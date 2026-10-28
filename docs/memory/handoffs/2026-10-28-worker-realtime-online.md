# 2026-10-28 自动化：Worker 在线状态实时化（未提交、未发布）

## 目录与分支

- 目录：`/Volumes/SSD/qing`，分支 `codex/club-ui`。
- 只改 Worker 通道（后端 + 参考 agent + 前端列表）；**未提交、未推送、未发布、未执行迁移**（无需新迁移）。
- **worker 由用户启动**，本轮没有拉起任何终端。

## 问题（用户原话）

> Worker. 现在退出之后 或者异常退出或者被关闭列表里面，它还是显示在线的。 这里需要调整为实时显示。在线就在线，不在线就不在线。

原因有三层，缺一不可：

1. **正常退出没有下线动作**：`xuanagent` 收到 SIGTERM/自然退出后只停终端、上报事件，从不告诉后台「我走了」，后台行仍是 `online`。
2. **异常退出兜底太慢**：心跳 10 秒、租约 90 秒、janitor 30 秒一轮 → 强杀后最长 ~2 分钟还显示在线。
3. **页面不自动刷新**：`AutomationWorkersPage` 只在挂载时拉一次列表，接口改了也要手动点「刷新」。

## 改动

### 后端 `server/internal/api/automation_agent.go`

- 时序收紧：`agentHeartbeatSeconds` 10→**5**、`agentLeaseTTLSeconds` 90→**20**（连丢 4 拍才判离线）、`agentJanitorInterval` 30s→**5s**。
- 新通道 `POST /agent/v1/offline`（走 `agentAuthorized`，带租约头）：`handleAgentOffline` 把 `status` 置 `offline`（`disabled` 不动）、清 `lease_token_hash/lease_expires_at`，把名下非 `offline/stopped` 机器人标 `offline` 并写 `last_error='节点已下线：<原因>'`，落一条 `WorkerOffline` 事件（payload 带 `reason/robots`），返回 `{status:"offline"}`。`reason` 可选，空则「节点主动退出」，截断 120 字。
- 注册时补一条兜底：`status != 'disabled'` 时把该节点 `offline` 的机器人放回 `idle` 并清 `last_error`，避免「掉线→重启」后终端永远卡在离线（原来只有心跳里读到旧状态是 offline 才复活，重新注册会绕过）。

### 后端在线判定改为「看租约」

- `automation_workers.go` 新增常量 `automationWorkerOnlineSQL`（`status='online'` **且** `lease_expires_at > NOW()`），`automationWorkerListSelect` 的 status 列改成 CASE：在线但租约已过期就返回 `offline`；状态筛选条件同步换成该 CASE。总览用的 `queryAutomationWorkers`（`automation_ops.go`）同样换成 CASE。
- 分配/统计不再承认「5 分钟内有心跳」这种宽松口径：`assignWaitingRobots`（`automation_assign.go`）、`assignAutomationWorkers`、`countOnlineWorkers`、投放页两处 `WorkersOnline` 子查询全部改用 `automationWorkerOnlineSQL`，死节点不会被继续派活。

### agent `server/cmd/xuanagent/`

- `client.go` 加 `offline(ctx, reason)` → `POST /agent/v1/offline`。
- `main.go` 两条退出路径都改成：`cancel()` → `shutdown()`（停终端）→ `flush()`（事件先发完，租约还在）→ `offline(reason)` → 退出；正常退出写「正常退出」，`run()` 报错路径写「异常退出」。上报失败只 `Warn`，由服务端租约超时兜底。
- `config.go` 默认 `heartbeatSeconds` 10→**5**（新生成的 `xuanagent.json` 才带上）。

### 前端 `web/src/pages/automation/AutomationWorkersPage.tsx`

- 节点列表在挂载拉取之外，加 **5 秒静默轮询**（`load(true)`，不闪加载态、不弹错误通知），在线/离线、租约、心跳列自己跟着变；详情弹窗原本就 10 秒轮询。

## 验证

- `gofmt` 无差异；`go build ./...`、`go vet ./internal/api ./cmd/xuanagent`、`go test ./internal/api` 通过。
- 前端 `npx tsc -b`、`eslint src`、`npm run build` 通过。
- mock 浏览器冒烟（临时 mock 8892 + vite 7459，用户 7458 未动）：节点「在线 · 租约有效 · 在线节点 1/1」→ 模拟接口转离线后**不点刷新**，页面自动变「离线 · 已过期 · 0/1」。轮询窗口内的 502 是重启 mock 造成的，非代码问题。临时 mock 与预览已停止删除。
- 截图工具仍不可用（`NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`），按可访问性快照核对。

## 剩余问题与下一步（交接要点）

1. **线上还没生效**：正式 8891 仍是 90 秒租约/30 秒巡检、没有 `/agent/v1/offline` 路由。要按既定流程发布后端（备份→替换→回读）与前端，**当前未获得发布授权**。
2. **worker 二进制要重编**：`server/bin/xuanagent` 是旧产物（gitignore，不在提交里），不重编就没有退出下线上报。重编与启动参数见[真实客户端专题 §11](../topics/automation-real-client.md)；由用户自行启动。
3. **本机 `bin/xuanagent.json` 仍是 `heartbeatSeconds: 10`**：10 秒心跳配 20 秒租约只容 2 拍，网络抖一下就会 401→重新注册（会自动恢复，但日志会多一条离线/上线）。建议改成 5 或删掉该键跟随后台。
4. **强杀不可能零延迟**：`kill -9`/断电走不到 offline 上报，最快 20 秒（+前端 5 秒轮询）显示离线；只有正常退出/Ctrl-C 是即时。
5. **未验证**：真实节点长跑的租约续期与断网重注册、离线 10 分钟收回账号链路、`draining/disabled` 节点在租约过期后仍显示原状态（有意保留，不并入离线）。
6. 同批次未发布的还有牌局快照（房间/观战/全桌手牌），见[牌桌交接](2026-10-28-automation-table-snapshot.md)；所有批次的未提交/未发布/未执行/待验证汇总见[剩余问题清单](2026-10-28-open-issues-backlog.md)。
