package api

import (
	"context"
	"crypto/md5"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
)

// 登录前自助修改登录密码（玩家侧接口，无后台登录态，身份核验完全依赖交易密码）。
// 只写 kbedm.third_marketing_info.player_wxpwd（登录校验的权威来源）；
// tbl_Account.sm_userPWD 由登录/重连自愈同步，本接口不持有该表写权限。

const (
	codePasswordOK           = 0
	codeAccountOrPayPwdWrong = 1001
	codePayPwdNotSet         = 1002
	codeNewPwdEmpty          = 1003
	codeRateLimited          = 1004
	codeBadParameters        = 1005
)

var playerAccountPattern = regexp.MustCompile(`^[A-Za-z0-9]{6,16}$`)

const (
	playerSelfServiceOperator  = "玩家自助"
	playerPasswordChangeAction = "game.player.change_login_password"
)

type playerPasswordChangeRequest struct {
	Account string `json:"account"`
	PayPwd  string `json:"pay_pwd"`
	NewPwd  string `json:"new_pwd"`
}

type passwordAttemptState struct {
	StartedAt   time.Time
	Failures    int
	LockedUntil time.Time
}

type passwordAttemptLimiter struct {
	mu           sync.Mutex
	maxFailures  int
	window       time.Duration
	lockDuration time.Duration
	entries      map[string]passwordAttemptState
}

func newPasswordAttemptLimiter(maxFailures int, window, lock time.Duration) *passwordAttemptLimiter {
	return &passwordAttemptLimiter{
		maxFailures:  maxFailures,
		window:       window,
		lockDuration: lock,
		entries:      make(map[string]passwordAttemptState),
	}
}

func (l *passwordAttemptLimiter) blocked(key string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	entry, ok := l.entries[key]
	if !ok {
		return false
	}
	if now.Before(entry.LockedUntil) {
		return true
	}
	if !entry.LockedUntil.IsZero() {
		// 锁定窗口结束后重新计数，让玩家可以再次尝试。
		delete(l.entries, key)
		return false
	}
	if now.Sub(entry.StartedAt) >= l.window {
		delete(l.entries, key)
		return false
	}
	return entry.Failures >= l.maxFailures
}

func (l *passwordAttemptLimiter) fail(key string, now time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	entry, ok := l.entries[key]
	if !ok || now.Sub(entry.StartedAt) >= l.window {
		entry = passwordAttemptState{StartedAt: now}
	}
	entry.Failures++
	if entry.Failures >= l.maxFailures {
		entry.LockedUntil = now.Add(l.lockDuration)
	}
	l.entries[key] = entry
	l.cleanup(now)
}

func (l *passwordAttemptLimiter) succeed(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.entries, key)
}

func (l *passwordAttemptLimiter) cleanup(now time.Time) {
	if len(l.entries) < 2048 {
		return
	}
	for key, entry := range l.entries {
		if now.Sub(entry.StartedAt) >= l.window && now.After(entry.LockedUntil) {
			delete(l.entries, key)
		}
	}
}

// 与后台管理接口使用同一套 ok/data 信封。
func writePlayerCode(w http.ResponseWriter, status, code int, message string) {
	if code == codePasswordOK {
		writeData(w, status, map[string]any{"message": message})
		return
	}
	writeError(w, status, playerErrorCode(code), message)
}

func playerErrorCode(code int) string {
	switch code {
	case codeAccountOrPayPwdWrong:
		return "ACCOUNT_OR_PAY_PASSWORD_WRONG"
	case codePayPwdNotSet:
		return "PAY_PASSWORD_NOT_SET"
	case codeNewPwdEmpty:
		return "NEW_PASSWORD_REQUIRED"
	case codeRateLimited:
		return "RATE_LIMITED"
	default:
		return "INVALID_PARAMETERS"
	}
}

// 玩家自助改密没有后台登录态，审计里以固定操作人标识记录，便于后台审计模块检索。
func (s *Server) auditPlayerPasswordChange(ctx context.Context, account, playerGUID string, code int, result, ip string) {
	request, err := json.Marshal(map[string]string{"account": account})
	if err != nil {
		request = []byte(`{}`)
	}
	if _, err := s.db.ExecContext(ctx, `INSERT INTO mgr_audit_log
(operator_id, operator_name, action, target_type, target_id, request_json, result_code, result_message, ip)
VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
		playerSelfServiceOperator, playerPasswordChangeAction, "game_player", playerGUID,
		string(request), code, result, ip); err != nil {
		s.logger.Error("write password change audit", "error", err)
	}
}

func (s *Server) handleChangePasswordOptions(w http.ResponseWriter, _ *http.Request) {
	setRegistrationCORS(w)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleChangePlayerLoginPassword(w http.ResponseWriter, r *http.Request) {
	setRegistrationCORS(w)
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16))
	decoder.DisallowUnknownFields()
	var body playerPasswordChangeRequest
	if err := decoder.Decode(&body); err != nil {
		writePlayerCode(w, http.StatusOK, codeBadParameters, "参数格式错误")
		return
	}
	account := strings.TrimSpace(body.Account)
	newPwd := body.NewPwd
	payPwd := body.PayPwd
	if !playerAccountPattern.MatchString(account) || strings.TrimSpace(payPwd) == "" {
		writePlayerCode(w, http.StatusOK, codeBadParameters, "参数格式错误")
		return
	}
	if strings.TrimSpace(newPwd) == "" {
		writePlayerCode(w, http.StatusOK, codeNewPwdEmpty, "新密码不能为空")
		return
	}

	now := time.Now()
	ip := clientIP(r)
	accountKey := "account:" + account
	ipKey := "ip:" + ip
	if s.passwordAccountLimiter.blocked(accountKey, now) || s.passwordIPLimiter.blocked(ipKey, now) {
		s.logger.Warn("change-login-password rate limited", "account", account, "ip", ip)
		s.auditPlayerPasswordChange(r.Context(), account, "", codeRateLimited, "请求过于频繁", ip)
		writePlayerCode(w, http.StatusOK, codeRateLimited, "请求过于频繁，请稍后再试")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var playerGUID string
	var storedPayPwd sql.NullString
	err := s.db.QueryRowContext(ctx, `SELECT t.player_guuid, a.sm_userPWD2
FROM kbedm.third_marketing_info t
LEFT JOIN kbedm.tbl_Account a ON a.sm_guuid = t.player_guuid
WHERE t.player_wxid = ? LIMIT 1`, account).Scan(&playerGUID, &storedPayPwd)
	if errors.Is(err, sql.ErrNoRows) {
		s.passwordAccountLimiter.fail(accountKey, now)
		s.passwordIPLimiter.fail(ipKey, now)
		s.logger.Warn("change-login-password unknown account", "account", account, "ip", ip)
		s.auditPlayerPasswordChange(r.Context(), account, "", codeAccountOrPayPwdWrong, "账号不存在", ip)
		writePlayerCode(w, http.StatusOK, codeAccountOrPayPwdWrong, "账号或交易密码错误")
		return
	}
	if err != nil {
		s.logger.Error("change-login-password lookup failed", "error", err)
		writePlayerCode(w, http.StatusInternalServerError, codeBadParameters, "服务暂时不可用，请稍后再试")
		return
	}

	if !storedPayPwd.Valid || strings.TrimSpace(storedPayPwd.String) == "" {
		s.logger.Warn("change-login-password pay password not set", "account", account, "ip", ip)
		s.auditPlayerPasswordChange(r.Context(), account, playerGUID, codePayPwdNotSet, "未设置交易密码", ip)
		writePlayerCode(w, http.StatusOK, codePayPwdNotSet, "该账号未设置交易密码，请先登录游戏设置交易密码")
		return
	}

	if !strings.EqualFold(md5Hex(payPwd), strings.TrimSpace(storedPayPwd.String)) {
		s.passwordAccountLimiter.fail(accountKey, now)
		s.passwordIPLimiter.fail(ipKey, now)
		s.logger.Warn("change-login-password pay password mismatch", "account", account, "ip", ip)
		s.auditPlayerPasswordChange(r.Context(), account, playerGUID, codeAccountOrPayPwdWrong, "交易密码错误", ip)
		writePlayerCode(w, http.StatusOK, codeAccountOrPayPwdWrong, "账号或交易密码错误")
		return
	}

	result, err := s.db.ExecContext(ctx, `UPDATE kbedm.third_marketing_info
SET player_wxpwd = MD5(?)
WHERE player_wxid = ?`, newPwd, account)
	if err != nil {
		s.logger.Error("change-login-password update failed", "error", err)
		writePlayerCode(w, http.StatusInternalServerError, codeBadParameters, "服务暂时不可用，请稍后再试")
		return
	}
	// MySQL 的 affected_rows 统计的是真正发生变化的行：新密码与当前密码相同时
	// 返回 0，这正是文档 P10 的幂等场景，必须当成成功。只有异常的多行更新才报错。
	if affected, _ := result.RowsAffected(); affected > 1 {
		s.logger.Error("change-login-password unexpected row count", "account", account, "rows", affected)
		writePlayerCode(w, http.StatusInternalServerError, codeBadParameters, "服务暂时不可用，请稍后再试")
		return
	}

	s.passwordAccountLimiter.succeed(accountKey)
	s.logger.Info("change-login-password ok", "account", account, "ip", ip)
	s.auditPlayerPasswordChange(r.Context(), account, playerGUID, codePasswordOK, "修改成功", ip)
	writePlayerCode(w, http.StatusOK, codePasswordOK, "ok")
}

func md5Hex(plain string) string {
	sum := md5.Sum([]byte(plain))
	return hex.EncodeToString(sum[:])
}
