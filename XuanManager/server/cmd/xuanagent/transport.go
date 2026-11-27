package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"

	"xuanmanager/internal/realtime"
)

// wsTransport 把「请求-应答」跑在一条 WebSocket 上：每条请求带 id，
// 服务端按 id 回 heartbeatAck/commands/ackResult/eventsAck 或 error。
//
// 为什么还要 HTTP：只有拿租约（register）必须走 HTTP；长连接断开或后台没升级时，
// 心跳/命令/事件自动退回原来的 HTTP 接口，机器人照常跑 —— 换传输层不能变成单点故障。

type wireReply struct {
	data    json.RawMessage
	code    string
	message string
}

type wsTransport struct {
	conn *realtime.Conn
	a    *agent

	mu      sync.Mutex
	seq     int64
	pending map[string]chan wireReply
}

func newWSTransport(conn *realtime.Conn, a *agent) *wsTransport {
	return &wsTransport{conn: conn, a: a, pending: map[string]chan wireReply{}}
}

func (t *wsTransport) nextID() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.seq++
	return fmt.Sprintf("r%d", t.seq)
}

// call 发一条请求并等应答；ctx 超时或连接断开都算失败，调用方回退 HTTP。
func (t *wsTransport) call(ctx context.Context, messageType string, payload any, out any) error {
	id := t.nextID()
	channel := make(chan wireReply, 1)
	t.mu.Lock()
	t.pending[id] = channel
	t.mu.Unlock()
	defer func() {
		t.mu.Lock()
		delete(t.pending, id)
		t.mu.Unlock()
	}()

	message := map[string]any{"type": messageType, "id": id}
	if payload != nil {
		message["data"] = payload
	}
	if err := t.conn.WriteJSON(message); err != nil {
		return err
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case reply := <-channel:
		if reply.code != "" {
			return &apiError{Code: reply.code, Message: reply.message}
		}
		if out != nil && len(reply.data) > 0 {
			return json.Unmarshal(reply.data, out)
		}
		return nil
	}
}

// deliver 由读循环调用：把应答交给等待中的请求。
func (t *wsTransport) deliver(id, code, message string, data json.RawMessage) {
	if id == "" {
		return
	}
	t.mu.Lock()
	channel, ok := t.pending[id]
	t.mu.Unlock()
	if !ok {
		return
	}
	select {
	case channel <- wireReply{data: data, code: code, message: message}:
	default:
	}
}

// failAll 在连接断开时唤醒所有等待中的请求，让调用方立刻回退 HTTP，
// 不用傻等到 20 秒超时。
func (t *wsTransport) failAll() {
	t.mu.Lock()
	pending := t.pending
	t.pending = map[string]chan wireReply{}
	t.mu.Unlock()
	for _, channel := range pending {
		select {
		case channel <- wireReply{code: "TRANSPORT_CLOSED", message: "长连接已断开"}:
		default:
		}
	}
}

// ---- agent 侧统一调用入口：有长连接走长连接，没有走 HTTP ----

func (a *agent) transport() *wsTransport {
	current := a.rt.Load()
	if current == nil {
		return nil
	}
	return current
}

func (a *agent) sendHeartbeat(ctx context.Context, request heartbeatRequest) (heartbeatResponse, error) {
	if transport := a.transport(); transport != nil {
		var result heartbeatResponse
		err := transport.call(ctx, "heartbeat", request, &result)
		if err == nil {
			return result, nil
		}
		if ctx.Err() != nil {
			return result, err
		}
		// 长连接上失败就退到 HTTP 再试一次：可能连接刚好断了。
		a.log.Debug("心跳走长连接失败，改走 HTTP", "error", err)
	}
	return a.client.heartbeat(ctx, request)
}

func (a *agent) pullCommandsRemote(ctx context.Context, cursor int64, limit int) (commandBatch, error) {
	if transport := a.transport(); transport != nil {
		var result commandBatch
		request := map[string]any{"cursor": cursor, "limit": limit}
		err := transport.call(ctx, "pull", request, &result)
		if err == nil {
			return result, nil
		}
		if ctx.Err() != nil {
			return result, err
		}
	}
	return a.client.pullCommands(ctx, cursor, limit)
}

func (a *agent) sendAck(ctx context.Context, commandNo, status string, result any, errCode, errMessage string) error {
	if transport := a.transport(); transport != nil {
		request := map[string]any{
			"commandNo":    commandNo,
			"status":       status,
			"result":       result,
			"errorCode":    errCode,
			"errorMessage": errMessage,
		}
		err := transport.call(ctx, "ack", request, nil)
		if err == nil {
			return nil
		}
		if ctx.Err() != nil {
			return err
		}
		a.log.Debug("回执走长连接失败，改走 HTTP", "error", err)
	}
	return a.client.ack(ctx, commandNo, status, result, errCode, errMessage)
}

func (a *agent) sendEvents(ctx context.Context, events []event) error {
	if len(events) == 0 {
		return nil
	}
	if transport := a.transport(); transport != nil {
		request := map[string]any{"events": events}
		err := transport.call(ctx, "events", request, nil)
		if err == nil {
			return nil
		}
		if ctx.Err() != nil {
			return err
		}
		a.log.Debug("事件上报走长连接失败，改走 HTTP", "error", err)
	}
	return a.client.reportEvents(ctx, events)
}

// ---- 命令执行队列 ----

// enqueueCommand 由读循环投递后台推来的命令，执行统一在主循环里做。
func (a *agent) enqueueCommand(item command) {
	select {
	case a.commands <- item:
	default:
		a.log.Warn("命令队列已满，丢弃", "commandNo", item.CommandNo, "type", item.Type)
	}
}

// markHandled 返回 false 表示这条命令已经执行过（推送与轮询可能同时拿到）。
func (a *agent) markHandled(commandNo string) bool {
	if commandNo == "" {
		return true
	}
	if _, ok := a.handled[commandNo]; ok {
		return false
	}
	if len(a.handled) > 512 {
		// 简单封顶，避免长跑无限增长；清空后最坏情况是多执行一次已被服务端拒绝的命令。
		a.handled = map[string]struct{}{}
	}
	a.handled[commandNo] = struct{}{}
	return true
}

var errTransportClosed = errors.New("长连接已关闭")
