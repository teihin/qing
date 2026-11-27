package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"xuanmanager/internal/realtime"
	"xuanmanager/internal/security"
)

// 实时通道（2026-11-25 第二版：全线长连接）
//
// 1. 节点 ↔ 后台：`/agent/v1/ws` 一条 WebSocket 承载全部往来
//    - 上行：heartbeat / events / ack / pull 都是请求，带 id，服务端按 id 回包；
//    - 下行：command 主动推、sync 让节点补心跳、pong 回应 ping。
//    业务内核在 automation_agent_core.go，与 HTTP 接口共用同一份实现。
//
// 2. 后台 → 浏览器：`/api/automation/stream`（SSE）只推「哪类数据变了」，
//    页面收到照旧调 REST 重拉，权限/数据范围/分页口径完全不变。
//
// 断线策略（关键）：
//   - 节点侧自动重连（2s→30s 退避）；重连期间自动回退到 HTTP 轮询，机器人继续在本地跑，不受影响。
//   - 命令推送后即置 DELIVERED；节点没回执的话由 janitor 在 120 秒后重新入队（attempts 用尽才作废）。
//   - 事件自带 eventId 幂等键，节点重连后重发未确认的批次，服务端靠 (worker_id, event_id) 去重。

// agentStream 是某个节点当前的长连接。
type agentStream struct {
	workerID int64
	code     string
	conn     *realtime.Conn
	out      chan []byte
	signals  chan string
	done     chan struct{}
	once     sync.Once
	openedAt time.Time
}

func (s *agentStream) close() { s.once.Do(func() { close(s.done) }) }

// send 把一条消息排进写循环；写循环是唯一写连接的地方。
func (s *agentStream) send(message any) {
	encoded, err := json.Marshal(message)
	if err != nil {
		return
	}
	select {
	case s.out <- encoded:
	case <-s.done:
	default:
		// 队列满说明节点收得太慢，丢掉这条（命令会被 janitor 重投，事件节点会重发）。
	}
}

type agentHub struct {
	mu     sync.Mutex
	agents map[int64]*agentStream
	admins map[int64]chan []byte
	nextID int64
}

var agentStreams = &agentHub{
	agents: map[int64]*agentStream{},
	admins: map[int64]chan []byte{},
}

// register 登记连接；同一节点重复连接时顶掉旧的那条。
func (h *agentHub) register(stream *agentStream) *agentStream {
	h.mu.Lock()
	previous := h.agents[stream.workerID]
	h.agents[stream.workerID] = stream
	h.mu.Unlock()
	if previous != nil && previous != stream {
		previous.close()
	}
	return previous
}

func (h *agentHub) remove(stream *agentStream) {
	h.mu.Lock()
	if current, ok := h.agents[stream.workerID]; ok && current == stream {
		delete(h.agents, stream.workerID)
	}
	h.mu.Unlock()
	stream.close()
}

func (h *agentHub) connected(workerID int64) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	_, ok := h.agents[workerID]
	return ok
}

// wake 通知节点「有活」：立刻取一次待执行命令，并补一拍心跳拿最新指派。
// 节点没连长连接就什么都不做 —— HTTP 轮询会把命令取走。
func (h *agentHub) wake(workerID int64, reason string) {
	if workerID <= 0 {
		return
	}
	h.mu.Lock()
	stream := h.agents[workerID]
	h.mu.Unlock()
	if stream == nil {
		return
	}
	select {
	case stream.signals <- reason:
	case <-stream.done:
	default:
	}
}

func (h *agentHub) addAdmin() (int64, chan []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.nextID++
	id := h.nextID
	channel := make(chan []byte, 32)
	h.admins[id] = channel
	return id, channel
}

func (h *agentHub) removeAdmin(id int64) {
	h.mu.Lock()
	delete(h.admins, id)
	h.mu.Unlock()
}

// notifyChange 广播一条「某类数据变了」的通知。页面收到后自己重拉对应接口，
// 所以这里不携带业务数据，避免两套序列化口径。
func (h *agentHub) notifyChange(scope string, extra map[string]any) {
	payload := map[string]any{"type": "change", "scope": scope, "at": time.Now().UnixMilli()}
	for key, value := range extra {
		payload[key] = value
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return
	}
	h.mu.Lock()
	targets := make([]chan []byte, 0, len(h.admins))
	for _, channel := range h.admins {
		targets = append(targets, channel)
	}
	h.mu.Unlock()
	for _, channel := range targets {
		select {
		case channel <- encoded:
		default:
		}
	}
}

func (s *Server) registerAutomationStreamRoutes() {
	s.mux.HandleFunc("GET /agent/v1/ws", s.handleAgentWebSocket)
	s.mux.Handle("GET /api/automation/stream",
		s.authorizedAny([]string{"automation.worker.view", "automation.robot.view"}, false, s.handleAutomationStream))
}

// ---- 节点 WebSocket ----

// agentWireMessage 是长连接上的统一信封：带 id 的是请求/应答，不带 id 的是推送。
type agentWireMessage struct {
	Type string          `json:"type"`
	ID   string          `json:"id,omitempty"`
	Data json.RawMessage `json:"data,omitempty"`
}

func (s *Server) handleAgentWebSocket(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimSpace(r.Header.Get("X-Agent-Token"))
	if token == "" {
		// 允许用 query 传，方便 curl / 浏览器工具排查；正式节点用头部。
		token = strings.TrimSpace(r.URL.Query().Get("token"))
	}
	agent, err := s.agentIdentityByToken(r.Context(), token)
	if err != nil {
		if errors.Is(err, errAgentTokenInvalid) {
			writeError(w, http.StatusUnauthorized, "AGENT_UNAUTHORIZED", "节点租约已失效，请重新注册")
			return
		}
		s.logger.Error("agent ws authorize", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "校验节点身份失败")
		return
	}
	if agent.Status == "disabled" {
		writeError(w, http.StatusForbidden, "AGENT_DISABLED", "节点已被后台停用，请联系管理员")
		return
	}
	conn, err := realtime.Upgrade(w, r)
	if err != nil {
		s.logger.Warn("agent ws upgrade failed", "workerId", agent.WorkerID, "error", err)
		return
	}
	stream := &agentStream{
		workerID: agent.WorkerID,
		code:     agent.NodeCode,
		conn:     conn,
		out:      make(chan []byte, 128),
		signals:  make(chan string, 32),
		done:     make(chan struct{}),
		openedAt: time.Now(),
	}
	if previous := agentStreams.register(stream); previous != nil {
		s.logger.Info("agent ws replaced stale connection", "workerId", agent.WorkerID)
	}
	remoteIP := ipFromAddr(conn.RemoteAddr().String())
	s.logger.Info("agent ws connected", "workerId", agent.WorkerID, "node", agent.NodeCode, "remote", conn.RemoteAddr().String())
	agentStreams.notifyChange("workers", map[string]any{"workerId": agent.WorkerID})

	// 上线先补一拍：告诉节点协议版本与心跳间隔，并立刻取一次命令/指派。
	stream.send(map[string]any{
		"type":              "hello",
		"workerId":          agent.WorkerID,
		"workerCode":        agent.NodeCode,
		"heartbeatInterval": agentHeartbeatSeconds,
		"serverTime":        time.Now().UTC().Format(time.RFC3339),
		"realtime":          true,
	})

	writeDone := make(chan struct{})
	go func() {
		defer close(writeDone)
		for {
			select {
			case <-stream.done:
				return
			case payload := <-stream.out:
				if err := conn.WriteText(payload); err != nil {
					stream.close()
					return
				}
			}
		}
	}()

	// 推送协程：负责「有命令就立刻下发」，与读循环解耦，DB 慢不挡命令回执。
	go func() {
		for {
			select {
			case <-stream.done:
				return
			case reason := <-stream.signals:
				items, _, err := s.claimAgentCommands(r.Context(), agent.WorkerID, 0, agentMaxCommands)
				if err != nil {
					s.logger.Error("agent ws claim commands", "error", err, "workerId", agent.WorkerID)
					continue
				}
				for _, item := range items {
					stream.send(map[string]any{"type": "command", "data": item})
				}
				// 指派可能同时变了，让节点补一拍心跳立刻对齐。
				stream.send(map[string]any{"type": "sync", "reason": reason})
			}
		}
	}()

	// 读循环：60 秒收不到任何消息就认为连接已死（节点每 15 秒 ping）。
	_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	for {
		raw, err := conn.ReadMessage()
		if err != nil {
			break
		}
		_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		var message agentWireMessage
		if json.Unmarshal(raw, &message) != nil {
			continue
		}
		s.dispatchAgentWireMessage(r.Context(), stream, agent, remoteIP, message)
	}

	stream.close()
	<-writeDone
	agentStreams.remove(stream)
	_ = conn.Close()
	s.logger.Info("agent ws closed", "workerId", agent.WorkerID, "node", agent.NodeCode,
		"duration", time.Since(stream.openedAt).Round(time.Second).String())
	agentStreams.notifyChange("workers", map[string]any{"workerId": agent.WorkerID})
	// 长连接断开是「节点可能要没了」的最早信号：给 6 秒宽限，
	// 期间既没重连也没有新心跳，就直接判离线，不用等 20 秒租约过期。
	go s.reapDisconnectedAgent(agent.WorkerID)
}

// agentWSGracePeriod 是长连接断开后等重连/心跳的宽限时间。
const agentWSGracePeriod = 6 * time.Second

// reapDisconnectedAgent 长连接断开后补判一次离线。
// 只要节点还活着，心跳会继续刷新 last_heartbeat，这里就不会误判。
func (s *Server) reapDisconnectedAgent(workerID int64) {
	time.Sleep(agentWSGracePeriod)
	if agentStreams.connected(workerID) {
		return // 已经重连上了
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var lastHeartbeat sql.NullTime
	var status string
	if err := s.db.QueryRowContext(ctx, "SELECT status, last_heartbeat FROM mgr_automation_worker WHERE id = ?", workerID).
		Scan(&status, &lastHeartbeat); err != nil {
		return
	}
	if status == "offline" || status == "disabled" {
		return
	}
	// 宽限期内还刷新过心跳，说明节点活着（只是长连接断了），交给正常机制。
	if lastHeartbeat.Valid && time.Since(lastHeartbeat.Time) < 8*time.Second {
		return
	}
	recordWorkerEvent(ctx, s.db, workerID, workerEventOffline, 0, "", map[string]any{
		"message": "节点长连接断开，等待心跳确认",
	})
	s.logger.Info("agent ws gone, waiting heartbeat to decide offline", "workerId", workerID)
	agentStreams.notifyChange("workers", map[string]any{"workerId": workerID})
	agentStreams.notifyChange("robots", map[string]any{"workerId": workerID})
}

// dispatchAgentWireMessage 把一条上行消息翻译成一次内核调用，并按 id 回包。
func (s *Server) dispatchAgentWireMessage(ctx context.Context, stream *agentStream, agent agentIdentity, remoteIP string, message agentWireMessage) {
	switch message.Type {
	case "ping":
		stream.send(map[string]any{"type": "pong", "at": time.Now().UnixMilli()})
	case "heartbeat":
		var input agentHeartbeatRequest
		if err := json.Unmarshal(message.Data, &input); err != nil {
			stream.send(errorReply(message.ID, "INVALID_JSON", "心跳内容格式不正确"))
			return
		}
		data, err := s.applyAgentHeartbeat(ctx, agent, input, remoteIP)
		if err != nil {
			stream.send(errorReply(message.ID, "UPDATE_ERROR", "心跳写入失败"))
			return
		}
		stream.send(map[string]any{"type": "heartbeatAck", "id": message.ID, "data": data})
	case "pull":
		var input struct {
			Cursor int64 `json:"cursor"`
			Limit  int   `json:"limit"`
		}
		_ = json.Unmarshal(message.Data, &input)
		limit := clampInt(input.Limit, 1, agentMaxCommands, agentDefaultLimit)
		items, cursor, err := s.claimAgentCommands(ctx, agent.WorkerID, input.Cursor, limit)
		if err != nil {
			stream.send(errorReply(message.ID, "QUERY_ERROR", "读取命令失败"))
			return
		}
		stream.send(map[string]any{"type": "commands", "id": message.ID,
			"data": map[string]any{"items": items, "cursor": cursor}})
	case "ack":
		var payload struct {
			CommandNo    string          `json:"commandNo"`
			Status       string          `json:"status"`
			Result       json.RawMessage `json:"result"`
			ErrorCode    string          `json:"errorCode"`
			ErrorMessage string          `json:"errorMessage"`
		}
		if err := json.Unmarshal(message.Data, &payload); err != nil {
			stream.send(errorReply(message.ID, "INVALID_JSON", "回执内容格式不正确"))
			return
		}
		data, failure := s.applyAgentAck(ctx, agent, payload.CommandNo, agentAckRequest{
			Status:       payload.Status,
			Result:       payload.Result,
			ErrorCode:    payload.ErrorCode,
			ErrorMessage: payload.ErrorMessage,
		})
		if failure != nil {
			stream.send(errorReply(message.ID, failure.Code, failure.Message))
			return
		}
		stream.send(map[string]any{"type": "ackResult", "id": message.ID, "data": data})
	case "events":
		var input agentEventsRequest
		if err := json.Unmarshal(message.Data, &input); err != nil {
			stream.send(errorReply(message.ID, "INVALID_JSON", "事件内容格式不正确"))
			return
		}
		data, failure := s.applyAgentEvents(ctx, agent, input.Events)
		if failure != nil {
			stream.send(errorReply(message.ID, failure.Code, failure.Message))
			return
		}
		stream.send(map[string]any{"type": "eventsAck", "id": message.ID, "data": data})
	case "bye":
		stream.close()
	}
}

func errorReply(id, code, message string) map[string]any {
	return map[string]any{"type": "error", "id": id, "code": code, "message": message}
}

func ipFromAddr(addr string) string {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return ""
	}
	return host
}

// ---- 后台页面 SSE ----

// handleAutomationStream 把「数据变了」推给浏览器。只发通知不发数据：
// 页面收到后仍走原来的 REST 接口，权限/数据范围/分页口径完全不变。
func (s *Server) handleAutomationStream(w http.ResponseWriter, r *http.Request, p principal) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "STREAM_UNSUPPORTED", "当前服务端不支持实时推送")
		return
	}
	header := w.Header()
	header.Set("Content-Type", "text/event-stream; charset=utf-8")
	header.Set("Cache-Control", "no-cache, no-transform")
	header.Set("Connection", "keep-alive")
	// 防止 Caddy 之类的反代把流攒起来一次性发。
	header.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	_, _ = fmt.Fprint(w, "retry: 3000\nevent: ready\ndata: {\"ok\":true}\n\n")
	flusher.Flush()

	adminID, channel := agentStreams.addAdmin()
	defer agentStreams.removeAdmin(adminID)

	keepalive := time.NewTicker(20 * time.Second)
	defer keepalive.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-keepalive.C:
			if _, err := fmt.Fprint(w, ": keepalive\n\n"); err != nil {
				return
			}
			flusher.Flush()
		case payload := <-channel:
			if _, err := fmt.Fprintf(w, "event: change\ndata: %s\n\n", payload); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

// ---- 鉴权 ----

var errAgentTokenInvalid = errors.New("agent lease token invalid")

// agentIdentityByToken 用租约令牌换节点身份；HTTP 通道与 WS 通道共用。
func (s *Server) agentIdentityByToken(ctx context.Context, token string) (agentIdentity, error) {
	token = strings.TrimSpace(token)
	if token == "" || len(token) < 32 {
		return agentIdentity{}, errAgentTokenInvalid
	}
	var agent agentIdentity
	err := s.db.QueryRowContext(ctx, `SELECT id, node_code, status, max_robots
FROM mgr_automation_worker
WHERE lease_token_hash = ? AND lease_expires_at IS NOT NULL AND lease_expires_at > NOW()`,
		security.HashToken(token)).Scan(&agent.WorkerID, &agent.NodeCode, &agent.Status, &agent.MaxRobots)
	if errors.Is(err, sql.ErrNoRows) {
		return agentIdentity{}, errAgentTokenInvalid
	}
	if err != nil {
		return agentIdentity{}, err
	}
	return agent, nil
}
