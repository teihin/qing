# 2026-10-28 自动化：机器人当前牌局（房间/观战/全桌手牌）

## 目录与分支

- 目录：`/Volumes/SSD/qing`，分支 `codex/club-ui`。
- 只改自动化链路；**未提交、未推送、未发布**，未执行任何迁移（本功能无需新迁移）。

## 目标（用户原话）

> 点击进去进入每一个机器人，能看到机器人当前的牌局 包括自己的牌和其他人所有的手牌。
>
> 如果机器人在房间内，需要展示当前房间的情况，有哪些人有哪些人在观战 如果在游戏中还要展示其他人的手牌。

## 改动

### 客户端（`XuanManager/agent-client/client.js`）

**手牌**

- 新增 `players/tableSeats/tableSettleRound/tableInfoRound` 状态；`cardList()` 容错解析 `take_pai`（数组 `[t,n]`、字符串、对象、Python 风格串），丢弃 `[0,0]` 占位。
- `查询_房间_游戏_信息` → `RoomGameInfo.take_pai` 是整桌 4 张手牌（含已扯出），配合 `ched_pai/is_zhuang/is_action/round_score/total_score/bei_shu` 组装 `seats`；**未使用付费的 `玩家_翻所有人牌_命令`**。
- 触发：发牌（`持有_手牌_消息`，`now_pai` 为本人真牌）与结算各查一次，每局最多一次；4 秒无响应发 `own-hand` 快照；权限错误置 `roomInfoDenied`，本局不再重试并附原因。
- 发牌时会先清 `tableSeats`，避免新一局短暂显示上一局的对手手牌。

**房间与观战**

- `roomMetaOf(room)` 在 `enterRoom` 保存房号/房名/底皮/座位上限/玩法/最低带入/单局分钟（解析 `special_rule` 里的「N分钟」）；`roomSnapshot()` 把元信息与实时在座人数、观战人数/名单合成 `room` 字段。
- 在座名单与房间状态以 `PlayerList` 为准（`GameStatus` running/end、`round_count`、每位玩家 `gold/status`）；`seatsCurrent()` 用 PlayerList 的在座列表叠加最近一次 `RoomGameInfo` 的手牌与战绩，保证有人进出座时快照跟着变。
- 观战：`reqAccountCommand({header:'获取_游戏内旁观_信息_命令'}, 'P@获取_游戏内旁观_信息_命令')`，新增 `case 'GameWatcherListInfo'` 解析 `{GameWatcherListInfo:[{id,name,photo}], count, number}`，最多留 50 人；`onAccountCommand` 里失败码非 `0x200/512` 时置 `spectatorDenied` 并写 warn 日志。请求 10 秒节流。
- 刷新：`PlayerList`、`GameWatcherListInfo` 到达即重发；无事件时 `scheduleRoomPoll()` 每 20 秒补发（`roomPollSeq` 令牌，换房后旧轮询链自行退出）。
- `emitTableState()` 发 `TableState` 事件（`phase/source/ownSeat/room/seats/nextOrderCount`），按 `phase+room+seats` 去重，轮询内容不变不落库；`terminalLog` 同步写「牌桌快照：第 N 局，X 人，Y 人手牌可见」。
- `resetTable()` 在进房/离房/房间解散时清空在座、手牌与观战名单，并发空 `seats` 快照，防止显示上一桌残留。
- 展示状态 `tableSeats` 与策略用 `state.table` 分开；**策略仍不读对手牌**。

### 后端（`XuanManager/server/internal/api/`）

- `automation_agent.go`：事件白名单加 `TableState`。
- `automation_workers.go`：`handleGetAutomationRobotTable` 取该机器人最新一条 `TableState` 事件，返回 `{table, receivedAt}`；无记录返回 `table: null`；先校验机器人存在与俱乐部可见范围。
- `automation_ops.go`：注册 `GET /api/automation/robots/{id}/table`，权限 `automation.robot.view` 或 `automation.worker.view`。

### 前端（`XuanManager/web/src/pages/automation/`）

- `AutomationRobotTable.tsx`（新）：`RobotTablePanel` 每 5 秒静默轮询快照；标题行显示阶段、房间号/房名/底皮、在座/座位上限、观战人数、局数与下一局张数；观战条列出观战者名字（无名单时显示「观战名单未下发」/「暂无观战」）；按座位渲染手牌（♦♣♥♠/大小王，红黑分色）、已扯牌、庄/行动中/自己标签、本局/累计/下注/倍和余额。
- `AutomationRobotsPage.tsx`：点开机器人**默认进「牌局」页签**；运行中行的按钮文案为「牌局」；新增 table 页签。
- `AutomationRobotModals.tsx`：投放配置弹窗加「牌局」页签，与配置/日志并列。
- `shared.tsx`：事件类型加 `TableState`（牌桌快照）；`styles.css` 加牌桌/观战条样式与 760px 以下单列布局。

## 验证

- `node --check client.js` 通过；`cardList` 对 6 种输入格式的 Node 内联测试通过。
- `cd XuanManager/server && go build ./...`、`go vet ./internal/api`、`go test ./internal/api` 通过；`gofmt` 无差异。
- `cd XuanManager/web && npx tsc -b`、`eslint src`、`npm run build` 通过（含本轮房间/观战改动）。
- mock 浏览器冒烟：标题显示「对局中 · 房间 420121 · 演示桌 · 底皮1/3 · 4/8 人在座 · 3 人观战 · 第 8 局」，观战条列出三位观战者，四座显示全手牌、已扯牌与余额；`own-hand` 回退分支显示说明与「手牌未下发」；无 console 报错。截图工具不可用（NATIVE_BROWSER_VIEWPORT_UNAVAILABLE），只做了结构快照核对。
- 临时 mock 与 7459 预览已停止并删除（用户 7458 开发服务未动）；**worker 未启动**。

## 未验证

- 真实牌局里 `查询_房间_游戏_信息` 是否允许机器人账号查询、`take_pai` 是否始终回全桌真实手牌，只在协议与老客户端代码层面确认。
- `获取_游戏内旁观_信息_命令` 是否对机器人账号开放、`GameWatcherListInfo` 回包字段是否与面板一致；未开通时只靠 `spectatorDenied` 降级。
- 观战者进出的实时性依赖 20 秒轮询，未验证观战频繁变动时的延迟体感。
- 结算时点查询能否稳定拿到本局结果、4 秒超时是否够用（网络差时可能多发一次 `own-hand`）。
- 现有线上后端/前端未包含本功能；需重新发布后才可见。

## 下一步

1. 用真实 worker 坐一桌，核对后台牌局页手牌与游戏内是否一致、牌局切换后是否清空。
2. 让一个账号观战，确认观战人数与名单能出现；再确认账号未开权限时的降级文案。
3. 观察日志里「牌桌快照」出现时机，确认同局不重复查询、结算快照带正确 phase、轮询未刷爆事件表。
4. 确认无误后再按既定流程发布后端与前端。
