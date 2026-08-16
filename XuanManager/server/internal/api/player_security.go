package api

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

var playerPasswordMutationMu sync.Mutex

type playerPasswordResetRequest struct {
	Password string `json:"password"`
	Reason   string `json:"reason"`
	Confirm  bool   `json:"confirm"`
}

type playerSecurityIdentity struct {
	PlayerID  string `json:"playerId"`
	LoginName string `json:"loginName"`
	Name      string `json:"name"`
}

type playerSensitiveInfo struct {
	PlayerID          string   `json:"playerId"`
	IP                string   `json:"ip"`
	GPS               string   `json:"gps"`
	Latitude          *float64 `json:"latitude"`
	Longitude         *float64 `json:"longitude"`
	LocationAvailable bool     `json:"locationAvailable"`
	LocationMessage   string   `json:"locationMessage"`
}

func (s *Server) handleResetPlayerPassword(w http.ResponseWriter, r *http.Request, p principal) {
	playerID, err := normalizeGamePlayerID(r.PathValue("playerId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PLAYER_ID", err.Error())
		return
	}
	var input playerPasswordResetRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if err := validateGamePlayerPassword(input.Password); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PLAYER_PASSWORD", err.Error())
		return
	}
	reason, err := normalizePlayerPasswordResetReason(input.Reason)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_RESET_REASON", err.Error())
		return
	}
	if !input.Confirm {
		writeError(w, http.StatusBadRequest, "PLAYER_PASSWORD_CONFIRM_REQUIRED", "请确认已核对玩家身份，并为该玩家重置登录密码")
		return
	}

	playerPasswordMutationMu.Lock()
	defer playerPasswordMutationMu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	identity, err := s.readPlayerSecurityIdentity(ctx, playerID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "PLAYER_NOT_FOUND", "没有找到这个游戏玩家 ID")
		return
	}
	if err != nil {
		s.logger.Error("read player before password reset", "error", err, "playerId", playerID)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取玩家账号失败")
		return
	}

	requestID := gameOperationContext("player-password")
	auditRequest := map[string]any{
		"playerId": playerID, "loginName": identity.LoginName,
		"reason": reason, "passwordChanged": true, "requestId": requestID,
	}
	if err := s.setPlayerLoginPassword(ctx, playerID, input.Password, requestID); err != nil {
		s.logger.Error("reset game player password", "error", err, "playerId", playerID, "requestId", requestID)
		s.audit(ctx, &p, "game.player.password.reset", "game_player", playerID, auditRequest, identity, nil, 502, "游戏服务未接受玩家密码重置", clientIP(r))
		writeError(w, http.StatusBadGateway, "PLAYER_PASSWORD_RESET_FAILED", "游戏服务未确认密码重置成功，未继续同步注册资料")
		return
	}
	if err := s.waitForPlayerPassword(ctx, playerID, input.Password); err != nil {
		s.logger.Error("verify game player password reset", "error", err, "playerId", playerID, "requestId", requestID)
		s.audit(ctx, &p, "game.player.password.reset", "game_player", playerID, auditRequest, identity, nil, 500, "密码重置已提交但账号表回读校验失败", clientIP(r))
		writeError(w, http.StatusInternalServerError, "PLAYER_PASSWORD_VERIFY_FAILED", "密码重置已提交，但未能确认账号表最终状态，请勿重复提交并立即核对")
		return
	}
	registrationRows, err := s.syncPlayerRegistrationPassword(ctx, playerID, input.Password)
	if err != nil {
		s.logger.Error("sync player registration password", "error", err, "playerId", playerID, "requestId", requestID)
		s.audit(ctx, &p, "game.player.password.reset", "game_player", playerID, auditRequest, identity,
			map[string]any{"passwordChanged": true, "registrationSynced": false}, 500, "游戏密码已重置但注册资料同步失败", clientIP(r))
		writeError(w, http.StatusInternalServerError, "PLAYER_PASSWORD_SYNC_FAILED", "游戏密码已重置，但注册资料同步失败，请勿重复提交并联系管理员核对")
		return
	}
	after := map[string]any{"passwordChanged": true, "registrationSynced": true, "registrationRows": registrationRows}
	s.audit(ctx, &p, "game.player.password.reset", "game_player", playerID, auditRequest, identity, after, 0, "游戏玩家登录密码已重置", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{
		"playerId": playerID,
		"message":  fmt.Sprintf("玩家 %s 的登录密码已重置，新密码将在下次登录时使用", playerID),
	})
}

func (s *Server) handleGetPlayerSensitiveInfo(w http.ResponseWriter, r *http.Request, p principal) {
	playerID, err := normalizeGamePlayerID(r.PathValue("playerId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PLAYER_ID", err.Error())
		return
	}
	if !p.IsProtectedRoot || !isProtectedRootIdentity(p.Username) {
		writeError(w, http.StatusForbidden, "PROTECTED_ROOT_REQUIRED", "只有 admin999 可以查看玩家 IP 和 GPS 定位")
		return
	}

	var info playerSensitiveInfo
	info.PlayerID = playerID
	if err := s.db.QueryRowContext(r.Context(), `SELECT COALESCE(sm_ip, ''), COALESCE(sm_gps, '')
FROM kbedm.tbl_Account WHERE sm_guuid = ? LIMIT 1`, playerID).Scan(&info.IP, &info.GPS); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "PLAYER_NOT_FOUND", "没有找到这个游戏玩家 ID")
			return
		}
		s.logger.Error("read player sensitive information", "error", err, "playerId", playerID)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取玩家安全信息失败")
		return
	}
	latitude, longitude, locationMessage := parsePlayerGPS(info.GPS)
	info.Latitude = latitude
	info.Longitude = longitude
	info.LocationAvailable = latitude != nil && longitude != nil
	info.LocationMessage = locationMessage
	w.Header().Set("Cache-Control", "no-store")
	s.audit(r.Context(), &p, "game.player.sensitive.view", "game_player", playerID,
		map[string]any{"fields": []string{"ip", "gps"}}, nil, nil, 0, "admin999查看玩家IP和GPS", clientIP(r))
	writeData(w, http.StatusOK, info)
}

func validateGamePlayerPassword(value string) error {
	if value != strings.TrimSpace(value) {
		return errors.New("登录密码首尾不能包含空格")
	}
	length := utf8.RuneCountInString(value)
	if length < 6 || length > 32 {
		return errors.New("登录密码长度必须为 6 到 32 个字符")
	}
	for _, char := range value {
		if unicode.IsControl(char) {
			return errors.New("登录密码不能包含换行或控制字符")
		}
	}
	return nil
}

func normalizePlayerPasswordResetReason(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	if utf8.RuneCountInString(value) > 120 {
		return "", errors.New("重置备注不能超过 120 个字符")
	}
	for _, char := range value {
		if unicode.IsControl(char) {
			return "", errors.New("重置备注不能包含换行或控制字符")
		}
	}
	return strings.Join(strings.Fields(value), " "), nil
}

func (s *Server) readPlayerSecurityIdentity(ctx context.Context, playerID string) (playerSecurityIdentity, error) {
	var identity playerSecurityIdentity
	err := s.db.QueryRowContext(ctx, `SELECT sm_guuid, sm_wxID, sm_name
FROM kbedm.tbl_Account WHERE sm_guuid = ? LIMIT 1`, playerID).
		Scan(&identity.PlayerID, &identity.LoginName, &identity.Name)
	return identity, err
}

func (s *Server) setPlayerLoginPassword(ctx context.Context, playerID, password, operationContext string) error {
	result, err := s.callGameCommand(ctx, "异步_设置_玩家_属性", map[string]any{
		"guuid": playerID, "name": "userPWD", "value": password, "context": operationContext,
	})
	if err != nil {
		return err
	}
	if result.RetCode != 512 && result.RetCode != 1280 {
		return fmt.Errorf("set player userPWD ret_code %d", result.RetCode)
	}
	return nil
}

func (s *Server) waitForPlayerPassword(ctx context.Context, playerID, password string) error {
	var lastErr error
	for attempt := 0; attempt < 16; attempt++ {
		var matches bool
		lastErr = s.db.QueryRowContext(ctx, `SELECT LOWER(sm_userPWD) = MD5(?)
FROM kbedm.tbl_Account WHERE sm_guuid = ? LIMIT 1`, password, playerID).Scan(&matches)
		if lastErr == nil && matches {
			return nil
		}
		if attempt < 15 {
			timer := time.NewTimer(250 * time.Millisecond)
			select {
			case <-ctx.Done():
				timer.Stop()
				return ctx.Err()
			case <-timer.C:
			}
		}
	}
	if lastErr != nil {
		return lastErr
	}
	return errors.New("player password did not match expected digest")
}

func (s *Server) syncPlayerRegistrationPassword(ctx context.Context, playerID, password string) (int64, error) {
	if _, err := s.db.ExecContext(ctx, `UPDATE kbedm.third_marketing_info
SET player_wxpwd = MD5(?) WHERE player_guuid = ?`, password, playerID); err != nil {
		return 0, err
	}
	var total, matched int64
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*), COALESCE(SUM(LOWER(player_wxpwd) = MD5(?)), 0)
FROM kbedm.third_marketing_info WHERE player_guuid = ?`, password, playerID).Scan(&total, &matched); err != nil {
		return 0, err
	}
	if total != matched {
		return total, errors.New("registration password readback did not match expected digest")
	}
	return total, nil
}

func parsePlayerGPS(value string) (*float64, *float64, string) {
	value = strings.TrimSpace(value)
	if value == "" || value == "0,0" || value == "0.0,0.0" {
		return nil, nil, "玩家尚未上报有效 GPS 坐标"
	}
	parts := strings.Split(value, ",")
	if len(parts) != 2 {
		return nil, nil, "GPS 原始值格式无法识别"
	}
	latitude, latErr := strconv.ParseFloat(strings.TrimSpace(parts[0]), 64)
	longitude, lngErr := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
	if latErr != nil || lngErr != nil || math.IsNaN(latitude) || math.IsNaN(longitude) || math.IsInf(latitude, 0) || math.IsInf(longitude, 0) {
		return nil, nil, "GPS 原始值格式无法识别"
	}
	if latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || (latitude == 0 && longitude == 0) {
		return nil, nil, "GPS 坐标超出有效经纬度范围"
	}
	return &latitude, &longitude, "客户端上报的 GPS 原始坐标（WGS84）"
}
