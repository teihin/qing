# 投放输赢目标「按周时段」交接（2026-10-29）

## 目标与结论

用户在投放机器人时要求输赢目标支持周期选项：勾选周一到周日、每天几点到几点，并确认了四条口径：
时段外先打完最后一局再让出机器人、不占 Worker；每个时段单独累计净分；每天可多段；允许跨零点（算开始那天）。

**当前状态：代码完成，构建通过；后端（含迁移 039）与前端已部署到正式 8891；页面交互与真实排空链路未实测；工作树未提交。**

## 目录 / 分支

- `/Volumes/SSD/qing`，分支 `codex/club-ui`，后端 `XuanManager/server`，前端 `XuanManager/web`，
  Worker 节点 `XuanManager/server/cmd/xuanagent`，客户端 `XuanManager/agent-client`。

## 改动文件

- 迁移 `XuanManager/server/migrations/039_automation_profit_schedule.sql`：
  `profit_schedule VARCHAR(1024)`、`schedule_window VARCHAR(24)`、`window_net BIGINT`、`schedule_state VARCHAR(16)`。
- 新增 `XuanManager/server/internal/api/automation_schedule.go`：时段校验/归一化（≤28 段、`HH:MM`、首尾不能相同）、
  跨零点与星期归属、`scheduleDeployState`、`SweepAutomationSchedules`（每 5 秒）。
- `automation_agent.go`：janitor 先 `SweepAutomationSchedules` 再 `assignWaitingRobots`；`GameSettled` 累加 `window_net`；
  指派 SQL 对 `schedule` 模式把 `window_net` 当 `todayNet` 下发。
- `automation_assign.go` / `automation_deploy.go`：三处分配/等待统计排除 `schedule_state='released'`，分配成功清空该标记；
  投放接口接受 `profitSchedule`，机器人行返回 `profitSchedule/scheduleState`，`dispatchNote` 增「不在周计划时段，已让出 Worker」。
- `automation_clubs.go`：`performAutomationDeploy` 支持 `schedule`（数值校验沿用 daily），落库四字段。
- `automation_robots.go`：机器人详情/列表返回 `profitSchedule/scheduleState/windowNet`；编辑接受 `profitSchedule`
  且计划未变时保留 `window_net`（CASE 表达式），撤回时清空周计划状态；`start` 在 `released` 时提示到点自动上机。
- `XuanManager/server/cmd/xuanagent/terminal.go`：`draining` 向客户端 stdin 写 `drain`（原来是 `stop`）。
- `XuanManager/agent-client/client.js`：`state.draining`、`drainNow()`（在局里等这一局结算后再 `shutdown`），
  control 处理 `drain`，`settleRound`/`afterSettle` 在排空时退出；`profitText()` 增加「时段」。
- 前端 `web/src/pages/automation/shared.tsx`：`ProfitScheduleEntry`、`parseProfitSchedule`、`profitScheduleText`、
  `profitScheduleError`、`ProfitScheduleFields`（周一~周日勾选 + 多段 + 跨零点「次日」标记），`ProfitTargetFields`
  增加「按周时段」选项与 `schedule` 入参，`profitModeLabels` 增加 `schedule`，`AutomationRobotItem` 补三字段。
- 前端 `AutomationDeployPage.tsx`：投放弹窗状态/校验/`profitSchedule` 载荷/摘要，机器人行显示时段摘要。
- 前端 `AutomationRobotModals.tsx`：机器人投放配置弹窗读写周时段，显示「本时段已累计 / 已让出 Worker」。
- `web/src/styles.css`：`.profit-schedule*`、`.automation-schedule-cell`。

## 验证结果

- `cd XuanManager/server && go vet ./...`、`go build ./...`：通过。
- `cd XuanManager/web`（Node 22.22.2）：`tsc -b`、`eslint src`、`vite build`：通过，产物 `index-B75dJ2zp.js` / `index-uU1NNbed.css`。
- `node --check agent-client/client.js strategy.js`：通过。
- 临时 Go 测试覆盖：周一午间命中、18:00 边界不命中、22:00–02:00 跨零点在次日 01:30 仍归属周一、
  02:00 结束、周日不误命中、周日 09:00 命中、首尾相同与空计划被拒；测试文件已删除。
- **未做**：迁移执行、部署、真实登录后的页面操作、Worker 排空全链路、服务端时间切换实测。

## 部署（2026-10-29 23:32）

- 后端：`GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w"`（9482424 字节，
  sha256 `2f15b249…`）→ 备份 `bin/xuanmanager.previous-schedule-20261029` → `stop.sh` → `install` → `start.sh`；
  `api/health` 200，新进程 31407。
- 迁移：启动后 `mgr_schema_migration` 已有 `039_automation_profit_schedule.sql`；`mgr_automation_robot`
  的 `profit_schedule/schedule_window/window_net/schedule_state` 四列已存在。
- 前端：`index-BLxZjeeW.js`（722856 B，sha256 `299535da…`）+ `index-uU1NNbed.css`（202706 B，sha256 `07507540…`），
  暂存目录校验后原子替换，回滚点 `web.previous-schedule-20261029`；线上 JS 含「按周时段」、CSS 含 `profit-schedule__day`，首页 200。
- 启动日志只有既有的「notification carousel 8890 连接失败」，与本功能无关。

## 未完成 / 下一步

1. **Worker 未更新**：本机目前没有 xuanagent 在跑；节点需重新编译并重启，`clientDir` 指向本仓库的
   `XuanManager/agent-client`，新 `client.js` 才会生效：
   `cd XuanManager/server && go build -o bin/xuanagent ./cmd/xuanagent`，然后 `cd bin && ./xuanagent`。
2. 上线后冒烟：投放一个 2 分钟后的时段 → 到点自动分配上机；时段结束先打完当前局再离房、Worker 被释放、
   列表显示「不在周计划时段，已让出 Worker」；下一个时段恢复。
3. 注意：客户端热更只对运行中的终端生效，节点上的 `client.js` 必须先替换；否则节点发 `drain` 会被旧客户端忽略。
