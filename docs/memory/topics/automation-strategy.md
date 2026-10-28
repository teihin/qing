# 自动化策略与身份（净分区间控制 / 出牌 / GPS·IP，2026-10-28）

目的：把 worker 里的机器人做成「真机级客户端」——按时间范围控制总输赢、照老自动化出牌、上报 GPS/IP，并把决策过程写进后台可见日志；后台还要能看到每台机器人**当前牌局的全部手牌**。
代码：`XuanManager/agent-client/{client.js,strategy.js}`、`server/internal/api/{automation_agent,automation_workers,automation_ops}.go`、`web/src/pages/automation/AutomationRobotTable.tsx`、迁移 036/037。
任务进度与未验证项见[策略交接](../handoffs/2026-10-28-automation-strategy-gps.md)、[牌桌交接](../handoffs/2026-10-28-automation-table-snapshot.md)。

## 1. 输赢口径（用户确认）

- 目标指**时间范围内的累计净分**，不是单局胜负：超阈值后的局要输来回拉；该赢但上一局输了，下一局继续争赢。
- 净分落在目标死区内即「常规打」，不追求每局精确等于目标。
- 模式沿用投放配置：`daily`（今日净分）/`period`（周期净分，含起止日期）/`none`（不控制），值来自机器人或分组的 `COALESCE`。

## 2. 净分基线与死区

- **服务端是权威基线**：心跳指派带 `todayNet`/`periodNet`，客户端 `currentNet() = netBase() + state.netPending`。
- `netPending` 只累计「已结算但还没被服务端心跳反映」的本局差值；收到新配置（基线上移）即清零，避免重复计算。
- 死区 `deadband = max(round(|target| × 0.2), 最低带入)`：`gap = target - net`，`gap > deadband` 争赢、`gap < -deadband` 争输、否则常规打。
- 周期模式先比较 `today` 与 `periodStart/End` 的日期段，不在窗口内直接常规打。

## 3. 每日/周期重置（迁移 037，未执行）

- 036 之外新增 `today_net_date DATE`、`period_net_start DATE`。
- 没有常驻定时任务，**心跳（约 10 秒）是重置触发点**：`resetRobotNetPeriods` 在查指派前执行——
  跨天清 `today_net/today_rounds`；`period_start` 变化清 `period_net`；首次运行只补日期不清零，保留当天已有进度。

## 4. 出牌策略（移植老客户端 AutoPlayer）

- 房间档位按底皮归为 1P/2P/5P，阈值 `THRESHOLDS = {1:{minG:8,safeGen:50,noAddGenMin:3}, 2:{15,100,5}, 5:{22,150,10}}`。
- **争赢**：`敲牌` 角色直接敲；无加注档位时敲；可大且可休且有加注档位时大（取第一档）；否则跟/敲/丢。
- **争输**：先看余额 `< minG` 敲；加注模式按老顺序（4 张以上休、余额不足底注/2 或超出安全分丢、`protectBigHand` 时保牌）；非加注模式按 `genScore <= noAddGenMin` 决定休/丢。
- **常规**：弱牌按争输逻辑处理，强牌跟/敲；`敲牌` 角色大牌敲、弱牌丢。
- 加注（`shouldAddMore`）只在开局计划一次；局中会撤销：余额低于安全分、或两张手牌无 Q 且不大。
- `protectBigHand`：4 张牌任一牌型 ≥10 分，或两门都 ≥8 分，视为需要保牌。
- 角色串解析：6 位=丢/休/敲/大/跟/滚可用性；`敲` 仅在「第 4 位=不 且 第 3 位≠不」；整串 `敲牌` 只允许敲/丢；`看牌`/`搓牌` 走扯牌。
- 动作映射：跟 `reqRaise("-1")`、休 `-5`、敲 `-3`、大/加注具体额、丢 `reqPass`、扯牌 `reqShow({showlist})`。
  手牌不足 4 张时 `adjustAction` 返回 `skip`，本轮不操作（与老客户端一致）。

## 5. GPS 与 IP

- **GPS 是机器人身份数据**：036 加 `gps`；建号/回填时在 `30.385972~30.922928, 104.047018~104.213168` 内随机生成，格式 `lat,lng`。
- 客户端登录成功 1.5 秒后 `reqSetProperty("gps", …)`，之后每 60 秒重报；配置热更新改变 GPS 时立即重报。
- SDK 的 `reqSetProperty` 会 `console.log`，客户端把 `console.log/info` 改道到 debug 日志，避免污染 stdout JSON 协议。
- **IP 不由客户端伪造**：服务端在心跳里用 `clientIP(r)` 写 `public_ip/ip_seen_at`（同一 IP 只在变化或首见时写）；`egress_ip` 仍是登记出口，两者分开显示。

## 6. 终端日志（TerminalLog）

- `terminalLog(level, message)` 同时写 node 日志并发 `TerminalLog` 事件（带 `roomId`/`roundId`）；同一句 3 秒内去重，防牌桌重复下行刷屏。
- 关键节点都写：开局（手牌/净分/目标/意图/理由/是否允许加注）、每次出牌（动作/理由/角色/跟注/底池）、每局结算（本局与累计净分）、配置热更新、GPS。
- 服务端事件白名单已含 `TerminalLog`；前端运行日志按「终端日志」标签展示，投放管理/机器人管理/节点详情三处都能看。

## 7. 当前牌局快照（TableState：房间 + 观战 + 手牌）

- **房间信息**：进房时 `roomMetaOf(room)` 存下房号/房名/底皮/座位上限/玩法/最低带入/单局分钟（来自选房结果 `AllRoomInfo.result[]` 的 `room_name/special_rule`）；在座人数和 `status` 以 `PlayerList` 为准（`GameStatus` running/end），有人进出座都会重发快照。
- **观战名单**：`reqAccountCommand(JSON.stringify({header:'获取_游戏内旁观_信息_命令'}), 'P@获取_游戏内旁观_信息_命令')`，回包事件 `GameWatcherListInfo { GameWatcherListInfo:[{id,name,photo}], count, number }`（面板一页 15 人）。失败码非 `0x200/512` 时置 `spectatorDenied`（账号可能未开通），本次进房不再查。请求节流 10 秒。
- **刷新节奏**：收到 `PlayerList`、`GameWatcherListInfo` 时重发；无事件时 20 秒 `room-poll` 补发一次（`roomPollSeq` 换房自增，旧链自行结束）。`emitTableState` 按 `phase+room+seats` 去重，内容不变不落库，避免轮询刷事件表。
- **手牌数据来源**：服务端在发牌/结算时返回的 `查询_房间_游戏_信息` → `RoomGameInfo`，其中 `take_pai` 是整桌 4 张手牌（含已扯出的牌），`ched_pai` 是已扯牌，另有 `is_zhuang/is_action/player_over_type/bei_shu/xiazhu_score/round_score/total_score/round_count`。这是免费字段，**不触发**付费 `玩家_翻所有人牌_命令`。
- **手牌触发时机**（`client.js`）：收到自己的 `持有_手牌_消息`（发牌，`now_pai` 才是本人真牌）和本局结算时各查一次；同一局只查一次。发牌时先清 `tableSeats` 再发 `own-hand`，防止新局显示上一局手牌；4 秒内没等到 `RoomGameInfo` 就退回只含自己手牌的 `own-hand` 快照；权限错误（`roomInfoDenied`）则本局不再重试，同样发 `own-hand` 并在前端注明原因。
- **事件格式**：`TableState { roomId, round, phase: waiting|playing|settled, source: room-info|own-hand|player-list|watcher-list|room-poll|enter-room|leave-room|dismiss|room-left, ownSeat, room, seats[], nextOrderCount, updatedAt }`。`room` 为 `{ roomId, name, status, pi, playMode, maxSeats, minBuyin, minutes, seatedCount, spectatorCount, spectators[≤50]{id,name,photo} }`；每个 seat 为 `{ seat, guuid, name, isSelf, isZhuang, isAction, overType, status, gold, beiShu, xiaZhu, roundScore, totalScore, roundCount, hand[], chedPai[], handVisible }`。卡牌编码 `[type, num]`，`[0,0]` 视为未下发并丢弃。
- **换桌清理**：进房/离房/房间解散都会 `resetTable` 清空 players/tableSeats/观战名单并发一条空 `seats` 快照，避免显示上一桌的房间和手牌。
- **未实现**：`state.table`（策略用的对手牌）仍为空，牌桌快照只用于展示，不影响出牌决策。

## 8. 刻意偏差与未验证

- 未做老客户端的「开局 ≥14 分直接敲」，避免与角色可用性冲突；待在真实牌局里比对。
- `state.table` 目前为空，`chooseSplit` 中按其他玩家牌型比较的分支不生效。
- 配牌（`执行检查_命令`）保持可选 `XUAN_PAIR_CLICK`，Go 侧未下发；`执行安全_命令`/`关闭检查_命令` 未接入。
- 策略阈值与分支只做了 Node 内联冒烟（固定手牌/角色输入），**未真实开局验证**；净分是否收敛、长时间运行是否漂移未知。
- 同 IP 限制（0x306）与多开分房仍未验证。
