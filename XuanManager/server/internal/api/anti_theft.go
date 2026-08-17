package api

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

var antiTheftMutationMu sync.Mutex

type antiTheftAccountItem struct {
	RegistrationID  int64      `json:"registrationId"`
	PlayerID        string     `json:"playerId"`
	LoginName       string     `json:"loginName"`
	Name            string     `json:"name"`
	Enabled         bool       `json:"enabled"`
	DeviceMasked    string     `json:"deviceMasked"`
	DevicePlatform  string     `json:"devicePlatform"`
	DeviceVersion   int64      `json:"deviceVersion"`
	BoundAt         *time.Time `json:"boundAt"`
	BindingRevision int64      `json:"bindingRevision"`
	RegistrationAt  string     `json:"registrationAt"`
	LastLoginAt     *time.Time `json:"lastLoginAt"`
	StateHealthy    bool       `json:"stateHealthy"`
}

type antiTheftUnbindRequest struct {
	ReasonCode string `json:"reasonCode"`
	Reason     string `json:"reason"`
	Confirm    bool   `json:"confirm"`
}

func (s *Server) handleListAntiTheftAccounts(w http.ResponseWriter, r *http.Request, _ principal) {
	page, size := pageParams(r)
	keyword := strings.TrimSpace(r.URL.Query().Get("keyword"))
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	platform := strings.TrimSpace(r.URL.Query().Get("platform"))
	if utf8.RuneCountInString(keyword) > 100 {
		writeError(w, http.StatusBadRequest, "INVALID_FILTER", "查询内容不能超过 100 个字符")
		return
	}
	if status != "" && status != "enabled" && status != "disabled" {
		writeError(w, http.StatusBadRequest, "INVALID_FILTER", "防盗号状态只能是 enabled 或 disabled")
		return
	}
	if platform != "" && platform != "android" && platform != "ios" && platform != "web" {
		writeError(w, http.StatusBadRequest, "INVALID_FILTER", "设备平台必须是 android、ios 或 web")
		return
	}
	where, args := buildAntiTheftWhere(keyword, status, platform)

	var total int64
	if err := s.db.QueryRowContext(r.Context(), `SELECT COUNT(*)
FROM kbedm.third_marketing_info m
LEFT JOIN kbedm.tbl_Account a ON a.sm_guuid = m.player_guuid
LEFT JOIN kbedm.kbe_accountinfos k ON k.entityDBID = a.id
WHERE `+where, args...).Scan(&total); err != nil {
		s.logger.Error("count anti theft accounts", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取防盗号账号数量失败，请确认 KB 数据库迁移已完成")
		return
	}

	queryArgs := append(append([]any{}, args...), size, (page-1)*size)
	rows, err := s.db.QueryContext(r.Context(), `SELECT
m.id, COALESCE(m.player_guuid, ''), m.player_wxid,
COALESCE(NULLIF(a.sm_name, ''), m.player_wxname, ''),
COALESCE(m.anti_theft_on, 0), COALESCE(m.device_id, ''),
COALESCE(m.device_platform, ''), COALESCE(m.device_version, 1),
DATE_ADD(m.device_bound_at, INTERVAL 8 HOUR), COALESCE(m.binding_revision, 0),
COALESCE(NULLIF(a.sm_reg_time, ''), DATE_FORMAT(DATE_ADD(CONCAT(m.date, ' ', m.time), INTERVAL 8 HOUR), '%Y-%m-%d %H:%i:%s'), ''),
DATE_ADD(FROM_UNIXTIME(NULLIF(k.lasttime, 0)), INTERVAL 8 HOUR)
FROM kbedm.third_marketing_info m
LEFT JOIN kbedm.tbl_Account a ON a.sm_guuid = m.player_guuid
LEFT JOIN kbedm.kbe_accountinfos k ON k.entityDBID = a.id
WHERE `+where+`
ORDER BY m.id DESC
LIMIT ? OFFSET ?`, queryArgs...)
	if err != nil {
		s.logger.Error("list anti theft accounts", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取防盗号账号失败，请确认 KB 数据库迁移已完成")
		return
	}
	defer rows.Close()

	items := make([]antiTheftAccountItem, 0, size)
	for rows.Next() {
		item, err := scanAntiTheftAccount(rows)
		if err != nil {
			s.logger.Error("scan anti theft account", "error", err)
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取防盗号账号数据失败")
			return
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		s.logger.Error("iterate anti theft accounts", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取防盗号账号数据失败")
		return
	}
	writeData(w, http.StatusOK, map[string]any{"items": items, "page": page, "pageSize": size, "total": total})
}

func buildAntiTheftWhere(keyword, status, platform string) (string, []any) {
	clauses := []string{"1 = 1"}
	args := []any{}
	if keyword != "" {
		like := "%" + keyword + "%"
		clauses = append(clauses, `(m.player_guuid = ? OR m.player_wxid = ? OR m.player_wxname LIKE ? OR a.sm_name LIKE ?)`)
		args = append(args, keyword, keyword, like, like)
	}
	if status == "enabled" {
		clauses = append(clauses, "COALESCE(m.anti_theft_on, 0) = 1")
	} else if status == "disabled" {
		clauses = append(clauses, "COALESCE(m.anti_theft_on, 0) = 0")
	}
	if platform != "" {
		clauses = append(clauses, "BINARY m.device_platform = BINARY ?")
		args = append(args, platform)
	}
	return strings.Join(clauses, " AND "), args
}

type rowScanner interface {
	Scan(...any) error
}

func scanAntiTheftAccount(row rowScanner) (antiTheftAccountItem, error) {
	var item antiTheftAccountItem
	var enabled int64
	var rawDeviceID string
	var boundAt sql.NullTime
	var lastLogin sql.NullTime
	if err := row.Scan(
		&item.RegistrationID, &item.PlayerID, &item.LoginName, &item.Name,
		&enabled, &rawDeviceID, &item.DevicePlatform, &item.DeviceVersion,
		&boundAt, &item.BindingRevision, &item.RegistrationAt, &lastLogin,
	); err != nil {
		return antiTheftAccountItem{}, err
	}
	item.Enabled = enabled == 1
	item.DeviceMasked = maskDeviceID(rawDeviceID)
	if boundAt.Valid {
		item.BoundAt = &boundAt.Time
	}
	if lastLogin.Valid {
		item.LastLoginAt = &lastLogin.Time
	}
	item.StateHealthy = (!item.Enabled && rawDeviceID == "" && item.DevicePlatform == "") ||
		(item.Enabled && registrationDeviceIDPattern.MatchString(rawDeviceID) &&
			(item.DevicePlatform == "android" || item.DevicePlatform == "ios" || item.DevicePlatform == "web") && item.DeviceVersion == 1)
	return item, nil
}

func maskDeviceID(value string) string {
	if value == "" {
		return ""
	}
	if len(value) < 4 {
		return "••••"
	}
	if len(value) <= 8 {
		return value[:1] + "••••" + value[len(value)-1:]
	}
	return value[:4] + "••••" + value[len(value)-4:]
}

func (s *Server) handleUnbindAntiTheftAccount(w http.ResponseWriter, r *http.Request, p principal) {
	playerID, err := normalizeGamePlayerID(r.PathValue("playerId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PLAYER_ID", err.Error())
		return
	}
	var input antiTheftUnbindRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	reasonCode, reason, err := normalizeAntiTheftUnbindReason(input.ReasonCode, input.Reason)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_UNBIND_REASON", err.Error())
		return
	}
	if !input.Confirm {
		writeError(w, http.StatusBadRequest, "ANTI_THEFT_UNBIND_CONFIRM_REQUIRED", "请确认已完成玩家身份核验，并解除该账号的设备绑定")
		return
	}

	antiTheftMutationMu.Lock()
	defer antiTheftMutationMu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	before, err := s.readAntiTheftAccount(ctx, playerID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "PLAYER_NOT_FOUND", "没有找到这个游戏玩家 ID 对应的注册账号")
		return
	}
	if err != nil {
		s.logger.Error("read anti theft account before unbind", "error", err, "playerId", playerID)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取玩家防盗号状态失败")
		return
	}
	if !before.Enabled {
		writeError(w, http.StatusConflict, "ANTI_THEFT_NOT_ENABLED", "该玩家当前没有开启防盗号")
		return
	}

	requestID := gameOperationContext("anti-theft-unbind")
	auditRequest := map[string]any{
		"playerId": playerID, "loginName": before.LoginName,
		"reasonCode": reasonCode, "reason": reason, "requestId": requestID,
	}
	commandErr := s.requestAntiTheftUnbind(ctx, playerID, before.LoginName, reasonCode, requestID)
	if commandErr != nil {
		s.logger.Error("unbind anti theft account", "error", commandErr, "playerId", playerID, "requestId", requestID)
		s.audit(ctx, &p, "game.anti_theft.unbind", "game_player", playerID, auditRequest, before, nil, 502, "KB 未接受防盗号解绑操作", clientIP(r))
		writeError(w, http.StatusBadGateway, "ANTI_THEFT_UNBIND_FAILED", "KB 服务未接受解绑操作，请稍后重试")
		return
	}
	after, err := s.waitForAntiTheftUnbound(ctx, playerID)
	if err != nil {
		s.logger.Error("verify anti theft unbind", "error", err, "playerId", playerID, "requestId", requestID)
		s.audit(ctx, &p, "game.anti_theft.unbind", "game_player", playerID, auditRequest, before, nil, 500, "解绑已提交但回读校验失败", clientIP(r))
		writeError(w, http.StatusInternalServerError, "ANTI_THEFT_UNBIND_VERIFY_FAILED", "解绑已提交，但未能确认最终状态，请刷新后人工核对")
		return
	}
	s.audit(ctx, &p, "game.anti_theft.unbind", "game_player", playerID, auditRequest, before, after, 0, "防盗号绑定已解除并完成回读校验", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"account": after, "message": fmt.Sprintf("玩家 %s 的防盗号绑定已解除", playerID)})
}

func (s *Server) requestAntiTheftUnbind(ctx context.Context, playerID, loginName, reasonCode, requestID string) error {
	result, err := s.callGameCommand(ctx, "异步_解除_玩家_防盗号绑定", map[string]any{
		"player_guuid": playerID,
		"login_name":   loginName,
		"request_id":   requestID,
		"reason_code":  reasonCode,
	})
	if err != nil {
		return err
	}
	if result.RetCode != 512 && result.RetCode != 1280 {
		return fmt.Errorf("game command ret_code %d", result.RetCode)
	}
	return nil
}

func normalizeAntiTheftUnbindReason(reasonCode, reason string) (string, string, error) {
	reasonCode = strings.TrimSpace(reasonCode)
	allowed := map[string]bool{"DEVICE_LOST": true, "BROWSER_DATA_CLEARED": true, "DEVICE_REPLACED": true, "OTHER": true}
	if !allowed[reasonCode] {
		return "", "", errors.New("请选择有效的解绑原因类型")
	}
	reason = strings.TrimSpace(reason)
	if utf8.RuneCountInString(reason) < 2 || utf8.RuneCountInString(reason) > 120 {
		return "", "", errors.New("身份核验说明必须为 2 到 120 个字符")
	}
	for _, char := range reason {
		if unicode.IsControl(char) {
			return "", "", errors.New("身份核验说明不能包含换行或控制字符")
		}
	}
	return reasonCode, strings.Join(strings.Fields(reason), " "), nil
}

func (s *Server) readAntiTheftAccount(ctx context.Context, playerID string) (antiTheftAccountItem, error) {
	row := s.db.QueryRowContext(ctx, `SELECT
m.id, COALESCE(m.player_guuid, ''), m.player_wxid,
COALESCE(NULLIF(a.sm_name, ''), m.player_wxname, ''),
COALESCE(m.anti_theft_on, 0), COALESCE(m.device_id, ''),
COALESCE(m.device_platform, ''), COALESCE(m.device_version, 1),
DATE_ADD(m.device_bound_at, INTERVAL 8 HOUR), COALESCE(m.binding_revision, 0),
COALESCE(NULLIF(a.sm_reg_time, ''), DATE_FORMAT(DATE_ADD(CONCAT(m.date, ' ', m.time), INTERVAL 8 HOUR), '%Y-%m-%d %H:%i:%s'), ''),
DATE_ADD(FROM_UNIXTIME(NULLIF(k.lasttime, 0)), INTERVAL 8 HOUR)
FROM kbedm.third_marketing_info m
LEFT JOIN kbedm.tbl_Account a ON a.sm_guuid = m.player_guuid
LEFT JOIN kbedm.kbe_accountinfos k ON k.entityDBID = a.id
WHERE m.player_guuid = ?
LIMIT 1`, playerID)
	return scanAntiTheftAccount(row)
}

func (s *Server) waitForAntiTheftUnbound(ctx context.Context, playerID string) (antiTheftAccountItem, error) {
	var last antiTheftAccountItem
	var lastErr error
	for attempt := 0; attempt < 20; attempt++ {
		last, lastErr = s.readAntiTheftAccount(ctx, playerID)
		if lastErr == nil && !last.Enabled && last.DeviceMasked == "" && last.DevicePlatform == "" {
			return last, nil
		}
		if attempt < 19 {
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
	return last, errors.New("anti theft state did not become unbound")
}
