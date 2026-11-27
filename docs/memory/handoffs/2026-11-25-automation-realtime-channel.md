# 2026-11-25 自动化通道：节点全线长连接（WS）+ 后台 SSE

## 口径（用户要求，别再退回混合模式）

原通道是纯 HTTP 轮询：命令 2 秒拉一次、心跳 5 秒、事件 800ms 攒批、页面 5 秒刷，端到端 3~6 秒。
第一版改成「WS 只推唤醒 + 业务仍走 HTTP」后，用户明确否掉：一条长连接上再叠 HTTP 心跳/事件是白费流量。
现口径：

- **长连接就是主通道**（`/agent/v1/ws`）：心跳、拉命令、回执、批量事件都是带 `id` 的请求/应答；
  命令由服务端主动推 `{type:"command"}`，`sync` 让节点补一拍心跳。
- **HTTP 只保留三件事**：注册换租约（`/register`）、正常退出（`/offline`）、长连接不可用时的兜底。
  兜底是自动的：`wsTransport` 调用失败即回退 `apiClient`，节点侧无感。
- **上行事件不落进 WS 就丢**：事件带 `eventId` 幂等键，节点把发不出去的批次留在 `pendingEvents`
  队列里（上限 2000），下一拍或重连后重发，服务端靠 `(worker_id, event_id)` 去重。
- **命令可靠性靠服务端状态机**：推送时即置 `DELIVERED`；节点没回执由 janitor 120 秒后重投，
  `attempts` 用尽才 `EXPIRED`。节点侧按 `commandNo` 去重，推送与轮询撞车也只执行一次。
- **后台页面走 SSE，只推「变了」**：`{type:"change",scope,workerId,robotId}`，页面收到照旧调 REST，
  权限/数据范围/分页口径零改动。

## 改动

- `server/internal/realtime/`：自写最小 RFC 6455（握手、分片、ping/pong、close，单消息 1 MB），
  **不引第三方 WS 库**（后端只依赖 mysql 驱动与 x/crypto）。
- `server/internal/api/automation_agent_core.go`（新）：通道业务内核，HTTP 与 WS 共用一份实现 —
  `applyAgentHeartbeat` / `claimAgentCommands` / `applyAgentAck` / `applyAgentEvents`。
  四个 HTTP 处理器缩成「解码 + 调内核 + 写响应」。
- `server/internal/api/automation_stream.go`：`agentHub`（每节点一条连接、重复连接顶掉旧连接）、
  `/agent/v1/ws`（鉴权 → 升级 → 读循环分发 + 写循环 + 推送协程）、`/api/automation/stream`（SSE）。
  信封：`{type,id,data}`；应答 `heartbeatAck`/`commands`/`ackResult`/`eventsAck`/`error`，
  推送 `command`/`sync`/`pong`。读超时 60 秒（节点 15 秒一次 ping）。
- `cmd/xuanagent/transport.go`（新）：`wsTransport` 请求-应答（id → channel）、断线时 `failAll`
  立刻唤醒等待方回退 HTTP；agent 侧 `sendHeartbeat`/`pullCommandsRemote`/`sendAck`/`sendEvents`
  四个统一入口。`cmd/xuanagent/realtime.go`：2s→30s 退避重连、15 秒 ping、推送命令入主循环队列。
- `cmd/xuanagent/main.go`：主循环加 `case item := <-a.commands`（命令只在主循环执行，避免并发）；
  事件上报失败进 `pendingEvents` 重发队列；长连接可用时命令轮询降为 30 秒、事件冲刷 800ms→250ms。
- 前端 `useAutomationStream.ts`（EventSource + 300ms 防抖 + 5 秒重连），接入 Worker 节点页、
  牌桌快照、运行日志；连上时轮询 5 秒→20 秒。Worker 列表/详情多返回 `realtime`，页面显示
  「实时通道已连接 / 轮询模式」。

## 验证（2026-11-25 21:5x，测试服 154.37.155.17）

- `go build ./...`、`go vet ./...` 通过；`go test ./...` 只剩既有失败
  `TestGameRegistrationHoneypotRejectsAndBansIP`（`REGISTRATION_MOVED`，与本次无关）。
- 新增测试：`TestUpgradeAndDialRoundTrip`、`TestUpgradeRejectsPlainRequest`、
  `TestAutomationStreamPushesChange`、`TestAgentHubReplacesStaleConnection` 全过。
- `npx tsc --noEmit`、`npm run build` 通过，产物 `index-B-bCvnNV.js`。
- 后端已部署：二进制 sha256 `c2f03485…`、health 200；回滚 `bin/xuanmanager.previous-ws-20261125`
  （第一版 ws，再往前是 11-25 的纯 HTTP 版）。前端回滚目录 `web.previous-realtime-20261125`。
- **公网探针**（经 Caddy，已删除）逐项验过：`hello` → `heartbeat` 回 `heartbeatAck`（带 assignments）→
  `pull` 回 `commands` → `events` 回 `eventsAck`（未知类型 skipped=1，不写库）→
  不存在的命令回 `error/COMMAND_NOT_FOUND` → `ping` 回 `pong`。
- **真实 worker 短跑**（`server/bin/xuanagent`，9 秒后强杀）：日志出现
  `实时通道已连接` + `实时通道握手完成`；两台终端拉起、事件经 WS 上报后库里出现
  `Waiting` / `LoginStarted`（各 8 条）；强杀后不到 30 秒 janitor 把节点置 `offline`、清租约。

## 未验证 / 已知问题

- 浏览器登录态下的 SSE 实际推送：测试服 admin 密码未知（试过一次失败即停），只验到路由 401 与
  Go 侧流测试。页面打开后看 Worker 行是否显示「实时通道已连接」即可确认。
- 命令推送的**人工端到端**（后台点暂停 → 1 秒内终端动）：需要登录后台操作，本次没做。
- **真实客户端连不上游戏服**：短跑时两台终端都报 `client: onerror_before_onopen`（WSS 20013）。
  `http://154-37-155-17.nip.io/ws/20013/` 返回 200，但 `https://…/ws/20013/` TLS 握手失败（curl exit 35），
  与本次改动无关，是下一步真机验证的前置障碍。

## 下一步

1. 查游戏服 WSS 入口（`/ws/20013/` 的 TLS/证书或 Caddy 路由），否则机器人登不进去。
2. 启动 Worker 后在后台点一次「暂停/停止」，确认命令 1 秒内到达（`logs/xuanmanager.log` 有
   `agent ws connected`，`xuanagent` 日志有「收到后台推送命令」）。
3. 断网演练：拔网线 30 秒再恢复，节点应自动重连，`pendingEvents` 补发，租约在断网期间过期 →
   节点被标离线 → 重连后心跳把机器人从 `offline` 复活（既有逻辑）。

## 追加：客户端连接方式对齐真机 + 直连 IP（2026-11-25 22:1x）

**结论：机器人连不上游戏服的根因不是 WSS 代理，也不是 IP**，而是 Node 内置 WebSocket（undici）
按 RFC 严格校验握手：KBEngine 的 WS 入口会回一个客户端没请求的
`Sec-WebSocket-Protocol: WebManagerSocket`，浏览器和 Cocos 原生引擎都容忍，undici 直接判失败
（日志就是 `onerror_before_onopen`）。用 `curl` 手工发同样的头能拿到 101，用自写 Go 客户端也能连上，
只有 undici 不行。

改动：

- `agent-client/wsclient.js`（新）：自带的极简 WebSocket 客户端（浏览器兼容接口：
  `onopen/onmessage/onclose/onerror`、`binaryType`、`send`、`close`），支持文本/二进制、分片、
  ping/pong、close，客户端帧按规范加掩码；握手不校验子协议、不发 `Sec-WebSocket-Extensions`。
- `agent-client/client.js`：`global.WebSocket = require('./wsclient')`（在加载 SDK 之前）；
  连接参数对齐原生客户端（`GameDataManager.initKBE` 那套）：
  - 默认 `154.37.155.17:20013`、**明文 ws 直连**（客户端 `IS_USE_WSS=false`，WSS 代理只给浏览器页用）；
  - `XUAN_GAME_WSS=1` 才走代理（可配 `XUAN_GAME_WSS_PROXY`）；
  - `defBaseAppIP` 默认钉成同一个地址（对应客户端 `BASE_SERVER_IP`），避免登录服下发域名后跑偏；
  - 登录数据与 `DeviceIdentityManager.createLoginData` 同结构，`scene` 只在 `login`/`reconnect` 之间取。
- `server/bin/xuanagent.json`：显式加 `gameHost`/`gamePort`/`gameWss:false`（不依赖客户端默认值）。

验证：`node` 直连 `ws://154.37.155.17:20013` 能 OPEN（undici 不行）；起真实 worker 后两台
`worker001/worker002` 都打完登录，日志 `只登录激活：登录成功，准备退出`，库里
`activated_at=2026-11-25 22:10:21`、`worker_id` 已被收回（激活会话按设计让出节点）。
这是**账号首次登录激活链路第一次真机跑通**。

未验证：普通（非 loginOnly）会话的进房与出牌——这两台还没投放到俱乐部（`join_status=unassigned`）。
