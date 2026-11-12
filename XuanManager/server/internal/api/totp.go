package api

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"xuanmanager/internal/security"
)

const (
	totpIssuer               = "XuanManager"
	totpChallengeTTL         = 5 * time.Minute
	totpChallengeMaxAttempts = 5
)

var errSecondFactorInvalid = errors.New("second factor invalid")

type totpLoginRequest struct {
	ChallengeToken string `json:"challengeToken"`
	Code           string `json:"code"`
}

type totpSetupRequest struct {
	Password string `json:"password"`
}

type totpConfirmRequest struct {
	Code string `json:"code"`
}

type totpDisableRequest struct {
	Password string `json:"password"`
	Code     string `json:"code"`
}

type totpRecoveryRequest struct {
	Password string `json:"password"`
	Code     string `json:"code"`
}

func (s *Server) createLoginChallenge(ctx context.Context, userID int64, ip string) (string, error) {
	token, err := security.NewToken()
	if err != nil {
		return "", err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	// 同一账号只保留最新挑战：旧页面停在验证码步骤时不能再换出一个会话。
	if _, err := tx.ExecContext(ctx, `DELETE FROM mgr_login_challenge WHERE user_id = ? OR expires_at <= NOW()`, userID); err != nil {
		return "", err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO mgr_login_challenge (token_hash, user_id, ip, expires_at)
VALUES (?, ?, ?, ?)`, security.HashToken(token), userID, truncate(ip, 64), time.Now().Add(totpChallengeTTL)); err != nil {
		return "", err
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	return token, nil
}

func (s *Server) handleTOTPLogin(w http.ResponseWriter, r *http.Request) {
	var input totpLoginRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	input.ChallengeToken = strings.TrimSpace(input.ChallengeToken)
	input.Code = strings.TrimSpace(input.Code)
	if input.ChallengeToken == "" || input.Code == "" {
		writeError(w, http.StatusBadRequest, "MISSING_TOTP", "请输入动态码或恢复码")
		return
	}
	tokenHash := security.HashToken(input.ChallengeToken)
	ctx := r.Context()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "登录暂时不可用")
		return
	}
	defer tx.Rollback()

	var (
		userID                                 int64
		attempts                               int
		expires                                time.Time
		username, displayName                  string
		roleID                                 int64
		roleCode, roleName, roleStatus, status string
		isSuper, totpEnabled                   bool
		totpSecret                             sql.NullString
		lastStep                               int64
		lockedUntil                            sql.NullTime
	)
	err = tx.QueryRowContext(ctx, `SELECT c.user_id, c.attempts, c.expires_at,
u.username, u.display_name, u.role_id, r.code, r.name, r.status, u.is_super,
u.totp_enabled, u.totp_secret, u.totp_last_step, u.status, u.locked_until
FROM mgr_login_challenge c
JOIN mgr_user u ON u.id = c.user_id
JOIN mgr_role r ON r.id = u.role_id
WHERE c.token_hash = ? FOR UPDATE`, tokenHash).Scan(
		&userID, &attempts, &expires, &username, &displayName, &roleID, &roleCode, &roleName, &roleStatus, &isSuper,
		&totpEnabled, &totpSecret, &lastStep, &status, &lockedUntil,
	)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "CHALLENGE_EXPIRED", "验证已过期，请重新输入账号密码")
		return
	}
	if expires.Before(time.Now()) {
		_, _ = tx.ExecContext(ctx, `DELETE FROM mgr_login_challenge WHERE token_hash = ?`, tokenHash)
		_ = tx.Commit()
		writeError(w, http.StatusUnauthorized, "CHALLENGE_EXPIRED", "验证已过期，请重新输入账号密码")
		return
	}
	if status != "enabled" || roleStatus != "enabled" {
		_, _ = tx.ExecContext(ctx, `DELETE FROM mgr_login_challenge WHERE token_hash = ?`, tokenHash)
		_ = tx.Commit()
		writeError(w, http.StatusUnauthorized, "ACCOUNT_DISABLED", "账号或角色已停用")
		return
	}
	if lockedUntil.Valid && lockedUntil.Time.After(time.Now()) {
		writeError(w, http.StatusUnauthorized, "ACCOUNT_LOCKED", "账号暂时锁定，请稍后再试")
		return
	}
	if attempts >= totpChallengeMaxAttempts {
		_, _ = tx.ExecContext(ctx, `DELETE FROM mgr_login_challenge WHERE token_hash = ?`, tokenHash)
		_ = tx.Commit()
		writeError(w, http.StatusUnauthorized, "CHALLENGE_EXPIRED", "验证失败次数过多，请重新登录")
		return
	}

	method := ""
	newStep := lastStep
	reusedCode := false
	if totpEnabled && totpSecret.Valid && totpSecret.String != "" {
		if plain, openErr := security.OpenCredential(s.totpKey, totpSecret.String); openErr == nil {
			if step, ok := security.ValidateTOTP(plain, input.Code, time.Now()); ok {
				if step > lastStep {
					method, newStep = "totp", step
				} else {
					reusedCode = true
				}
			}
		} else {
			s.logger.Error("open totp secret", "user", username, "error", openErr)
		}
	}
	if method == "" {
		normalized := security.NormalizeRecoveryCode(input.Code)
		if len(normalized) == 10 {
			result, updateErr := tx.ExecContext(ctx, `UPDATE mgr_user_recovery_code SET used_at = NOW()
WHERE user_id = ? AND code_hash = ? AND used_at IS NULL`, userID, security.HashToken(normalized))
			if updateErr != nil {
				writeError(w, http.StatusInternalServerError, "DB_ERROR", "登录暂时不可用")
				return
			}
			if rows, rowsErr := result.RowsAffected(); rowsErr == nil && rows == 1 {
				method = "recovery"
			}
		}
	}

	// 同一个 30 秒窗口内的重复码属于正常现象（验证器还没刷新），不累计失败次数，避免误锁账号。
	if method == "" && reusedCode {
		writeError(w, http.StatusUnauthorized, "TOTP_REUSED", "该动态码已经使用过，请等待验证器显示下一个动态码后再试")
		return
	}

	if method == "" {
		nextAttempts := attempts + 1
		if nextAttempts >= totpChallengeMaxAttempts {
			_, _ = tx.ExecContext(ctx, `DELETE FROM mgr_login_challenge WHERE token_hash = ?`, tokenHash)
		} else {
			_, _ = tx.ExecContext(ctx, `UPDATE mgr_login_challenge SET attempts = ? WHERE token_hash = ?`, nextAttempts, tokenHash)
		}
		_, _ = tx.ExecContext(ctx, `UPDATE mgr_user SET
login_fail_count = login_fail_count + 1,
locked_until = CASE WHEN login_fail_count + 1 >= 5 THEN DATE_ADD(NOW(), INTERVAL 15 MINUTE) ELSE locked_until END
WHERE id = ?`, userID)
		_ = tx.Commit()
		s.audit(ctx, nil, "auth.totp.verify_failed", "mgr_user", username,
			map[string]any{"username": username}, nil, nil, 401, "动态码或恢复码不正确", clientIP(r))
		if nextAttempts >= totpChallengeMaxAttempts {
			writeError(w, http.StatusUnauthorized, "CHALLENGE_EXPIRED", "验证失败次数过多，请重新登录")
			return
		}
		writeError(w, http.StatusUnauthorized, "TOTP_INVALID", "动态码或恢复码不正确，还可尝试 "+strconv.Itoa(totpChallengeMaxAttempts-nextAttempts)+" 次")
		return
	}

	sessionToken, err := security.NewToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "TOKEN_ERROR", "暂时无法登录，请稍后重试")
		return
	}
	csrfToken, err := security.NewToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "TOKEN_ERROR", "暂时无法登录，请稍后重试")
		return
	}
	sessionExpires := time.Now().Add(s.cfg.SessionTTL)
	if method == "totp" {
		if _, err := tx.ExecContext(ctx, `UPDATE mgr_user SET totp_last_step = ? WHERE id = ?`, newStep, userID); err != nil {
			writeError(w, http.StatusInternalServerError, "SESSION_ERROR", "创建登录会话失败")
			return
		}
	}
	_, _ = tx.ExecContext(ctx, `DELETE FROM mgr_login_challenge WHERE token_hash = ?`, tokenHash)
	replacedSessions, err := replaceUserSession(ctx, tx, security.HashToken(sessionToken), userID,
		security.HashToken(csrfToken), clientIP(r), truncate(r.UserAgent(), 255), sessionExpires)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "SESSION_ERROR", "创建登录会话失败")
		return
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "SESSION_ERROR", "创建登录会话失败")
		return
	}
	s.setAuthCookies(w, sessionToken, csrfToken, sessionExpires)

	p := principal{
		ID: userID, Username: username, DisplayName: displayName,
		RoleID: roleID, RoleCode: roleCode, RoleName: roleName,
		IsSuper: isEffectiveSuper(isSuper, roleCode), IsProtectedRoot: isProtectedRootIdentity(username),
		TOTPEnabled: totpEnabled,
	}
	after := map[string]any{"singleSession": true, "replacedSessionCount": replacedSessions, "method": method}
	s.audit(ctx, &p, "auth.login", "mgr_user", numericID(userID),
		map[string]any{"username": username}, nil, after, 0, "二次验证通过，登录成功", clientIP(r))
	if method == "recovery" {
		s.audit(ctx, &p, "auth.totp.recovery_used", "mgr_user", numericID(userID),
			map[string]any{"username": username}, nil, nil, 0, "使用恢复码登录", clientIP(r))
	}

	var recoveryCodesLeft int
	_ = s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM mgr_user_recovery_code WHERE user_id = ? AND used_at IS NULL`, userID).Scan(&recoveryCodesLeft)
	writeData(w, http.StatusOK, map[string]any{
		"message":           "登录成功，同账号其他设备已退出",
		"recoveryCodeUsed":  method == "recovery",
		"recoveryCodesLeft": recoveryCodesLeft,
	})
}

func (s *Server) handleTOTPStatus(w http.ResponseWriter, r *http.Request, p principal) {
	var enabled bool
	var confirmedAt sql.NullTime
	if err := s.db.QueryRowContext(r.Context(), `SELECT totp_enabled, totp_confirmed_at FROM mgr_user WHERE id = ?`, p.ID).
		Scan(&enabled, &confirmedAt); err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取二次验证状态失败")
		return
	}
	var recoveryCodesLeft int
	if err := s.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM mgr_user_recovery_code WHERE user_id = ? AND used_at IS NULL`, p.ID).
		Scan(&recoveryCodesLeft); err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取恢复码数量失败")
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

func (s *Server) handleTOTPSetup(w http.ResponseWriter, r *http.Request, p principal) {
	var input totpSetupRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if input.Password == "" {
		writeError(w, http.StatusBadRequest, "MISSING_PASSWORD", "请输入当前登录密码")
		return
	}
	var passwordHash string
	var enabled bool
	if err := s.db.QueryRowContext(r.Context(), `SELECT password_hash, totp_enabled FROM mgr_user WHERE id = ?`, p.ID).
		Scan(&passwordHash, &enabled); err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取账号失败")
		return
	}
	if !security.VerifyPassword(passwordHash, input.Password) {
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
	if _, err := s.db.ExecContext(r.Context(), `UPDATE mgr_user SET
totp_secret = ?, totp_enabled = 0, totp_confirmed_at = NULL, totp_last_step = 0
WHERE id = ?`, sealed, p.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "TOTP_SETUP_ERROR", "保存动态口令密钥失败")
		return
	}
	s.audit(r.Context(), &p, "auth.totp.setup", "mgr_user", numericID(p.ID),
		map[string]any{"username": p.Username}, nil, nil, 0, "已生成动态口令密钥，等待确认", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{
		"secret":     secret,
		"otpauthUri": security.TOTPURI(totpIssuer, p.Username, secret),
	})
}

func (s *Server) handleTOTPConfirm(w http.ResponseWriter, r *http.Request, p principal) {
	var input totpConfirmRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	var sealed string
	var enabled bool
	err := s.db.QueryRowContext(r.Context(), `SELECT totp_secret, totp_enabled FROM mgr_user WHERE id = ?`, p.ID).Scan(&sealed, &enabled)
	if err != nil || sealed == "" || enabled {
		writeError(w, http.StatusBadRequest, "TOTP_NOT_STARTED", "请先重新发起绑定")
		return
	}
	secret, err := security.OpenCredential(s.totpKey, sealed)
	if err != nil || secret == "" {
		writeError(w, http.StatusInternalServerError, "TOTP_STATE_INVALID", "动态口令密钥异常，请重新绑定")
		return
	}
	step, ok := security.ValidateTOTP(secret, input.Code, time.Now())
	if !ok || step <= 0 {
		writeError(w, http.StatusBadRequest, "TOTP_INVALID", "动态码不正确，请确认手机时间准确后重试")
		return
	}
	codes, hashes, err := newRecoveryCodeSet()
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
	if _, err := tx.ExecContext(r.Context(), `DELETE FROM mgr_user_recovery_code WHERE user_id = ?`, p.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "保存恢复码失败")
		return
	}
	for _, hash := range hashes {
		if _, err := tx.ExecContext(r.Context(), `INSERT INTO mgr_user_recovery_code (user_id, code_hash) VALUES (?, ?)`, p.ID, hash); err != nil {
			writeError(w, http.StatusInternalServerError, "DB_ERROR", "保存恢复码失败")
			return
		}
	}
	if _, err := tx.ExecContext(r.Context(), `UPDATE mgr_user SET totp_enabled = 1, totp_confirmed_at = NOW(), totp_last_step = ? WHERE id = ?`, step, p.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "保存二次验证失败")
		return
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "保存二次验证失败")
		return
	}
	s.audit(r.Context(), &p, "auth.totp.enabled", "mgr_user", numericID(p.ID),
		map[string]any{"username": p.Username}, nil, nil, 0, "谷歌验证已开启", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{
		"message":       "谷歌验证已开启，请妥善保存恢复码",
		"recoveryCodes": codes,
	})
}

func (s *Server) handleTOTPDisable(w http.ResponseWriter, r *http.Request, p principal) {
	var input totpDisableRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	sealed, lastStep, err := s.loadTOTPState(r, p.ID, input.Password, true)
	if err != nil {
		writeTOTPLoadError(w, err)
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "关闭二次验证失败")
		return
	}
	defer tx.Rollback()
	method, step, err := s.verifySecondFactor(r.Context(), tx, p.ID, sealed, lastStep, input.Code)
	if err != nil {
		if errors.Is(err, errSecondFactorInvalid) {
			writeError(w, http.StatusBadRequest, "TOTP_INVALID", "动态码或恢复码不正确")
			return
		}
		writeError(w, http.StatusInternalServerError, "TOTP_STATE_INVALID", "校验二次验证失败")
		return
	}
	if method == "totp" {
		if _, err := tx.ExecContext(r.Context(), `UPDATE mgr_user SET totp_last_step = ? WHERE id = ?`, step, p.ID); err != nil {
			writeError(w, http.StatusInternalServerError, "DB_ERROR", "关闭二次验证失败")
			return
		}
	}
	if _, err := tx.ExecContext(r.Context(), `UPDATE mgr_user SET
totp_secret = NULL, totp_enabled = 0, totp_confirmed_at = NULL, totp_last_step = 0
WHERE id = ?`, p.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "关闭二次验证失败")
		return
	}
	if _, err := tx.ExecContext(r.Context(), `DELETE FROM mgr_user_recovery_code WHERE user_id = ?`, p.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "关闭二次验证失败")
		return
	}
	if _, err := tx.ExecContext(r.Context(), `DELETE FROM mgr_login_challenge WHERE user_id = ?`, p.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "关闭二次验证失败")
		return
	}
	currentToken := ""
	if cookie, err := r.Cookie(sessionCookie); err == nil {
		currentToken = security.HashToken(cookie.Value)
	}
	if _, err := tx.ExecContext(r.Context(), `DELETE FROM mgr_session WHERE user_id = ? AND token_hash <> ?`, p.ID, currentToken); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "关闭二次验证失败")
		return
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "关闭二次验证失败")
		return
	}
	s.audit(r.Context(), &p, "auth.totp.disabled", "mgr_user", numericID(p.ID),
		map[string]any{"username": p.Username, "method": method}, nil, nil, 0, "谷歌验证已关闭", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"message": "谷歌验证已关闭，其他登录会话已退出"})
}

func (s *Server) handleTOTPRegenerateRecovery(w http.ResponseWriter, r *http.Request, p principal) {
	var input totpRecoveryRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	sealed, lastStep, err := s.loadTOTPState(r, p.ID, input.Password, true)
	if err != nil {
		writeTOTPLoadError(w, err)
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "生成恢复码失败")
		return
	}
	defer tx.Rollback()
	method, step, err := s.verifySecondFactor(r.Context(), tx, p.ID, sealed, lastStep, input.Code)
	if err != nil {
		if errors.Is(err, errSecondFactorInvalid) {
			writeError(w, http.StatusBadRequest, "TOTP_INVALID", "动态码或恢复码不正确")
			return
		}
		writeError(w, http.StatusInternalServerError, "TOTP_STATE_INVALID", "校验二次验证失败")
		return
	}
	if method == "totp" {
		if _, err := tx.ExecContext(r.Context(), `UPDATE mgr_user SET totp_last_step = ? WHERE id = ?`, step, p.ID); err != nil {
			writeError(w, http.StatusInternalServerError, "DB_ERROR", "生成恢复码失败")
			return
		}
	}
	codes, hashes, err := newRecoveryCodeSet()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "TOTP_SETUP_ERROR", "生成恢复码失败")
		return
	}
	if _, err := tx.ExecContext(r.Context(), `DELETE FROM mgr_user_recovery_code WHERE user_id = ?`, p.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "生成恢复码失败")
		return
	}
	for _, hash := range hashes {
		if _, err := tx.ExecContext(r.Context(), `INSERT INTO mgr_user_recovery_code (user_id, code_hash) VALUES (?, ?)`, p.ID, hash); err != nil {
			writeError(w, http.StatusInternalServerError, "DB_ERROR", "生成恢复码失败")
			return
		}
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "生成恢复码失败")
		return
	}
	s.audit(r.Context(), &p, "auth.totp.recovery_regenerated", "mgr_user", numericID(p.ID),
		map[string]any{"username": p.Username, "method": method}, nil, nil, 0, "恢复码已重新生成", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{
		"message":       "恢复码已重新生成，旧恢复码全部失效",
		"recoveryCodes": codes,
	})
}

var errCurrentPasswordInvalid = errors.New("current password invalid")
var errTOTPNotEnabled = errors.New("totp not enabled")

func (s *Server) loadTOTPState(r *http.Request, userID int64, password string, requireEnabled bool) (string, int64, error) {
	if password == "" {
		return "", 0, errCurrentPasswordInvalid
	}
	var passwordHash string
	var enabled bool
	var lastStep int64
	var secret sql.NullString
	if err := s.db.QueryRowContext(r.Context(), `SELECT password_hash, totp_secret, totp_enabled, totp_last_step
FROM mgr_user WHERE id = ?`, userID).Scan(&passwordHash, &secret, &enabled, &lastStep); err != nil {
		return "", 0, err
	}
	if !security.VerifyPassword(passwordHash, password) {
		return "", 0, errCurrentPasswordInvalid
	}
	if requireEnabled && (!enabled || !secret.Valid || secret.String == "") {
		return "", 0, errTOTPNotEnabled
	}
	return secret.String, lastStep, nil
}

func writeTOTPLoadError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errCurrentPasswordInvalid):
		writeError(w, http.StatusBadRequest, "CURRENT_PASSWORD_INVALID", "当前密码不正确")
	case errors.Is(err, errTOTPNotEnabled):
		writeError(w, http.StatusBadRequest, "TOTP_NOT_ENABLED", "谷歌验证尚未开启")
	default:
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取账号失败")
	}
}

func (s *Server) verifySecondFactor(ctx context.Context, exec sessionExecer, userID int64, sealed string, lastStep int64, code string) (string, int64, error) {
	code = strings.TrimSpace(code)
	if code == "" {
		return "", lastStep, errSecondFactorInvalid
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
		return "", lastStep, errSecondFactorInvalid
	}
	result, err := exec.ExecContext(ctx, `UPDATE mgr_user_recovery_code SET used_at = NOW()
WHERE user_id = ? AND code_hash = ? AND used_at IS NULL`, userID, security.HashToken(normalized))
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
	return "", lastStep, errSecondFactorInvalid
}

func newRecoveryCodeSet() ([]string, []string, error) {
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
