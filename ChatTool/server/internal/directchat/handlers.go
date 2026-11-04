package directchat

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Handler 暴露 /api/direct/* 接口。
//
// 与客服接口的关系：共用一个 Go 进程和同一份配置，但使用独立路由前缀、
// 独立令牌、独立数据表，互不影响。
type Handler struct {
	service        *Service
	logger         *slog.Logger
	loginLimiter   *ipLimiter
	uploadLimiter  *ipLimiter
	realtime       *realtimeHub
	allowedOrigins []string
	wsTicketMu     sync.Mutex
	wsTickets      map[string]wsTicket
}

type wsTicket struct {
	session   Session
	expiresAt time.Time
}

type sessionHandlerFunc func(http.ResponseWriter, *http.Request, Session)

// NewHandler 创建直聊 HTTP 处理器。俱乐部目录由 Service 从游戏库只读查询。
func NewHandler(service *Service, logger *slog.Logger, origins ...[]string) *Handler {
	allowedOrigins := []string(nil)
	if len(origins) > 0 {
		allowedOrigins = append([]string(nil), origins[0]...)
	}
	return &Handler{
		service:        service,
		logger:         logger,
		loginLimiter:   newIPLimiter(30, time.Minute),
		uploadLimiter:  newIPLimiter(60, time.Minute),
		realtime:       newRealtimeHub(),
		allowedOrigins: allowedOrigins,
		wsTickets:      make(map[string]wsTicket),
	}
}

// Register 把直聊路由挂到同一台 mux 上。
func (h *Handler) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/direct/ws", h.handleWebSocket)
	mux.HandleFunc("POST /api/direct/ws-ticket", h.authorized(h.handleWSTicket))
	mux.HandleFunc("POST /api/direct/session", h.handleCreateSession)
	mux.HandleFunc("POST /api/direct/session/dev", h.handleDevSession)
	mux.HandleFunc("DELETE /api/direct/session", h.authorized(h.handleDeleteSession))

	mux.HandleFunc("GET /api/direct/me", h.authorized(h.handleMe))
	mux.HandleFunc("GET /api/direct/clubs", h.authorized(h.handleClubs))
	mux.HandleFunc("GET /api/direct/unread", h.authorized(h.handleUnread))
	mux.HandleFunc("GET /api/direct/clubs/{clubId}/members", h.authorized(h.handleMembers))
	mux.HandleFunc("GET /api/direct/clubs/{clubId}/conversations", h.authorized(h.handleConversations))
	mux.HandleFunc("POST /api/direct/clubs/{clubId}/conversations", h.authorized(h.handleCreateConversation))
	mux.HandleFunc("GET /api/direct/conversations", h.authorized(h.handleAllConversations))
	mux.HandleFunc("GET /api/direct/conversations/{conversationId}/messages", h.authorized(h.handleMessages))
	mux.HandleFunc("POST /api/direct/conversations/{conversationId}/messages", h.authorized(h.handleSendMessage))
	mux.HandleFunc("POST /api/direct/conversations/{conversationId}/attachments", h.authorized(h.handleCreateAttachment))
	mux.HandleFunc("POST /api/direct/conversations/{conversationId}/attachments/{attachmentId}/upload", h.authorized(h.handleUploadAttachment))
	mux.HandleFunc("POST /api/direct/conversations/{conversationId}/attachments/{attachmentId}/complete", h.authorized(h.handleCompleteAttachment))
	mux.HandleFunc("POST /api/direct/conversations/{conversationId}/read", h.authorized(h.handleRead))
	mux.HandleFunc("DELETE /api/direct/conversations/{conversationId}", h.authorized(h.handleHide))
	mux.HandleFunc("GET /api/direct/media/{attachmentId}", h.handleMedia)
}

// authorized 校验令牌后把会话注入处理器；客户端无法通过请求体伪造 meGuuid。
func (h *Handler) authorized(next sessionHandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session, err := h.service.Authenticate(r.Context(), bearerToken(r))
		if err != nil {
			writeDirectError(w, err)
			return
		}
		// 单次请求内复用俱乐部/成员/联盟查询；会话列表逐条转换时不再重复读游戏库。
		next(w, r.WithContext(WithRequestCache(r.Context())), session)
	}
}

func bearerToken(r *http.Request) string {
	if value := strings.TrimSpace(r.Header.Get("X-Direct-Token")); value != "" {
		return value
	}
	auth := strings.TrimSpace(r.Header.Get("Authorization"))
	if len(auth) > 7 && strings.EqualFold(auth[:7], "bearer ") {
		return strings.TrimSpace(auth[7:])
	}
	return ""
}

// handleWSTicket 把长期聊天令牌换成一次性短票据，避免把长期令牌写进 WebSocket URL
// 和反向代理访问日志。票据只在本进程内保存 60 秒，连接升级成功后立即消费。
func (h *Handler) handleWSTicket(w http.ResponseWriter, r *http.Request, session Session) {
	raw := make([]byte, 24)
	if _, err := rand.Read(raw); err != nil {
		writeDirectError(w, err)
		return
	}
	ticket := base64.RawURLEncoding.EncodeToString(raw)
	expiresAt := time.Now().Add(time.Minute)
	h.wsTicketMu.Lock()
	now := time.Now()
	for key, item := range h.wsTickets {
		if !item.expiresAt.After(now) {
			delete(h.wsTickets, key)
		}
	}
	if len(h.wsTickets) >= 4096 {
		h.wsTicketMu.Unlock()
		writeDirectJSON(w, http.StatusTooManyRequests, nil, errRateLimited)
		return
	}
	h.wsTickets[ticket] = wsTicket{session: session, expiresAt: expiresAt}
	h.wsTicketMu.Unlock()
	writeDirectData(w, http.StatusOK, map[string]any{
		"ticket": ticket, "expiresAt": fmtTime(expiresAt),
	})
}

// ---------------- 会话 ----------------

func (h *Handler) handleCreateSession(w http.ResponseWriter, r *http.Request) {
	if !h.loginLimiter.Allow(clientIP(r)) {
		writeDirectJSON(w, http.StatusTooManyRequests, nil, errRateLimited)
		return
	}
	var body struct {
		Ticket string `json:"ticket"`
		// Payload 是与客服入口同格式的轻量加密资料（AES + ts）。
		// 一期游戏客户端没有正式票据时走这条路，服务端解密后才知道 guuid。
		Payload string `json:"payload"`
	}
	if !decodeDirectJSON(w, r, &body, 64<<10) {
		return
	}
	var token string
	var session Session
	var err error
	if strings.TrimSpace(body.Payload) != "" {
		token, session, err = h.service.CreateLinkSession(r.Context(), body.Payload)
	} else {
		token, session, err = h.service.CreateSession(r.Context(), body.Ticket)
	}
	if err != nil {
		writeDirectError(w, err)
		return
	}
	writeDirectData(w, http.StatusOK, map[string]any{
		"token":     token,
		"expiresAt": fmtTime(session.ExpiresAt),
		"me": map[string]string{
			"guuid": session.Guuid, "name": session.Name, "avatar": session.Avatar,
		},
	})
}

// handleDevSession 只在显式开启联调开关时可用，生产环境必须保持关闭。
func (h *Handler) handleDevSession(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Guuid string `json:"guuid"`
		Name  string `json:"name"`
	}
	if !decodeDirectJSON(w, r, &body, 4<<10) {
		return
	}
	token, session, err := h.service.CreateDevSession(r.Context(), body.Guuid, body.Name)
	if err != nil {
		writeDirectError(w, err)
		return
	}
	writeDirectData(w, http.StatusOK, map[string]any{
		"token":     token,
		"expiresAt": fmtTime(session.ExpiresAt),
		"me": map[string]string{
			"guuid": session.Guuid, "name": session.Name, "avatar": session.Avatar,
		},
	})
}

func (h *Handler) handleDeleteSession(w http.ResponseWriter, r *http.Request, session Session) {
	if err := h.service.Logout(r.Context(), session); err != nil {
		writeDirectError(w, err)
		return
	}
	writeDirectData(w, http.StatusOK, map[string]bool{"ok": true})
}

// ---------------- 当前用户与俱乐部 ----------------

func (h *Handler) handleMe(w http.ResponseWriter, r *http.Request, session Session) {
	view, err := h.service.Me(r.Context(), session)
	if err != nil {
		writeDirectError(w, err)
		return
	}
	writeDirectData(w, http.StatusOK, view)
}

func (h *Handler) handleClubs(w http.ResponseWriter, r *http.Request, session Session) {
	clubs, err := h.service.Clubs(r.Context(), session)
	if err != nil {
		writeDirectError(w, err)
		return
	}
	writeDirectData(w, http.StatusOK, map[string]any{"items": clubs})
}

func (h *Handler) handleUnread(w http.ResponseWriter, r *http.Request, session Session) {
	view, err := h.service.Unread(r.Context(), session)
	if err != nil {
		writeDirectError(w, err)
		return
	}
	writeDirectData(w, http.StatusOK, view)
}

func (h *Handler) handleMembers(w http.ResponseWriter, r *http.Request, session Session) {
	query := r.URL.Query()
	page, _ := strconv.Atoi(query.Get("page"))
	pageSize, _ := strconv.Atoi(query.Get("pageSize"))
	view, err := h.service.Members(r.Context(), session, r.PathValue("clubId"), query.Get("keyword"), page, pageSize)
	if err != nil {
		writeDirectError(w, err)
		return
	}
	writeDirectData(w, http.StatusOK, view)
}

// ---------------- 会话列表与创建 ----------------

func (h *Handler) handleConversations(w http.ResponseWriter, r *http.Request, session Session) {
	query := r.URL.Query()
	page, _ := strconv.Atoi(query.Get("page"))
	pageSize, _ := strconv.Atoi(query.Get("pageSize"))
	view, err := h.service.Conversations(r.Context(), session, r.PathValue("clubId"), page, pageSize)
	if err != nil {
		writeDirectError(w, err)
		return
	}
	writeDirectData(w, http.StatusOK, view)
}

func (h *Handler) handleAllConversations(w http.ResponseWriter, r *http.Request, session Session) {
	query := r.URL.Query()
	page, _ := strconv.Atoi(query.Get("page"))
	pageSize, _ := strconv.Atoi(query.Get("pageSize"))
	view, err := h.service.AllConversations(r.Context(), session, page, pageSize)
	if err != nil {
		writeDirectError(w, err)
		return
	}
	writeDirectData(w, http.StatusOK, view)
}

func (h *Handler) handleCreateConversation(w http.ResponseWriter, r *http.Request, session Session) {
	var body struct {
		PeerGuuid string `json:"peerGuuid"`
	}
	if !decodeDirectJSON(w, r, &body, 4<<10) {
		return
	}
	view, err := h.service.CreateConversation(r.Context(), session, r.PathValue("clubId"), body.PeerGuuid)
	if err != nil {
		writeDirectError(w, err)
		return
	}
	writeDirectData(w, http.StatusOK, view)
}

// ---------------- 消息 ----------------

func (h *Handler) handleMessages(w http.ResponseWriter, r *http.Request, session Session) {
	query := r.URL.Query()
	limit, _ := strconv.Atoi(query.Get("limit"))
	view, err := h.service.Messages(r.Context(), session, r.PathValue("conversationId"),
		query.Get("before"), query.Get("after"), limit)
	if err != nil {
		writeDirectError(w, err)
		return
	}
	writeDirectData(w, http.StatusOK, view)
}

func (h *Handler) handleSendMessage(w http.ResponseWriter, r *http.Request, session Session) {
	var body SendRequest
	if !decodeDirectJSON(w, r, &body, 16<<10) {
		return
	}
	view, duplicate, err := h.sendMessageAndPublish(r.Context(), session, r.PathValue("conversationId"), body)
	if err != nil {
		writeDirectError(w, err)
		return
	}
	status := http.StatusOK
	if duplicate {
		// 重试命中同一条消息：返回原消息，同时用 200 与 duplicate 标记表达。
		w.Header().Set("X-Direct-Duplicate", "1")
	}
	writeDirectData(w, status, map[string]any{"message": view, "duplicate": duplicate, "code": ternary(duplicate, CodeMessageDuplicate, "")})
}

// sendMessageAndPublish 先完成服务端校验和落库，再通知对方在线连接。
// 广播失败不影响已落库消息；对方重连后会用 after 游标补偿，避免把实时通道当作唯一消息来源。
func (h *Handler) sendMessageAndPublish(ctx context.Context, session Session, conversationID string, request SendRequest) (MessageView, bool, error) {
	recipient, clubID, err := h.service.RealtimeTarget(ctx, session, conversationID)
	if err != nil {
		return MessageView{}, false, err
	}
	view, duplicate, err := h.service.SendMessage(ctx, session, conversationID, request)
	if err != nil {
		return MessageView{}, false, err
	}
	if !duplicate && recipient != "" && h.realtime != nil {
		h.realtime.publish(recipient, RealtimeEvent{
			Type: "message.new",
			Data: map[string]any{
				"conversationId": conversationID,
				"messageId":      view.ID,
				"clubId":         clubID,
			},
		})
	}
	return view, duplicate, nil
}

func (h *Handler) handleRead(w http.ResponseWriter, r *http.Request, session Session) {
	var body struct {
		LastReadMessageID string `json:"lastReadMessageId"`
	}
	if !decodeDirectJSON(w, r, &body, 4<<10) {
		return
	}
	if err := h.service.MarkRead(r.Context(), session, r.PathValue("conversationId"), body.LastReadMessageID); err != nil {
		writeDirectError(w, err)
		return
	}
	writeDirectData(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Handler) handleHide(w http.ResponseWriter, r *http.Request, session Session) {
	if err := h.service.Hide(r.Context(), session, r.PathValue("conversationId")); err != nil {
		writeDirectError(w, err)
		return
	}
	writeDirectData(w, http.StatusOK, map[string]bool{"ok": true})
}

// ---------------- 附件 ----------------

func (h *Handler) handleCreateAttachment(w http.ResponseWriter, r *http.Request, session Session) {
	var body AttachmentRequest
	if !decodeDirectJSON(w, r, &body, 8<<10) {
		return
	}
	ticket, err := h.service.CreateAttachment(r.Context(), session, r.PathValue("conversationId"), body)
	if err != nil {
		// 业务错误会直接返回给客户端；未知错误保留服务端原始原因，便于定位
		// 数据库/运行目录问题，避免只看到笼统的 500。
		if h.logger != nil && AsError(err).Code == "INTERNAL_ERROR" {
			h.logger.Error("直聊图片附件创建失败", "conversation_id", r.PathValue("conversationId"),
				"guuid", session.Guuid, "error", err)
		}
		writeDirectError(w, err)
		return
	}
	writeDirectData(w, http.StatusOK, ticket)
}

func (h *Handler) handleUploadAttachment(w http.ResponseWriter, r *http.Request, session Session) {
	if !h.uploadLimiter.Allow(clientIP(r)) {
		writeDirectJSON(w, http.StatusTooManyRequests, nil, errRateLimited)
		return
	}
	if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "image/") {
		writeDirectJSON(w, http.StatusUnsupportedMediaType, nil, invalidMedia("上传内容必须是图片"))
		return
	}
	body := http.MaxBytesReader(w, r.Body, MaxImageBytes+1024)
	data, err := io.ReadAll(body)
	if err != nil {
		writeDirectJSON(w, http.StatusRequestEntityTooLarge, nil, errMediaTooLarge)
		return
	}
	view, err := h.service.UploadImage(r.Context(), session, r.PathValue("conversationId"), r.PathValue("attachmentId"), data)
	if err != nil {
		writeDirectError(w, err)
		return
	}
	writeDirectData(w, http.StatusOK, view)
}

func (h *Handler) handleCompleteAttachment(w http.ResponseWriter, r *http.Request, session Session) {
	view, err := h.service.CompleteAttachment(r.Context(), session, r.PathValue("conversationId"), r.PathValue("attachmentId"))
	if err != nil {
		writeDirectError(w, err)
		return
	}
	writeDirectData(w, http.StatusOK, view)
}

// handleMedia 用签名票据下载图片；storage_key 永不返回给客户端。
func (h *Handler) handleMedia(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	file, contentType, err := h.service.OpenMedia(r.Context(), r.PathValue("attachmentId"),
		query.Get("ticket"), query.Get("variant"))
	if err != nil {
		writeDirectError(w, err)
		return
	}
	defer file.Close()
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, "", time.Time{}, file)
}

// ---------------- 通用小工具 ----------------

func writeDirectData(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "data": data})
}

func writeDirectJSON(w http.ResponseWriter, status int, data any, err error) {
	if err == nil {
		writeDirectData(w, status, data)
		return
	}
	biz := AsError(err)
	if biz.Status == 0 {
		biz.Status = status
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(biz.Status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":    false,
		"error": map[string]string{"code": biz.Code, "message": biz.Message},
	})
}

func writeDirectError(w http.ResponseWriter, err error) {
	writeDirectJSON(w, http.StatusInternalServerError, nil, err)
}

func decodeDirectJSON(w http.ResponseWriter, r *http.Request, dst any, maxBytes int64) bool {
	if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
		writeDirectJSON(w, http.StatusUnsupportedMediaType, nil,
			newError(http.StatusUnsupportedMediaType, "JSON_REQUIRED", "请求必须使用 JSON 格式"))
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		writeDirectJSON(w, http.StatusBadRequest, nil,
			newError(http.StatusBadRequest, "INVALID_JSON", "请求内容格式不正确"))
		return false
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		writeDirectJSON(w, http.StatusBadRequest, nil,
			newError(http.StatusBadRequest, "INVALID_JSON", "请求只能包含一个 JSON 对象"))
		return false
	}
	return true
}

func clientIP(r *http.Request) string {
	host := r.RemoteAddr
	if index := strings.LastIndex(host, ":"); index > 0 {
		host = host[:index]
	}
	if forwarded := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-For"), ",")[0]); forwarded != "" && host == "127.0.0.1" {
		return forwarded
	}
	return host
}

func ternary(condition bool, whenTrue, whenFalse string) string {
	if condition {
		return whenTrue
	}
	return whenFalse
}

// ipLimiter 是进程内的简单限流器（按来源 IP）。
type ipLimiter struct {
	mu     sync.Mutex
	limit  int
	window time.Duration
	items  map[string][]time.Time
}

func newIPLimiter(limit int, window time.Duration) *ipLimiter {
	return &ipLimiter{limit: limit, window: window, items: map[string][]time.Time{}}
}

func (l *ipLimiter) Allow(key string) bool {
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
