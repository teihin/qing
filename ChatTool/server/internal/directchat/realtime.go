package directchat

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	realtimeWriteWait = 10 * time.Second
	realtimePongWait  = 70 * time.Second
	realtimePingEvery = 25 * time.Second
	realtimeMaxFrame  = 64 << 10
)

// RealtimeEvent 是直聊长连接上的统一事件封装。
// message.new 只推送游标提示，不直接携带媒体 URL；客户端随后用自己的身份
// 通过 REST after 游标读取消息，保证图片签名不会绑定到发送方。
type RealtimeEvent struct {
	Type      string `json:"type"`
	RequestID string `json:"requestId,omitempty"`
	Data      any    `json:"data,omitempty"`
}

type realtimeCommand struct {
	Type           string      `json:"type"`
	RequestID      string      `json:"requestId"`
	ConversationID string      `json:"conversationId"`
	Message        SendRequest `json:"message"`
}

type realtimeHub struct {
	mu      sync.RWMutex
	clients map[string]map[*realtimeClient]struct{}
}

func newRealtimeHub() *realtimeHub {
	return &realtimeHub{clients: make(map[string]map[*realtimeClient]struct{})}
}

func (h *realtimeHub) register(client *realtimeClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	clients := h.clients[client.session.Guuid]
	if clients == nil {
		clients = make(map[*realtimeClient]struct{})
		h.clients[client.session.Guuid] = clients
	}
	clients[client] = struct{}{}
}

func (h *realtimeHub) unregister(client *realtimeClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	clients := h.clients[client.session.Guuid]
	if clients == nil {
		return
	}
	delete(clients, client)
	if len(clients) == 0 {
		delete(h.clients, client.session.Guuid)
	}
}

func (h *realtimeHub) publish(guuid string, event RealtimeEvent) {
	if h == nil || strings.TrimSpace(guuid) == "" {
		return
	}
	body, err := json.Marshal(event)
	if err != nil {
		return
	}
	h.mu.RLock()
	clients := h.clients[guuid]
	list := make([]*realtimeClient, 0, len(clients))
	for client := range clients {
		list = append(list, client)
	}
	h.mu.RUnlock()
	for _, client := range list {
		select {
		case client.send <- body:
		default:
			// 客户端消费速度异常时主动断开，避免无限制堆积内存。
			client.stop()
		}
	}
}

type realtimeClient struct {
	conn    *websocket.Conn
	session Session
	hub     *realtimeHub
	send    chan []byte
	done    chan struct{}
	stopOne sync.Once
}

func (c *realtimeClient) stop() {
	c.stopOne.Do(func() {
		close(c.done)
		if c.conn != nil {
			_ = c.conn.Close()
		}
	})
}

func (c *realtimeClient) enqueue(event RealtimeEvent) bool {
	body, err := json.Marshal(event)
	if err != nil {
		return false
	}
	select {
	case c.send <- body:
		return true
	case <-c.done:
		return false
	default:
		c.stop()
		return false
	}
}

func (c *realtimeClient) writePump() {
	ticker := time.NewTicker(realtimePingEvery)
	defer func() {
		ticker.Stop()
		c.stop()
		c.hub.unregister(c)
	}()
	for {
		select {
		case body := <-c.send:
			if body == nil {
				return
			}
			_ = c.conn.SetWriteDeadline(time.Now().Add(realtimeWriteWait))
			if err := c.conn.WriteMessage(websocket.TextMessage, body); err != nil {
				return
			}
		case <-ticker.C:
			if !c.session.ExpiresAt.After(time.Now()) {
				return
			}
			_ = c.conn.SetWriteDeadline(time.Now().Add(realtimeWriteWait))
			if err := c.conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(realtimeWriteWait)); err != nil {
				return
			}
		case <-c.done:
			return
		}
	}
}

func (h *Handler) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	ticket := strings.TrimSpace(r.URL.Query().Get("ticket"))
	// 原生 Cocos WebSocket 可能携带 file://、localhost 等非网页 Origin。
	// 一次性 ticket 已由已鉴权的 HTTP 会话签发，并且只消费一次；此路径不再
	// 依赖网页 Origin 白名单。未带 ticket 的兼容旧客户端仍执行来源校验。
	if !h.originAllowedForTicket(r.Header.Get("Origin"), ticket) {
		http.Error(w, "websocket origin denied", http.StatusForbidden)
		return
	}
	var session Session
	if ticket != "" {
		var ok bool
		session, ok = h.consumeWSTicket(ticket)
		if !ok || !session.ExpiresAt.After(time.Now()) {
			writeDirectError(w, errAuthRequired)
			return
		}
	} else {
		token := bearerToken(r)
		if token == "" {
			// 兼容未实现短票据的旧客户端；新客户端始终使用一次性 ticket。
			token = strings.TrimSpace(r.URL.Query().Get("token"))
		}
		var err error
		session, err = h.service.Authenticate(r.Context(), token)
		if err != nil {
			writeDirectError(w, err)
			return
		}
	}
	upgrader := websocket.Upgrader{
		ReadBufferSize:    4096,
		WriteBufferSize:   4096,
		EnableCompression: true,
		CheckOrigin: func(_ *http.Request) bool {
			return true
		},
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		if h.logger != nil {
			h.logger.Warn("直聊 WebSocket 升级失败", "error", err)
		}
		return
	}
	client := &realtimeClient{
		conn: conn, session: session, hub: h.realtime,
		send: make(chan []byte, 32), done: make(chan struct{}),
	}
	client.conn.SetReadLimit(realtimeMaxFrame)
	client.conn.SetReadDeadline(time.Now().Add(realtimePongWait))
	client.conn.SetPongHandler(func(string) error {
		return client.conn.SetReadDeadline(time.Now().Add(realtimePongWait))
	})
	h.realtime.register(client)
	client.enqueue(RealtimeEvent{Type: "ready", Data: map[string]any{"guuid": session.Guuid}})
	go client.writePump()
	h.readRealtime(client)
}

func (h *Handler) originAllowedForTicket(origin, ticket string) bool {
	if strings.TrimSpace(ticket) != "" {
		return true
	}
	return h.originAllowed(origin)
}

func (h *Handler) consumeWSTicket(ticket string) (Session, bool) {
	h.wsTicketMu.Lock()
	defer h.wsTicketMu.Unlock()
	item, ok := h.wsTickets[ticket]
	if ok {
		delete(h.wsTickets, ticket)
	}
	return item.session, ok && item.expiresAt.After(time.Now())
}

func (h *Handler) readRealtime(client *realtimeClient) {
	defer client.stop()
	for {
		_, body, err := client.conn.ReadMessage()
		if err != nil {
			return
		}
		var command realtimeCommand
		if err := json.Unmarshal(body, &command); err != nil {
			client.enqueue(RealtimeEvent{Type: "error", Data: map[string]string{
				"code": "INVALID_COMMAND", "message": "长连接消息格式无效",
			}})
			continue
		}
		switch strings.ToLower(strings.TrimSpace(command.Type)) {
		case "ping":
			client.enqueue(RealtimeEvent{Type: "pong", RequestID: command.RequestID})
		case "message.send":
			h.handleRealtimeSend(client, command)
		default:
			client.enqueue(RealtimeEvent{Type: "error", RequestID: command.RequestID, Data: map[string]string{
				"code": "INVALID_COMMAND", "message": "不支持的长连接指令",
			}})
		}
	}
}

func (h *Handler) handleRealtimeSend(client *realtimeClient, command realtimeCommand) {
	if strings.TrimSpace(command.RequestID) == "" || strings.TrimSpace(command.ConversationID) == "" {
		client.enqueue(RealtimeEvent{Type: "error", RequestID: command.RequestID, Data: map[string]string{
			"code": "INVALID_COMMAND", "message": "缺少请求编号或会话编号",
		}})
		return
	}
	view, duplicate, err := h.sendMessageAndPublish(context.Background(), client.session, command.ConversationID, command.Message)
	if err != nil {
		biz := AsError(err)
		client.enqueue(RealtimeEvent{Type: "error", RequestID: command.RequestID, Data: map[string]string{
			"code": biz.Code, "message": biz.Message,
		}})
		return
	}
	client.enqueue(RealtimeEvent{Type: "message.sent", RequestID: command.RequestID, Data: map[string]any{
		"message": view, "duplicate": duplicate,
	}})
}

func (h *Handler) originAllowed(origin string) bool {
	origin = strings.TrimSpace(origin)
	if origin == "" {
		return true
	}
	for _, allowed := range h.allowedOrigins {
		if origin == strings.TrimSpace(allowed) {
			return true
		}
	}
	return false
}
