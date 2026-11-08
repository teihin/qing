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
m.device_bound_at, COALESCE(m.binding_revision, 0),
COALESCE(NULLIF(a.sm_reg_time, ''), DATE_FORMAT(CONCAT(m.date, ' ', m.time), '%Y-%m-%d %H:%i:%s'), ''),
FROM_UNIXTIME(NULLIF(k.lasttime, 0))
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
	s.fillAntiTheftPlayerIDs(r.Context(), items)
	writeData(w, http.StatusOK, map[string]any{"items": items, "page": page, "pageSize": size, "total": total})
}

// fillAntiTheftPlayerIDs 给 playerId 为空的行兜底补一次玩家 ID。
//
// 背景（2026-11-09）：玩家先微信登录写 third_marketing_info、后注册游戏账号时，
// 注册流程没有回写 player_guuid，这类行在列表里 playerId 是空串。
// 前端把空值拼进地址会得到 /api/game/anti-theft//unbind（空路径段），
// Go 的路由不匹配，只能回 404「接口不存在」，客服看到的就是一句莫名其妙的报错。
// 这里按微信 ID 回查 tbl_Account 补上；补不到的行前端会禁用解绑按钮。
func (s *Server) fillAntiTheftPlayerIDs(ctx context.Context, items []antiTheftAccountItem) {
	logins := make([]string, 0, len(items))
	index := make(map[string][]int, len(items))
	for i := range items {
		if items[i].PlayerID != "" || items[i].LoginName == "" {
			continue
		}
		if _, ok := index[items[i].LoginName]; !ok {
			logins = append(logins, items[i].LoginName)
		}
		index[items[i].LoginName] = append(index[items[i].LoginName], i)
	}
	if len(logins) == 0 {
		return
	}
	args := make([]any, len(logins))
	for i, value := range logins {
		args[i] = value
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(logins)), ",")
	rows, err := s.db.QueryContext(ctx, `SELECT sm_wxid, sm_guuid FROM kbedm.tbl_Account
WHERE sm_wxid IN (`+placeholders+`)
ORDER BY id`, args...)
	if err != nil {
		s.logger.Error("fill anti theft player ids", "error", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var wxid, guuid string
		if err := rows.Scan(&wxid, &guuid); err != nil {
			s.logger.Error("scan anti theft player id", "error", err)
			return
		}
		if guuid == "" {
			continue
		}
		for _, idx := range index[wxid] {
			items[idx].PlayerID = guuid
		}
	}
	if err := rows.Err(); err != nil {
		s.logger.Error("iterate anti theft player ids", "error", err)
	}
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
	// 2026-11-09：游戏服实际没有实现「异步_解除_玩家_防盗号绑定」——
	// 拿一个随手编的命令名去问，返回的正是同一个 769 + 空结果，命令名根本不进分发。
	// 客服点解绑永远失败，所以命令不可用时降级为直接改营销表（离线玩家下次登录即按新状态校验；
	// 在线 Account 的内存属性同步不了，需玩家重新登录）。
	usedDirectWrite := false
	if commandErr != nil {
		if fallbackErr := s.directUnbindAntiTheft(ctx, playerID, before.LoginName); fallbackErr != nil {
			s.logger.Error("unbind anti theft account", "error", commandErr, "fallbackError", fallbackErr, "playerId", playerID, "requestId", requestID)
			s.audit(ctx, &p, "game.anti_theft.unbind", "game_player", playerID, auditRequest, before, nil, 502, "KB 未接受防盗号解绑操作", clientIP(r))
			writeError(w, http.StatusBadGateway, "ANTI_THEFT_UNBIND_FAILED", "KB 服务未接受解绑操作，请稍后重试")
			return
		}
		usedDirectWrite = true
		s.logger.Warn("unbind anti theft via direct write", "commandError", commandErr, "playerId", playerID, "requestId", requestID)
	}
	after, err := s.waitForAntiTheftUnbound(ctx, playerID)
	if err != nil {
		s.logger.Error("verify anti theft unbind", "error", err, "playerId", playerID, "requestId", requestID)
		s.audit(ctx, &p, "game.anti_theft.unbind", "game_player", playerID, auditRequest, before, nil, 500, "解绑已提交但回读校验失败", clientIP(r))
		writeError(w, http.StatusInternalServerError, "ANTI_THEFT_UNBIND_VERIFY_FAILED", "解绑已提交，但未能确认最终状态，请刷新后人工核对")
		return
	}
	detail := "防盗号绑定已解除并完成回读校验"
	message := fmt.Sprintf("玩家 %s 的防盗号绑定已解除", playerID)
	if usedDirectWrite {
		detail = "游戏服未实现解绑命令，后台直接改库解除并完成回读校验"
		message = fmt.Sprintf("玩家 %s 的防盗号绑定已解除（游戏服未提供解绑命令，本次由后台直接改库；玩家如在线需重新登录才生效）", playerID)
	}
	s.audit(ctx, &p, "game.anti_theft.unbind", "game_player", playerID, auditRequest, before, after, 0, detail, clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"account": after, "message": message})
}

// directUnbindAntiTheft 照 KB 文档第 9 节的解绑语义直接改营销表。
// 先按「玩家 ID + 登录账号」精确匹配；匹配不到再按空 player_guuid + 登录账号兜底
// （注册流程没回写 guuid 的行，库里的 player_guuid 是空的）。
func (s *Server) directUnbindAntiTheft(ctx context.Context, playerID, loginName string) error {
	const updateSQL = `UPDATE kbedm.third_marketing_info
SET anti_theft_on = 0,
    device_id = '',
    device_platform = NULL,
    device_version = 1,
    device_bound_at = NULL,
    binding_revision = binding_revision + 1
WHERE `
	result, err := s.db.ExecContext(ctx, updateSQL+`player_guuid = ? AND player_wxid = ?
LIMIT 1`, playerID, loginName)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected > 0 {
		return nil
	}
	result, err = s.db.ExecContext(ctx, updateSQL+`COALESCE(player_guuid, '') = '' AND player_wxid = ?
LIMIT 1`, loginName)
	if err != nil {
		return err
	}
	affected, err = result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return sql.ErrNoRows
	}
	return nil
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
	item, err := s.queryAntiTheftAccount(ctx, `WHERE m.player_guuid = ?
LIMIT 1`, playerID)
	if !errors.Is(err, sql.ErrNoRows) {
		return item, err
	}
	// 营销行 player_guuid 没回写的账号（微信先登录、后注册）在库里查不到，
	// 列表里那个玩家 ID 是按 sm_wxid 从 tbl_Account 兜底补出来的；
	// 这里用同样的口径反查回去，否则解绑只会回「没有找到这个游戏玩家 ID 对应的注册账号」。
	return s.queryAntiTheftAccount(ctx, `WHERE COALESCE(m.player_guuid, '') = ''
AND m.player_wxid = (SELECT sm_wxid FROM kbedm.tbl_Account
WHERE sm_guuid = ? AND COALESCE(sm_wxid, '') <> '' ORDER BY id LIMIT 1)
LIMIT 1`, playerID)
}

func (s *Server) queryAntiTheftAccount(ctx context.Context, where string, arg any) (antiTheftAccountItem, error) {
	row := s.db.QueryRowContext(ctx, `SELECT
m.id, COALESCE(m.player_guuid, ''), m.player_wxid,
COALESCE(NULLIF(a.sm_name, ''), m.player_wxname, ''),
COALESCE(m.anti_theft_on, 0), COALESCE(m.device_id, ''),
COALESCE(m.device_platform, ''), COALESCE(m.device_version, 1),
m.device_bound_at, COALESCE(m.binding_revision, 0),
COALESCE(NULLIF(a.sm_reg_time, ''), DATE_FORMAT(CONCAT(m.date, ' ', m.time), '%Y-%m-%d %H:%i:%s'), ''),
FROM_UNIXTIME(NULLIF(k.lasttime, 0))
FROM kbedm.third_marketing_info m
LEFT JOIN kbedm.tbl_Account a ON a.sm_guuid = m.player_guuid
LEFT JOIN kbedm.kbe_accountinfos k ON k.entityDBID = a.id
`+where, arg)
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
