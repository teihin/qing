package api

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

// 联盟管理（联盟模式 V2）：
//   - club_union_info       联盟本体与联盟池额度（union_quota，单位分）
//   - club_guuid_info       俱乐部归属（union_id）与俱乐部可用额度（union_quota，单位分）
//   - tbl_Account           俱乐部创建者（sm_club_make / sm_club_make2）
//
// 平台后台只能给联盟池注资（游戏命令「增加_联盟_额度」，仅 boss），
// 俱乐部额度由联盟总群主在游戏内用「授信_联盟_额度」下发。
// 后台不直接改额度表，避免和游戏服形成第二份真相。

// unionQuotaMutationMu 串行化联盟池注资：额度是钱，并发叠加会让回读校验失去意义。
var unionQuotaMutationMu sync.Mutex

type unionListItem struct {
	UnionID string `json:"unionId"`
	Name    string `json:"name"`
	// OwnerID / OwnerName 是联盟总群主（创建者）。
	OwnerID   string `json:"ownerId"`
	OwnerName string `json:"ownerName"`
	// OwnerClubID / OwnerClubName 是总群主自己的俱乐部。
	OwnerClubID   string `json:"ownerClubId"`
	OwnerClubName string `json:"ownerClubName"`
	// PoolQuotaFen 是联盟池余额（分）；TotalClubQuotaFen 是已分给俱乐部的额度合计（分）。
	PoolQuotaFen      int64  `json:"poolQuotaFen"`
	TotalClubQuotaFen int64  `json:"totalClubQuotaFen"`
	MemberCount       int64  `json:"memberCount"`
	Status            string `json:"status"`
	CreatedAt         string `json:"createdAt"`
}

type unionClubItem struct {
	ClubID      string `json:"clubId"`
	Name        string `json:"name"`
	Status      string `json:"status"`
	Mode        string `json:"mode"`
	OwnerID     string `json:"ownerId"`
	OwnerName   string `json:"ownerName"`
	QuotaFen    int64  `json:"quotaFen"`
	MemberCount int64  `json:"memberCount"`
	Tax         string `json:"tax"`
}

type unionDetailResponse struct {
	Union unionListItem   `json:"union"`
	Clubs []unionClubItem `json:"clubs"`
}

type unionFilters struct {
	Keyword string
}

func parseUnionFilters(r *http.Request) (unionFilters, error) {
	filters := unionFilters{Keyword: strings.TrimSpace(r.URL.Query().Get("keyword"))}
	if len([]rune(filters.Keyword)) > 100 {
		return unionFilters{}, errors.New("关键字不能超过 100 个字符")
	}
	return filters, nil
}

func (s *Server) handleListUnions(w http.ResponseWriter, r *http.Request, _ principal) {
	page, size := pageParams(r)
	filters, err := parseUnionFilters(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_FILTER", err.Error())
		return
	}

	where := "cu.status <> 'init'"
	args := []any{}
	if filters.Keyword != "" {
		where += " AND (cu.union_id = ? OR cu.union_name LIKE ? ESCAPE '\\\\')"
		args = append(args, filters.Keyword, "%"+escapeLike(filters.Keyword)+"%")
	}

	var total int64
	if err := s.db.QueryRowContext(r.Context(),
		`SELECT COUNT(*) FROM kbedm.club_union_info cu WHERE `+where, args...).Scan(&total); err != nil {
		s.logger.Error("count unions", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取联盟数量失败")
		return
	}

	queryArgs := append([]any{}, args...)
	queryArgs = append(queryArgs, size, (page-1)*size)
	rows, err := s.db.QueryContext(r.Context(), `SELECT
cu.union_id, COALESCE(cu.union_name, ''), COALESCE(cu.owner_guuid, ''), COALESCE(cu.owner_name, ''),
COALESCE(cu.club_guuid, ''),
COALESCE((SELECT c.club_name FROM kbedm.club_guuid_info c WHERE c.club_guuid = cu.club_guuid ORDER BY c.id LIMIT 1), ''),
cu.union_quota, COALESCE(cu.status, ''), COALESCE(cu.date, ''),
COALESCE(agg.member_count, 0), COALESCE(agg.total_quota, 0)
FROM kbedm.club_union_info cu
LEFT JOIN (
  SELECT union_id, COUNT(*) AS member_count, SUM(union_quota) AS total_quota
  FROM kbedm.club_guuid_info
  WHERE union_id <> '' AND club_status NOT IN ('init', 'del')
  GROUP BY union_id
) agg ON agg.union_id = cu.union_id
WHERE `+where+`
ORDER BY cu.id DESC
LIMIT ? OFFSET ?`, queryArgs...)
	if err != nil {
		s.logger.Error("list unions", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取联盟列表失败")
		return
	}
	defer rows.Close()

	items := make([]unionListItem, 0, size)
	for rows.Next() {
		var item unionListItem
		if err := rows.Scan(&item.UnionID, &item.Name, &item.OwnerID, &item.OwnerName,
			&item.OwnerClubID, &item.OwnerClubName, &item.PoolQuotaFen, &item.Status,
			&item.CreatedAt, &item.MemberCount, &item.TotalClubQuotaFen); err != nil {
			s.logger.Error("scan union row", "error", err)
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取联盟数据失败")
			return
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取联盟列表失败")
		return
	}

	writeData(w, http.StatusOK, map[string]any{
		"items": items, "total": total, "page": page, "pageSize": size,
	})
}

func (s *Server) handleGetUnion(w http.ResponseWriter, r *http.Request, _ principal) {
	unionID, err := normalizeUnionID(r.PathValue("unionId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_UNION_ID", err.Error())
		return
	}
	detail, err := s.readUnionDetail(r.Context(), unionID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "UNION_NOT_FOUND", "没有找到这个联盟")
		return
	}
	if err != nil {
		s.logger.Error("read union detail", "error", err, "unionId", unionID)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取联盟详情失败")
		return
	}
	writeData(w, http.StatusOK, detail)
}

func (s *Server) readUnionDetail(ctx context.Context, unionID string) (unionDetailResponse, error) {
	var detail unionDetailResponse
	var err error
	detail.Union, err = s.readUnion(ctx, unionID)
	if err != nil {
		return detail, err
	}

	rows, err := s.db.QueryContext(ctx, `SELECT club_guuid, COALESCE(club_name, ''),
COALESCE(club_status, ''), COALESCE(club_mode, ''), club_tax, COALESCE(number_count, 0), union_quota
FROM kbedm.club_guuid_info
WHERE union_id = ? AND club_status NOT IN ('init', 'del')
ORDER BY id DESC`, unionID)
	if err != nil {
		return detail, err
	}
	defer rows.Close()

	clubs := make([]unionClubItem, 0, 16)
	for rows.Next() {
		var item unionClubItem
		var tax any
		if err := rows.Scan(&item.ClubID, &item.Name, &item.Status, &item.Mode,
			&tax, &item.MemberCount, &item.QuotaFen); err != nil {
			return detail, err
		}
		item.Tax = stringOrEmpty(tax)
		clubs = append(clubs, item)
	}
	if err := rows.Err(); err != nil {
		return detail, err
	}

	clubIDs := make([]string, 0, len(clubs))
	for _, club := range clubs {
		clubIDs = append(clubIDs, club.ClubID)
	}
	owners, _, err := s.clubOwnersAndAgentCounts(ctx, clubIDs)
	if err != nil {
		return detail, err
	}
	ownerIDs := make([]string, 0, len(clubs))
	for index := range clubs {
		clubs[index].OwnerID = owners[clubs[index].ClubID]
		if clubs[index].OwnerID != "" {
			ownerIDs = append(ownerIDs, clubs[index].OwnerID)
		}
	}
	if names, nameErr := s.playerNames(ctx, ownerIDs); nameErr == nil {
		for index := range clubs {
			clubs[index].OwnerName = names[clubs[index].OwnerID]
		}
	} else {
		s.logger.Error("read union club owner names", "error", nameErr, "unionId", unionID)
	}
	detail.Clubs = clubs
	return detail, nil
}

// readUnion 读取联盟本体与成员俱乐部聚合；sql.ErrNoRows 表示联盟不存在或已初始化占位。
func (s *Server) readUnion(ctx context.Context, unionID string) (unionListItem, error) {
	var item unionListItem
	err := s.db.QueryRowContext(ctx, `SELECT
cu.union_id, COALESCE(cu.union_name, ''), COALESCE(cu.owner_guuid, ''), COALESCE(cu.owner_name, ''),
COALESCE(cu.club_guuid, ''),
COALESCE((SELECT c.club_name FROM kbedm.club_guuid_info c WHERE c.club_guuid = cu.club_guuid ORDER BY c.id LIMIT 1), ''),
cu.union_quota, COALESCE(cu.status, ''), COALESCE(cu.date, ''),
COALESCE(agg.member_count, 0), COALESCE(agg.total_quota, 0)
FROM kbedm.club_union_info cu
LEFT JOIN (
  SELECT union_id, COUNT(*) AS member_count, SUM(union_quota) AS total_quota
  FROM kbedm.club_guuid_info
  WHERE union_id <> '' AND club_status NOT IN ('init', 'del')
  GROUP BY union_id
) agg ON agg.union_id = cu.union_id
WHERE cu.union_id = ? AND cu.status <> 'init'
LIMIT 1`, unionID).Scan(&item.UnionID, &item.Name, &item.OwnerID, &item.OwnerName,
		&item.OwnerClubID, &item.OwnerClubName, &item.PoolQuotaFen, &item.Status,
		&item.CreatedAt, &item.MemberCount, &item.TotalClubQuotaFen)
	return item, err
}

type adjustUnionQuotaRequest struct {
	Action                string   `json:"action"`
	AmountYuan            float64  `json:"amountYuan"`
	Reason                string   `json:"reason"`
	ExpectedPoolQuotaYuan *float64 `json:"expectedPoolQuotaYuan"`
	Confirm               bool     `json:"confirm"`
}

type unionQuotaAdjustmentResponse struct {
	UnionID       string  `json:"unionId"`
	PoolQuotaFen  int64   `json:"poolQuotaFen"`
	PoolQuotaYuan float64 `json:"poolQuotaYuan"`
	DeltaFen      int64   `json:"deltaFen"`
	Verified      bool    `json:"verified"`
	Message       string  `json:"message"`
}

// handleAdjustUnionQuota 给联盟池注资。
// 联盟模式 V2 只提供「增加_联盟_额度」（仅 boss、只能正数），
// 俱乐部额度由联盟总群主在游戏内授信，后台不越权分配。
func (s *Server) handleAdjustUnionQuota(w http.ResponseWriter, r *http.Request, p principal) {
	unionID, err := normalizeUnionID(r.PathValue("unionId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_UNION_ID", err.Error())
		return
	}
	var input adjustUnionQuotaRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Action = strings.TrimSpace(strings.ToLower(input.Action))
	if input.Action != "" && input.Action != "add" {
		writeError(w, http.StatusBadRequest, "INVALID_ADJUSTMENT_ACTION", "平台只能增加联盟池额度，不能扣减或直接分配俱乐部额度")
		return
	}
	if math.IsNaN(input.AmountYuan) || math.IsInf(input.AmountYuan, 0) || input.AmountYuan <= 0 {
		writeError(w, http.StatusBadRequest, "INVALID_ADJUSTMENT_AMOUNT", "注资金额必须大于 0")
		return
	}
	deltaFen := int64(math.Round(input.AmountYuan * 100))
	if deltaFen <= 0 {
		writeError(w, http.StatusBadRequest, "INVALID_ADJUSTMENT_AMOUNT", "注资金额不能为 0")
		return
	}
	if deltaFen > 100000000 {
		writeError(w, http.StatusBadRequest, "INVALID_ADJUSTMENT_AMOUNT", "单次注资不能超过 100 万元")
		return
	}
	if input.Reason, err = normalizeUnionQuotaReason(input.Reason); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_ADJUSTMENT_REASON", err.Error())
		return
	}
	if !input.Confirm {
		writeError(w, http.StatusBadRequest, "ADJUSTMENT_CONFIRM_REQUIRED", "请确认本次操作会直接增加联盟池额度")
		return
	}

	unionQuotaMutationMu.Lock()
	defer unionQuotaMutationMu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	before, beforeErr := s.readUnionPoolQuota(ctx, unionID)
	if errors.Is(beforeErr, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "UNION_NOT_FOUND", "没有找到这个联盟")
		return
	}
	if beforeErr != nil {
		s.logger.Error("read union quota before adjust", "error", beforeErr, "unionId", unionID)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取联盟额度失败")
		return
	}
	if input.ExpectedPoolQuotaYuan != nil &&
		math.Abs(float64(before)/100-*input.ExpectedPoolQuotaYuan) > 0.005 {
		writeError(w, http.StatusConflict, "QUOTA_CHANGED", "联盟池额度已变化，请刷新后重新操作")
		return
	}

	operationContext := gameOperationContext("union-quota")
	requestAudit := map[string]any{
		"unionId": unionID, "action": "add", "deltaFen": deltaFen,
		"reason": input.Reason, "context": operationContext,
	}
	auditBefore := map[string]any{"poolQuotaFen": before}

	result, callErr := s.callGameCommand(ctx, "增加_联盟_额度", map[string]any{
		"union_id": unionID, "quota_fen": deltaFen, "context": operationContext,
	})
	if callErr != nil {
		s.audit(ctx, &p, "game.union.quota_adjust", "game_union", unionID, requestAudit, auditBefore, nil,
			502, "联盟额度注资服务调用失败", clientIP(r))
		writeError(w, http.StatusBadGateway, "QUOTA_ADJUSTMENT_FAILED", "游戏服务调用失败，联盟额度未确认变更")
		return
	}
	if result.RetCode != 512 {
		message := gameCommandErrorMessage(result, "联盟额度注资被拒绝")
		s.audit(ctx, &p, "game.union.quota_adjust", "game_union", unionID, requestAudit, auditBefore, nil,
			400, message, clientIP(r))
		writeError(w, http.StatusBadRequest, "QUOTA_ADJUSTMENT_REJECTED", message)
		return
	}

	after, afterErr := s.waitForUnionPoolQuota(ctx, unionID, before+deltaFen)
	verified := afterErr == nil
	message := "联盟池额度已增加，游戏服已回读校验"
	if !verified {
		message = "注资已提交，但未能回读校验；请稍后刷新联盟列表确认，不要重复提交"
		s.logger.Error("verify union quota after adjust", "error", afterErr, "unionId", unionID)
	}
	resultCode := 0
	if !verified {
		resultCode = 202
	}
	s.audit(ctx, &p, "game.union.quota_adjust", "game_union", unionID, requestAudit, auditBefore,
		map[string]any{"poolQuotaFen": after, "verified": verified}, resultCode, message, clientIP(r))
	writeData(w, http.StatusOK, unionQuotaAdjustmentResponse{
		UnionID: unionID, PoolQuotaFen: after, PoolQuotaYuan: float64(after) / 100,
		DeltaFen: deltaFen, Verified: verified, Message: message,
	})
}

func (s *Server) readUnionPoolQuota(ctx context.Context, unionID string) (int64, error) {
	var quota int64
	err := s.db.QueryRowContext(ctx, `SELECT union_quota FROM kbedm.club_union_info
WHERE union_id = ? AND status = 'used' LIMIT 1`, unionID).Scan(&quota)
	return quota, err
}

func (s *Server) waitForUnionPoolQuota(ctx context.Context, unionID string, expected int64) (int64, error) {
	var last int64
	var lastErr error
	for attempt := 0; attempt < 6; attempt++ {
		last, lastErr = s.readUnionPoolQuota(ctx, unionID)
		if lastErr == nil && last == expected {
			return last, nil
		}
		if attempt < 5 {
			select {
			case <-ctx.Done():
				return last, ctx.Err()
			case <-time.After(400 * time.Millisecond):
			}
		}
	}
	if lastErr != nil {
		return last, lastErr
	}
	return last, errors.New("联盟池额度未达到预期值")
}

func normalizeUnionID(value string) (string, error) {
	value = strings.TrimSpace(value)
	if !isSixDigitCode(value) {
		return "", errors.New("联盟 ID 必须是 6 位数字")
	}
	return value, nil
}

func normalizeUnionQuotaReason(value string) (string, error) {
	value = strings.TrimSpace(value)
	if utf8.RuneCountInString(value) < 2 || utf8.RuneCountInString(value) > 120 {
		return "", errors.New("操作原因必须填写 2 到 120 个字符")
	}
	for _, char := range value {
		if unicode.IsControl(char) {
			return "", errors.New("操作原因不能包含换行或控制字符")
		}
	}
	return strings.Join(strings.Fields(value), " "), nil
}
