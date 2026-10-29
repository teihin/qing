# Worker 通道（`/agent/v1/*`）

2026-10-27 完成代码；迁移 033 已在正式库执行，后端（00:30 版）与前端（00:31 版）均已发布，
版本 sha 与回滚路径见[上线验证归档](../archive/2026-10-28/worker-channel-prod-verification.md)。
总体规划与页面见[自动化后台](automation-console.md)，过程见[交接](../handoffs/2026-10-27-automation-console.md)。

## 1. 代码位置

| 文件 | 职责 |
| --- | --- |
| `server/internal/api/automation_agent.go` | 六条 agent 通道（注册/心跳/下线/拉命令/回执/事件）、命令状态机、事件收敛、janitor、`enqueueWorkerCommand` |
| `server/internal/api/automation_workers.go` | 后台管理接口（列表/详情/动作/手动命令/接入令牌生成·轮换·关闭） |
| `server/migrations/033_automation_worker_channel.sql` | `mgr_automation_setting`、worker 扩列、`mgr_automation_worker_command`、`mgr_automation_worker_event` |
| `server/cmd/xuanagent/` | 参考 agent：`main.go` 主循环与参数、`config.go` 同目录配置文件、`client.go` 协议、`terminal.go` 终端模拟 |

## 2. 身份与租约

- 接入令牌存 `mgr_automation_setting.agent_enroll_token`，值是 `security.HashToken` 后的 SHA-256，
  后台只能生成/轮换（`POST /api/automation/agent-token/rotate`）或关闭（`DELETE /api/automation/agent-token`），
  **明文只返回一次**，读接口只给 configured/updatedBy/updatedAt。**不配就是开放注册**（见第 6 节）。
- 节点 `POST /agent/v1/register` 带 `enrollToken`（可空）换 **20 秒租约**（存 `lease_token_hash`），之后所有调用只带
  `X-Agent-Token` 头，心跳（5 秒一拍）续租。租约过期 → 401（agent 会重新注册）；节点 `disabled` → 403。
- **「在线」以租约为准，不看 `status` 单字段**：`automationWorkerOnlineSQL` = `status='online'` 且 `lease_expires_at > NOW()`。
  列表/详情/总览的 status 列用 CASE 现算（在线但租约已过期就报 `offline`），分配、`countOnlineWorkers`、投放页在线数也用它，
  所以 janitor 还没跑到也不会把死节点当在线、不会继续派活。`draining`/`disabled` 保留原样，不并入离线。
- 正常退出走 `POST /agent/v1/offline` 即时置离线（见第 3 节）；被强杀只能等租约过期，最快约 20 秒 + 前端 5 秒轮询。
- 该通道**不走 session/CSRF**，用独立的 `agentAuthorized()`，与后台 6 层权限无关。
- 同一个 `worker_code` 重复注册复用同一行（`ON DUPLICATE KEY UPDATE`），保留 `disabled`/`draining` 状态不被覆盖；
  注册还会复活该节点被判离线的机器人（原因见第 6 节）。

## 3. 接口契约

响应统一 `{ok:true,data}` / `{ok:false,error:{code,message}}`；`decodeJSON` 开了 `DisallowUnknownFields`，
**字段名必须精确**，多一个字段就 400。

| 接口 | 关键字段 |
| --- | --- |
| `POST /agent/v1/register` | 入：`workerCode`(3–32 位字母数字 `_` `-`)、`platform`、`arch`、`version`、`capacity`(1–200)、`labels`、`enrollToken`；出：`workerId`、`workerCode`、`status`、`leaseToken`、`leaseExpiresAt`、`heartbeatInterval`(5s)、`serverTime` |
| `POST /agent/v1/heartbeat` | 入：`version`、`cpuPct`、`memPct`、`activeTerminals`、`activeTasks`、`lastEventSeq`、`capacity`、`egressCidr`；出：`status`、`pendingCommands`、`heartbeatInterval`、`leaseExpiresAt`、`assignments[]` |
| `POST /agent/v1/offline` | 入：`{reason}`（可空，截断 120 字）；节点退出前调用：置 `offline`、清租约、名下机器人标 `offline`（`stopped` 不动）、写 `WorkerOffline` 事件；出：`{status:"offline"}`。调用后租约即失效，所以 agent 先把事件 flush 完再调它 |
| `GET /agent/v1/commands?cursor=&limit=` | 出：`items[]`（`commandNo`/`commandType`/`label`/`robotId`/`terminalNo`/`params`/`expiresAt`/`attempts`）、`cursor`。取走即置 DELIVERED、`attempts+1`；取之前先把过期 PENDING 置 EXPIRED |
| `POST /agent/v1/commands/{commandNo}/ack` | 入：`status`(ACCEPTED/RUNNING/COMPLETED/REJECTED)、`result`、`errorCode`、`errorMessage`；REJECTED 会把原因写回机器人 `last_error` |
| `POST /agent/v1/events/batch` | 入：`events[]`（≤200），每条 `eventId`/`terminalNo`/`robotId`/`eventType`/`sequence`/`roomId`/`roundId`/`strategyVersion`/`commandNo`/`occurredAt`(RFC3339)/`payload`；`INSERT IGNORE` 靠 `uk_worker_event(worker_id,event_id)` 幂等，返回 `accepted`/`duplicated` |

心跳里的 `assignments` 是**该节点的权威终端清单**（robotId/terminalNo/account/clubId/inviteCode/groupName/
strategyName/desiredStatus/status/joinStatus/enabled，上限 200 条）。agent 用它拉起/收敛本地终端，
所以「后台想让节点跑什么」不靠命令逐条通知，而是靠心跳反复对照——命令只表达「这个动作」。

## 4. 命令状态机

固定 9 种枚举，服务端拒绝任意字符串：`START_TERMINAL`、`PAUSE_TERMINAL`、`DRAIN_TERMINAL`、`STOP_TERMINAL`、
`START_TASK`、`PAUSE_TASK`、`CANCEL_TASK`、`APPLY_STRATEGY`、`RECONCILE_STATE`。

```
PENDING ──pull──> DELIVERED ──ack──> ACCEPTED ──ack──> RUNNING ──ack──> COMPLETED
   │                   │                 │                 │
   └───────────────────┴─────────────────┴─────────────────┴──> REJECTED
（服务端另有 EXPIRED / CANCELLED，agent 不能设置）
```

非法跃迁返回 409 `INVALID_TRANSITION`；重复 ack 同一状态按「已同步」幂等返回。
命令有 `idem_key` 唯一索引（`enqueueWorkerCommand` 撞键即复用已有 `command_no`）、`expires_at`（默认 5–10 分钟）、
`result_json`（截断 4000）、`attempts`。

## 5. 事件 → 机器人状态收敛

`applyAgentEventToRobot` 只改确定的事实，不做猜测式迁移（`desired_state` 由后台维护）：

| 事件 | 收敛动作 |
| --- | --- |
| `TerminalStarted` / `LoginStarted` | `status='entering'`，清 `last_error` |
| `LoginSucceeded` | `status='idle'`，清 `last_error` |
| `LoginFailed` | `status='faulted'`，`last_error` = payload.message/reason |
| `Waiting` | 已在座/在玩就保留状态，否则 `status='idle'` |
| `LogoutSucceeded` | `status='idle'`，清房间与座位 |
| `RoomJoined` / `PlayerSeated` / `GameReady` | `status='seated'`，带 roomId/seatNo 时一并写入 |
| `GameStarted` / `TurnStarted` | `status='playing'` |
| `GameSettled` | `today_rounds+1`、`today_net`/`period_net`/`balance` 累加 `delta` |
| `RoomLeft` / `RoomClosed` | `status='idle'`，清房间与座位 |
| `TaskFailed` | 写 `last_error` |

## 5.5 自动分配（2026-10-28）

「谁该跑在哪个节点」不需要人工点，四处触发：

| 时机 | 函数 | 说明 |
| --- | --- | --- |
| 节点注册成功 | `assignWaitingRobotsToWorker` | 上线就把它装得下的等待账号全领走 |
| 每次心跳 | 同上（先 `countWaitingRobots` 挡一道） | 节点扩容/后投放都能落位；**先分配再取指派清单**，新终端当拍就进回包 |
| 巡检每 5 秒 | `assignWaitingRobots` | 全局兜底，按剩余容量从多到少喂一遍在线节点（在线=租约有效） |
| 投放俱乐部时 | `assignAutomationWorkers(clubID)` | 原有逻辑，仍按俱乐部优先 |

- 「等待分配」= `worker_id IS NULL AND enabled=1 AND join_status='joined'`；`unassigned`（还没投放到俱乐部）**不参与**分配。
- 抢占用 `UPDATE ... WHERE id=? AND worker_id IS NULL` + `RowsAffected`，多节点并发不会重复分配；
  `disabled`/`draining`/`offline` 一律不接新账号，离线 10 分钟的名下账号由巡检收回（见第 6 节）。
- `mgr_automation_robot` 没有 `worker_id` 索引，靠表小（百级）扛；上量再补 `(worker_id, status)`。

## 5.6 节点日志（事件流）

`mgr_automation_worker_event` 一份日志两个来源，靠 `event_id` 前缀区分：

- **后台动作**（`event_id = sys-<纳秒>-<robotId>`，`sequence=0`，前端标「系统」）：
  `WorkerOnline`、`WorkerOffline`、`RobotAssigned`、`RobotReleased`。由 `recordWorkerEvent` 写入，
  分配/收回/上下线都留痕，不依赖节点配合。
- **终端事件**（`event_id = <terminalNo>-<runID>-<seq>`）：`TerminalStarted` → `LoginStarted` →
  `LoginSucceeded`/`LoginFailed` → `Waiting` → `RoomJoined`/`PlayerSeated`/`GameReady` → 逐局
  `GameStarted`/`TurnStarted`/`Action*`/`GameSettled` → `RoomLeft`/`RoomClosed` → `LogoutSucceeded` → `TerminalStopped`。

**runID 是必须的**：终端序号每次启动从 1 开始，不带前缀的话重启后的事件会被后台按
`(worker_id, event_id)` 当重复丢掉，日志会静默缺一大段。
（踩过：`emitRound` 原本用 `<terminalNo>-<seq>`。）

事件类型白名单 `agentEventTypes` 收 21 种；**单条类型不认只跳过并 log，不再整批 400**，
新旧版本混跑时不会因为一条怪事件把整批丢掉（响应里多返回 `skipped`）。

详情接口：命令 50 条、事件 200 条，前端事件行显示「标签 + 系统/seq + 终端 + 房间/局 + 时间 + 一句摘要」
（摘要从 payload 抽 `message`/`account`/`clubName`/`reason`/`roomId`/`delta`，见 `workerEventSummary`）。

## 6. janitor

`RunAutomationWorkerJanitor(workerCtx, db, logger)`（`main.go` 启动，**5 秒一轮**）：

1. `online` 且心跳超 **20 秒**（= 租约 TTL）→ `offline` 并清租约，写 `WorkerOffline` 事件；其机器人 → `offline`，`last_error='Worker 节点心跳中断'`。
2. 离线超 10 分钟的节点 → 名下账号收回等待池（`worker_id=NULL`），写 `RobotReleased`。
3. 过期 PENDING → `EXPIRED`。
4. DELIVERED 超 120 秒无回执且 `attempts<3` → 退回 `PENDING` 重投；`attempts` 用尽 → `EXPIRED`。
5. 末尾跑一次 `assignWaitingRobots` 兜底分配。

节点恢复的两条路都要把掉线时标的机器人放回 `idle`：**重新注册**时（`status != 'disabled'` 就复活）和
**心跳读到旧状态是 `offline`** 时。少了前者，「掉线→重启」的终端会永远显示离线。
正常退出走 `/agent/v1/offline`，不等巡检；被强杀才靠这里的 20 秒超时兜底。

## 7. 后台接口（`automation.worker.view` / `automation.worker.manage`）

- `GET /api/automation/workers?keyword=&status=` — 行里含 `leased`、`pendingCommands`、`runningCommands`、
  `faultedRobots`、`platform`/`arch`/`labels`/`enrolledAt`/`lastEventAt`/`lastEventSeq`/`notes`。
  `status` 与筛选都按**租约现算**（在线但租约过期回 `offline`），总览 `queryAutomationWorkers` 同一口径。
- `GET /api/automation/workers/{id}` — worker + 该节点机器人 + 近 20 条命令 + 近 30 条事件。
- `POST /api/automation/workers/{id}/action` — `enable`/`drain`/`disable`/`restart`/`delete`；
  enable/drain/restart 会顺手发一条 `RECONCILE_STATE`；`delete` 先把机器人解绑回池再删行。
- `POST /api/automation/workers/{id}/commands` — 手动下发（命令类型 + 可选 robotId + params），10 分钟有效。
- `GET /api/automation/agent-token`、`POST /api/automation/agent-token/rotate` — 令牌状态与轮换。
- `DELETE /api/automation/agent-token` — 关掉令牌校验，回到「不带令牌也能注册」的开放模式。

**令牌是可选的**：`mgr_automation_setting` 无 `agent_enroll_token` 时注册直接放行（log `open mode`、审计 `tokenChecked=false`）；
配了哈希才要求 `enrollToken` 匹配，不匹配回 `AGENT_ENROLL_REJECTED`。不想管就不生成，想收紧再点「生成/轮换」。

**机器人动作联动**：`performAutomationRobotAction` 先做本地状态更新，再在该节点入队终端命令
（`start`/`restart`/`enable` → `START_TERMINAL`，`pause` → `PAUSE_TERMINAL`，`drain` → `DRAIN_TERMINAL`，
`stop`/`disable`/`release` → `STOP_TERMINAL`），幂等键按 30 秒桶，避免连点刷命令。

**前端**：`web/src/pages/automation/AutomationWorkersPage.tsx` — 令牌卡（可选：生成/复制/关闭校验 + `xuanagent.json` 样例）、
节点表（租约·承载·命令·心跳）、详情弹窗（5 列事实 + 终端/命令/事件三页签 + 手动下发）、动作确认弹窗。
节点表**每 5 秒静默轮询**（详情弹窗 10 秒），所以节点退出后不用手点「刷新」就会变离线。

## 8. 参考 agent（xuanagent）

`server/cmd/xuanagent` 是后台配套的 Worker 节点：注册 → 心跳（顺带收敛终端）→ 每 2 秒拉命令 → 三段回执 →
事件攒批（800ms / 64 条）上报。**退出顺序固定**：`cancel()` → `shutdown()`（停终端，先离房）→
`flush()`（租约还在时把攒着的事件发完）→ `offline(reason)`（正常/异常退出）→ 进程结束；
上报失败只 Warn，由服务端租约超时兜底。启动配置、参数与交叉编译见[真实客户端专题 §11](automation-real-client.md)。

## 9. 已验证 / 未验证（2026-10-28）

> **本轮「在线状态实时化」只在本地代码与 mock 上验证**：正式 8891 仍是 90 秒租约 / 30 秒巡检、没有
> `POST /agent/v1/offline` 路由，`bin/xuanagent` 也是旧产物。发布后端 + 重编 agent 之前，线上表现不变。
> 明细见[交接](../handoffs/2026-10-28-worker-realtime-online.md)。

**已验证（对本地 mock，严格按服务端字段名校验）**：注册换租约、心跳回指派、命令 ACCEPTED→COMPLETED、
9 秒 358 条事件字段零错误且 `eventId` 唯一、SIGTERM 后先离房再退出、windows/linux 交叉编译；
Worker 列表在接口转离线后**不手点刷新**自动由「在线·租约有效·1/1」变「离线·已过期·0/1」。

**已上线的验证（正式 8891 / 外网 Caddy，00:30～00:52 那三版）**：注册/租约、开放模式注册、前端发布、
旧口径 janitor 掉线、0.4 秒自动分配与全量事件回流均已实测通过，明细见[上线验证归档](../archive/2026-10-28/worker-channel-prod-verification.md)。

**未验证**：真实节点长跑（租约续期、断网重注册、时钟偏差）、真机投放后的指派清单与命令闭环、
DELIVERED 无回执重投、离线 10 分钟收回账号的真实链路、页面对真实接口联调、Windows 版 agent 未构建；
本轮的 `/agent/v1/offline` 真机调用、强杀后 20 秒判离线的真实延迟、20 秒租约在真实抖动下是否反复重注册同样未实测，
逐条剩余问题见[交接](../handoffs/2026-10-28-worker-realtime-online.md)。

## 10. 俱乐部模式：硬前置 + 一轮一房 + 超目标留房连输（2026-10-29，后端已部署 / 未连真服）

用户确认的规则：**进房必须自己在该俱乐部内**；**房间没有「结束」概念**；**每轮结算后离房换桌**，刚离开的房
10 分钟内不再进（`XUAN_ROOM_AVOID_MS`），没别的房就等，过期才允许回原房；**例外：结算时已超目标就留在原房
继续带入来输，最多连续 2 次**（`XUAN_STAY_BUYIN_TIMES`），用完才离房。阀值口径：低于目标允许赢，超过目标本轮该输。

信号与实现：`PromptInfo`/`PromptInfo2` 里 word 含「已结算」是权威的整轮结束信号（游戏内 `onPromptInfo2`
靠它去补分），`结算_结束(is_exit=True)` 3 秒后兜底，两者 5 秒内只处理一次 → `afterSettle()`：判
`strategy.profitIntent` 为 `lose` 且留房次数未满 → `tryBuyin()` 发 `坐下_事件`（不带 site，照官方「确认带入」）；
否则 `leaveAfterSettle()` 记避让 + 离房 + 1.5 秒后重查房；`pickRoom` 跳过避让中的房。只有留座到期被收座才
`resetSeat()` + `tryTakeSeat()` 重新占座；`0x311` 与 `enterRoom` 都拦回入会流程。新增 `PlayerUnseated`
（丢座，保留 room_id），后端已随当日部署上线；`agent-client/` 在 worker 节点本地（xuanagent 同目录），
远程节点需另同步。

改动清单、已核对「不改」的项、四项冒烟与待验证项见[交接](../handoffs/2026-10-29-worker-club-mode.md)。
