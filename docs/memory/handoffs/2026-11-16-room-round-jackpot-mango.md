# 2026-11-16 后台「房间战绩」逐局显示奖池 / 芒果 / 输赢 / 下注（已部署 8891）

- 目录/分支：`/Volumes/SSD/qing`，`codex/club-ui`（改动仅在 `XuanManager/`，不涉及客户端与服务端游戏逻辑）
- 目标：后台房间战绩的逐局列表与每局明细按客户端「牌局回顾」口径，把每一局的奖池、芒果、下注、输赢都显示出来

## 口径（重要）

数据全部来自 `kbedm.usr_round_score.remark`，该字段以 `@` 分段（下标 0 起）：

| 下标 | 内容 | 后台处理 |
| --- | --- | --- |
| 2 | `下注:x` | 按玩家 SUM 成 `totalBet` |
| 4 | `芒果:x` | 旧版记录的玩家芒果输赢，SUM 成 `mangoTotal` |
| 5 | `本局剩余芒果:x` | 已在每人卡片显示 `remainingMango` |
| 9 | 本局奖池（纯数字） | 同局全表一致，`MAX` 成 `poolScore` |
| 11 | `芒果:x`（芒池总额） | 同局一致，`MAX` 成 `mangoPool` |
| 12 | `显示分:x` | 每人 `displayScore` |
| 13 | `芒果净:x` | 新版记录（11-14 起）取代下标 4，SUM 成 `mangoNetTotal` |

实测：同一局内下标 9、11 的 distinct 值恒为 1（1758 局全表校验），所以聚合用 `MAX` 不会翻倍；下标 4 在 11-14 之后不再写入，页面用 `mangoTotal != 0 ? mangoTotal : mangoNetTotal` 兼容两版记录。

## 改动文件

| 文件 | 内容 |
| --- | --- |
| `XuanManager/server/internal/api/room_records.go` | `roomRecordRound` 新增 `poolScore/mangoTotal/mangoNetTotal/mangoPool/totalBet`；`queryRoomRecordRounds` 用 `SUBSTRING_INDEX` 从 `remark` 提取后聚合（`roomRemarkIntExpr`/`roomRemarkDecimalExpr`/`roomRemarkSegment`）；`roomRecordRoundPlayer` 新增 `mangoPool/displayScore/mangoNet` 并在 `parseRoundPlayerRemark` 解析下标 11/12/13 |
| `XuanManager/web/src/types.ts` | 对应接口类型补字段 |
| `XuanManager/web/src/pages/RoomRecordsPage.tsx` | 逐局列表由卡片行改为表格：局数/时间、本局奖池、本局芒果、本局下注、赢分、输分、差额、人数/操作、牌面；每局明细弹窗新增四张摘要卡（奖池/芒池/下注/芒果），每人卡片补「芒果净」和「奖池」 |
| `XuanManager/web/src/styles.css` | 新增 `.room-round-table*`、`.room-round-stat-card*`、`.room-round-toolbar` 标题排版；删除废弃的 `.room-round-row`/`.room-round-number`/`.room-round-stat`/`.room-round-net` 及其媒体查询 |
| `XuanManager/新后台管理系统接口文档.md` | 新增 §8.5.1 逐局奖池/芒果/下注字段与 `remark` 下标口径 |

配色沿用后台既有「绿赢红输」，0 值统一灰色；客户端「红加绿减」的约定只作用于客户端记录列表。

## 校验

- `go build ./...`、`go vet ./internal/api/`、`go test ./internal/api/ -run RoomRecord` 通过。
- `tsc -b`、`eslint src`、`vite build` 通过。
- SQL 在线上库直接执行核对：房间 140774 第 9 局 → 奖池 20、芒果净 -760（-280 + -480）、芒池 860、下注 870，与逐行 remark 手工计算一致。
- 用构建产物 CSS 做 1440/768/390 三档离屏截图，表格对齐、0 值灰、移动端横向滚动正常。

## 部署（2026-11-16 01:13 / 01:15，8891）

| 项 | 值 |
| --- | --- |
| 二进制 | sha256 `76bc54894f7dd0cf602d0d8465ad4980784eb62ca6fddf547ec303aea5be6220`，11,133,112 字节（`bin/xuanmanager.previous-roomround-20261116-0112` 为旧版备份） |
| 前端 | 第一次 `index-BevpIJBI.js` + `index-0JIJmIWM.css`；第二次（0 值配色与文案修正）`index-CFeY8ZgU.js` + `index-0JIJmIWM.css`；web 备份 `web.previous-roomround-20261116-0112`、`web.previous-roomround2-20261116-0115` |
| 迁移 | 无 |
| 自检 | health 200；`GET /api/game/room-records`、`GET /api/game/room-records/140774/rounds/9` 未登录均 401；运行中进程 sha 与构建一致 |

## 待办 / 风险

1. **登录态实操未验收**：逐局表格数值、每局弹窗摘要卡、移动端横向滚动需要后台账号实际点一遍。
2. 芒果列在 11-13 与更早的房间里显示 `mangoTotal`（旧写法），11-14 之后显示 `mangoNetTotal`，列内副标题会随之变化（「芒果合计」/「芒果净合计」），不要误判为两种口径同时存在。
3. 奖池关闭的房间逐局奖池恒为 0（灰色 `0`），属正常。
4. 代码未提交（本地 `codex/club-ui` 保持未提交修改）。
