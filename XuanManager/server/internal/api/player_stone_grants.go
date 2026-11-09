package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// 玩家钻石发放：后台直接给指定玩家增加 Account.stone，不经过俱乐部钻石池。
// 游戏服命令「异步_增加_玩家_钻石」只允许 boss 调用，正数增加、负数扣减；
// 本接口只做正向发放，成功后回读 tbl_Account.sm_stone 校验，并写 mgr_audit_log。

const playerStoneGrantAction = "game.player.grant_stone"

var playerStoneGrantMu sync.Mutex

type grantPlayerStoneRequest struct {
	Amount        int64  `json:"amount"`
	Reason        string `json:"reason"`
	ExpectedStone int64  `json:"expectedStone"`
	Confirm       bool   `json:"confirm"`
}

type playerStoneState struct {
	PlayerID string `json:"playerId"`
	Name     string `json:"name"`
	Stone    int64  `json:"stone"`
	RoomID   int64  `json:"roomId"`
}

type playerStoneGrantResponse struct {
	Player   playerStoneState `json:"player"`
	Amount   int64            `json:"amount"`
	Context  string           `json:"context"`
	Verified bool             `json:"verified"`
	Message  string           `json:"message"`
}

type playerStoneGrantRecord struct {
	ID           int64     `json:"id"`
	PlayerID     string    `json:"playerId"`
	LoginName    string    `json:"loginName"`
	AccountName  string    `json:"accountName"`
	Name         string    `json:"name"`
	Amount       int64     `json:"amount"`
	Reason       string    `json:"reason"`
	OperatorName string    `json:"operatorName"`
	StoneBefore  int64     `json:"stoneBefore"`
	StoneAfter   int64     `json:"stoneAfter"`
	Context      string    `json:"context"`
	CreatedAt    time.Time `json:"createdAt"`
}

func (s *Server) handleGrantPlayerStone(w http.ResponseWriter, r *http.Request, p principal) {
	playerID, err := normalizeGamePlayerID(r.PathValue("playerId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PLAYER_ID", err.Error())
		return
	}
	var input grantPlayerStoneRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if input.Amount < 1 || input.Amount > 1000000 {
		writeError(w, http.StatusBadRequest, "INVALID_GRANT_AMOUNT", "单次发放钻石必须是 1 到 1,000,000 的整数")
		return
	}
	input.Reason, err = normalizeAdjustmentReasonText(input.Reason, "发放原因")
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_GRANT_REASON", err.Error())
		return
	}
	if !input.Confirm {
		writeError(w, http.StatusBadRequest, "GRANT_CONFIRM_REQUIRED", "请确认本次操作会直接增加玩家钻石")
		return
	}

	playerStoneGrantMu.Lock()
	defer playerStoneGrantMu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 18*time.Second)
	defer cancel()

	before, err := s.readPlayerStoneState(ctx, playerID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "PLAYER_NOT_FOUND", "没有找到这个游戏玩家 ID")
		return
	}
	if err != nil {
		s.logger.Error("read player stone", "error", err, "playerId", playerID)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取玩家钻石失败")
		return
	}
	if before.Stone != input.ExpectedStone {
		writeError(w, http.StatusConflict, "STONE_CHANGED", "玩家钻石已变化，请刷新玩家列表后重新操作")
		return
	}

	operationContext := gameOperationContext("player-stone")
	requestAudit := map[string]any{
		"amount": input.Amount, "reason": input.Reason, "context": operationContext,
	}
	beforeAudit := map[string]any{"stone": before.Stone}

	result, callErr := s.callGameCommand(ctx, "异步_增加_玩家_钻石", map[string]any{
		"guuid": playerID, "stone_number": input.Amount, "context": operationContext,
	})
	if callErr != nil {
		s.logger.Error("grant player stone", "error", callErr, "playerId", playerID, "context", operationContext)
		s.audit(ctx, &p, playerStoneGrantAction, "game_player", playerID, requestAudit, beforeAudit, nil,
			502, "游戏服未确认钻石发放成功", clientIP(r))
		writeError(w, http.StatusBadGateway, "STONE_GRANT_FAILED", "游戏服未确认钻石发放成功，已停止操作")
		return
	}
	if result.RetCode != 512 {
		message := gameCommandErrorMessage(result, "钻石发放被拒绝")
		if gameCommandResultEmpty(result) {
			// 命令未注册时 /hall/command 返回 769 且 ret_result 为空，与业务拒绝的 error 文本不同。
			message = "游戏服尚未开放钻石发放命令（异步_增加_玩家_钻石），请先完成游戏服部署后重试"
		}
		s.audit(ctx, &p, playerStoneGrantAction, "game_player", playerID, requestAudit, beforeAudit, nil,
			400, message, clientIP(r))
		writeError(w, http.StatusBadRequest, "STONE_GRANT_REJECTED", message)
		return
	}

	target := before.Stone + input.Amount
	var grantResult struct {
		Add   int64 `json:"add"`
		Stone int64 `json:"stone"`
	}
	if err := json.Unmarshal(result.RetResult, &grantResult); err == nil && grantResult.Stone != 0 {
		// 优先用游戏服返回的变更后余额；玩家随后消费也不影响本次发放的落库判断。
		target = grantResult.Stone
	}
	after, verifyErr := s.waitForPlayerStone(ctx, playerID, target)
	verified := verifyErr == nil
	afterStone := target
	if !verified {
		afterStone = after.Stone
		s.logger.Error("verify player stone", "error", verifyErr, "playerId", playerID)
	}
	afterAudit := map[string]any{"stone": afterStone, "verified": verified}

	message := fmt.Sprintf("已为玩家 %s 发放 %d 钻，游戏服已回读校验", playerID, input.Amount)
	resultCode := 0
	if !verified {
		message = "钻石发放已提交，但未能回读校验；请刷新玩家列表确认，不要重复提交"
		resultCode = 202
	}
	s.audit(ctx, &p, playerStoneGrantAction, "game_player", playerID, requestAudit, beforeAudit, afterAudit, resultCode, message, clientIP(r))
	writeData(w, http.StatusOK, playerStoneGrantResponse{
		Player: playerStoneState{PlayerID: before.PlayerID, Name: before.Name, Stone: afterStone, RoomID: before.RoomID},
		Amount: input.Amount, Context: operationContext, Verified: verified, Message: message,
	})
}

func (s *Server) handleListPlayerStoneGrants(w http.ResponseWriter, r *http.Request, p principal) {
	page, size := pageParams(r)
	filter, err := parsePlayerStoneGrantFilter(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_FILTER", err.Error())
		return
	}
	where, args := buildPlayerStoneGrantWhere(filter, p)

	var total int64
	if err := s.db.QueryRowContext(r.Context(), `SELECT COUNT(*)
FROM mgr_audit_log audit_row
LEFT JOIN kbedm.tbl_Account game_player ON game_player.sm_guuid = audit_row.target_id
LEFT JOIN kbedm.kbe_accountinfos game_login ON game_login.entityDBID = game_player.id
WHERE `+where, args...).Scan(&total); err != nil {
		s.logger.Error("count player stone grants", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取钻石发放记录数量失败")
		return
	}

	queryArgs := append(append([]any{}, args...), size, (page-1)*size)
	rows, err := s.db.QueryContext(r.Context(), `SELECT
audit_row.id, audit_row.target_id,
COALESCE(game_player.sm_wxID, ''), COALESCE(game_login.accountName, ''), COALESCE(game_player.sm_name, ''),
audit_row.operator_name, audit_row.request_json, audit_row.before_json, audit_row.after_json, audit_row.created_at
FROM mgr_audit_log audit_row
LEFT JOIN kbedm.tbl_Account game_player ON game_player.sm_guuid = audit_row.target_id
LEFT JOIN kbedm.kbe_accountinfos game_login ON game_login.entityDBID = game_player.id
WHERE `+where+`
ORDER BY audit_row.id DESC
LIMIT ? OFFSET ?`, queryArgs...)
	if err != nil {
		s.logger.Error("list player stone grants", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取钻石发放记录失败")
		return
	}
	defer rows.Close()

	items := make([]playerStoneGrantRecord, 0, size)
	for rows.Next() {
		var item playerStoneGrantRecord
		var requestJSON, beforeJSON, afterJSON sql.NullString
		if err := rows.Scan(
			&item.ID, &item.PlayerID, &item.LoginName, &item.AccountName, &item.Name,
			&item.OperatorName, &requestJSON, &beforeJSON, &afterJSON, &item.CreatedAt,
		); err != nil {
			s.logger.Error("scan player stone grant", "error", err)
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取钻石发放记录数据失败")
			return
		}
		enrichPlayerStoneGrantRecord(&item, requestJSON.String, beforeJSON.String, afterJSON.String)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		s.logger.Error("iterate player stone grants", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取钻石发放记录数据失败")
		return
	}

	writeData(w, http.StatusOK, map[string]any{
		"items": items, "page": page, "pageSize": size, "total": total,
	})
}

type playerStoneGrantFilter struct {
	Keyword string
	From    string
	To      string
}

func parsePlayerStoneGrantFilter(r *http.Request) (playerStoneGrantFilter, error) {
	filter := playerStoneGrantFilter{
		Keyword: strings.TrimSpace(r.URL.Query().Get("keyword")),
		From:    strings.TrimSpace(r.URL.Query().Get("from")),
		To:      strings.TrimSpace(r.URL.Query().Get("to")),
	}
	if utf8.RuneCountInString(filter.Keyword) > 100 {
		return playerStoneGrantFilter{}, errors.New("查询内容不能超过 100 个字符")
	}
	for label, value := range map[string]string{"开始日期": filter.From, "结束日期": filter.To} {
		if value != "" {
			if _, err := time.Parse("2006-01-02", value); err != nil {
				return playerStoneGrantFilter{}, fmt.Errorf("%s格式必须是 YYYY-MM-DD", label)
			}
		}
	}
	if filter.From != "" && filter.To != "" && filter.From > filter.To {
		return playerStoneGrantFilter{}, errors.New("开始日期不能晚于结束日期")
	}
	return filter, nil
}

func buildPlayerStoneGrantWhere(filter playerStoneGrantFilter, p principal) (string, []any) {
	clauses := []string{
		"audit_row.target_type = ?",
		"audit_row.action = ?",
		"audit_row.result_code = 0",
		"(? = 1 OR " + nonRootAuditVisibilitySQL + ")",
	}
	args := []any{"game_player", playerStoneGrantAction, canSeeProtectedRootFlag(p)}
	if filter.Keyword != "" {
		like := "%" + filter.Keyword + "%"
		clauses = append(clauses, `(audit_row.target_id LIKE ? OR COALESCE(game_player.sm_wxID, '') LIKE ? OR COALESCE(game_login.accountName, '') LIKE ?
OR COALESCE(game_player.sm_name, '') LIKE ? OR audit_row.operator_name LIKE ? OR COALESCE(audit_row.request_json, '') LIKE ?)`)
		for range 6 {
			args = append(args, like)
		}
	}
	if filter.From != "" {
		clauses = append(clauses, "audit_row.created_at >= CONCAT(?, ' 00:00:00')")
		args = append(args, filter.From)
	}
	if filter.To != "" {
		clauses = append(clauses, "audit_row.created_at <= CONCAT(?, ' 23:59:59')")
		args = append(args, filter.To)
	}
	return strings.Join(clauses, " AND "), args
}

func enrichPlayerStoneGrantRecord(item *playerStoneGrantRecord, requestJSON, beforeJSON, afterJSON string) {
	var request struct {
		Amount  int64  `json:"amount"`
		Reason  string `json:"reason"`
		Context string `json:"context"`
	}
	var before, after struct {
		Stone int64 `json:"stone"`
	}
	_ = json.Unmarshal([]byte(requestJSON), &request)
	_ = json.Unmarshal([]byte(beforeJSON), &before)
	_ = json.Unmarshal([]byte(afterJSON), &after)
	item.Amount = request.Amount
	item.Reason = strings.TrimSpace(request.Reason)
	item.Context = strings.TrimSpace(request.Context)
	item.StoneBefore = before.Stone
	item.StoneAfter = after.Stone
}

func gameCommandResultEmpty(result gameCommandResponse) bool {
	raw := strings.TrimSpace(string(result.RetResult))
	return raw == "" || raw == "null" || raw == "{}"
}

func (s *Server) readPlayerStoneState(ctx context.Context, playerID string) (playerStoneState, error) {
	var state playerStoneState
	err := s.db.QueryRowContext(ctx, `SELECT sm_guuid, COALESCE(sm_name, ''), COALESCE(sm_stone, 0), COALESCE(sm_roomID, 0)
FROM kbedm.tbl_Account WHERE sm_guuid = ? LIMIT 1`, playerID).
		Scan(&state.PlayerID, &state.Name, &state.Stone, &state.RoomID)
	return state, err
}

func (s *Server) waitForPlayerStone(ctx context.Context, playerID string, expected int64) (playerStoneState, error) {
	var last playerStoneState
	var lastErr error
	for attempt := 0; attempt < 16; attempt++ {
		last, lastErr = s.readPlayerStoneState(ctx, playerID)
		if lastErr == nil && last.Stone == expected {
			return last, nil
		}
		if attempt < 15 {
			select {
			case <-ctx.Done():
				return last, ctx.Err()
			case <-time.After(300 * time.Millisecond):
			}
		}
	}
	if lastErr != nil {
		return last, lastErr
	}
	return last, fmt.Errorf("player stone %d does not match expected %d", last.Stone, expected)
}
