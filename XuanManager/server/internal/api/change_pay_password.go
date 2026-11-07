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
	"time"
)

// 游戏内「修改交易密码」改为用登录密码核验身份。
//
// 游戏服的 `修改_玩家_交易密码` 只认旧交易密码，没法改成校验登录密码；
// 后台账号对此也没有写权限（webcm_user 只有 kbedm.* 的 SELECT，交易密码
// 落在 tbl_Account.sm_userPWD2）。所以这里由后台自己做两件事：
//   1. 用 kbedm.third_marketing_info.player_wxpwd（登录校验的权威摘要）比对登录密码；
//   2. 通过服务器本机 8890 的 `异步_设置_玩家_属性`（name=userPWD2）写交易密码，
//      由游戏服落库，写完回读 tbl_Account.sm_userPWD2 确认。
//
// 接口给已登录的玩家端用，没有后台登录态，核验完全依赖登录密码。

const (
	playerChangePayPasswordAction = "game.player.change_pay_password"
	playerChangePayPasswordCtx    = "玩家自助修改交易密码"
	// 与玩家管理里的登录密码重置一致：游戏服受理成功返回这两个码。
	gameRetCodeOK  = 512
	gameRetCodeOK2 = 1280
)

var playerGUIDPattern = regexp.MustCompile(`^[0-9]{1,19}$`)

type playerPayPasswordChangeRequest struct {
	PlayerID  string `json:"player_id"`
	LoginPwd  string `json:"login_pwd"`
	NewPayPwd string `json:"new_pay_pwd"`
}

func (s *Server) handleChangePayPasswordOptions(w http.ResponseWriter, _ *http.Request) {
	setRegistrationCORS(w)
	w.WriteHeader(http.StatusNoContent)
}

// validatePayPasswordChange 只做入参格式校验，方便单测覆盖。
func validatePayPasswordChange(playerID, loginPwd, newPayPwd string) (int, string) {
	if !playerGUIDPattern.MatchString(playerID) || strings.TrimSpace(loginPwd) == "" {
		return codeBadParameters, "参数格式错误"
	}
	if strings.TrimSpace(newPayPwd) == "" {
		return codeNewPwdEmpty, "新交易密码不能为空"
	}
	// 交易密码在游戏里是短口令，这里只挡明显的异常输入。
	if len([]rune(newPayPwd)) > 32 || strings.ContainsAny(newPayPwd, " \t\r\n") {
		return codeBadParameters, "新交易密码格式不正确"
	}
	return codePasswordOK, ""
}

func (s *Server) handleChangePlayerPayPassword(w http.ResponseWriter, r *http.Request) {
	setRegistrationCORS(w)
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	decoder.DisallowUnknownFields()
	var body playerPayPasswordChangeRequest
	if err := decoder.Decode(&body); err != nil {
		writePlayerCode(w, http.StatusOK, codeBadParameters, "参数格式错误")
		return
	}

	playerID := strings.TrimSpace(body.PlayerID)
	loginPwd := body.LoginPwd
	newPayPwd := body.NewPayPwd
	if code, message := validatePayPasswordChange(playerID, loginPwd, newPayPwd); code != codePasswordOK {
		writePlayerCode(w, http.StatusOK, code, message)
		return
	}

	now := time.Now()
	ip := clientIP(r)
	accountKey := "pay-" + playerID
	ipKey := "pay-ip-" + ip
	if s.passwordAccountLimiter.blocked(accountKey, now) || s.passwordIPLimiter.blocked(ipKey, now) {
		s.logger.Warn("change-pay-password rate limited", "player_id", playerID, "ip", ip)
		s.auditPlayerPayPasswordChange(r.Context(), playerID, "", codeRateLimited, "请求过于频繁", ip)
		writePlayerCode(w, http.StatusOK, codeRateLimited, "请求过于频繁，请稍后再试")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	var storedLoginPwd sql.NullString
	err := s.db.QueryRowContext(ctx, `SELECT t.player_wxpwd
FROM kbedm.third_marketing_info t
WHERE t.player_guuid = ? LIMIT 1`, playerID).Scan(&storedLoginPwd)
	if errors.Is(err, sql.ErrNoRows) {
		s.passwordAccountLimiter.fail(accountKey, now)
		s.passwordIPLimiter.fail(ipKey, now)
		s.auditPlayerPayPasswordChange(r.Context(), playerID, "", codeAccountOrPayPwdWrong, "账号不存在", ip)
		writePlayerCode(w, http.StatusOK, codeAccountOrPayPwdWrong, "登录密码错误")
		return
	}
	if err != nil {
		s.logger.Error("change-pay-password lookup failed", "error", err, "player_id", playerID)
		writePlayerCode(w, http.StatusInternalServerError, codeBadParameters, "服务暂时不可用，请稍后再试")
		return
	}
	if !storedLoginPwd.Valid || strings.TrimSpace(storedLoginPwd.String) == "" {
		s.logger.Warn("change-pay-password login password missing", "player_id", playerID, "ip", ip)
		s.auditPlayerPayPasswordChange(r.Context(), playerID, "", codeAccountOrPayPwdWrong, "登录密码缺失", ip)
		writePlayerCode(w, http.StatusOK, codeAccountOrPayPwdWrong, "登录密码错误")
		return
	}
	if !strings.EqualFold(md5Hex(loginPwd), strings.TrimSpace(storedLoginPwd.String)) {
		s.passwordAccountLimiter.fail(accountKey, now)
		s.passwordIPLimiter.fail(ipKey, now)
		s.logger.Warn("change-pay-password login password mismatch", "player_id", playerID, "ip", ip)
		s.auditPlayerPayPasswordChange(r.Context(), playerID, "", codeAccountOrPayPwdWrong, "登录密码错误", ip)
		writePlayerCode(w, http.StatusOK, codeAccountOrPayPwdWrong, "登录密码错误")
		return
	}

	result, err := s.callGameCommand(ctx, "异步_设置_玩家_属性", map[string]any{
		"guuid":   playerID,
		"name":    "userPWD2",
		"value":   newPayPwd,
		"context": playerChangePayPasswordCtx,
	})
	if err != nil {
		s.logger.Error("change-pay-password game command failed", "error", err, "player_id", playerID)
		writePlayerCode(w, http.StatusInternalServerError, codeBadParameters, "服务暂时不可用，请稍后再试")
		return
	}
	if result.RetCode != gameRetCodeOK && result.RetCode != gameRetCodeOK2 {
		s.logger.Warn("change-pay-password game command rejected", "player_id", playerID, "ret_code", result.RetCode)
		s.auditPlayerPayPasswordChange(r.Context(), playerID, "", codeBadParameters, fmt.Sprintf("游戏服拒绝 ret_code=%d", result.RetCode), ip)
		writePlayerCode(w, http.StatusOK, codeBadParameters, "修改失败，请稍后再试")
		return
	}

	// 游戏服是异步落库的，回读确认后再给玩家成功提示，避免"提示成功但密码没变"。
	if err := s.waitForPlayerPayPassword(ctx, playerID, newPayPwd); err != nil {
		s.logger.Error("change-pay-password readback failed", "error", err, "player_id", playerID)
		s.auditPlayerPayPasswordChange(r.Context(), playerID, "", codeBadParameters, "回读未生效", ip)
		writePlayerCode(w, http.StatusOK, codeBadParameters, "修改未生效，请稍后再试")
		return
	}

	s.passwordAccountLimiter.succeed(accountKey)
	s.passwordIPLimiter.succeed(ipKey)
	s.logger.Info("change-pay-password ok", "player_id", playerID, "ip", ip)
	s.auditPlayerPayPasswordChange(r.Context(), playerID, playerID, codePasswordOK, "修改成功", ip)
	writePlayerCode(w, http.StatusOK, codePasswordOK, "ok")
}

func (s *Server) waitForPlayerPayPassword(ctx context.Context, playerID, password string) error {
	var lastErr error
	for attempt := 0; attempt < 16; attempt++ {
		var matches bool
		lastErr = s.db.QueryRowContext(ctx, `SELECT LOWER(sm_userPWD2) = MD5(?)
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
	return errors.New("pay password did not match expected digest")
}

func (s *Server) auditPlayerPayPasswordChange(ctx context.Context, playerID, targetID string, code int, result, ip string) {
	request, err := json.Marshal(map[string]string{"player_id": playerID})
	if err != nil {
		request = []byte(`{}`)
	}
	if _, err := s.db.ExecContext(ctx, `INSERT INTO mgr_audit_log
(operator_id, operator_name, action, target_type, target_id, request_json, result_code, result_message, ip)
VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
		playerSelfServiceOperator, playerChangePayPasswordAction, "game_player", targetID,
		string(request), code, result, ip); err != nil {
		s.logger.Error("write pay password change audit", "error", err)
	}
}
