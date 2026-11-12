package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
)

// 大小BOSS 管理范围：玩家管理页给账号配置可管理的联盟 / 俱乐部。
// 写入走游戏服「异步_设置_俱乐部_管理范围」，成功回读 tbl_Account.sm_union_manage / sm_club_manage。
// 后台玩家列表的 isBoss / boss 筛选也以这两列为准，不再看等级 99 / 董事长 / 总裁。

const (
	playerManageScopeAction      = "game.player.manage_scope"
	setClubManageScopeCommand    = "异步_设置_俱乐部_管理范围"
	playerManageScopeMaxIDs      = 200
	playerManageScopeVerifyTimes = 8
)

var (
	playerManageScopeMu  sync.Mutex
	manageScopeIDPattern = regexp.MustCompile(`^[0-9]{6}$`)
)

type playerManageScopeState struct {
	UnionManage string
	ClubManage  string
}

type setPlayerManageScopeRequest struct {
	UnionIDs []string `json:"unionIds"`
	ClubIDs  []string `json:"clubIds"`
	// 前端把列表里看到的值带回来；后台先比对再写，避免两个管理员同时改时互相覆盖。
	ExpectedUnionManage *string `json:"expectedUnionManage"`
	ExpectedClubManage  *string `json:"expectedClubManage"`
	Confirm             bool    `json:"confirm"`
}

type setPlayerManageScopeResponse struct {
	PlayerID    string `json:"playerId"`
	UnionManage string `json:"unionManage"`
	ClubManage  string `json:"clubManage"`
	Verified    bool   `json:"verified"`
	Message     string `json:"message"`
	Context     string `json:"context"`
}

type manageScopeOption struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	OwnerName   string `json:"ownerName,omitempty"`
	ClubCount   int64  `json:"clubCount,omitempty"`
	MemberCount int64  `json:"memberCount,omitempty"`
}

type manageScopeOptions struct {
	Unions []manageScopeOption `json:"unions"`
	Clubs  []manageScopeOption `json:"clubs"`
}

type manageScopeName struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func splitCommaIDs(raw string) []string {
	result := make([]string, 0)
	seen := map[string]bool{}
	for _, part := range strings.Split(raw, ",") {
		id := strings.TrimSpace(part)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		result = append(result, id)
	}
	return result
}

func manageScopeNames(ids []string, names map[string]string) []manageScopeName {
	result := make([]manageScopeName, 0, len(ids))
	for _, id := range ids {
		result = append(result, manageScopeName{ID: id, Name: names[id]})
	}
	return result
}

// attachPlayerManageScopeNames 给玩家列表批量补「可管理联盟 / 俱乐部」名称。
// 名称只用于展示：查不到时保留空名称，前端回退显示编号，不能因此让列表失败。
func (s *Server) attachPlayerManageScopeNames(ctx context.Context, items []playerItem) error {
	unionSet := map[string]bool{}
	clubSet := map[string]bool{}
	for _, item := range items {
		for _, id := range splitCommaIDs(item.UnionManage) {
			unionSet[id] = true
		}
		for _, id := range splitCommaIDs(item.ClubManage) {
			clubSet[id] = true
		}
	}

	unionNames := map[string]string{}
	if len(unionSet) > 0 {
		ids := make([]string, 0, len(unionSet))
		args := make([]any, 0, len(unionSet))
		for id := range unionSet {
			ids = append(ids, id)
			args = append(args, id)
		}
		placeholders := strings.TrimRight(strings.Repeat("?,", len(ids)), ",")
		rows, err := s.db.QueryContext(ctx, `SELECT union_id, COALESCE(union_name, '')
FROM kbedm.club_union_info WHERE union_id IN (`+placeholders+`)`, args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id, name string
			if err := rows.Scan(&id, &name); err != nil {
				return err
			}
			unionNames[id] = name
		}
		if err := rows.Err(); err != nil {
			return err
		}
	}

	clubNames := map[string]string{}
	if len(clubSet) > 0 {
		ids := make([]string, 0, len(clubSet))
		for id := range clubSet {
			ids = append(ids, id)
		}
		metas, err := s.readActiveClubMeta(ctx, ids)
		if err != nil {
			return err
		}
		for id, meta := range metas {
			clubNames[id] = meta.Name
		}
	}

	for index := range items {
		items[index].UnionManageNames = manageScopeNames(splitCommaIDs(items[index].UnionManage), unionNames)
		items[index].ClubManageNames = manageScopeNames(splitCommaIDs(items[index].ClubManage), clubNames)
	}
	return nil
}

// handlePlayerManageScopeOptions 给「管理范围」弹窗提供可选项：
// 全部未解散联盟 + 未加入联盟的独立俱乐部。前端只做选择，不再手输编号。
func (s *Server) handlePlayerManageScopeOptions(w http.ResponseWriter, r *http.Request, _ principal) {
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	unionRows, err := s.db.QueryContext(ctx, `SELECT cu.union_id, COALESCE(cu.union_name, ''),
COALESCE(cu.owner_name, ''),
COALESCE((SELECT COUNT(*) FROM kbedm.club_guuid_info c
          WHERE c.union_id = cu.union_id AND c.club_status NOT IN ('init','del')), 0)
FROM kbedm.club_union_info cu
WHERE cu.status = 'used'
ORDER BY cu.id DESC
LIMIT 5000`)
	if err != nil {
		s.logger.Error("list manage scope unions", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取联盟列表失败")
		return
	}
	defer unionRows.Close()

	options := manageScopeOptions{Unions: []manageScopeOption{}, Clubs: []manageScopeOption{}}
	for unionRows.Next() {
		var item manageScopeOption
		if err := unionRows.Scan(&item.ID, &item.Name, &item.OwnerName, &item.ClubCount); err != nil {
			s.logger.Error("scan manage scope union", "error", err)
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "解析联盟列表失败")
			return
		}
		options.Unions = append(options.Unions, item)
	}
	if err := unionRows.Err(); err != nil {
		s.logger.Error("iterate manage scope unions", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取联盟列表失败")
		return
	}

	clubRows, err := s.db.QueryContext(ctx, `SELECT c.club_guuid, COALESCE(c.club_name, ''),
COALESCE(c.number_count, 0)
FROM kbedm.club_guuid_info c
WHERE c.club_status NOT IN ('init','del') AND COALESCE(c.union_id, '') = ''
ORDER BY c.id DESC
LIMIT 5000`)
	if err != nil {
		s.logger.Error("list manage scope clubs", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取独立俱乐部列表失败")
		return
	}
	defer clubRows.Close()
	for clubRows.Next() {
		var item manageScopeOption
		if err := clubRows.Scan(&item.ID, &item.Name, &item.MemberCount); err != nil {
			s.logger.Error("scan manage scope club", "error", err)
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "解析独立俱乐部失败")
			return
		}
		options.Clubs = append(options.Clubs, item)
	}
	if err := clubRows.Err(); err != nil {
		s.logger.Error("iterate manage scope clubs", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取独立俱乐部列表失败")
		return
	}

	writeData(w, http.StatusOK, options)
}

// hasManageScopeColumn 探测游戏服是否已经部署 union_manage 列。
// 未部署时玩家列表退回只看 club_manage，避免整条 SQL 因 Unknown column 失败。
func (s *Server) hasManageScopeColumn(ctx context.Context) bool {
	if s.db == nil {
		return false
	}
	s.manageScopeColumnMu.Lock()
	defer s.manageScopeColumnMu.Unlock()
	if s.manageScopeColumnChecked {
		return s.manageScopeColumnOK
	}
	var count int
	// 与其它玩家查询一致：固定查 kbedm，不依赖后台库连接当前选中的 schema。
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*)
FROM information_schema.columns
WHERE table_schema = 'kbedm' AND table_name = 'tbl_Account' AND column_name = 'sm_union_manage'`).Scan(&count)
	if err != nil {
		if s.logger != nil {
			s.logger.Warn("check sm_union_manage column", "error", err)
		}
		return false
	}
	s.manageScopeColumnChecked = true
	s.manageScopeColumnOK = count > 0
	return s.manageScopeColumnOK
}

func (s *Server) readPlayerManageScope(ctx context.Context, playerID string) (playerManageScopeState, error) {
	var state playerManageScopeState
	err := s.db.QueryRowContext(ctx, `SELECT COALESCE(sm_union_manage, ''), COALESCE(sm_club_manage, '')
FROM kbedm.tbl_Account WHERE sm_guuid = ? LIMIT 1`, playerID).
		Scan(&state.UnionManage, &state.ClubManage)
	return state, err
}

func (s *Server) waitForPlayerManageScope(ctx context.Context, playerID string, unionIDs, clubIDs []string) (playerManageScopeState, error) {
	var last playerManageScopeState
	var lastErr error
	for attempt := 0; attempt < playerManageScopeVerifyTimes; attempt++ {
		last, lastErr = s.readPlayerManageScope(ctx, playerID)
		if lastErr == nil && scopeIDsEqual(last.UnionManage, unionIDs) && scopeIDsEqual(last.ClubManage, clubIDs) {
			return last, nil
		}
		if attempt < playerManageScopeVerifyTimes-1 {
			select {
			case <-ctx.Done():
				return last, ctx.Err()
			case <-time.After(250 * time.Millisecond):
			}
		}
	}
	if lastErr == nil {
		lastErr = errors.New("回读的管理范围与提交值不一致")
	}
	return last, lastErr
}

// normalizeManageScopeIDs 接受数组或逗号/空白分隔的字符串，去空、去重并校验 6 位数字。
func normalizeManageScopeIDs(values []string) ([]string, error) {
	result := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, raw := range values {
		for _, part := range strings.FieldsFunc(raw, func(char rune) bool {
			return char == ',' || char == '，' || char == ' ' || char == '\t' || char == '\n' || char == '\r'
		}) {
			id := strings.TrimSpace(part)
			if id == "" {
				continue
			}
			if !manageScopeIDPattern.MatchString(id) {
				return nil, fmt.Errorf("编号 %s 不是 6 位数字", id)
			}
			if seen[id] {
				continue
			}
			seen[id] = true
			result = append(result, id)
		}
	}
	if len(result) > playerManageScopeMaxIDs {
		return nil, fmt.Errorf("单次最多配置 %d 个编号", playerManageScopeMaxIDs)
	}
	return result, nil
}

func scopeIDsEqual(raw string, expected []string) bool {
	actual, err := normalizeManageScopeIDs([]string{raw})
	if err != nil {
		return false
	}
	if len(actual) != len(expected) {
		return false
	}
	seen := make(map[string]bool, len(actual))
	for _, id := range actual {
		seen[id] = true
	}
	for _, id := range expected {
		if !seen[id] {
			return false
		}
	}
	return true
}

func (s *Server) handleSetPlayerManageScope(w http.ResponseWriter, r *http.Request, p principal) {
	playerID, err := normalizeGamePlayerID(r.PathValue("playerId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PLAYER_ID", err.Error())
		return
	}
	var input setPlayerManageScopeRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	unionIDs, err := normalizeManageScopeIDs(input.UnionIDs)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_UNION_IDS", "可管理联盟号不正确："+err.Error())
		return
	}
	clubIDs, err := normalizeManageScopeIDs(input.ClubIDs)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_CLUB_IDS", "可管理俱乐部号不正确："+err.Error())
		return
	}
	if !input.Confirm {
		writeError(w, http.StatusBadRequest, "SCOPE_CONFIRM_REQUIRED", "请确认本次操作会覆盖该账号的可管理联盟和俱乐部")
		return
	}
	if !s.hasManageScopeColumn(r.Context()) {
		writeError(w, http.StatusServiceUnavailable, "SCOPE_COLUMN_MISSING", "游戏服尚未部署 union_manage 字段，请先完成游戏服部署后重试")
		return
	}

	playerManageScopeMu.Lock()
	defer playerManageScopeMu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 18*time.Second)
	defer cancel()

	before, err := s.readPlayerManageScope(ctx, playerID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "PLAYER_NOT_FOUND", "没有找到这个游戏玩家 ID")
		return
	}
	if err != nil {
		s.logger.Error("read player manage scope", "error", err, "playerId", playerID)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取玩家管理范围失败")
		return
	}
	if input.ExpectedUnionManage != nil && !scopeIDsEqual(before.UnionManage, mustNormalizeScopeIDs(*input.ExpectedUnionManage)) {
		writeError(w, http.StatusConflict, "SCOPE_CHANGED", "该玩家的联盟管理范围已变化，请刷新玩家列表后重新操作")
		return
	}
	if input.ExpectedClubManage != nil && !scopeIDsEqual(before.ClubManage, mustNormalizeScopeIDs(*input.ExpectedClubManage)) {
		writeError(w, http.StatusConflict, "SCOPE_CHANGED", "该玩家的俱乐部管理范围已变化，请刷新玩家列表后重新操作")
		return
	}

	operationContext := gameOperationContext("player-manage-scope")
	requestAudit := map[string]any{
		"union_ids": unionIDs, "club_ids": clubIDs, "context": operationContext,
	}
	beforeAudit := map[string]any{
		"union_manage": before.UnionManage, "club_manage": before.ClubManage,
	}
	result, callErr := s.callGameCommand(ctx, setClubManageScopeCommand, map[string]any{
		"guuid": playerID, "union_ids": unionIDs, "club_ids": clubIDs, "context": operationContext,
	})
	if callErr != nil {
		s.logger.Error("set player manage scope", "error", callErr, "playerId", playerID, "context", operationContext)
		s.audit(ctx, &p, playerManageScopeAction, "game_player", playerID, requestAudit, beforeAudit, nil,
			502, "游戏服未确认管理范围设置成功", clientIP(r))
		writeError(w, http.StatusBadGateway, "SCOPE_SET_FAILED", "游戏服未确认管理范围设置成功，已停止操作")
		return
	}
	if result.RetCode != 512 && result.RetCode != 1280 {
		message := gameCommandErrorMessage(result, "管理范围设置被拒绝")
		if gameCommandResultEmpty(result) {
			message = "游戏服尚未开放管理范围设置命令（异步_设置_俱乐部_管理范围），请先完成游戏服部署后重试"
		}
		s.audit(ctx, &p, playerManageScopeAction, "game_player", playerID, requestAudit, beforeAudit, nil,
			400, message, clientIP(r))
		writeError(w, http.StatusBadRequest, "SCOPE_SET_REJECTED", message)
		return
	}

	after := playerManageScopeState{}
	var payload struct {
		UnionManage string `json:"union_manage"`
		ClubManage  string `json:"club_manage"`
	}
	if err := json.Unmarshal(result.RetResult, &payload); err == nil {
		after.UnionManage, after.ClubManage = payload.UnionManage, payload.ClubManage
	}
	verified := false
	readBack, verifyErr := s.waitForPlayerManageScope(ctx, playerID, unionIDs, clubIDs)
	if verifyErr == nil {
		after = readBack
		verified = true
	} else if after.UnionManage != "" || after.ClubManage != "" {
		verified = scopeIDsEqual(after.UnionManage, unionIDs) && scopeIDsEqual(after.ClubManage, clubIDs)
	}
	if !verified {
		s.logger.Error("verify player manage scope", "error", verifyErr, "playerId", playerID)
	}

	message := fmt.Sprintf("已更新玩家 %s 的管理范围：联盟 %d 个、俱乐部 %d 个，游戏服已回读校验", playerID, len(unionIDs), len(clubIDs))
	resultCode := 0
	if !verified {
		message = "管理范围已提交，但未能回读校验；请刷新玩家列表确认，不要重复提交"
		resultCode = 202
	}
	afterAudit := map[string]any{
		"union_manage": after.UnionManage, "club_manage": after.ClubManage, "verified": verified,
	}
	s.audit(ctx, &p, playerManageScopeAction, "game_player", playerID, requestAudit, beforeAudit, afterAudit,
		resultCode, message, clientIP(r))
	writeData(w, http.StatusOK, setPlayerManageScopeResponse{
		PlayerID: playerID, UnionManage: after.UnionManage, ClubManage: after.ClubManage,
		Verified: verified, Message: message, Context: operationContext,
	})
}

// mustNormalizeScopeIDs 用于比对前端回传的旧值；格式不合法时返回空集，必然与库值不一致。
func mustNormalizeScopeIDs(raw string) []string {
	ids, err := normalizeManageScopeIDs([]string{raw})
	if err != nil {
		return []string{}
	}
	return ids
}
