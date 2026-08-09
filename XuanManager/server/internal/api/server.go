package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"xuanmanager/internal/config"
	"xuanmanager/internal/security"
)

const (
	sessionCookie = "xuan_session"
	csrfCookie    = "xuan_csrf"
)

type contextKey string

const principalKey contextKey = "xuan-principal"

type Server struct {
	db                  *sql.DB
	cfg                 config.Config
	mux                 *http.ServeMux
	logger              *slog.Logger
	registrationLimiter *registrationRateLimiter
	gameHTTPClient      httpDoer
}

type handlerFunc func(http.ResponseWriter, *http.Request, principal)

func New(db *sql.DB, cfg config.Config, logger *slog.Logger) http.Handler {
	s := &Server{
		db:                  db,
		cfg:                 cfg,
		mux:                 http.NewServeMux(),
		logger:              logger,
		registrationLimiter: newRegistrationRateLimiter(10, 10*time.Minute),
		gameHTTPClient:      &http.Client{Timeout: 6 * time.Second},
	}
	s.routes()
	return s.securityHeaders(s.mux)
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /api/health", s.handleHealth)
	s.mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	s.mux.HandleFunc("OPTIONS /api/game/registrations", s.handleRegistrationOptions)
	s.mux.HandleFunc("POST /api/game/registrations", s.handleCreateGameRegistration)
	s.mux.Handle("GET /api/auth/me", s.authorized("", false, s.handleMe))
	s.mux.Handle("POST /api/auth/logout", s.authorized("", true, s.handleLogout))
	s.mux.Handle("PUT /api/auth/password", s.authorized("", true, s.handleChangePassword))

	s.mux.Handle("GET /api/dashboard/summary", s.authorized("dashboard.view", false, s.handleDashboard))
	s.mux.Handle("GET /api/game/players", s.authorized("game.player.view", false, s.handleListPlayers))
	s.mux.Handle("GET /api/game/players/{playerId}/rooms", s.authorized("game.room_record.view", false, s.handlePlayerRoomHistory))
	s.mux.Handle("GET /api/game/agents", s.authorized("game.agent.view", false, s.handleListAgents))
	s.mux.Handle("GET /api/game/agents/{agentId}/relationship", s.authorized("game.agent.view", false, s.handleAgentRelationship))
	s.mux.Handle("GET /api/game/agents/{agentId}/children", s.authorized("game.agent.view", false, s.handleAgentChildren))
	s.mux.Handle("GET /api/game/agents/{agentId}/bonuses", s.authorized("game.agent.view", false, s.handleAgentBonuses))
	s.mux.Handle("GET /api/game/transactions", s.authorized("game.transaction.view", false, s.handleListTransactions))
	s.mux.Handle("GET /api/game/room-records", s.authorized("game.room_record.view", false, s.handleRoomRecord))
	s.mux.Handle("GET /api/game/room-records/{roomId}/rounds/{round}", s.authorized("game.room_record.view", false, s.handleRoomRecordRound))
	s.mux.Handle("GET /api/game/bans", s.authorized("game.ban.view", false, s.handleListBannedPlayers))
	s.mux.Handle("POST /api/game/bans", s.authorized("game.ban.create", true, s.handleCreatePlayerBan))
	s.mux.Handle("POST /api/game/bans/{playerId}/unban", s.authorized("game.ban.remove", true, s.handleRemovePlayerBan))
	s.mux.Handle("GET /api/configuration/announcement", s.authorized("configuration.announcement.view", false, s.handleGetGameAnnouncement))
	s.mux.Handle("PUT /api/configuration/announcement", s.authorized("configuration.announcement.update", true, s.handleUpdateGameAnnouncement))
	s.mux.Handle("GET /api/configuration/notifications", s.authorized("configuration.notification.view", false, s.handleListGameNotifications))
	s.mux.Handle("POST /api/configuration/notifications", s.authorized("configuration.notification.send", true, s.handleSendGameNotification))
	s.mux.Handle("GET /api/configuration/reward-pools", s.authorized("configuration.reward_pool.view", false, s.handleGetRewardPools))
	s.mux.Handle("PUT /api/configuration/reward-pools", s.authorized("configuration.reward_pool.update", true, s.handleUpdateRewardPools))
	s.mux.Handle("GET /api/users", s.authorized("user.view", false, s.handleListUsers))
	s.mux.Handle("GET /api/users/role-options", s.authorized("user.view", false, s.handleRoleOptions))
	s.mux.Handle("POST /api/users", s.authorized("user.create", true, s.handleCreateUser))
	s.mux.Handle("PUT /api/users/{id}", s.authorized("user.update", true, s.handleUpdateUser))
	s.mux.Handle("PUT /api/users/{id}/status", s.authorized("user.status", true, s.handleUserStatus))
	s.mux.Handle("PUT /api/users/{id}/password", s.authorized("user.reset_password", true, s.handleResetPassword))

	s.mux.Handle("GET /api/roles", s.authorized("role.view", false, s.handleListRoles))
	s.mux.Handle("POST /api/roles", s.authorized("role.create", true, s.handleCreateRole))
	s.mux.Handle("PUT /api/roles/{id}", s.authorized("role.update", true, s.handleUpdateRole))
	s.mux.Handle("PUT /api/roles/{id}/permissions", s.authorized("role.assign_permissions", true, s.handleRolePermissions))

	s.mux.Handle("GET /api/modules", s.authorized("module.view", false, s.handleListModules))
	s.mux.Handle("POST /api/modules", s.authorized("module.create", true, s.handleCreateModule))
	s.mux.Handle("PUT /api/modules/{id}", s.authorized("module.update", true, s.handleUpdateModule))
	s.mux.Handle("GET /api/permissions", s.authorized("module.view", false, s.handleListPermissions))
	s.mux.Handle("GET /api/role-permissions", s.authorized("role.view", false, s.handleListPermissions))
	s.mux.Handle("POST /api/permissions", s.authorized("permission.create", true, s.handleCreatePermission))
	s.mux.Handle("PUT /api/permissions/{id}", s.authorized("permission.update", true, s.handleUpdatePermission))

	s.mux.Handle("GET /api/audit", s.authorized("audit.view", false, s.handleAuditList))
	s.mux.HandleFunc("/", s.handleStatic)
}

func (s *Server) authorized(permission string, mutate bool, next handlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p, err := s.authenticate(r)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "登录已失效，请重新登录")
			return
		}
		if permission != "" && !p.Can(permission) {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "当前角色没有此操作权限")
			return
		}
		if mutate {
			if !sameOrigin(r) {
				writeError(w, http.StatusForbidden, "BAD_ORIGIN", "请求来源校验失败")
				return
			}
			if !security.EqualTokenHash(r.Header.Get("X-CSRF-Token"), p.CSRFHash) {
				writeError(w, http.StatusForbidden, "BAD_CSRF", "安全校验已失效，请刷新页面")
				return
			}
		}
		next(w, r.WithContext(context.WithValue(r.Context(), principalKey, p)), p)
	})
}

func (s *Server) authenticate(r *http.Request) (principal, error) {
	cookie, err := r.Cookie(sessionCookie)
	if err != nil || len(cookie.Value) != 64 {
		return principal{}, errors.New("missing session")
	}
	tokenHash := security.HashToken(cookie.Value)
	var p principal
	var isSuper bool
	err = s.db.QueryRowContext(r.Context(), `SELECT
u.id, u.username, u.display_name, u.role_id, r.code, r.name, u.is_super, sess.csrf_hash
FROM mgr_session sess
JOIN mgr_user u ON u.id = sess.user_id
JOIN mgr_role r ON r.id = u.role_id
WHERE sess.token_hash = ? AND sess.expires_at > NOW()
  AND u.status = 'enabled' AND r.status = 'enabled'`, tokenHash).Scan(
		&p.ID, &p.Username, &p.DisplayName, &p.RoleID, &p.RoleCode, &p.RoleName, &isSuper, &p.CSRFHash,
	)
	if err != nil {
		return principal{}, err
	}
	p.IsSuper = isSuper
	p.Permissions = map[string]bool{}
	query := `SELECT p.code FROM mgr_permission p WHERE p.status = 'enabled'`
	args := []any{}
	if !p.IsSuper {
		query = `SELECT p.code FROM mgr_role_permission rp
JOIN mgr_permission p ON p.id = rp.permission_id
WHERE rp.role_id = ? AND p.status = 'enabled'`
		args = append(args, p.RoleID)
	}
	rows, err := s.db.QueryContext(r.Context(), query, args...)
	if err != nil {
		return principal{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var code string
		if err := rows.Scan(&code); err != nil {
			return principal{}, err
		}
		p.Permissions[code] = true
	}
	_, _ = s.db.ExecContext(r.Context(), "UPDATE mgr_session SET last_seen_at = NOW() WHERE token_hash = ?", tokenHash)
	return p, rows.Err()
}

func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'")
		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := s.db.PingContext(ctx); err != nil {
		writeError(w, http.StatusServiceUnavailable, "DB_UNAVAILABLE", "数据库暂不可用")
		return
	}
	writeData(w, http.StatusOK, map[string]any{"status": "ok", "service": "XuanManager"})
}

func (s *Server) handleStatic(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "接口不存在")
		return
	}
	clean := filepath.Clean(strings.TrimPrefix(r.URL.Path, "/"))
	if clean == "." {
		clean = "index.html"
	}
	path := filepath.Join(s.cfg.StaticDir, clean)
	if info, err := os.Stat(path); err == nil && !info.IsDir() {
		http.ServeFile(w, r, path)
		return
	}
	http.ServeFile(w, r, filepath.Join(s.cfg.StaticDir, "index.html"))
}

func writeData(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "data": data})
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":    false,
		"error": map[string]string{"code": code, "message": message},
	})
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", "请求内容格式不正确")
		return false
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", "请求只能包含一个 JSON 对象")
		return false
	}
	return true
}

func parseID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "ID 不正确")
		return 0, false
	}
	return id, true
}

func pageParams(r *http.Request) (int, int) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	size, _ := strconv.Atoi(r.URL.Query().Get("pageSize"))
	if page < 1 {
		page = 1
	}
	if size < 1 {
		size = 20
	}
	if size > 100 {
		size = 100
	}
	return page, size
}

func validStatus(value string) bool {
	return value == "enabled" || value == "disabled"
}

func sameOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	return err == nil && strings.EqualFold(u.Host, r.Host)
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	remoteIP := net.ParseIP(strings.TrimSpace(host))
	if remoteIP != nil && remoteIP.IsLoopback() {
		forwarded := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
		for i := len(forwarded) - 1; i >= 0; i-- {
			candidate := strings.TrimSpace(forwarded[i])
			if net.ParseIP(candidate) != nil {
				return candidate
			}
		}
	}
	return host
}

func (s *Server) audit(ctx context.Context, p *principal, action, targetType, targetID string, request, before, after any, resultCode int, resultMessage, ip string) {
	var operatorID any
	operatorName := ""
	if p != nil {
		operatorID = p.ID
		operatorName = p.Username
	}
	marshal := func(value any) any {
		if value == nil {
			return nil
		}
		body, err := json.Marshal(value)
		if err != nil {
			return fmt.Sprintf(`{"marshalError":%q}`, err.Error())
		}
		return string(body)
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO mgr_audit_log
(operator_id, operator_name, action, target_type, target_id, request_json, before_json, after_json, result_code, result_message, ip)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, operatorID, operatorName, action, targetType, targetID,
		marshal(request), marshal(before), marshal(after), resultCode, resultMessage, ip)
	if err != nil {
		s.logger.Error("write audit log", "error", err, "action", action)
	}
}
