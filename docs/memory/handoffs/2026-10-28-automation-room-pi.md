# 2026-10-28 自动化：投放限底皮 + 三处机器人日志

## 目录与分支

- 目录：`/Volumes/SSD/qing`，分支 `codex/club-ui`。
- 工作树包含 030–035 迁移与自动化后台未提交改动；本轮只动自动化相关文件，未提交、未推送。

## 目标（用户原话）

> 投放机器人除了设置输赢之外 还需要设置 这些机器人 只进 几皮的 房间啊 投放之后 点击机器人也要支持修改 ，
> 另外worker 节点中点击某个work之后可以看到所有机器人列表， 再点进入可以看到这个机器人的日志
> 投放管理 和机器人管理 里面点击在运行的机器人也都能够看到当前机器人日志

## 改动

### 后端

- `server/migrations/035_automation_room_pi.sql`（新）：`mgr_automation_robot ADD COLUMN room_pi VARCHAR(64) NOT NULL DEFAULT ''`，
  存逗号分隔的 `底皮X/Y`，空串 = 不限。**未执行**。
- `automation_robots.go`：机器人列表/详情多返回 `roomPi`；`PUT /robots/{id}` 接收 `roomPi`
  并全量覆盖（不传即清空，所有调用方必须回传）；新增 `handleListAutomationRobotEvents`。
- `automation_ops.go`：注册 `GET /api/automation/robots/{id}/events`（`authorizedAny` robot.view / worker.view）。
- `automation_clubs.go`：`performAutomationDeploy` 新增 `roomPi` 参数，统一走 `normalizeRoomPiList` 校验后写进
  `UPDATE ... room_pi = ?`；结果消息追加「只进 … 的房间」。
- `automation_deploy.go`：投放接口请求体加 `roomPi`；俱乐部详情机器人查询带 `r.room_pi`。
- `automation_agent.go`：心跳指派的机器人项加 `roomPi`。
- `cmd/xuanagent/client.go` / `terminal.go`：解析 `roomPi`，spawn node 时写 `XUAN_ROOM_PI=`。

### 客户端

- `agent-client/client.js`：`normalizePi` 统一 `底皮X/Y` 写法；`parseRoom` 同时认 9 元数组与字典两种房间返回；
  `pickRoom` 按 `cfg.roomPi` 过滤，过滤后无房记「没有 X 的空房，稍后重试」；启动日志打印「只进 …／不限底皮」。

### 前端

- `shared.tsx`：`ROOM_PI_LEVELS`（8 档）、`roomPiText`、`RoomPiPicker`（chip 多选）、`AutomationRobotItem.roomPi`。
- `AutomationDeployPage.tsx`：投放弹窗与投放后的「配置」弹窗都能选底皮；POST 带 `roomPi`。
- `AutomationRobotModals.tsx`：机器人编辑弹窗加底皮；投放后配置弹窗提示「改完要重新拉起终端」。
- `AutomationRobotLogs.tsx`（新）：`RobotLogList` / `RobotLogModal`，5 秒轮询 `GET /robots/{id}/events`。
- `AutomationRobotsPage.tsx`：列表「只进底皮」列与详情项；点名称/「日志」开详情，运行中的机器人直接落在「运行日志」页签。
- `AutomationWorkersPage.tsx`：节点详情点终端 → 「机器人日志」页签，返回列表时清掉该页签。
- `styles.css`：底皮 chip、可点击行、机器人日志头部、行内 JSON 溢出修正；`components/ui.tsx` 的 `Field` 支持 `as="div"`
  （按钮组不能包在 `<label>` 里）。

## 验证

- 静态全过：`npx tsc -b`、`npm run lint`、`npm run build`（702.10 kB，仅 >500 kB 提示）；
  `go build ./...`、`go vet ./internal/api ./cmd/xuanagent`；`node --check agent-client/client.js`。
- mock 9911 + vite 浏览器冒烟四项通过：投放弹窗选底皮且请求体抓到 `"roomPi":"底皮5/10"`；投放详情「配置/日志」；
  机器人管理点运行中机器人直接看运行日志（空日志另有空态）；节点详情点终端 → 机器人日志 → 返回后页签消失。
  控制台只有 vite HMR 日志，无 React 错误。

## 未做 / 未验证

- **035 未执行、后端未发 8891、前端未发**（用户要求本地跑，别影响线上）。
- 真实 worker 进房与底皮过滤：只有 mock 房间列表验证过，真机未验。
- 改底皮不会重启已在跑的终端，要手动「重新拉起」才生效。

## 下一步

1. 执行 035（先备份 `mgr_automation*`）→ 发布后端 → 用真实 worker 跑「建号 → 设底皮 → 投放 → 重新拉起」。
2. 看心跳/终端日志里 `XUAN_ROOM_PI` 是否下发、客户端是否只进所选档位、无匹配房时的日志文案。
3. 前端等用户确认后再发 `/www/html/.xuanmanager/web`。
