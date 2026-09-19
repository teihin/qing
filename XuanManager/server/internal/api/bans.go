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
	"unicode"
	"unicode/utf8"
)

const defaultBanReason = "你的账号已被暂停使用！"

var playerBanMutationMu sync.Mutex

type bannedPlayerItem struct {
	PlayerID         string     `json:"playerId"`
	LoginName        string     `json:"loginName"`
	AccountName      string     `json:"accountName"`
	Name             string     `json:"name"`
	Role             string     `json:"role"`
	Reason           string     `json:"reason"`
	AgentID          string     `json:"agentId"`
	RoomID           int64      `json:"roomId"`
	ClientVersion    string     `json:"clientVersion"`
	RegistrationTime string     `json:"registrationTime"`
	LastLoginAt      *time.Time `json:"lastLoginAt"`
	BannedBy         string     `json:"bannedBy"`
	BannedAt         *time.Time `json:"bannedAt"`
}

type playerBanState struct {
	PlayerID     string `json:"playerId"`
	LoginName    string `json:"loginName"`
	AccountName  string `json:"accountName"`
	Name         string `json:"name"`
	ClientStatus string `json:"clientStatus"`
}

type createPlayerBanRequest struct {
	PlayerID string `json:"playerId"`
	Reason   string `json:"reason"`
	Confirm  bool   `json:"confirm"`
}

type removePlayerBanRequest struct {
	Confirm bool `json:"confirm"`
}

type banAuditMetadata struct {
	OperatorName string
	CreatedAt    time.Time
	Hidden       bool
}

type playerBanHistoryItem struct {
	ID            int64     `json:"id"`
	PlayerID      string    `json:"playerId"`
	LoginName     string    `json:"loginName"`
	AccountName   string    `json:"accountName"`
	Name          string    `json:"name"`
	Operation     string    `json:"operation"`
	Reason        string    `json:"reason"`
	OperatorName  string    `json:"operatorName"`
	Success       bool      `json:"success"`
	ResultCode    int       `json:"resultCode"`
	ResultMessage string    `json:"resultMessage"`
	CreatedAt     time.Time `json:"createdAt"`
}

type playerBanHistoryFilter struct {
	Keyword   string
	Operation string
	Result    string
}

func (s *Server) handleListBannedPlayers(w http.ResponseWriter, r *http.Request, p principal) {
	page, size := pageParams(r)
	keyword := strings.TrimSpace(r.URL.Query().Get("keyword"))
	if utf8.RuneCountInString(keyword) > 100 {
		writeError(w, http.StatusBadRequest, "INVALID_FILTER", "查询内容不能超过 100 个字符")
		return
	}
	where, args := buildBannedPlayerWhere(keyword)

	var total int64
	if err := s.db.QueryRowContext(r.Context(), `SELECT COUNT(*)
FROM kbedm.tbl_Account a
LEFT JOIN kbedm.kbe_accountinfos k ON k.entityDBID = a.id
WHERE `+where, args...).Scan(&total); err != nil {
		s.logger.Error("count banned game players", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取已封账号数量失败")
		return
	}

	queryArgs := append(append([]any{}, args...), size, (page-1)*size)
	rows, err := s.db.QueryContext(r.Context(), `SELECT
a.sm_guuid, a.sm_wxID, COALESCE(k.accountName, ''), a.sm_name, a.sm_role,
a.sm_client_status, a.sm_agentID, a.sm_roomID, a.sm_client_version, a.sm_reg_time,
FROM_UNIXTIME(NULLIF(k.lasttime, 0))
FROM kbedm.tbl_Account a
LEFT JOIN kbedm.kbe_accountinfos k ON k.entityDBID = a.id
WHERE `+where+`
ORDER BY a.id DESC
LIMIT ? OFFSET ?`, queryArgs...)
	if err != nil {
		s.logger.Error("list banned game players", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取已封账号列表失败")
		return
	}
	defer rows.Close()

	items := make([]bannedPlayerItem, 0, size)
	for rows.Next() {
		var item bannedPlayerItem
		var lastLogin sql.NullTime
		if err := rows.Scan(
			&item.PlayerID, &item.LoginName, &item.AccountName, &item.Name, &item.Role,
			&item.Reason, &item.AgentID, &item.RoomID, &item.ClientVersion, &item.RegistrationTime,
			&lastLogin,
		); err != nil {
			s.logger.Error("scan banned game player", "error", err)
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取已封账号数据失败")
			return
		}
		if lastLogin.Valid {
			item.LastLoginAt = &lastLogin.Time
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		s.logger.Error("iterate banned game players", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取已封账号数据失败")
		return
	}
	if err := s.enrichBanAuditMetadata(r.Context(), p, items); err != nil {
		s.logger.Warn("read ban audit metadata", "error", err)
	}

	writeData(w, http.StatusOK, map[string]any{
		"items": items, "page": page, "pageSize": size, "total": total,
	})
}

func (s *Server) handleListPlayerBanHistory(w http.ResponseWriter, r *http.Request, p principal) {
	page, size := pageParams(r)
	filter, err := parsePlayerBanHistoryFilter(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_FILTER", err.Error())
		return
	}
	where, args := buildPlayerBanHistoryWhere(filter, p)

	var total int64
	if err := s.db.QueryRowContext(r.Context(), `SELECT COUNT(*)
FROM mgr_audit_log audit_row
LEFT JOIN kbedm.tbl_Account game_player ON game_player.sm_guuid = audit_row.target_id
LEFT JOIN kbedm.kbe_accountinfos game_login ON game_login.entityDBID = game_player.id
WHERE `+where, args...).Scan(&total); err != nil {
		s.logger.Error("count player ban history", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取封号历史数量失败")
		return
	}

	queryArgs := append(append([]any{}, args...), size, (page-1)*size)
	rows, err := s.db.QueryContext(r.Context(), `SELECT
audit_row.id, audit_row.target_id,
COALESCE(game_player.sm_wxID, ''), COALESCE(game_login.accountName, ''), COALESCE(game_player.sm_name, ''),
audit_row.action, audit_row.operator_name, audit_row.request_json, audit_row.before_json, audit_row.after_json,
audit_row.result_code, audit_row.result_message, audit_row.created_at
FROM mgr_audit_log audit_row
LEFT JOIN kbedm.tbl_Account game_player ON game_player.sm_guuid = audit_row.target_id
LEFT JOIN kbedm.kbe_accountinfos game_login ON game_login.entityDBID = game_player.id
WHERE `+where+`
ORDER BY audit_row.id DESC
LIMIT ? OFFSET ?`, queryArgs...)
	if err != nil {
		s.logger.Error("list player ban history", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取封号历史失败")
		return
	}
	defer rows.Close()

	items := make([]playerBanHistoryItem, 0, size)
	for rows.Next() {
		var item playerBanHistoryItem
		var action string
		var requestJSON, beforeJSON, afterJSON sql.NullString
		if err := rows.Scan(
			&item.ID, &item.PlayerID, &item.LoginName, &item.AccountName, &item.Name,
			&action, &item.OperatorName, &requestJSON, &beforeJSON, &afterJSON,
			&item.ResultCode, &item.ResultMessage, &item.CreatedAt,
		); err != nil {
			s.logger.Error("scan player ban history", "error", err)
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取封号历史数据失败")
			return
		}
		item.Operation = playerBanHistoryOperation(action)
		item.Success = item.ResultCode == 0
		enrichPlayerBanHistoryItem(&item, requestJSON.String, beforeJSON.String, afterJSON.String)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		s.logger.Error("iterate player ban history", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取封号历史数据失败")
		return
	}

	writeData(w, http.StatusOK, map[string]any{
		"items": items, "page": page, "pageSize": size, "total": total,
	})
}

func parsePlayerBanHistoryFilter(r *http.Request) (playerBanHistoryFilter, error) {
	filter := playerBanHistoryFilter{
		Keyword:   strings.TrimSpace(r.URL.Query().Get("keyword")),
		Operation: strings.TrimSpace(r.URL.Query().Get("operation")),
		Result:    strings.TrimSpace(r.URL.Query().Get("result")),
	}
	if utf8.RuneCountInString(filter.Keyword) > 100 {
		return playerBanHistoryFilter{}, errors.New("查询内容不能超过 100 个字符")
	}
	if filter.Operation != "" && filter.Operation != "ban" && filter.Operation != "unban" {
		return playerBanHistoryFilter{}, errors.New("操作类型不正确")
	}
	if filter.Result != "" && filter.Result != "success" && filter.Result != "failed" {
		return playerBanHistoryFilter{}, errors.New("操作结果不正确")
	}
	return filter, nil
}

func buildPlayerBanHistoryWhere(filter playerBanHistoryFilter, p principal) (string, []any) {
	clauses := []string{
		"audit_row.target_type = ?",
		"audit_row.action IN (?, ?)",
		"(? = 1 OR " + nonRootAuditVisibilitySQL + ")",
	}
	args := []any{"game_player", "game.player.ban", "game.player.unban", canSeeProtectedRootFlag(p)}
	if filter.Operation != "" {
		clauses = append(clauses, "audit_row.action = ?")
		args = append(args, "game.player."+filter.Operation)
	}
	if filter.Result == "success" {
		clauses = append(clauses, "audit_row.result_code = 0")
	} else if filter.Result == "failed" {
		clauses = append(clauses, "audit_row.result_code <> 0")
	}
	if filter.Keyword != "" {
		like := "%" + filter.Keyword + "%"
		clauses = append(clauses, `(audit_row.target_id LIKE ? OR game_player.sm_wxID LIKE ? OR game_login.accountName LIKE ?
OR game_player.sm_name LIKE ? OR audit_row.operator_name LIKE ? OR COALESCE(audit_row.request_json, '') LIKE ?
OR COALESCE(audit_row.before_json, '') LIKE ? OR COALESCE(audit_row.after_json, '') LIKE ?)`)
		for range 8 {
			args = append(args, like)
		}
	}
	return strings.Join(clauses, " AND "), args
}

func playerBanHistoryOperation(action string) string {
	if action == "game.player.unban" {
		return "unban"
	}
	return "ban"
}

func enrichPlayerBanHistoryItem(item *playerBanHistoryItem, requestJSON, beforeJSON, afterJSON string) {
	var request createPlayerBanRequest
	var before, after playerBanState
	_ = json.Unmarshal([]byte(requestJSON), &request)
	_ = json.Unmarshal([]byte(beforeJSON), &before)
	_ = json.Unmarshal([]byte(afterJSON), &after)
	if item.PlayerID == "" {
		item.PlayerID = firstNonEmpty(after.PlayerID, before.PlayerID, request.PlayerID)
	}
	if item.LoginName == "" {
		item.LoginName = firstNonEmpty(after.LoginName, before.LoginName)
	}
	if item.AccountName == "" {
		item.AccountName = firstNonEmpty(after.AccountName, before.AccountName)
	}
	if item.Name == "" {
		item.Name = firstNonEmpty(after.Name, before.Name)
	}
	if item.Operation == "unban" {
		item.Reason = strings.TrimSpace(before.ClientStatus)
	} else {
		item.Reason = firstNonEmpty(request.Reason, after.ClientStatus, before.ClientStatus)
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}

func buildBannedPlayerWhere(keyword string) (string, []any) {
	clauses := []string{"TRIM(COALESCE(a.sm_client_status, '')) <> ''"}
	args := []any{}
	if keyword != "" {
		like := "%" + keyword + "%"
		clauses = append(clauses, `(a.sm_guuid = ? OR a.sm_wxID = ? OR k.accountName = ? OR a.sm_name LIKE ? OR a.sm_client_status LIKE ?)`)
		args = append(args, keyword, keyword, keyword, like, like)
	}
	return strings.Join(clauses, " AND "), args
}

func (s *Server) enrichBanAuditMetadata(ctx context.Context, p principal, items []bannedPlayerItem) error {
	if len(items) == 0 {
		return nil
	}
	placeholders := make([]string, len(items))
	args := make([]any, 0, len(items)+2)
	args = append(args, "game.player.ban", "game_player")
	for index, item := range items {
		placeholders[index] = "?"
		args = append(args, item.PlayerID)
	}
	rows, err := s.db.QueryContext(ctx, `SELECT audit_row.target_id, audit_row.operator_name, audit_row.created_at,
COALESCE(operator_user.username = 'admin999', 0)
FROM mgr_audit_log audit_row
LEFT JOIN mgr_user operator_user ON operator_user.id = audit_row.operator_id
WHERE audit_row.action = ? AND audit_row.target_type = ? AND audit_row.result_code = 0
  AND audit_row.target_id IN (`+strings.Join(placeholders, ",")+`)
ORDER BY audit_row.id DESC`, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	metadata := make(map[string]banAuditMetadata, len(items))
	for rows.Next() {
		var playerID string
		var item banAuditMetadata
		var operatorIsSuper bool
		if err := rows.Scan(&playerID, &item.OperatorName, &item.CreatedAt, &operatorIsSuper); err != nil {
			return err
		}
		item.Hidden = hideSuperUserFrom(p, operatorIsSuper)
		if _, exists := metadata[playerID]; !exists {
			metadata[playerID] = item
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for index := range items {
		if audit, ok := metadata[items[index].PlayerID]; ok && !audit.Hidden {
			items[index].BannedBy = audit.OperatorName
			createdAt := audit.CreatedAt
			items[index].BannedAt = &createdAt
		}
	}
	return nil
}

func (s *Server) handleCreatePlayerBan(w http.ResponseWriter, r *http.Request, p principal) {
	var input createPlayerBanRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	playerID, err := normalizeGamePlayerID(input.PlayerID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PLAYER_ID", err.Error())
		return
	}
	reason, err := normalizeBanReason(input.Reason)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BAN_REASON", err.Error())
		return
	}
	if !input.Confirm {
		writeError(w, http.StatusBadRequest, "BAN_CONFIRM_REQUIRED", "请确认封号会立即影响该游戏玩家登录和使用")
		return
	}

	playerBanMutationMu.Lock()
	defer playerBanMutationMu.Unlock()
	operationCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	operationContext := gameOperationContext("player-ban")
	before, err := s.readPlayerBanState(operationCtx, playerID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "PLAYER_NOT_FOUND", "没有找到这个游戏玩家 ID")
		return
	}
	if err != nil {
		s.logger.Error("read player before ban", "error", err, "playerId", playerID)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取玩家当前状态失败")
		return
	}
	if strings.TrimSpace(before.ClientStatus) != "" {
		writeError(w, http.StatusConflict, "PLAYER_ALREADY_BANNED", "该玩家已处于封号状态，请勿重复操作")
		return
	}
	requestAudit := map[string]any{"playerId": playerID, "reason": reason, "context": operationContext}
	if err := s.setPlayerClientStatus(operationCtx, playerID, reason, operationContext); err != nil {
		s.logger.Error("ban game player", "error", err, "playerId", playerID, "context", operationContext)
		s.audit(operationCtx, &p, "game.player.ban", "game_player", playerID, requestAudit, before, nil, 502, "游戏服务未接受封号操作", clientIP(r))
		writeError(w, http.StatusBadGateway, "PLAYER_BAN_FAILED", "游戏服务未接受封号操作")
		return
	}
	after, err := s.waitForPlayerClientStatus(operationCtx, playerID, reason)
	if err != nil {
		s.logger.Error("verify game player ban", "error", err, "playerId", playerID, "context", operationContext)
		s.audit(operationCtx, &p, "game.player.ban", "game_player", playerID, requestAudit, before, nil, 500, "封号已提交但回读校验失败", clientIP(r))
		writeError(w, http.StatusInternalServerError, "PLAYER_BAN_VERIFY_FAILED", "封号已提交，但未能确认最终状态，请刷新列表后人工核对")
		return
	}
	s.audit(operationCtx, &p, "game.player.ban", "game_player", playerID, requestAudit, before, after, 0, "游戏账号已封禁并完成回读校验", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"player": after, "message": fmt.Sprintf("玩家 %s 已封号", playerID)})
}

func (s *Server) handleRemovePlayerBan(w http.ResponseWriter, r *http.Request, p principal) {
	playerID, err := normalizeGamePlayerID(r.PathValue("playerId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PLAYER_ID", err.Error())
		return
	}
	var input removePlayerBanRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if !input.Confirm {
		writeError(w, http.StatusBadRequest, "UNBAN_CONFIRM_REQUIRED", "请确认解除该游戏玩家的封号状态")
		return
	}

	playerBanMutationMu.Lock()
	defer playerBanMutationMu.Unlock()
	operationCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	operationContext := gameOperationContext("player-unban")
	before, err := s.readPlayerBanState(operationCtx, playerID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "PLAYER_NOT_FOUND", "没有找到这个游戏玩家 ID")
		return
	}
	if err != nil {
		s.logger.Error("read player before unban", "error", err, "playerId", playerID)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取玩家当前状态失败")
		return
	}
	if strings.TrimSpace(before.ClientStatus) == "" {
		writeError(w, http.StatusConflict, "PLAYER_NOT_BANNED", "该玩家当前没有被封号")
		return
	}
	requestAudit := map[string]any{"playerId": playerID, "context": operationContext}
	if err := s.setPlayerClientStatus(operationCtx, playerID, "", operationContext); err != nil {
		s.logger.Error("unban game player", "error", err, "playerId", playerID, "context", operationContext)
		s.audit(operationCtx, &p, "game.player.unban", "game_player", playerID, requestAudit, before, nil, 502, "游戏服务未接受解封操作", clientIP(r))
		writeError(w, http.StatusBadGateway, "PLAYER_UNBAN_FAILED", "游戏服务未接受解封操作")
		return
	}
	after, err := s.waitForPlayerClientStatus(operationCtx, playerID, "")
	if err != nil {
		s.logger.Error("verify game player unban", "error", err, "playerId", playerID, "context", operationContext)
		s.audit(operationCtx, &p, "game.player.unban", "game_player", playerID, requestAudit, before, nil, 500, "解封已提交但回读校验失败", clientIP(r))
		writeError(w, http.StatusInternalServerError, "PLAYER_UNBAN_VERIFY_FAILED", "解封已提交，但未能确认最终状态，请刷新列表后人工核对")
		return
	}
	s.audit(operationCtx, &p, "game.player.unban", "game_player", playerID, requestAudit, before, after, 0, "游戏账号已解封并完成回读校验", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"player": after, "message": fmt.Sprintf("玩家 %s 已解封", playerID)})
}

func normalizeGamePlayerID(value string) (string, error) {
	value = strings.TrimSpace(value)
	if len(value) != 6 {
		return "", errors.New("玩家 ID 必须是 6 位数字")
	}
	for _, char := range value {
		if char < '0' || char > '9' {
			return "", errors.New("玩家 ID 必须是 6 位数字")
		}
	}
	return value, nil
}

func normalizeBanReason(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return defaultBanReason, nil
	}
	for _, char := range value {
		if unicode.IsControl(char) {
			return "", errors.New("封号提示不能包含换行或控制字符")
		}
	}
	value = strings.Join(strings.Fields(value), " ")
	if utf8.RuneCountInString(value) > 120 {
		return "", errors.New("封号提示不能超过 120 个字符")
	}
	return value, nil
}

func (s *Server) readPlayerBanState(ctx context.Context, playerID string) (playerBanState, error) {
	var state playerBanState
	err := s.db.QueryRowContext(ctx, `SELECT
a.sm_guuid, a.sm_wxID, COALESCE(k.accountName, ''), a.sm_name, a.sm_client_status
FROM kbedm.tbl_Account a
LEFT JOIN kbedm.kbe_accountinfos k ON k.entityDBID = a.id
WHERE a.sm_guuid = ?
LIMIT 1`, playerID).Scan(&state.PlayerID, &state.LoginName, &state.AccountName, &state.Name, &state.ClientStatus)
	return state, err
}

func (s *Server) setPlayerClientStatus(ctx context.Context, playerID, value, operationContext string) error {
	result, err := s.callGameCommand(ctx, "异步_设置_玩家_属性", map[string]any{
		"guuid":   playerID,
		"name":    "client_status",
		"value":   value,
		"context": operationContext,
	})
	if err != nil {
		return err
	}
	if result.RetCode != 512 {
		return fmt.Errorf("set player client_status ret_code %d", result.RetCode)
	}
	return nil
}

func (s *Server) waitForPlayerClientStatus(ctx context.Context, playerID, expected string) (playerBanState, error) {
	var last playerBanState
	var lastErr error
	for attempt := 0; attempt < 12; attempt++ {
		last, lastErr = s.readPlayerBanState(ctx, playerID)
		if lastErr == nil && last.ClientStatus == expected {
			return last, nil
		}
		if attempt < 11 {
			timer := time.NewTimer(250 * time.Millisecond)
			select {
			case <-ctx.Done():
				timer.Stop()
				return last, ctx.Err()
			case <-timer.C:
			}
		}
	}
	if lastErr != nil {
		return last, lastErr
	}
	return last, errors.New("player client_status did not match expected value")
}
