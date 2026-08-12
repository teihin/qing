package api

import (
	"database/sql"
	"net/http"
	"strconv"
	"strings"
	"time"

	"chattool/internal/security"
)

type agentLoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (s *Server) handleAgentLogin(w http.ResponseWriter, r *http.Request) {
	var req agentLoginRequest
	if !decodeJSON(w, r, &req, 16<<10) {
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	key := clientIP(r) + ":" + strings.ToLower(req.Username)
	if !s.loginLimiter.Allow(key) {
		writeError(w, http.StatusTooManyRequests, "LOGIN_RATE_LIMITED", "登录尝试过于频繁，请稍后再试")
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
	var p agentPrincipal
	var passwordHash string
	var enabled bool
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "登录暂时不可用")
		return
	}
	defer tx.Rollback()
	// 锁定客服账号行，使同一账号的并发登录串行执行。最后完成的登录会删除
	// 前一个会话，因此不会出现两个设备同时保持有效登录的竞态。
	err = tx.QueryRowContext(r.Context(), `SELECT id,username,password_hash,display_name,role,channel_code,enabled,presence
FROM chat_agent WHERE username=? FOR UPDATE`, req.Username).Scan(
		&p.ID, &p.Username, &passwordHash, &p.DisplayName, &p.Role, &p.ChannelCode, &enabled, &p.Presence,
	)
	if err != nil || !enabled || !security.CheckPassword(passwordHash, req.Password) {
		_ = tx.Rollback()
		s.audit(r.Context(), "agent", req.Username, "agent.login_failed", "agent", req.Username, map[string]any{"reason": "invalid_credentials"}, clientIP(r))
		writeError(w, http.StatusUnauthorized, "INVALID_CREDENTIALS", "账号或密码不正确")
		return
	}
	if err = tx.QueryRowContext(r.Context(), `SELECT display_name FROM chat_channel WHERE code=? AND enabled=1`, p.ChannelCode).Scan(&p.ChannelName); err != nil {
		_ = tx.Rollback()
		s.audit(r.Context(), "agent", req.Username, "agent.login_failed", "agent", req.Username, map[string]any{"reason": "channel_unavailable"}, clientIP(r))
		writeError(w, http.StatusUnauthorized, "INVALID_CREDENTIALS", "账号或密码不正确")
		return
	}
	deleteResult, err := tx.ExecContext(r.Context(), `DELETE FROM chat_agent_session WHERE agent_id=?`, p.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "登录暂时不可用")
		return
	}
	replacedSessions, _ := deleteResult.RowsAffected()
	if _, err = tx.ExecContext(r.Context(), `INSERT INTO chat_agent_session
(token_hash, agent_id, csrf_hash, expires_at, last_seen_at, created_at)
VALUES (?, ?, ?, ?, NOW(), NOW())`, security.HashToken(sessionToken), p.ID, security.HashToken(csrfToken), time.Now().Add(s.cfg.SessionTTL)); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "登录暂时不可用")
		return
	}
	if _, err = tx.ExecContext(r.Context(), `UPDATE chat_agent SET presence = 'online', last_seen_at = NOW() WHERE id = ?`, p.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "登录暂时不可用")
		return
	}
	if err = tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "登录暂时不可用")
		return
	}
	p.Presence = "online"
	setCookie(w, agentSessionCookie, sessionToken, s.cfg.CookiePath, true, s.cfg.CookieSecure, s.cfg.SessionTTL)
	setCookie(w, agentCSRFCookie, csrfToken, s.cfg.CookiePath, false, s.cfg.CookieSecure, s.cfg.SessionTTL)
	s.audit(r.Context(), "agent", strconv.FormatInt(p.ID, 10), "agent.login", "agent", strconv.FormatInt(p.ID, 10), map[string]any{"replacedSessionCount": replacedSessions}, clientIP(r))
	if replacedSessions > 0 {
		s.hub.publish("agent:"+strconv.FormatInt(p.ID, 10), liveEvent{
			Type:    "session.replaced",
			Payload: map[string]any{"message": "该账号已在其他设备登录，当前登录已退出"},
		})
	}
	s.hub.publish("team", liveEvent{Type: "team.changed"})
	s.tryAssignQueued(r.Context(), "agent_login")
	writeData(w, http.StatusOK, map[string]any{"agent": p, "csrfToken": csrfToken})
}

func (s *Server) handleAgentMe(w http.ResponseWriter, r *http.Request, p agentPrincipal) {
	csrf := ""
	if cookie, err := r.Cookie(agentCSRFCookie); err == nil {
		csrf = cookie.Value
	}
	writeData(w, http.StatusOK, map[string]any{"agent": p, "csrfToken": csrf})
}

type changeAgentPasswordRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

func (s *Server) handleAgentChangePassword(w http.ResponseWriter, r *http.Request, p agentPrincipal) {
	var req changeAgentPasswordRequest
	if !decodeJSON(w, r, &req, 16<<10) {
		return
	}
	var currentHash string
	if err := s.db.QueryRowContext(r.Context(), `SELECT password_hash FROM chat_agent WHERE id=? AND enabled=1`, p.ID).Scan(&currentHash); err != nil {
		writeError(w, http.StatusUnauthorized, "AGENT_NOT_FOUND", "客服账号不存在或已停用")
		return
	}
	if !security.CheckPassword(currentHash, req.CurrentPassword) {
		writeError(w, http.StatusBadRequest, "CURRENT_PASSWORD_INVALID", "当前密码不正确")
		return
	}
	if security.CheckPassword(currentHash, req.NewPassword) {
		writeError(w, http.StatusBadRequest, "PASSWORD_UNCHANGED", "新密码不能与当前密码相同")
		return
	}
	newHash, err := security.HashPassword(req.NewPassword)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PASSWORD", err.Error())
		return
	}
	cookie, err := r.Cookie(agentSessionCookie)
	if err != nil || cookie.Value == "" {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "登录已失效，请重新登录")
		return
	}
	currentTokenHash := security.HashToken(cookie.Value)
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "密码修改失败")
		return
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(r.Context(), `UPDATE chat_agent SET password_hash=?,updated_at=NOW() WHERE id=? AND enabled=1`, newHash, p.ID); err == nil {
		_, err = tx.ExecContext(r.Context(), `DELETE FROM chat_agent_session WHERE agent_id=? AND token_hash<>?`, p.ID, currentTokenHash)
	}
	if err != nil || tx.Commit() != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "密码修改失败")
		return
	}
	s.audit(r.Context(), "agent", strconv.FormatInt(p.ID, 10), "agent.password_change", "agent", strconv.FormatInt(p.ID, 10), map[string]any{"otherSessionsRevoked": true}, clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"changed": true, "otherSessionsRevoked": true})
}

func (s *Server) handleAgentLogout(w http.ResponseWriter, r *http.Request, p agentPrincipal) {
	if cookie, err := r.Cookie(agentSessionCookie); err == nil {
		_, _ = s.db.ExecContext(r.Context(), `DELETE FROM chat_agent_session WHERE token_hash = ?`, security.HashToken(cookie.Value))
	}
	_, _ = s.db.ExecContext(r.Context(), `UPDATE chat_agent SET presence = 'offline', last_seen_at = NOW() WHERE id = ?`, p.ID)
	_ = s.requeueAgentConversations(r.Context(), p.ID, "客服主动离线")
	setCookie(w, agentSessionCookie, "", s.cfg.CookiePath, true, s.cfg.CookieSecure, -time.Hour)
	setCookie(w, agentCSRFCookie, "", s.cfg.CookiePath, false, s.cfg.CookieSecure, -time.Hour)
	s.audit(r.Context(), "agent", strconv.FormatInt(p.ID, 10), "agent.logout", "agent", strconv.FormatInt(p.ID, 10), map[string]any{}, clientIP(r))
	s.hub.publish("team", liveEvent{Type: "team.changed"})
	w.WriteHeader(http.StatusNoContent)
}

type presenceRequest struct {
	Presence string `json:"presence"`
}

func (s *Server) handleAgentPresence(w http.ResponseWriter, r *http.Request, p agentPrincipal) {
	var req presenceRequest
	if !decodeJSON(w, r, &req, 8<<10) {
		return
	}
	if req.Presence != "online" && req.Presence != "away" && req.Presence != "offline" {
		writeError(w, http.StatusBadRequest, "INVALID_PRESENCE", "在线状态不正确")
		return
	}
	if _, err := s.db.ExecContext(r.Context(), `UPDATE chat_agent SET presence = ?, last_seen_at = NOW() WHERE id = ?`, req.Presence, p.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "无法更新在线状态")
		return
	}
	if req.Presence == "offline" {
		_ = s.requeueAgentConversations(r.Context(), p.ID, "客服切换为离线")
	} else if req.Presence == "online" {
		s.tryAssignQueued(r.Context(), "agent_presence_online")
	}
	s.hub.publish("team", liveEvent{Type: "team.changed"})
	writeData(w, http.StatusOK, map[string]any{"presence": req.Presence})
}

func (s *Server) handleAgentHeartbeat(w http.ResponseWriter, r *http.Request, p agentPrincipal) {
	_, err := s.db.ExecContext(r.Context(), `UPDATE chat_agent SET last_seen_at = NOW() WHERE id = ? AND presence <> 'offline'`, p.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "心跳更新失败")
		return
	}
	if p.Presence == "online" {
		s.tryAssignQueued(r.Context(), "agent_heartbeat")
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleAgentEvents(w http.ResponseWriter, r *http.Request, p agentPrincipal) {
	personal, cancelPersonal := s.hub.subscribe("agent:" + strconv.FormatInt(p.ID, 10))
	defer cancelPersonal()
	channel, cancelChannel := s.hub.subscribe("channel:" + p.ChannelCode)
	defer cancelChannel()
	team, cancelTeam := s.hub.subscribe("team")
	defer cancelTeam()
	merged := make(chan liveEvent, 32)
	go func() {
		for {
			select {
			case event := <-personal:
				select {
				case merged <- event:
				case <-r.Context().Done():
					return
				}
			case event := <-channel:
				select {
				case merged <- event:
				case <-r.Context().Done():
					return
				}
			case event := <-team:
				select {
				case merged <- event:
				case <-r.Context().Done():
					return
				}
			case <-r.Context().Done():
				return
			}
		}
	}()
	streamEvents(w, r, merged, s.hub.done)
}

func setCookie(w http.ResponseWriter, name, value, path string, httpOnly, secure bool, ttl time.Duration) {
	maxAge := int(ttl.Seconds())
	if ttl < 0 {
		maxAge = -1
	}
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     path,
		HttpOnly: httpOnly,
		Secure:   secure,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   maxAge,
		Expires:  time.Now().Add(ttl),
	})
}

func (s *Server) ensureAgentCanAccess(r *http.Request, p agentPrincipal, conversationID string) error {
	if p.IsSupervisor() {
		var exists int
		if err := s.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM chat_conversation WHERE id=? AND channel_code=?`, conversationID, p.ChannelCode).Scan(&exists); err != nil {
			return err
		}
		if exists == 0 {
			return sql.ErrNoRows
		}
		return nil
	}
	var assigned sql.NullInt64
	var status, channelCode string
	if err := s.db.QueryRowContext(r.Context(), `SELECT assigned_agent_id,status,channel_code FROM chat_conversation WHERE id=?`, conversationID).Scan(&assigned, &status, &channelCode); err != nil {
		return err
	}
	if channelCode != p.ChannelCode || status == "queued" || !assigned.Valid || assigned.Int64 != p.ID {
		return sql.ErrNoRows
	}
	return nil
}
