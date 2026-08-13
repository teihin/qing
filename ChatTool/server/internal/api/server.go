package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"chattool/internal/config"
	"chattool/internal/security"
)

const (
	agentSessionCookie  = "chat_agent_session"
	agentCSRFCookie     = "chat_agent_csrf"
	playerSessionCookie = "chat_player_session"
	playerCSRFCookie    = "chat_player_csrf"
)

type contextKey string

const (
	agentPrincipalKey  contextKey = "chat-agent"
	playerPrincipalKey contextKey = "chat-player"
)

type agentPrincipal struct {
	ID          int64  `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Role        string `json:"role"`
	ChannelCode string `json:"channelCode"`
	ChannelName string `json:"channelName"`
	Presence    string `json:"presence"`
	CSRFHash    string `json:"-"`
}

func (p agentPrincipal) IsSupervisor() bool { return p.Role == "supervisor" }

type playerPrincipal struct {
	PlayerID       string `json:"playerId"`
	Nickname       string `json:"nickname"`
	ConversationID string `json:"conversationId"`
	SessionRef     string `json:"-"`
	TokenHash      string `json:"-"`
	HeaderAuth     bool   `json:"-"`
	CSRFHash       string `json:"-"`
}

type mediaAccessTicket struct {
	MediaID        string
	ConversationID string
	ExpiresAt      time.Time
}

type Server struct {
	db             *sql.DB
	cfg            config.Config
	mux            *http.ServeMux
	logger         *slog.Logger
	hub            *eventHub
	loginLimiter   *rateLimiter
	messageLimiter *rateLimiter
	mediaTicketMu  sync.Mutex
	mediaTickets   map[string]mediaAccessTicket
}

type handlerFunc func(http.ResponseWriter, *http.Request, agentPrincipal)
type playerHandlerFunc func(http.ResponseWriter, *http.Request, playerPrincipal)

func New(db *sql.DB, cfg config.Config, logger *slog.Logger) *Server {
	s := &Server{
		db:             db,
		cfg:            cfg,
		mux:            http.NewServeMux(),
		logger:         logger,
		hub:            newEventHub(),
		loginLimiter:   newRateLimiter(8, 10*time.Minute),
		messageLimiter: newRateLimiter(30, time.Minute),
		mediaTickets:   make(map[string]mediaAccessTicket),
	}
	s.routes()
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.recoverPanic(s.securityHeaders(s.mux)).ServeHTTP(w, r)
}

func (s *Server) StartMaintenance(ctx context.Context) {
	go s.runMaintenance(ctx)
}

func (s *Server) StopLiveEvents() {
	s.hub.stop()
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /api/health", s.handleHealth)
	s.mux.HandleFunc("POST /api/player/session", s.handleCreateDirectPlayerSession)
	s.mux.Handle("GET /api/player/me", s.playerAuthorized(false, s.handlePlayerMe))
	s.mux.Handle("GET /api/player/events", s.playerAuthorized(false, s.handlePlayerEvents))
	s.mux.Handle("GET /api/player/messages", s.playerAuthorized(false, s.handlePlayerMessages))
	s.mux.Handle("POST /api/player/messages", s.playerAuthorized(true, s.handlePlayerSendMessage))
	s.mux.Handle("POST /api/player/uploads", s.playerAuthorized(true, s.handlePlayerUpload))
	s.mux.Handle("GET /api/player/media/{id}/ticket", s.playerAuthorized(false, s.handlePlayerMediaTicket))
	s.mux.Handle("POST /api/player/typing", s.playerAuthorized(true, s.handlePlayerTyping))
	s.mux.Handle("POST /api/player/read", s.playerAuthorized(true, s.handlePlayerRead))
	s.mux.Handle("POST /api/player/end", s.playerAuthorized(true, s.handlePlayerEnd))
	s.mux.Handle("POST /api/player/satisfaction", s.playerAuthorized(true, s.handlePlayerSatisfaction))

	s.mux.HandleFunc("POST /api/agent/auth/login", s.handleAgentLogin)
	s.mux.Handle("GET /api/agent/auth/me", s.agentAuthorized(false, false, s.handleAgentMe))
	s.mux.Handle("POST /api/agent/auth/password", s.agentAuthorized(true, false, s.handleAgentChangePassword))
	s.mux.Handle("POST /api/agent/auth/logout", s.agentAuthorized(true, false, s.handleAgentLogout))
	s.mux.Handle("POST /api/agent/presence", s.agentAuthorized(true, false, s.handleAgentPresence))
	s.mux.Handle("POST /api/agent/heartbeat", s.agentAuthorized(true, false, s.handleAgentHeartbeat))
	s.mux.Handle("GET /api/agent/events", s.agentAuthorized(false, false, s.handleAgentEvents))
	s.mux.Handle("GET /api/agent/dashboard", s.agentAuthorized(false, false, s.handleAgentDashboard))
	s.mux.Handle("GET /api/agent/conversations", s.agentAuthorized(false, false, s.handleAgentConversations))
	s.mux.Handle("GET /api/agent/conversations/{id}", s.agentAuthorized(false, false, s.handleAgentConversation))
	s.mux.Handle("GET /api/agent/conversations/{id}/messages", s.agentAuthorized(false, false, s.handleAgentMessages))
	s.mux.Handle("POST /api/agent/conversations/{id}/messages", s.agentAuthorized(true, false, s.handleAgentSendMessage))
	s.mux.Handle("POST /api/agent/conversations/{id}/uploads", s.agentAuthorized(true, false, s.handleAgentUpload))
	s.mux.Handle("POST /api/agent/conversations/{id}/typing", s.agentAuthorized(true, false, s.handleAgentTyping))
	s.mux.Handle("POST /api/agent/conversations/{id}/read", s.agentAuthorized(true, false, s.handleAgentRead))
	s.mux.Handle("POST /api/agent/conversations/{id}/claim", s.agentAuthorized(true, false, s.handleAgentClaim))
	s.mux.Handle("POST /api/agent/conversations/{id}/transfer", s.agentAuthorized(true, false, s.handleAgentTransfer))
	s.mux.Handle("POST /api/agent/conversations/{id}/close", s.agentAuthorized(true, false, s.handleAgentClose))
	s.mux.Handle("DELETE /api/agent/conversations/{id}/messages", s.agentAuthorized(true, false, s.handleAgentClearConversation))
	s.mux.Handle("GET /api/agent/players/{playerId}/memos", s.agentAuthorized(false, false, s.handlePlayerMemos))
	s.mux.Handle("POST /api/agent/players/{playerId}/memos", s.agentAuthorized(true, false, s.handleCreatePlayerMemo))
	s.mux.Handle("DELETE /api/agent/players/{playerId}/memos/{memoId}", s.agentAuthorized(true, false, s.handleDeletePlayerMemo))
	s.mux.Handle("GET /api/agent/quick-replies", s.agentAuthorized(false, false, s.handleQuickReplies))
	s.mux.Handle("GET /api/agent/team/options", s.agentAuthorized(false, false, s.handleTeamOptions))
	s.mux.Handle("GET /api/agent/team", s.agentAuthorized(false, true, s.handleTeamList))
	s.mux.Handle("POST /api/agent/team", s.agentAuthorized(true, true, s.handleTeamCreate))
	s.mux.Handle("PUT /api/agent/team/{id}", s.agentAuthorized(true, true, s.handleTeamUpdate))

	s.mux.HandleFunc("GET /api/media/{id}", s.handleMedia)
	s.mux.HandleFunc("/", s.handleStatic)
}

func (s *Server) agentAuthorized(mutate, supervisor bool, next handlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p, err := s.authenticateAgent(r)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "登录已失效，请重新登录")
			return
		}
		if !agentIdentityMatchesRequest(r, p.ID) {
			writeError(w, http.StatusUnauthorized, "AGENT_ACCOUNT_SWITCHED", "当前浏览器已切换为其他客服账号；多客服请使用独立浏览器配置文件、不同浏览器或不同设备")
			return
		}
		if supervisor && !p.IsSupervisor() {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "只有客服主管可以执行此操作")
			return
		}
		if mutate && (!sameOrigin(r) || !security.EqualSecret(security.HashToken(r.Header.Get("X-CSRF-Token")), p.CSRFHash)) {
			writeError(w, http.StatusForbidden, "BAD_CSRF", "安全校验已失效，请刷新页面")
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), agentPrincipalKey, p)), p)
	})
}

func agentIdentityMatchesRequest(r *http.Request, agentID int64) bool {
	expected := strings.TrimSpace(r.Header.Get("X-Agent-Expected-ID"))
	if expected == "" {
		expected = strings.TrimSpace(r.URL.Query().Get("expectedAgentId"))
	}
	if expected == "" {
		// 兼容尚未刷新到新版静态资源的既有工作台，以及首次加载 /auth/me。
		return true
	}
	value, err := strconv.ParseInt(expected, 10, 64)
	return err == nil && value > 0 && value == agentID
}

func (s *Server) playerAuthorized(mutate bool, next playerHandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p, err := s.authenticatePlayer(r)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "PLAYER_SESSION_EXPIRED", "会话已失效，请返回游戏重新进入客服")
			return
		}
		if mutate && !playerMutationAllowed(r, p) {
			writeError(w, http.StatusForbidden, "BAD_CSRF", "安全校验已失效，请重新进入客服")
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), playerPrincipalKey, p)), p)
	})
}

func (s *Server) authenticateAgent(r *http.Request) (agentPrincipal, error) {
	cookie, err := r.Cookie(agentSessionCookie)
	if err != nil || len(cookie.Value) != 64 {
		return agentPrincipal{}, errors.New("missing session")
	}
	var p agentPrincipal
	err = s.db.QueryRowContext(r.Context(), `SELECT a.id, a.username, a.display_name, a.role, a.channel_code, channel.display_name, a.presence, sess.csrf_hash
FROM chat_agent_session sess JOIN chat_agent a ON a.id = sess.agent_id
JOIN chat_channel channel ON channel.code=a.channel_code AND channel.enabled=1
WHERE sess.token_hash = ? AND sess.expires_at > NOW() AND a.enabled = 1`, security.HashToken(cookie.Value)).Scan(
		&p.ID, &p.Username, &p.DisplayName, &p.Role, &p.ChannelCode, &p.ChannelName, &p.Presence, &p.CSRFHash,
	)
	if err != nil {
		return agentPrincipal{}, err
	}
	_, _ = s.db.ExecContext(r.Context(), `UPDATE chat_agent_session SET last_seen_at = NOW() WHERE token_hash = ?`, security.HashToken(cookie.Value))
	return p, nil
}

func (s *Server) authenticatePlayer(r *http.Request) (playerPrincipal, error) {
	ref := playerSessionRefFromRequest(r)
	sessionToken := strings.TrimSpace(r.Header.Get("X-Player-Embedded-Token"))
	headerAuth := len(sessionToken) == 64
	if !headerAuth {
		cookie, err := r.Cookie(playerSessionCookieName(ref))
		if err != nil || len(cookie.Value) != 64 {
			return playerPrincipal{}, errors.New("missing player session")
		}
		sessionToken = cookie.Value
	}
	tokenHash := security.HashToken(sessionToken)
	var p playerPrincipal
	err := s.db.QueryRowContext(r.Context(), `SELECT ps.player_id, p.nickname, ps.conversation_id, ps.csrf_hash
FROM chat_player_session ps JOIN chat_player p ON p.player_id = ps.player_id
WHERE ps.token_hash = ? AND ps.expires_at > NOW()`, tokenHash).Scan(
		&p.PlayerID, &p.Nickname, &p.ConversationID, &p.CSRFHash,
	)
	if err != nil {
		return playerPrincipal{}, err
	}
	p.SessionRef = ref
	p.TokenHash = tokenHash
	p.HeaderAuth = headerAuth
	_, _ = s.db.ExecContext(r.Context(), `UPDATE chat_player_session SET last_seen_at = NOW() WHERE token_hash = ?`, tokenHash)
	return p, nil
}

func playerMutationAllowed(r *http.Request, p playerPrincipal) bool {
	if p.HeaderAuth {
		// 内嵌令牌通过自定义请求头显式发送，不会像Cookie一样被浏览器自动
		// 附带到跨站请求，因此本身不受CSRF攻击；认证成功后无需依赖可能被
		// WebView的SameSite策略拦截的CSRF Cookie。
		return true
	}
	return sameOrigin(r) && security.EqualSecret(
		security.HashToken(r.Header.Get("X-CSRF-Token")),
		p.CSRFHash,
	)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := s.db.PingContext(ctx); err != nil {
		writeError(w, http.StatusServiceUnavailable, "DB_UNAVAILABLE", "客服数据库暂不可用")
		return
	}
	writeData(w, http.StatusOK, map[string]any{"status": "ok", "service": "ChatTool"})
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
	if clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) || filepath.IsAbs(clean) {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "页面不存在")
		return
	}
	path := filepath.Join(s.cfg.StaticDir, clean)
	if info, err := os.Stat(path); err == nil && !info.IsDir() {
		if contentType := mime.TypeByExtension(filepath.Ext(path)); contentType != "" {
			w.Header().Set("Content-Type", contentType)
		}
		if strings.Contains(filepath.Base(path), ".") && filepath.Ext(path) != ".html" {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		http.ServeFile(w, r, path)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	http.ServeFile(w, r, filepath.Join(s.cfg.StaticDir, "index.html"))
}

func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		contentSecurityPolicy := "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
		if r.Method == http.MethodGet && (r.URL.Path == "/player" || r.URL.Path == "/player/") {
			// 游戏 Web/PWA 端通过 Cocos WebView 的 iframe 打开玩家聊天页。
			// 只允许玩家入口被嵌入；客服后台与全部 API 仍禁止装入第三方页面。
			contentSecurityPolicy = "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors *; base-uri 'self'; form-action 'self'"
		} else {
			w.Header().Set("X-Frame-Options", "DENY")
		}
		w.Header().Set("Content-Security-Policy", contentSecurityPolicy)
		next.ServeHTTP(w, r)
	})
}

func (s *Server) recoverPanic(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				s.logger.Error("request panic", "error", recovered, "path", r.URL.Path)
				writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "服务暂时不可用，请稍后再试")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any, maxBytes int64) bool {
	if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
		writeError(w, http.StatusUnsupportedMediaType, "JSON_REQUIRED", "请求必须使用 JSON 格式")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
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

func writeData(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "data": data})
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": map[string]string{"code": code, "message": message}})
}

func sameOrigin(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	return origin == "http://"+r.Host || origin == "https://"+r.Host
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if net.ParseIP(host).IsLoopback() {
		if forwarded := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-For"), ",")[0]); net.ParseIP(forwarded) != nil {
			return forwarded
		}
	}
	return host
}

func parseInt64Path(w http.ResponseWriter, value string) (int64, bool) {
	id, err := strconv.ParseInt(value, 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "编号格式不正确")
		return 0, false
	}
	return id, true
}

type rateLimiter struct {
	mu     sync.Mutex
	limit  int
	window time.Duration
	items  map[string][]time.Time
}

func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	return &rateLimiter{limit: limit, window: window, items: map[string][]time.Time{}}
}

func (l *rateLimiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	cutoff := now.Add(-l.window)
	list := l.items[key][:0]
	for _, value := range l.items[key] {
		if value.After(cutoff) {
			list = append(list, value)
		}
	}
	if len(list) >= l.limit {
		l.items[key] = list
		return false
	}
	l.items[key] = append(list, now)
	return true
}

func (s *Server) audit(ctx context.Context, actorType, actorID, action, targetType, targetID string, detail any, ip string) {
	body, _ := json.Marshal(detail)
	_, err := s.db.ExecContext(ctx, `INSERT INTO chat_audit_log
(actor_type, actor_id, action, target_type, target_id, detail_json, ip_address, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`, actorType, actorID, action, targetType, targetID, string(body), ip)
	if err != nil {
		s.logger.Warn("write audit failed", "error", err, "action", action)
	}
}

func (s *Server) cleanupExpired(ctx context.Context) {
	result, _ := s.db.ExecContext(ctx, `DELETE FROM chat_agent_session WHERE expires_at <= NOW()`)
	if deleted, _ := result.RowsAffected(); deleted > 0 {
		s.hub.publish("team", liveEvent{Type: "team.changed"})
	}
	_, _ = s.db.ExecContext(ctx, `DELETE FROM chat_player_session WHERE expires_at <= NOW()`)
}

func sqlBool(value bool) int {
	if value {
		return 1
	}
	return 0
}

func requireText(value string, max int) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || len([]rune(value)) > max {
		return "", fmt.Errorf("内容不能为空且不能超过 %d 个字符", max)
	}
	return value, nil
}
