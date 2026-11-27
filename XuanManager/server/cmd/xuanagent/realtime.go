package main

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"xuanmanager/internal/realtime"
)

// 实时通道（2026-11-25）
//
// 后台 → 节点：一条 WebSocket 长连接，只在「有新命令 / 指派变了」时推一条 wake。
// 节点收到后立刻走原来的 HTTP 接口拉命令与补心跳 —— 业务逻辑不搬家，WS 只是把
// 「什么时候去拉」从固定 2 秒轮询变成即时通知。
//
// 为什么上行（心跳、事件、回执）不放上来：事件是批量幂等的，HTTP 天然可重试；
// 走 WS 一旦断线就要自己做补发队列，反而更脆。
//
// 连不上不影响可用：所有动作都有 HTTP 轮询兜底，只是慢一点。

// wake 往主循环丢一个「有活干了」的信号（非阻塞，队列满就丢，反正轮询会补）。
func (a *agent) wake(reason string) {
	select {
	case a.wakeCh <- reason:
	default:
	}
}

// realtimeActive 表示 WS 长连接此刻可用（用于降频轮询、加密事件上报）。
func (a *agent) realtimeActive() bool { return a.rt.Load() != nil }

// wsEndpoint 把 http(s):// 的后台地址换成 ws(s):// 并拼上通道路径。
func wsEndpoint(base string) string {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	switch {
	case strings.HasPrefix(base, "https://"):
		base = "wss://" + strings.TrimPrefix(base, "https://")
	case strings.HasPrefix(base, "http://"):
		base = "ws://" + strings.TrimPrefix(base, "http://")
	}
	return base + "/agent/v1/ws"
}

// sleep 等一会儿；返回 false 表示进程正在退出，调用方应直接返回。
func (a *agent) sleep(duration time.Duration) bool {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-a.ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

// realtimeLoop 维护长连接：连上就收推送，断了按 2s→30s 退避重连。
func (a *agent) realtimeLoop() {
	backoff := 2 * time.Second
	for {
		if a.ctx.Err() != nil {
			return
		}
		token := a.client.token
		if token == "" {
			// 还没注册成功（拿不到租约），等主流程注册完再连。
			if !a.sleep(2 * time.Second) {
				return
			}
			continue
		}
		url := wsEndpoint(a.cfg.server)
		ctx, cancel := context.WithTimeout(a.ctx, 15*time.Second)
		conn, err := realtime.Dial(ctx, url, http.Header{"X-Agent-Token": []string{token}})
		cancel()
		if err != nil {
			if a.ctx.Err() != nil {
				return
			}
			a.log.Warn("实时通道连接失败，稍后重试", "url", url, "error", err, "retryIn", backoff.String())
			if !a.sleep(backoff) {
				return
			}
			if backoff < 30*time.Second {
				backoff *= 2
			}
			continue
		}
		backoff = 2 * time.Second
		a.log.Info("实时通道已连接", "url", url)
		transport := newWSTransport(conn, a)
		a.rt.Store(transport)
		// 断线期间可能错过了命令与指派变化，连上先补一次。
		a.wake("connected")
		go a.realtimePing(conn)
		err = a.realtimeRead(transport)
		a.rt.Store(nil)
		transport.failAll()
		_ = conn.Close()
		if a.ctx.Err() != nil {
			return
		}
		if err != nil {
			a.log.Warn("实时通道断开，回退到轮询", "error", err)
		}
		if !a.sleep(time.Second) {
			return
		}
	}
}

// realtimePing 每 15 秒发一次 ping：服务端 60 秒收不到就认为连接已死。
func (a *agent) realtimePing(conn *realtime.Conn) {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-a.ctx.Done():
			_ = conn.Close()
			return
		case <-ticker.C:
			if err := conn.WriteJSON(map[string]any{"type": "ping"}); err != nil {
				_ = conn.Close()
				return
			}
		}
	}
}

// realtimeRead 读服务端推送；读循环退出即认为连接断开。
//
// 这里的调度：
//   - 带 id 的应答交给等待中的请求（transport.deliver）；
//   - 下行 command：丢进主循环的命令队列执行；
//   - sync：让主循环补一拍心跳（拿最新指派）。
func (a *agent) realtimeRead(transport *wsTransport) error {
	_ = transport.conn.SetReadDeadline(time.Now().Add(90 * time.Second))
	for {
		raw, err := transport.conn.ReadMessage()
		if err != nil {
			return err
		}
		_ = transport.conn.SetReadDeadline(time.Now().Add(90 * time.Second))
		var message struct {
			Type    string          `json:"type"`
			ID      string          `json:"id"`
			Reason  string          `json:"reason"`
			Code    string          `json:"code"`
			Message string          `json:"message"`
			Data    json.RawMessage `json:"data"`
		}
		if json.Unmarshal(raw, &message) != nil {
			continue
		}
		switch message.Type {
		case "hello":
			a.log.Info("实时通道握手完成（命令、心跳、事件全部走长连接）")
		case "command":
			var item command
			if json.Unmarshal(message.Data, &item) == nil {
				a.log.Debug("收到后台推送命令", "commandNo", item.CommandNo, "type", item.Type)
				a.enqueueCommand(item)
			}
		case "sync":
			a.wake(message.Reason)
		case "error":
			transport.deliver(message.ID, message.Code, message.Message, nil)
		default:
			// heartbeatAck / commands / ackResult / eventsAck / pong
			transport.deliver(message.ID, "", "", message.Data)
		}
	}
}
