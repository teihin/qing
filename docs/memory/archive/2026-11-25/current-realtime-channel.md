# CURRENT 归档：自动化实时通道

> 按预算归档，原文保留。

## 2026-11-25 自动化通道改实时：节点全线长连接（WS）+ 后台 SSE（测试服已部署，详见[交接](handoffs/2026-11-25-automation-realtime-channel.md)）

- 口径（用户已否掉「WS 只推唤醒 + 业务走 HTTP」的混合版）：**心跳、拉命令、回执、批量事件全部走
  `/agent/v1/ws` 长连接**，命令由服务端主动推；HTTP 只留注册、正常退出、断线兜底。
  上行事件带 `eventId` 幂等键，发不出去留在 `pendingEvents` 重连重发；命令推送即 `DELIVERED`，
  没回执由 janitor 120 秒重投。后台页面走 SSE 推 `change` 通知，页面照旧调 REST 重拉。
- 新增 `server/internal/realtime/`（自写最小 RFC 6455，不引第三方库）、`api/automation_agent_core.go`
  （HTTP 与 WS 共用业务内核）、`api/automation_stream.go`、`cmd/xuanagent/transport.go`+`realtime.go`、
  前端 `useAutomationStream.ts`；Worker 行多返回 `realtime`。
- 验证：`go build/vet/test`（仅剩既有 `TestGameRegistrationHoneypotRejectsAndBansIP`）、`tsc`、`vite build`；
  公网探针逐项验过 hello/heartbeat/pull/events/ack/ping；**真实 worker 短跑** WS 通、事件落库、
  强杀后 30 秒内判离线。测试服已部署（`c2f03485…`、`index-B-bCvnNV.js`），回滚点
  `bin/xuanmanager.previous-ws-20261125`、`web.previous-realtime-20261125`。
- 未验证：浏览器登录态下 SSE 实际推送（测试服 admin 密码未知）、后台点命令的 1 秒端到端。
- **客户端连接已对齐真机并修好**（22:1x）：根因是 Node 内置 WebSocket（undici）不接受 KBEngine 回的
  未请求 `Sec-WebSocket-Protocol`，与 WSS/IP 无关；换成自写 `agent-client/wsclient.js` 后，
  节点按客户端方式**明文 ws 直连 `154.37.155.17:20013`**（`defBaseAppIP` 钉同址），
  两台机器人首次登录激活跑通（`activated_at` 已写）。

