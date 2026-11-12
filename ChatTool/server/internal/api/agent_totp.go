package api

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"chattool/internal/security"
)

const (
	agentTOTPIssuer               = "ChatTool"
	agentTOTPChallengeTTL         = 5 * time.Minute
	agentTOTPChallengeMaxAttempts = 5
)

var (
	errAgentSecondFactorInvalid = errors.New("second factor invalid")
	errAgentPasswordInvalid     = errors.New("current password invalid")
	errAgentTOTPNotEnabled      = errors.New("totp not enabled")
)

type agentTOTPLoginRequest struct {
	ChallengeToken string `json:"challengeToken"`
	Code           string `json:"code"`
}

type agentTOTPSetupRequest struct {
	Password string `json:"password"`
}

type agentTOTPConfirmRequest struct {
	Code string `json:"code"`
}

type agentTOTPDisableRequest struct {
	Password string `json:"password"`
	Code     string `json:"code"`
}

type agentTOTPRecoveryRequest struct {
	Password string `json:"password"`
	Code     string `json:"code"`
}

func (s *Server) createAgentLoginChallenge(ctx context.Context, agentID int64, ip string) (string, error) {
	token, err := security.RandomToken()
	if err != nil {
		return "", err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	// 同一账号只保留最新挑战，旧页面停在验证码步骤时不能再换出一个会话。
	if _, err := tx.ExecContext(ctx, `DELETE FROM chat_agent_login_challenge WHERE agent_id = ? OR expires_at <= NOW()`, agentID); err != nil {
		return "", err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO chat_agent_login_challenge (token_hash, agent_id, ip, expires_at)
VALUES (?, ?, ?, ?)`, security.HashToken(token), agentID, truncateText(ip, 64), time.Now().Add(agentTOTPChallengeTTL)); err != nil {
		return "", err
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	return token, nil
}

func (s *Server) handleAgentTOTPVerify(w http.ResponseWriter, r *http.Request) {
	var req agentTOTPLoginRequest
	if !decodeJSON(w, r, &req, 16<<10) {
		return
	}
	req.ChallengeToken = strings.TrimSpace(req.ChallengeToken)
	req.Code = strings.TrimSpace(req.Code)
	if req.ChallengeToken == "" || req.Code == "" {
		writeError(w, http.StatusBadRequest, "MISSING_TOTP", "请输入动态码或恢复码")
		return
	}
	if !s.totpLimiter.Allow(clientIP(r)) {
		writeError(w, http.StatusTooManyRequests, "LOGIN_RATE_LIMITED", "验证尝试过于频繁，请稍后再试")
		return
	}
	tokenHash := security.HashToken(req.ChallengeToken)
	ctx := r.Context()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "登录暂时不可用")
		return
	}
	defer tx.Rollback()

	var (
		p              agentPrincipal
		attempts       int
		expires        time.Time
		channelEnabled bool
		enabled        bool
		totpEnabled    bool
		totpSecret     sql.NullString
		lastStep       int64
	)
	err = tx.QueryRowContext(ctx, `SELECT c.agent_id, c.attempts, c.expires_at,
a.username, a.display_name, a.role, a.is_super, a.channel_code, channel.display_name,
a.enabled, channel.enabled, a.totp_enabled, a.totp_secret, a.totp_last_step
FROM chat_agent_login_challenge c
JOIN chat_agent a ON a.id = c.agent_id
JOIN chat_channel channel ON channel.code = a.channel_code
WHERE c.token_hash = ? FOR UPDATE`, tokenHash).Scan(
		&p.ID, &attempts, &expires, &p.Username, &p.DisplayName, &p.Role, &p.IsSuper, &p.ChannelCode, &p.ChannelName,
		&enabled, &channelEnabled, &totpEnabled, &totpSecret, &lastStep,
	)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "CHALLENGE_EXPIRED", "验证已过期，请重新输入账号密码")
		return
	}
	if expires.Before(time.Now()) {
		_, _ = tx.ExecContext(ctx, `DELETE FROM chat_agent_login_challenge WHERE token_hash = ?`, tokenHash)
		_ = tx.Commit()
		writeError(w, http.StatusUnauthorized, "CHALLENGE_EXPIRED", "验证已过期，请重新输入账号密码")
		return
	}
	if !enabled || !channelEnabled {
		_, _ = tx.ExecContext(ctx, `DELETE FROM chat_agent_login_challenge WHERE token_hash = ?`, tokenHash)
		_ = tx.Commit()
		writeError(w, http.StatusUnauthorized, "ACCOUNT_DISABLED", "账号或服务通道已停用")
		return
	}
	if attempts >= agentTOTPChallengeMaxAttempts {
		_, _ = tx.ExecContext(ctx, `DELETE FROM chat_agent_login_challenge WHERE token_hash = ?`, tokenHash)
		_ = tx.Commit()
		writeError(w, http.StatusUnauthorized, "CHALLENGE_EXPIRED", "验证失败次数过多，请重新登录")
		return
	}

	method := ""
	newStep := lastStep
	reusedCode := false
	if totpEnabled && totpSecret.Valid && totpSecret.String != "" {
		if plain, openErr := security.OpenCredential(s.totpKey, totpSecret.String); openErr == nil {
			if step, ok := security.ValidateTOTP(plain, req.Code, time.Now()); ok {
				if step > lastStep {
					method, newStep = "totp", step
				} else {
					reusedCode = true
				}
			}
		} else {
			s.logger.Error("open agent totp secret", "agent", p.Username, "error", openErr)
		}
	}
	if method == "" {
		normalized := security.NormalizeRecoveryCode(req.Code)
		if len(normalized) == 10 {
			result, updateErr := tx.ExecContext(ctx, `UPDATE chat_agent_recovery_code SET used_at = NOW()
WHERE agent_id = ? AND code_hash = ? AND used_at IS NULL`, p.ID, security.HashToken(normalized))
			if updateErr != nil {
				writeError(w, http.StatusInternalServerError, "DB_ERROR", "登录暂时不可用")
				return
			}
			if rows, rowsErr := result.RowsAffected(); rowsErr == nil && rows == 1 {
				method = "recovery"
			}
		}
	}

	// 同一个 30 秒窗口内的重复码属于正常现象（验证器还没刷新），不累计失败次数，避免误锁。
	if method == "" && reusedCode {
		writeError(w, http.StatusUnauthorized, "TOTP_REUSED", "该动态码已经使用过，请等待验证器显示下一个动态码后再试")
		return
	}

	if method == "" {
		nextAttempts := attempts + 1
		if nextAttempts >= agentTOTPChallengeMaxAttempts {
			_, _ = tx.ExecContext(ctx, `DELETE FROM chat_agent_login_challenge WHERE token_hash = ?`, tokenHash)
		} else {
			_, _ = tx.ExecContext(ctx, `UPDATE chat_agent_login_challenge SET attempts = ? WHERE token_hash = ?`, nextAttempts, tokenHash)
		}
		_ = tx.Commit()
		s.audit(ctx, "agent", p.Username, "agent.totp_verify_failed", "agent", p.Username,
			map[string]any{"reason": "invalid_code"}, clientIP(r))
		if nextAttempts >= agentTOTPChallengeMaxAttempts {
			writeError(w, http.StatusUnauthorized, "CHALLENGE_EXPIRED", "验证失败次数过多，请重新登录")
			return
		}
		writeError(w, http.StatusUnauthorized, "TOTP_INVALID", "动态码或恢复码不正确，还可尝试 "+strconv.Itoa(agentTOTPChallengeMaxAttempts-nextAttempts)+" 次")
		return
	}

	sessionToken, err := security.RandomToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "TOKEN_FAILED", "无法创建登录会话")
		return
	}
	csrfToken, err := security.RandomToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "TOKEN_FAILED", "无法创建安全令牌")
		return
	}
	if method == "totp" {
		if _, err := tx.ExecContext(ctx, `UPDATE chat_agent SET totp_last_step = ? WHERE id = ?`, newStep, p.ID); err != nil {
			writeError(w, http.StatusInternalServerError, "DB_ERROR", "登录暂时不可用")
			return
		}
	}
	_, _ = tx.ExecContext(ctx, `DELETE FROM chat_agent_login_challenge WHERE token_hash = ?`, tokenHash)
	replacedSessions, err := s.createAgentSession(ctx, tx, p.ID, sessionToken, csrfToken)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "登录暂时不可用")
		return
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "登录暂时不可用")
		return
	}
	p.Presence = "online"
	p.TOTPEnabled = totpEnabled
	s.completeAgentLogin(w, r, p, sessionToken, csrfToken, replacedSessions, method)
	if method == "recovery" {
		s.audit(ctx, "agent", strconv.FormatInt(p.ID, 10), "agent.totp_recovery_used", "agent", strconv.FormatInt(p.ID, 10),
			map[string]any{"method": "recovery"}, clientIP(r))
	}

	var recoveryCodesLeft int
	_ = s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM chat_agent_recovery_code WHERE agent_id = ? AND used_at IS NULL`, p.ID).Scan(&recoveryCodesLeft)
	writeData(w, http.StatusOK, map[string]any{
		"agent":             p,
		"csrfToken":         csrfToken,
		"recoveryCodeUsed":  method == "recovery",
		"recoveryCodesLeft": recoveryCodesLeft,
	})
}

func (s *Server) handleAgentTOTPStatus(w http.ResponseWriter, r *http.Request, p agentPrincipal) {
	var enabled bool
	var confirmedAt sql.NullTime
	if err := s.db.QueryRowContext(r.Context(), `SELECT totp_enabled, totp_confirmed_at FROM chat_agent WHERE id = ?`, p.ID).
		Scan(&enabled, &confirmedAt); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "读取二次验证状态失败")
		return
	}
	var recoveryCodesLeft int
	if err := s.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM chat_agent_recovery_code WHERE agent_id = ? AND used_at IS NULL`, p.ID).
		Scan(&recoveryCodesLeft); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "读取恢复码数量失败")
		return
	}
	var confirmed any
	if confirmedAt.Valid {
		confirmed = confirmedAt.Time
	}
	writeData(w, http.StatusOK, map[string]any{
		"enabled":           enabled,
		"confirmedAt":       confirmed,
		"recoveryCodesLeft": recoveryCodesLeft,
	})
}

func (s *Server) handleAgentTOTPSetup(w http.ResponseWriter, r *http.Request, p agentPrincipal) {
	var req agentTOTPSetupRequest
	if !decodeJSON(w, r, &req, 16<<10) {
		return
	}
	if req.Password == "" {
		writeError(w, http.StatusBadRequest, "MISSING_PASSWORD", "请输入当前登录密码")
		return
	}
	var passwordHash string
	var enabled bool
	if err := s.db.QueryRowContext(r.Context(), `SELECT password_hash, totp_enabled FROM chat_agent WHERE id = ?`, p.ID).
		Scan(&passwordHash, &enabled); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "读取账号失败")
		return
	}
	if !security.CheckPassword(passwordHash, req.Password) {
		writeError(w, http.StatusBadRequest, "CURRENT_PASSWORD_INVALID", "当前密码不正确")
		return
	}
	if enabled {
		writeError(w, http.StatusConflict, "TOTP_ALREADY_ENABLED", "二次验证已开启，请先关闭再重新绑定")
		return
	}
	secret, err := security.NewTOTPSecret()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "TOTP_SETUP_ERROR", "生成动态口令密钥失败")
		return
	}
	sealed, err := security.SealCredential(s.totpKey, secret)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "TOTP_SETUP_ERROR", "保存动态口令密钥失败")
		return
	}
	if _, err := s.db.ExecContext(r.Context(), `UPDATE chat_agent SET
totp_secret = ?, totp_enabled = 0, totp_confirmed_at = NULL, totp_last_step = 0
WHERE id = ?`, sealed, p.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "TOTP_SETUP_ERROR", "保存动态口令密钥失败")
		return
	}
	s.audit(r.Context(), "agent", strconv.FormatInt(p.ID, 10), "agent.totp_setup", "agent", strconv.FormatInt(p.ID, 10),
		map[string]any{"username": p.Username}, clientIP(r))
	writeData(w, http.StatusOK, map[string]any{
		"secret":     secret,
		"otpauthUri": security.TOTPURI(agentTOTPIssuer, p.Username, secret),
	})
}

func (s *Server) handleAgentTOTPConfirm(w http.ResponseWriter, r *http.Request, p agentPrincipal) {
	var req agentTOTPConfirmRequest
	if !decodeJSON(w, r, &req, 16<<10) {
		return
	}
	var sealed string
	var enabled bool
	err := s.db.QueryRowContext(r.Context(), `SELECT totp_secret, totp_enabled FROM chat_agent WHERE id = ?`, p.ID).Scan(&sealed, &enabled)
	if err != nil || sealed == "" || enabled {
		writeError(w, http.StatusBadRequest, "TOTP_NOT_STARTED", "请先重新发起绑定")
		return
	}
	secret, err := security.OpenCredential(s.totpKey, sealed)
	if err != nil || secret == "" {
		writeError(w, http.StatusInternalServerError, "TOTP_STATE_INVALID", "动态口令密钥异常，请重新绑定")
		return
	}
	step, ok := security.ValidateTOTP(secret, req.Code, time.Now())
	if !ok || step <= 0 {
		writeError(w, http.StatusBadRequest, "TOTP_INVALID", "动态码不正确，请确认手机时间准确后重试")
		return
	}
	codes, hashes, err := newAgentRecoveryCodeSet()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "TOTP_SETUP_ERROR", "生成恢复码失败")
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "保存二次验证失败")
		return
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(r.Context(), `DELETE FROM chat_agent_recovery_code WHERE agent_id = ?`, p.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "保存恢复码失败")
		return
	}
	for _, hash := range hashes {
		if _, err := tx.ExecContext(r.Context(), `INSERT INTO chat_agent_recovery_code (agent_id, code_hash) VALUES (?, ?)`, p.ID, hash); err != nil {
			writeError(w, http.StatusInternalServerError, "DB_ERROR", "保存恢复码失败")
			return
		}
	}
	if _, err := tx.ExecContext(r.Context(), `UPDATE chat_agent SET totp_enabled = 1, totp_confirmed_at = NOW(), totp_last_step = ? WHERE id = ?`, step, p.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "保存二次验证失败")
		return
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "保存二次验证失败")
		return
	}
	s.audit(r.Context(), "agent", strconv.FormatInt(p.ID, 10), "agent.totp_enabled", "agent", strconv.FormatInt(p.ID, 10),
		map[string]any{"username": p.Username}, clientIP(r))
	writeData(w, http.StatusOK, map[string]any{
		"message":       "谷歌验证已开启，请妥善保存恢复码",
		"recoveryCodes": codes,
	})
}

func (s *Server) handleAgentTOTPDisable(w http.ResponseWriter, r *http.Request, p agentPrincipal) {
	var req agentTOTPDisableRequest
	if !decodeJSON(w, r, &req, 16<<10) {
		return
	}
	sealed, lastStep, err := s.loadAgentTOTPState(r, p.ID, req.Password)
	if err != nil {
		writeAgentTOTPLoadError(w, err)
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "关闭二次验证失败")
		return
	}
	defer tx.Rollback()
	method, step, err := s.verifyAgentSecondFactor(r.Context(), tx, p.ID, sealed, lastStep, req.Code)
	if err != nil {
		if errors.Is(err, errAgentSecondFactorInvalid) {
			writeError(w, http.StatusBadRequest, "TOTP_INVALID", "动态码或恢复码不正确")
			return
		}
		writeError(w, http.StatusInternalServerError, "TOTP_STATE_INVALID", "校验二次验证失败")
		return
	}
	if method == "totp" {
		if _, err := tx.ExecContext(r.Context(), `UPDATE chat_agent SET totp_last_step = ? WHERE id = ?`, step, p.ID); err != nil {
			writeError(w, http.StatusInternalServerError, "DB_ERROR", "关闭二次验证失败")
			return
		}
	}
	if _, err := tx.ExecContext(r.Context(), `UPDATE chat_agent SET
totp_secret = NULL, totp_enabled = 0, totp_confirmed_at = NULL, totp_last_step = 0
WHERE id = ?`, p.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "关闭二次验证失败")
		return
	}
	if _, err := tx.ExecContext(r.Context(), `DELETE FROM chat_agent_recovery_code WHERE agent_id = ?`, p.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "关闭二次验证失败")
		return
	}
	if _, err := tx.ExecContext(r.Context(), `DELETE FROM chat_agent_login_challenge WHERE agent_id = ?`, p.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "关闭二次验证失败")
		return
	}
	currentToken := ""
	if cookie, err := r.Cookie(agentSessionCookie); err == nil {
		currentToken = security.HashToken(cookie.Value)
	}
	if _, err := tx.ExecContext(r.Context(), `DELETE FROM chat_agent_session WHERE agent_id = ? AND token_hash <> ?`, p.ID, currentToken); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "关闭二次验证失败")
		return
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "关闭二次验证失败")
		return
	}
	s.audit(r.Context(), "agent", strconv.FormatInt(p.ID, 10), "agent.totp_disabled", "agent", strconv.FormatInt(p.ID, 10),
		map[string]any{"username": p.Username, "method": method}, clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"message": "谷歌验证已关闭，其他登录会话已退出"})
}

func (s *Server) handleAgentTOTPRegenerateRecovery(w http.ResponseWriter, r *http.Request, p agentPrincipal) {
	var req agentTOTPRecoveryRequest
	if !decodeJSON(w, r, &req, 16<<10) {
		return
	}
	sealed, lastStep, err := s.loadAgentTOTPState(r, p.ID, req.Password)
	if err != nil {
		writeAgentTOTPLoadError(w, err)
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "生成恢复码失败")
		return
	}
	defer tx.Rollback()
	method, step, err := s.verifyAgentSecondFactor(r.Context(), tx, p.ID, sealed, lastStep, req.Code)
	if err != nil {
		if errors.Is(err, errAgentSecondFactorInvalid) {
			writeError(w, http.StatusBadRequest, "TOTP_INVALID", "动态码或恢复码不正确")
			return
		}
		writeError(w, http.StatusInternalServerError, "TOTP_STATE_INVALID", "校验二次验证失败")
		return
	}
	if method == "totp" {
		if _, err := tx.ExecContext(r.Context(), `UPDATE chat_agent SET totp_last_step = ? WHERE id = ?`, step, p.ID); err != nil {
			writeError(w, http.StatusInternalServerError, "DB_ERROR", "生成恢复码失败")
			return
		}
	}
	codes, hashes, err := newAgentRecoveryCodeSet()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "TOTP_SETUP_ERROR", "生成恢复码失败")
		return
	}
	if _, err := tx.ExecContext(r.Context(), `DELETE FROM chat_agent_recovery_code WHERE agent_id = ?`, p.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "生成恢复码失败")
		return
	}
	for _, hash := range hashes {
		if _, err := tx.ExecContext(r.Context(), `INSERT INTO chat_agent_recovery_code (agent_id, code_hash) VALUES (?, ?)`, p.ID, hash); err != nil {
			writeError(w, http.StatusInternalServerError, "DB_ERROR", "生成恢复码失败")
			return
		}
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "生成恢复码失败")
		return
	}
	s.audit(r.Context(), "agent", strconv.FormatInt(p.ID, 10), "agent.totp_recovery_regenerated", "agent", strconv.FormatInt(p.ID, 10),
		map[string]any{"username": p.Username, "method": method}, clientIP(r))
	writeData(w, http.StatusOK, map[string]any{
		"message":       "恢复码已重新生成，旧恢复码全部失效",
		"recoveryCodes": codes,
	})
}

func (s *Server) loadAgentTOTPState(r *http.Request, agentID int64, password string) (string, int64, error) {
	if password == "" {
		return "", 0, errAgentPasswordInvalid
	}
	var passwordHash string
	var enabled bool
	var lastStep int64
	var secret sql.NullString
	if err := s.db.QueryRowContext(r.Context(), `SELECT password_hash, totp_secret, totp_enabled, totp_last_step
FROM chat_agent WHERE id = ? AND enabled = 1`, agentID).Scan(&passwordHash, &secret, &enabled, &lastStep); err != nil {
		return "", 0, err
	}
	if !security.CheckPassword(passwordHash, password) {
		return "", 0, errAgentPasswordInvalid
	}
	if !enabled || !secret.Valid || secret.String == "" {
		return "", 0, errAgentTOTPNotEnabled
	}
	return secret.String, lastStep, nil
}

func writeAgentTOTPLoadError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errAgentPasswordInvalid):
		writeError(w, http.StatusBadRequest, "CURRENT_PASSWORD_INVALID", "当前密码不正确")
	case errors.Is(err, errAgentTOTPNotEnabled):
		writeError(w, http.StatusBadRequest, "TOTP_NOT_ENABLED", "谷歌验证尚未开启")
	default:
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "读取账号失败")
	}
}

func (s *Server) verifyAgentSecondFactor(ctx context.Context, exec interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}, agentID int64, sealed string, lastStep int64, code string) (string, int64, error) {
	code = strings.TrimSpace(code)
	if code == "" {
		return "", lastStep, errAgentSecondFactorInvalid
	}
	if len(code) == security.TOTPDigits {
		plain, err := security.OpenCredential(s.totpKey, sealed)
		if err != nil {
			return "", lastStep, err
		}
		if plain != "" {
			if step, ok := security.ValidateTOTP(plain, code, time.Now()); ok && step > lastStep {
				return "totp", step, nil
			}
		}
	}
	normalized := security.NormalizeRecoveryCode(code)
	if len(normalized) != 10 {
		return "", lastStep, errAgentSecondFactorInvalid
	}
	result, err := exec.ExecContext(ctx, `UPDATE chat_agent_recovery_code SET used_at = NOW()
WHERE agent_id = ? AND code_hash = ? AND used_at IS NULL`, agentID, security.HashToken(normalized))
	if err != nil {
		return "", lastStep, err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return "", lastStep, err
	}
	if rows == 1 {
		return "recovery", lastStep, nil
	}
	return "", lastStep, errAgentSecondFactorInvalid
}

func newAgentRecoveryCodeSet() ([]string, []string, error) {
	codes, err := security.NewRecoveryCodes()
	if err != nil {
		return nil, nil, err
	}
	hashes := make([]string, 0, len(codes))
	for _, code := range codes {
		hashes = append(hashes, security.HashToken(security.NormalizeRecoveryCode(code)))
	}
	return codes, hashes, nil
}

func truncateText(value string, size int) string {
	if len(value) <= size {
		return value
	}
	return value[:size]
}
