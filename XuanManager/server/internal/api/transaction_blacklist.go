package api

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode"
)

const (
	transactionBlacklistEnabledKey = "disable_cash_exchange"
	transactionBlacklistUsersKey   = "npc"
	transactionBlacklistMaxUsers   = 1000
)

var transactionBlacklistMutationMu sync.Mutex

type transactionBlacklistItem struct {
	PlayerID  string `json:"playerId"`
	LoginName string `json:"loginName"`
	Name      string `json:"name"`
	AgentID   string `json:"agentId"`
	RoomID    int64  `json:"roomId"`
	Exists    bool   `json:"exists"`
}

type transactionBlacklistState struct {
	Enabled  bool                       `json:"enabled"`
	Items    []transactionBlacklistItem `json:"items"`
	Total    int                        `json:"total"`
	Revision string                     `json:"revision"`
	Warnings []string                   `json:"warnings"`
}

type createTransactionBlacklistRequest struct {
	PlayerID string `json:"playerId"`
	Revision string `json:"revision"`
	Confirm  bool   `json:"confirm"`
}

type updateTransactionBlacklistRequest struct {
	NewPlayerID string `json:"newPlayerId"`
	Revision    string `json:"revision"`
	Confirm     bool   `json:"confirm"`
}

type deleteTransactionBlacklistRequest struct {
	Revision string `json:"revision"`
	Confirm  bool   `json:"confirm"`
}

type updateTransactionBlacklistStatusRequest struct {
	Enabled  bool   `json:"enabled"`
	Revision string `json:"revision"`
	Confirm  bool   `json:"confirm"`
}

func (s *Server) handleGetTransactionBlacklist(w http.ResponseWriter, r *http.Request, _ principal) {
	state, err := s.queryTransactionBlacklist(r.Context())
	if err != nil {
		s.logger.Error("read transaction blacklist", "error", err)
		writeError(w, http.StatusBadGateway, "TRANSACTION_BLACKLIST_QUERY_FAILED", "读取交易黑名单失败")
		return
	}
	writeData(w, http.StatusOK, state)
}

func (s *Server) handleCreateTransactionBlacklist(w http.ResponseWriter, r *http.Request, p principal) {
	var input createTransactionBlacklistRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	playerID, err := normalizeGamePlayerID(input.PlayerID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PLAYER_ID", err.Error())
		return
	}
	if !input.Confirm {
		writeError(w, http.StatusBadRequest, "TRANSACTION_BLACKLIST_CONFIRM_REQUIRED", "请确认加入后该玩家将不能赠送金币")
		return
	}

	transactionBlacklistMutationMu.Lock()
	defer transactionBlacklistMutationMu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 18*time.Second)
	defer cancel()
	before, err := s.queryTransactionBlacklist(ctx)
	if err != nil {
		writeError(w, http.StatusBadGateway, "TRANSACTION_BLACKLIST_QUERY_FAILED", "读取当前交易黑名单失败")
		return
	}
	if !transactionBlacklistRevisionMatches(input.Revision, before.Revision) {
		writeError(w, http.StatusConflict, "TRANSACTION_BLACKLIST_CHANGED", "交易黑名单已被其他管理员修改，请刷新后重试")
		return
	}
	if len(before.Warnings) > 0 {
		writeError(w, http.StatusConflict, "TRANSACTION_BLACKLIST_INVALID_SOURCE", "游戏配置中存在无法识别的黑名单内容，请先人工核对")
		return
	}
	if transactionBlacklistContains(before.Items, playerID) {
		writeError(w, http.StatusConflict, "PLAYER_ALREADY_IN_TRANSACTION_BLACKLIST", "该玩家已经在交易黑名单中")
		return
	}
	if len(before.Items) >= transactionBlacklistMaxUsers {
		writeError(w, http.StatusConflict, "TRANSACTION_BLACKLIST_LIMIT_REACHED", "交易黑名单已达到 1000 人上限")
		return
	}
	player, err := s.readTransactionBlacklistPlayer(ctx, playerID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "PLAYER_NOT_FOUND", "没有找到这个游戏玩家 ID")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取游戏玩家资料失败")
		return
	}
	ids := transactionBlacklistIDs(before.Items)
	ids = append(ids, playerID)
	requestAudit := map[string]any{"playerId": playerID, "revision": input.Revision}
	if err := s.writeTransactionBlacklistUsers(ctx, ids, transactionBlacklistIDs(before.Items)); err != nil {
		s.audit(ctx, &p, "game.transaction_blacklist.create", "game_player", playerID, requestAudit, transactionBlacklistAuditSnapshot(before), nil, 502, "加入交易黑名单失败，已尝试恢复", clientIP(r))
		writeError(w, http.StatusBadGateway, "TRANSACTION_BLACKLIST_UPDATE_FAILED", "游戏服务未接受修改，已尝试恢复原名单")
		return
	}
	after, err := s.queryTransactionBlacklist(ctx)
	if err != nil || !transactionBlacklistContains(after.Items, playerID) {
		_ = s.setAndVerifyReplicaConfiguration(ctx, transactionBlacklistUsersKey, serializeTransactionBlacklistIDs(transactionBlacklistIDs(before.Items)), gameOperationContext("transaction-blacklist-restore"))
		s.audit(ctx, &p, "game.transaction_blacklist.create", "game_player", playerID, requestAudit, transactionBlacklistAuditSnapshot(before), nil, 500, "加入后回读校验失败，已尝试恢复", clientIP(r))
		writeError(w, http.StatusInternalServerError, "TRANSACTION_BLACKLIST_VERIFY_FAILED", "加入后回读校验失败，已尝试恢复原名单")
		return
	}
	s.audit(ctx, &p, "game.transaction_blacklist.create", "game_player", playerID, requestAudit, transactionBlacklistAuditSnapshot(before), transactionBlacklistAuditSnapshot(after), 0, "玩家已加入交易黑名单并完成回读校验", clientIP(r))
	writeData(w, http.StatusCreated, map[string]any{"state": after, "player": player, "message": fmt.Sprintf("玩家 %s 已加入交易黑名单", playerID)})
}

func (s *Server) handleUpdateTransactionBlacklist(w http.ResponseWriter, r *http.Request, p principal) {
	oldPlayerID, err := normalizeGamePlayerID(r.PathValue("playerId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PLAYER_ID", err.Error())
		return
	}
	var input updateTransactionBlacklistRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	newPlayerID, err := normalizeGamePlayerID(input.NewPlayerID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PLAYER_ID", err.Error())
		return
	}
	if oldPlayerID == newPlayerID {
		writeError(w, http.StatusBadRequest, "TRANSACTION_BLACKLIST_UNCHANGED", "新玩家 ID 与当前玩家 ID 相同")
		return
	}
	if !input.Confirm {
		writeError(w, http.StatusBadRequest, "TRANSACTION_BLACKLIST_CONFIRM_REQUIRED", "请确认替换交易黑名单玩家")
		return
	}

	transactionBlacklistMutationMu.Lock()
	defer transactionBlacklistMutationMu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 18*time.Second)
	defer cancel()
	before, err := s.queryTransactionBlacklist(ctx)
	if err != nil {
		writeError(w, http.StatusBadGateway, "TRANSACTION_BLACKLIST_QUERY_FAILED", "读取当前交易黑名单失败")
		return
	}
	if !transactionBlacklistRevisionMatches(input.Revision, before.Revision) {
		writeError(w, http.StatusConflict, "TRANSACTION_BLACKLIST_CHANGED", "交易黑名单已被其他管理员修改，请刷新后重试")
		return
	}
	if len(before.Warnings) > 0 {
		writeError(w, http.StatusConflict, "TRANSACTION_BLACKLIST_INVALID_SOURCE", "游戏配置中存在无法识别的黑名单内容，请先人工核对")
		return
	}
	if !transactionBlacklistContains(before.Items, oldPlayerID) {
		writeError(w, http.StatusNotFound, "TRANSACTION_BLACKLIST_PLAYER_NOT_FOUND", "该玩家已不在交易黑名单中")
		return
	}
	if transactionBlacklistContains(before.Items, newPlayerID) {
		writeError(w, http.StatusConflict, "PLAYER_ALREADY_IN_TRANSACTION_BLACKLIST", "新的玩家已经在交易黑名单中")
		return
	}
	if _, err := s.readTransactionBlacklistPlayer(ctx, newPlayerID); errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "PLAYER_NOT_FOUND", "没有找到新的游戏玩家 ID")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取游戏玩家资料失败")
		return
	}
	beforeIDs := transactionBlacklistIDs(before.Items)
	afterIDs := append([]string(nil), beforeIDs...)
	for index := range afterIDs {
		if afterIDs[index] == oldPlayerID {
			afterIDs[index] = newPlayerID
			break
		}
	}
	requestAudit := map[string]any{"oldPlayerId": oldPlayerID, "newPlayerId": newPlayerID, "revision": input.Revision}
	if err := s.writeTransactionBlacklistUsers(ctx, afterIDs, beforeIDs); err != nil {
		s.audit(ctx, &p, "game.transaction_blacklist.update", "game_player", oldPlayerID, requestAudit, transactionBlacklistAuditSnapshot(before), nil, 502, "替换交易黑名单玩家失败，已尝试恢复", clientIP(r))
		writeError(w, http.StatusBadGateway, "TRANSACTION_BLACKLIST_UPDATE_FAILED", "游戏服务未接受修改，已尝试恢复原名单")
		return
	}
	after, err := s.queryTransactionBlacklist(ctx)
	if err != nil || transactionBlacklistContains(after.Items, oldPlayerID) || !transactionBlacklistContains(after.Items, newPlayerID) {
		_ = s.setAndVerifyReplicaConfiguration(ctx, transactionBlacklistUsersKey, serializeTransactionBlacklistIDs(beforeIDs), gameOperationContext("transaction-blacklist-restore"))
		s.audit(ctx, &p, "game.transaction_blacklist.update", "game_player", oldPlayerID, requestAudit, transactionBlacklistAuditSnapshot(before), nil, 500, "替换后回读校验失败，已尝试恢复", clientIP(r))
		writeError(w, http.StatusInternalServerError, "TRANSACTION_BLACKLIST_VERIFY_FAILED", "替换后回读校验失败，已尝试恢复原名单")
		return
	}
	s.audit(ctx, &p, "game.transaction_blacklist.update", "game_player", oldPlayerID, requestAudit, transactionBlacklistAuditSnapshot(before), transactionBlacklistAuditSnapshot(after), 0, "交易黑名单玩家已替换并完成回读校验", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"state": after, "message": fmt.Sprintf("已将黑名单玩家 %s 替换为 %s", oldPlayerID, newPlayerID)})
}

func (s *Server) handleDeleteTransactionBlacklist(w http.ResponseWriter, r *http.Request, p principal) {
	playerID, err := normalizeGamePlayerID(r.PathValue("playerId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PLAYER_ID", err.Error())
		return
	}
	var input deleteTransactionBlacklistRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if !input.Confirm {
		writeError(w, http.StatusBadRequest, "TRANSACTION_BLACKLIST_CONFIRM_REQUIRED", "请确认删除后该玩家将恢复赠送金币资格")
		return
	}

	transactionBlacklistMutationMu.Lock()
	defer transactionBlacklistMutationMu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 18*time.Second)
	defer cancel()
	before, err := s.queryTransactionBlacklist(ctx)
	if err != nil {
		writeError(w, http.StatusBadGateway, "TRANSACTION_BLACKLIST_QUERY_FAILED", "读取当前交易黑名单失败")
		return
	}
	if !transactionBlacklistRevisionMatches(input.Revision, before.Revision) {
		writeError(w, http.StatusConflict, "TRANSACTION_BLACKLIST_CHANGED", "交易黑名单已被其他管理员修改，请刷新后重试")
		return
	}
	if len(before.Warnings) > 0 {
		writeError(w, http.StatusConflict, "TRANSACTION_BLACKLIST_INVALID_SOURCE", "游戏配置中存在无法识别的黑名单内容，请先人工核对")
		return
	}
	if !transactionBlacklistContains(before.Items, playerID) {
		writeError(w, http.StatusNotFound, "TRANSACTION_BLACKLIST_PLAYER_NOT_FOUND", "该玩家已不在交易黑名单中")
		return
	}
	beforeIDs := transactionBlacklistIDs(before.Items)
	afterIDs := make([]string, 0, len(beforeIDs)-1)
	for _, id := range beforeIDs {
		if id != playerID {
			afterIDs = append(afterIDs, id)
		}
	}
	requestAudit := map[string]any{"playerId": playerID, "revision": input.Revision}
	if err := s.writeTransactionBlacklistUsers(ctx, afterIDs, beforeIDs); err != nil {
		s.audit(ctx, &p, "game.transaction_blacklist.delete", "game_player", playerID, requestAudit, transactionBlacklistAuditSnapshot(before), nil, 502, "删除交易黑名单玩家失败，已尝试恢复", clientIP(r))
		writeError(w, http.StatusBadGateway, "TRANSACTION_BLACKLIST_UPDATE_FAILED", "游戏服务未接受修改，已尝试恢复原名单")
		return
	}
	after, err := s.queryTransactionBlacklist(ctx)
	if err != nil || transactionBlacklistContains(after.Items, playerID) {
		_ = s.setAndVerifyReplicaConfiguration(ctx, transactionBlacklistUsersKey, serializeTransactionBlacklistIDs(beforeIDs), gameOperationContext("transaction-blacklist-restore"))
		s.audit(ctx, &p, "game.transaction_blacklist.delete", "game_player", playerID, requestAudit, transactionBlacklistAuditSnapshot(before), nil, 500, "删除后回读校验失败，已尝试恢复", clientIP(r))
		writeError(w, http.StatusInternalServerError, "TRANSACTION_BLACKLIST_VERIFY_FAILED", "删除后回读校验失败，已尝试恢复原名单")
		return
	}
	s.audit(ctx, &p, "game.transaction_blacklist.delete", "game_player", playerID, requestAudit, transactionBlacklistAuditSnapshot(before), transactionBlacklistAuditSnapshot(after), 0, "玩家已从交易黑名单删除并完成回读校验", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"state": after, "message": fmt.Sprintf("玩家 %s 已从交易黑名单删除", playerID)})
}

func (s *Server) handleUpdateTransactionBlacklistStatus(w http.ResponseWriter, r *http.Request, p principal) {
	var input updateTransactionBlacklistStatusRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if !input.Confirm {
		writeError(w, http.StatusBadRequest, "TRANSACTION_BLACKLIST_CONFIRM_REQUIRED", "请确认修改交易黑名单总开关")
		return
	}

	transactionBlacklistMutationMu.Lock()
	defer transactionBlacklistMutationMu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 18*time.Second)
	defer cancel()
	before, err := s.queryTransactionBlacklist(ctx)
	if err != nil {
		writeError(w, http.StatusBadGateway, "TRANSACTION_BLACKLIST_QUERY_FAILED", "读取当前交易黑名单失败")
		return
	}
	if !transactionBlacklistRevisionMatches(input.Revision, before.Revision) {
		writeError(w, http.StatusConflict, "TRANSACTION_BLACKLIST_CHANGED", "交易黑名单已被其他管理员修改，请刷新后重试")
		return
	}
	if input.Enabled == before.Enabled {
		writeError(w, http.StatusBadRequest, "TRANSACTION_BLACKLIST_STATUS_UNCHANGED", "交易黑名单总开关没有变化")
		return
	}
	operationContext := gameOperationContext("transaction-blacklist-status")
	if err := s.setAndVerifyReplicaConfiguration(ctx, transactionBlacklistEnabledKey, gameBool(input.Enabled), operationContext); err != nil {
		_ = s.setAndVerifyReplicaConfiguration(ctx, transactionBlacklistEnabledKey, gameBool(before.Enabled), operationContext+"-restore")
		s.audit(ctx, &p, "game.transaction_blacklist.status", "game_configuration", transactionBlacklistEnabledKey, input, transactionBlacklistAuditSnapshot(before), nil, 502, "交易黑名单总开关修改失败，已尝试恢复", clientIP(r))
		writeError(w, http.StatusBadGateway, "TRANSACTION_BLACKLIST_UPDATE_FAILED", "游戏服务未接受总开关修改，已尝试恢复原值")
		return
	}
	after, err := s.queryTransactionBlacklist(ctx)
	if err != nil || after.Enabled != input.Enabled {
		_ = s.setAndVerifyReplicaConfiguration(ctx, transactionBlacklistEnabledKey, gameBool(before.Enabled), operationContext+"-restore")
		s.audit(ctx, &p, "game.transaction_blacklist.status", "game_configuration", transactionBlacklistEnabledKey, input, transactionBlacklistAuditSnapshot(before), nil, 500, "交易黑名单总开关回读校验失败，已尝试恢复", clientIP(r))
		writeError(w, http.StatusInternalServerError, "TRANSACTION_BLACKLIST_VERIFY_FAILED", "总开关回读校验失败，已尝试恢复原值")
		return
	}
	s.audit(ctx, &p, "game.transaction_blacklist.status", "game_configuration", transactionBlacklistEnabledKey, input, transactionBlacklistAuditSnapshot(before), transactionBlacklistAuditSnapshot(after), 0, "交易黑名单总开关已修改并完成回读校验", clientIP(r))
	message := "交易黑名单已停用，名单内容已保留"
	if after.Enabled {
		message = "交易黑名单已启用，名单内玩家将不能赠送金币"
	}
	writeData(w, http.StatusOK, map[string]any{"state": after, "message": message})
}

func (s *Server) queryTransactionBlacklist(ctx context.Context) (transactionBlacklistState, error) {
	enabledValue, err := s.getReplicaConfiguration(ctx, transactionBlacklistEnabledKey, gameOperationContext("transaction-blacklist-read"))
	if err != nil {
		return transactionBlacklistState{}, fmt.Errorf("read %s: %w", transactionBlacklistEnabledKey, err)
	}
	usersValue, err := s.getReplicaConfiguration(ctx, transactionBlacklistUsersKey, gameOperationContext("transaction-blacklist-read"))
	if err != nil {
		return transactionBlacklistState{}, fmt.Errorf("read %s: %w", transactionBlacklistUsersKey, err)
	}
	ids, warnings := parseTransactionBlacklistIDs(usersValue)
	items := make([]transactionBlacklistItem, len(ids))
	byID := make(map[string]int, len(ids))
	for index, id := range ids {
		items[index] = transactionBlacklistItem{PlayerID: id}
		byID[id] = index
	}
	if len(ids) > 0 {
		placeholders := make([]string, len(ids))
		args := make([]any, len(ids))
		for index, id := range ids {
			placeholders[index], args[index] = "?", id
		}
		rows, err := s.db.QueryContext(ctx, `SELECT sm_guuid, sm_wxID, sm_name, sm_agentID, sm_roomID
FROM kbedm.tbl_Account WHERE sm_guuid IN (`+strings.Join(placeholders, ",")+`)`, args...)
		if err != nil {
			return transactionBlacklistState{}, err
		}
		defer rows.Close()
		for rows.Next() {
			var item transactionBlacklistItem
			if err := rows.Scan(&item.PlayerID, &item.LoginName, &item.Name, &item.AgentID, &item.RoomID); err != nil {
				return transactionBlacklistState{}, err
			}
			item.Exists = true
			if index, ok := byID[item.PlayerID]; ok {
				items[index] = item
			}
		}
		if err := rows.Err(); err != nil {
			return transactionBlacklistState{}, err
		}
	}
	state := transactionBlacklistState{Enabled: parseGameBool(enabledValue), Items: items, Total: len(items), Warnings: warnings}
	state.Revision = transactionBlacklistRevision(state.Enabled, ids)
	return state, nil
}

func (s *Server) readTransactionBlacklistPlayer(ctx context.Context, playerID string) (transactionBlacklistItem, error) {
	var item transactionBlacklistItem
	err := s.db.QueryRowContext(ctx, `SELECT sm_guuid, sm_wxID, sm_name, sm_agentID, sm_roomID
FROM kbedm.tbl_Account WHERE sm_guuid = ? LIMIT 1`, playerID).Scan(&item.PlayerID, &item.LoginName, &item.Name, &item.AgentID, &item.RoomID)
	item.Exists = err == nil
	return item, err
}

func (s *Server) getReplicaConfiguration(ctx context.Context, key, operationContext string) (string, error) {
	result, err := s.callGameCommand(ctx, "获取_副本_配置数据", map[string]any{"param_name": key, "context": operationContext})
	if err != nil {
		return "", err
	}
	if result.RetCode == 769 {
		return "", nil
	}
	if result.RetCode != 512 {
		return "", fmt.Errorf("ret_code %d", result.RetCode)
	}
	var response struct {
		ParamValue any `json:"param_value"`
	}
	if err := json.Unmarshal(result.RetResult, &response); err != nil {
		return "", err
	}
	if response.ParamValue == nil {
		return "", nil
	}
	return fmt.Sprint(response.ParamValue), nil
}

func (s *Server) setReplicaConfiguration(ctx context.Context, key, value, operationContext string) error {
	result, err := s.callGameCommand(ctx, "设置_副本_配置数据", map[string]any{"param_name": key, "param_value": value, "context": operationContext})
	if err != nil {
		return err
	}
	if result.RetCode != 512 && result.RetCode != 1280 {
		return fmt.Errorf("ret_code %d", result.RetCode)
	}
	return nil
}

func (s *Server) setAndVerifyReplicaConfiguration(ctx context.Context, key, value, operationContext string) error {
	if err := s.setReplicaConfiguration(ctx, key, value, operationContext); err != nil {
		return err
	}
	var last string
	var lastErr error
	for attempt := 0; attempt < 8; attempt++ {
		last, lastErr = s.getReplicaConfiguration(ctx, key, operationContext+"-verify")
		if lastErr == nil && strings.TrimSpace(last) == strings.TrimSpace(value) {
			return nil
		}
		if attempt < 7 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(250 * time.Millisecond):
			}
		}
	}
	if lastErr != nil {
		return lastErr
	}
	return fmt.Errorf("replica configuration %s read back as %q", key, last)
}

func (s *Server) writeTransactionBlacklistUsers(ctx context.Context, afterIDs, beforeIDs []string) error {
	operationContext := gameOperationContext("transaction-blacklist-users")
	if err := s.setAndVerifyReplicaConfiguration(ctx, transactionBlacklistUsersKey, serializeTransactionBlacklistIDs(afterIDs), operationContext); err != nil {
		_ = s.setAndVerifyReplicaConfiguration(ctx, transactionBlacklistUsersKey, serializeTransactionBlacklistIDs(beforeIDs), operationContext+"-restore")
		return err
	}
	return nil
}

func parseTransactionBlacklistIDs(value string) ([]string, []string) {
	parts := strings.FieldsFunc(value, func(r rune) bool {
		return r == ',' || r == '，' || r == ';' || r == '；' || unicode.IsSpace(r)
	})
	ids := make([]string, 0, len(parts))
	warnings := []string{}
	seen := map[string]bool{}
	for _, part := range parts {
		candidate := strings.TrimSpace(part)
		if candidate == "" {
			continue
		}
		if _, err := normalizeGamePlayerID(candidate); err != nil {
			warnings = append(warnings, candidate)
			continue
		}
		if !seen[candidate] {
			seen[candidate] = true
			ids = append(ids, candidate)
		}
	}
	return ids, warnings
}

func serializeTransactionBlacklistIDs(ids []string) string { return strings.Join(ids, ",") }

func transactionBlacklistContains(items []transactionBlacklistItem, playerID string) bool {
	for _, item := range items {
		if item.PlayerID == playerID {
			return true
		}
	}
	return false
}

func transactionBlacklistIDs(items []transactionBlacklistItem) []string {
	ids := make([]string, len(items))
	for index, item := range items {
		ids[index] = item.PlayerID
	}
	return ids
}

func transactionBlacklistRevision(enabled bool, ids []string) string {
	body, _ := json.Marshal(struct {
		Enabled bool     `json:"enabled"`
		IDs     []string `json:"ids"`
	}{Enabled: enabled, IDs: ids})
	digest := sha256.Sum256(body)
	return hex.EncodeToString(digest[:])
}

func transactionBlacklistRevisionMatches(expected, actual string) bool {
	return strings.TrimSpace(expected) != "" && strings.TrimSpace(expected) == actual
}

func transactionBlacklistAuditSnapshot(state transactionBlacklistState) map[string]any {
	return map[string]any{"enabled": state.Enabled, "playerIds": transactionBlacklistIDs(state.Items), "revision": state.Revision}
}
