# 2026-10-28 自动化：净分区间控制 + GPS/IP + 策略移植 + 终端日志

## 目录与分支

- 目录：`/Volumes/SSD/qing`，分支 `codex/club-ui`。
- 工作树含 030–037 迁移与自动化后台全部未提交改动；本轮只动自动化链路，**未提交、未推送、未发布**。

## 目标（用户原话）

> 机器人投放的输赢指的是 时间范围内的总输赢，如果上一局 超过了阈值 后面的局都需要输来降低 或者要求赢 但是上一局输了 下一局就要开始赢 一次类推。输赢控制在范围内就行。
> 另外 worker中执行的机器人 也需要和真机一样 上报GPS 和IP 啊 参考 之前给你的 老版自动化代码 自动化程序需要模拟真实客户端 实现一样的效果。
> 游戏内打牌过程中的 出牌策略 操作策略目前都依照 给你的老版本自动化代码进行参考实现。注意写好日志 方便调试。

## 改动

### 后端

- `server/migrations/036_automation_robot_identity.sql`（新）：`mgr_automation_robot` 加 `gps VARCHAR(64)`、`public_ip VARCHAR(64)`、`ip_seen_at DATETIME`。**未执行**。
- `server/migrations/037_automation_robot_net_period.sql`（新）：加 `today_net_date DATE`、`period_net_start DATE`。**未执行**。
- `automation_agent.go`：
  - 心跳写 `public_ip/ip_seen_at`（`clientIP(r)`，同 IP 只在变化或首见时更新）。
  - `resetRobotNetPeriods()` 在查指派前懒重置：跨天清 `today_net/today_rounds`，`period_start` 变化清 `period_net`；首次只补日期不清零。
  - 指派项新增 `gps/profitMode/profitTarget/periodStart/periodEnd/todayNet/periodNet`，策略来自机器人或分组的 `COALESCE`；空 GPS 随机生成并回填。
  - 事件白名单加 `TerminalLog`；`GameSettled` 按 delta 累加 `today_net/period_net/balance`。
- `automation_robots.go`：列表/详情多返回 `gps/publicIp/ipSeenAt`；建号/编辑读写 `gps`（编辑不传则保留原值）。

### 客户端（`XuanManager/agent-client/`）

- `strategy.js`（新）：老客户端策略移植——
  - `THRESHOLDS`（1P/2P/5P）、`roomTypeOf`、`parseRole`（含 `敲牌`/`看牌`/`搓牌`）、`bestSplit`/`handIsBig`/`chooseSplit`。
  - `profitIntent`（目标/死区/周期窗口）、`planRound`（争赢降级）、`decide`（争赢/争输/常规分支）、`shouldAddMore`、`protectBigHand`。
- `client.js`：
  - 净分：`netBase()` 取服务端基线 + `state.netPending` 累计未入账差值；配置热更新时清零 pending。
  - GPS：`randomGps/currentGps/reportGps`，登录后 1.5s 首报、每 60s 重报；`console.log/info` 改道到 debug。
  - 牌桌数据：解析 `role/gen_score/money_score/table_times|all_bei_shu/bei_shu_unit/now_pai/now_pai_count/一张_活牌`。
  - 出牌：`planCurrentRound` 开局定意图与加注；`scheduleAction` 延迟 1.2–2.5s 后 `strategy.decide` → `adjustAction` → `submitAction`；手牌不足 4 张的扯牌直接跳过。
  - 日志：`terminalLog()` 写 node 日志并发 `TerminalLog` 事件，同一句 3 秒去重；覆盖开局/出牌/结算/配置/GPS。
  - `applyConfig` 处理 stdin `{"cmd":"config"}`：GPS、模式、目标、净分基线、周期窗口热更新，不重启终端。

### 前端

- `shared.tsx`：`AutomationRobotItem` 加 `gps/publicIp/ipSeenAt`；事件类型加 `TerminalLog`（终端日志）。
- `AutomationRobotsPage.tsx`：详情总览显示「上报 GPS / 公网 IP / 登记出口 IP」。
- 运行日志沿用 `RobotLogList`，`workerEventSummary` 已能展示 `message/reason/delta`。

## 验证

- `node --check client.js && node --check strategy.js` 通过；策略内联冒烟符合预期（如 41:23 → 丁皇 21 分、天对 20；争赢给大 10；无加注档位改敲；4 张争输休；无加注便宜/贵牌分别丢）。
- `cd XuanManager/server && go build ./... && go vet ./...` 通过；`go test ./internal/api/` ok。
- `cd XuanManager/web && npx tsc -b`、`npm run lint`、`npm run build` 通过（702.54 kB，仅体积提示）。
- **未启动 worker**（用户自行启动）、未真实开局、未执行 036/037、未发布后端/前端。

## 未做 / 未验证

- 036/037 未在任何库执行；后端与前端改动未上 8891。
- 净分控制只在本地推算：真实对局里服务端结算与心跳回传的时序、`netPending` 是否会重复计算、长时间运行是否漂移都未验证。
- 策略阈值/分支只做固定输入冒烟；真实牌局中的角色串、扯牌 4 张、加注档位仍需比对老客户端日志。
- GPS 是否被服务端强校验（坐下前的 `CheckCanSitByGps`）未验证；同 IP 限制 0x306 未验证。
- 未做「开局 ≥14 分直接敲」；配牌仍为可选且 Go 未下发；`state.table` 为空导致 `chooseSplit` 的对手比较分支不生效。

## 下一步

1. 备份 `mgr_automation*` 后执行 036/037，再发布后端；前端发 `/www/html/.xuanmanager/web`。
2. 用真实 worker 跑一桌：看机器人详情 GPS 是否与库里一致、公网 IP 是否随心跳出现；后台日志里确认「终端日志」有开局/出牌/结算三行。
3. 观察 30～50 局净分是否围绕目标收敛；对照老客户端日志核对争赢/争输分支与加注时机，再调阈值。
