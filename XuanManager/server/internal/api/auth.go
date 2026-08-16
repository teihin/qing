package api

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"xuanmanager/internal/security"
)

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type changePasswordRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var input loginRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Username = strings.TrimSpace(input.Username)
	if input.Username == "" || input.Password == "" {
		writeError(w, http.StatusBadRequest, "MISSING_CREDENTIALS", "请输入账号和密码")
		return
	}

	var p principal
	var passwordHash, status string
	var isSuper bool
	var failCount int
	var lockedUntil sql.NullTime
	err := s.db.QueryRowContext(r.Context(), `SELECT
u.id, u.username, u.display_name, u.role_id, r.code, r.name, u.is_super,
u.password_hash, u.status, u.login_fail_count, u.locked_until
FROM mgr_user u JOIN mgr_role r ON r.id = u.role_id
WHERE u.username = ?`, input.Username).Scan(
		&p.ID, &p.Username, &p.DisplayName, &p.RoleID, &p.RoleCode, &p.RoleName, &isSuper,
		&passwordHash, &status, &failCount, &lockedUntil,
	)
	if err != nil || status != "enabled" || (lockedUntil.Valid && lockedUntil.Time.After(time.Now())) || !security.VerifyPassword(passwordHash, input.Password) {
		if err == nil && status == "enabled" && (!lockedUntil.Valid || lockedUntil.Time.Before(time.Now())) {
			_, _ = s.db.ExecContext(r.Context(), `UPDATE mgr_user SET
login_fail_count = login_fail_count + 1,
locked_until = CASE WHEN login_fail_count + 1 >= 5 THEN DATE_ADD(NOW(), INTERVAL 15 MINUTE) ELSE locked_until END
WHERE id = ?`, p.ID)
		}
		s.audit(r.Context(), nil, "auth.login.failed", "mgr_user", input.Username,
			map[string]any{"username": input.Username}, nil, nil, 401, "账号或密码错误", clientIP(r))
		writeError(w, http.StatusUnauthorized, "LOGIN_FAILED", "账号或密码错误，连续失败会暂时锁定账号")
		return
	}
	p.IsProtectedRoot = isProtectedRootIdentity(p.Username)
	p.IsSuper = isEffectiveSuper(isSuper, p.RoleCode)

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
	expires := time.Now().Add(s.cfg.SessionTTL)
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "SESSION_ERROR", "创建登录会话失败")
		return
	}
	defer tx.Rollback()
	replacedSessions, err := replaceUserSession(r.Context(), tx, security.HashToken(sessionToken), p.ID,
		security.HashToken(csrfToken), clientIP(r), truncate(r.UserAgent(), 255), expires)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "SESSION_ERROR", "创建登录会话失败")
		return
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "SESSION_ERROR", "创建登录会话失败")
		return
	}
	s.setAuthCookies(w, sessionToken, csrfToken, expires)
	s.audit(r.Context(), &p, "auth.login", "mgr_user", numericID(p.ID),
		map[string]any{"username": p.Username}, nil,
		map[string]any{"singleSession": true, "replacedSessionCount": replacedSessions},
		0, "登录成功，其他设备会话已退出", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"message": "登录成功，同账号其他设备已退出"})
}

type sessionExecer interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func replaceUserSession(ctx context.Context, executor sessionExecer, tokenHash string, userID int64, csrfHash, ip, userAgent string, expires time.Time) (int64, error) {
	// Updating the user row first serializes concurrent logins for the same account.
	// The later login waits for the earlier transaction, then removes its session.
	if _, err := executor.ExecContext(ctx, `UPDATE mgr_user SET
login_fail_count = 0, locked_until = NULL, last_login_at = NOW() WHERE id = ?`, userID); err != nil {
		return 0, fmt.Errorf("lock user for login: %w", err)
	}
	result, err := executor.ExecContext(ctx, "DELETE FROM mgr_session WHERE user_id = ?", userID)
	if err != nil {
		return 0, fmt.Errorf("clear previous sessions: %w", err)
	}
	replaced, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("count previous sessions: %w", err)
	}
	if _, err := executor.ExecContext(ctx, `INSERT INTO mgr_session
(token_hash, user_id, csrf_hash, ip, user_agent, expires_at)
VALUES (?, ?, ?, ?, ?, ?)`, tokenHash, userID, csrfHash, ip, userAgent, expires); err != nil {
		return 0, fmt.Errorf("insert current session: %w", err)
	}
	return replaced, nil
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request, p principal) {
	permissionCodes := make([]string, 0, len(p.Permissions))
	for code := range p.Permissions {
		permissionCodes = append(permissionCodes, code)
	}
	sort.Strings(permissionCodes)
	modules, err := s.allowedNavigation(r, p)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取菜单失败")
		return
	}
	writeData(w, http.StatusOK, map[string]any{
		"user": map[string]any{
			"id": p.ID, "username": p.Username, "displayName": p.DisplayName,
			"roleId": p.RoleID, "roleCode": p.RoleCode, "roleName": p.RoleName,
			"isSuper": p.IsSuper, "isProtectedRoot": p.IsProtectedRoot,
		},
		"permissions": permissionCodes,
		"modules":     modules,
	})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request, p principal) {
	if cookie, err := r.Cookie(sessionCookie); err == nil {
		_, _ = s.db.ExecContext(r.Context(), "DELETE FROM mgr_session WHERE token_hash = ?", security.HashToken(cookie.Value))
	}
	s.clearAuthCookies(w)
	s.audit(r.Context(), &p, "auth.logout", "mgr_user", numericID(p.ID), nil, nil, nil, 0, "退出登录", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"message": "已安全退出"})
}

func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request, p principal) {
	var input changePasswordRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	var currentHash string
	if err := s.db.QueryRowContext(r.Context(), "SELECT password_hash FROM mgr_user WHERE id = ?", p.ID).Scan(&currentHash); err != nil || !security.VerifyPassword(currentHash, input.CurrentPassword) {
		writeError(w, http.StatusBadRequest, "CURRENT_PASSWORD_INVALID", "当前密码不正确")
		return
	}
	newHash, err := security.HashPassword(input.NewPassword)
	if err != nil {
		writeError(w, http.StatusBadRequest, "WEAK_PASSWORD", err.Error())
		return
	}
	if security.VerifyPassword(currentHash, input.NewPassword) {
		writeError(w, http.StatusBadRequest, "PASSWORD_UNCHANGED", "新密码不能与当前密码相同")
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "修改密码失败")
		return
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(r.Context(), "UPDATE mgr_user SET password_hash = ?, password_changed_at = NOW() WHERE id = ?", newHash, p.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "修改密码失败")
		return
	}
	currentToken := ""
	if cookie, err := r.Cookie(sessionCookie); err == nil {
		currentToken = security.HashToken(cookie.Value)
	}
	if _, err := tx.ExecContext(r.Context(), "DELETE FROM mgr_session WHERE user_id = ? AND token_hash <> ?", p.ID, currentToken); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "修改密码失败")
		return
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "修改密码失败")
		return
	}
	s.audit(r.Context(), &p, "auth.change_password", "mgr_user", numericID(p.ID),
		map[string]any{"passwordChanged": true}, nil, nil, 0, "密码修改成功", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"message": "密码修改成功，其他登录会话已退出"})
}

func (s *Server) setAuthCookies(w http.ResponseWriter, session, csrf string, expires time.Time) {
	base := http.Cookie{Path: "/", Secure: s.cfg.CookieSecure, SameSite: http.SameSiteStrictMode, Expires: expires, MaxAge: int(s.cfg.SessionTTL.Seconds())}
	base.Name, base.Value, base.HttpOnly = sessionCookie, session, true
	http.SetCookie(w, &base)
	base.Name, base.Value, base.HttpOnly = csrfCookie, csrf, false
	http.SetCookie(w, &base)
}

func (s *Server) clearAuthCookies(w http.ResponseWriter) {
	for _, name := range []string{sessionCookie, csrfCookie} {
		http.SetCookie(w, &http.Cookie{Name: name, Value: "", Path: "/", MaxAge: -1, Expires: time.Unix(0, 0), HttpOnly: name == sessionCookie, Secure: s.cfg.CookieSecure, SameSite: http.SameSiteStrictMode})
	}
}

func (s *Server) allowedNavigation(r *http.Request, p principal) ([]moduleItem, error) {
	rows, err := s.db.QueryContext(r.Context(), `SELECT id, parent_id, code, name, route, icon, sort_order, visible, status
FROM mgr_module WHERE visible = 1 AND status = 'enabled' ORDER BY sort_order, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var all []moduleItem
	for rows.Next() {
		var item moduleItem
		if err := rows.Scan(&item.ID, &item.ParentID, &item.Code, &item.Name, &item.Route, &item.Icon, &item.SortOrder, &item.Visible, &item.Status); err != nil {
			return nil, err
		}
		all = append(all, item)
	}
	if p.IsSuper {
		return all, rows.Err()
	}

	allowed := map[int64]bool{}
	permRows, err := s.db.QueryContext(r.Context(), `SELECT DISTINCT p.module_id
FROM mgr_role_permission rp JOIN mgr_permission p ON p.id = rp.permission_id
WHERE rp.role_id = ? AND p.status = 'enabled' AND p.action = 'view'`, p.RoleID)
	if err != nil {
		return nil, err
	}
	for permRows.Next() {
		var id int64
		if err := permRows.Scan(&id); err != nil {
			permRows.Close()
			return nil, err
		}
		allowed[id] = true
	}
	permRows.Close()
	for _, item := range all {
		if allowed[item.ID] && item.ParentID != nil {
			allowed[*item.ParentID] = true
		}
	}
	result := make([]moduleItem, 0, len(all))
	for _, item := range all {
		if isSuperOnlyModuleID(item.ID) {
			continue
		}
		if allowed[item.ID] {
			result = append(result, item)
		}
	}
	return result, nil
}

func truncate(value string, size int) string {
	if len(value) <= size {
		return value
	}
	return value[:size]
}

func numericID(id int64) string {
	return fmt.Sprintf("%d", id)
}
