# Worker 适配俱乐部模式：俱乐部硬前置 + 结算后重新带入

目录 `/Volumes/SSD/qing`，分支 `codex/club-ui`。**未提交；后端已随当日 19:07 起各轮部署上线；未连真服跑过。**

生效范围：后端（`/agent/v1/*`、`automation_agent.go` 的 `PlayerUnseated`）部署在服务器；
`agent-client/client.js` 由各 worker 节点本地运行（`clientDir` = `xuanagent` 可执行文件同目录的 `agent-client`，
见 `cmd/xuanagent/config.go` defaultClientDir），**本机节点改完即生效，别的机器上的节点要另同步该目录**。

## 用户给的两条新规则

1. **进房间必须当前自己在这个俱乐部里**，不在就进不去（服务端会拒）。
2. **俱乐部模式房间没有「结束」概念**：倒计时到了 → 所有玩家统一结算 → 桌面上的分回到身上 → **需要重新带入**才能继续下一轮。**人仍然处于留座状态**，没有离开座位，也没有离开房间。

> 第 2 条第一版理解错了，按「下桌 → 重新预坐 → 坐下」实现，后被用户纠正：不是下桌。

## 机制依据（查官方客户端确认）

`assets/scripts/UI/panelGameView.ts` 的「确认带入」按钮（897–939 行）发的是：

```
坐下_事件 {money, ready:1, type:"直接"|"申请", club_id}   // 不带 site
```

注释原文：「预坐后确认带入，或者已经正式坐下后的普通补分，都不再传 site」。
即**重新带入 = 再发一次 `坐下_事件`**，不是预坐、不是重坐。`site` 只在 `预坐_事件` 里用。

留座状态由 `PlayerList` 每行的 `site_countdown` 表示（`DrhLogicMgr` 读取，非 `0` 即留座中）；
留座倒计时走完，服务端才真正收座（见同日 `2026-10-29-seat-timeout-close-buyin.md`）。

更权威的入口是服务端提示：`panelGameView.onPromptInfo2`（注册在 `PromptInfo2` 事件上）在 `word` 含「已结算」时，
`context=="补分"|"弹窗"` 就等价于点「补充钵钵」按钮 → `checkBuMang("补分")` → `玩家_补芒_查询 {context:"补分"}`，
同时把提示文字弹给玩家。自动化按这条走，不再靠 `is_exit` 自己推断。

## 结论先说：原实现两条都不成立

- `requestJoinClub` 三次没等到 `club_join` 变化时设 `skipJoinCheck` 硬进房，等于绕过俱乐部前置。
- 下桌/结算后没有任何「重新带入」动作：`结算_结束_消息` 带 `is_exit=True` 只打了一行 warn。
  即便走座位表分支，`state.seated` 从不复位，`sendSit` 的守卫永远命中，机器人只会预坐、永远坐不下。

## 改动

### `XuanManager/agent-client/client.js`

**俱乐部硬前置**

- 删除 `skipJoinCheck`：三次入会未生效 → 不进房，`emit Waiting` + 30 秒后重试。
- `enterRoom()` 开头二次校验 `clubJoined(account)`，不在俱乐部就回入会流程。
- `onEnterRoom` 返回 `0x311`（不属于该俱乐部）→ 标记未入会 + 重新入会，不再换房重试。

**一轮结束后去哪：离房换桌 + 超目标可留房连输 2 次**

用户确认的完整规则：

1. **每次结算后默认离房换桌**（房间不结束，人走就行）。
2. 离房后**优先找其他房间**；刚离开的房在 `XUAN_ROOM_AVOID_MS`（默认 10 分钟）内不再进；
   这期间没别的房就一直等（`requestRooms` 15 秒一轮），**10 分钟后避让自动过期，允许回原房**。
3. **例外**：结算时累计净分**已超目标**（`profitIntent` 判定为 `lose`）→ **不用离房**，留在原房重新带入继续输，
   **最多连续 2 次**（`XUAN_STAY_BUYIN_TIMES`），用完才离房换桌；换到新房间后计数清零。
4. 阀值口径不变：低于目标 → 允许赢（`win`/常规），超过目标 → 本轮该输（`lose`）。

实现：

- `afterSettle(reason)`：结算后的唯一入口，5 秒内去重（`is_exit` 与 `PromptInfo` 两个信号只处理一次）。
  先 `strategy.profitIntent(...)` 判 `lose` 且 `stayBuyinCount < stayBuyinTimes` → 原房 `tryBuyin()`；
  否则 `leaveAfterSettle()`。
- `leaveAfterSettle()`：把当前房放进 `avoidRooms`（roomId → 到期时间），`leaveRoom()`，1.5 秒后 `requestRooms`。
- `pickRoom()` 跳过 `isRoomAvoided()` 的房；全被跳过时 `emit Waiting`「本轮结束，换房」，等下一轮查询。
- `tryBuyin()`：人还在座位上，直接发 `坐下_事件 {money, ready:1, type:'直接', club_id}`（不带 site），
  8 秒节流；余额不足停 30 秒并报 `Waiting`。
- 触发信号：`PromptInfo` / `PromptInfo2` 里 `word` 含「已结算」（游戏内 `onPromptInfo2` 收到它才会去补分，
  是权威信号），走 `afterSettle('prompt-settled')`；`结算_结束_消息(is_exit=True)` 3 秒后兜底调一次。
  `context=="回坐"` 仍照游戏发 `回座_事件`；「带入金币不足」只记日志上报。
- `enterRoom()` 清零 `stayBuyinCount / needBuyin / settleHandledAt`。
- 新环境变量：`XUAN_ROOM_AVOID_MS`（默认 600000，最小 60000）、`XUAN_STAY_BUYIN_TIMES`（默认 2）。

**真正的丢座（留座到期被收座 / 被清座）才重新占座**

- `resetSeat(reason)`：清座位与局内状态、`emit PlayerUnseated` + `Waiting`、排一次 `tryTakeSeat`。
- `tryTakeSeat()`：主动找空座发 `预坐_事件`，不依赖下一次座位表广播；预坐请求在途 5 秒内不重发；
  预坐成功但没坐进去时借机重试 `sendSit`。
- `sendSit` 去掉 `state.seated` 守卫（预坐占座成功时 `seated` 已为真，原来会把自己拦死），只认 `sitSent` 和座位号。

**进房后等位而非反复进出**

- 新增 `state.enterOk`（`onEnterRoom` 成功才置真）。12 秒检查改成 `checkSeated()` 递归：
  已进房但没座 → 原地等（12 秒一轮，最多 15 轮 ≈ 3 分钟），超过才换房；没进房才离房重找。

**其他修掉的问题**

- `持有_手牌_消息` / `一张_活牌_消息` 不再强制 `Array.isArray`，统一走 `cardList`，字符串格式不再静默丢手牌。
- `结算_信息_消息` 先 `trackRound(room_round, true)` 再结算，避免被上一局的去重挡掉而丢分；
  `结算_结束_消息` 的 `trackRound` 同样 silent，后台不再出现「结算 → 开始」倒序。
- `parseRoom` 满员判定改用座位数 `player_list.length`，`player_and_watcher_count`（含观战）只兜底。
- `freeSeat` 在服务端不下发 `id=init` 占位行时，按「房间上限内未被占用的最小座号」兜底。
- `special_rule` 从写死 `'观战'` 改成 `XUAN_ENTER_RULE`（默认仍是观战）。
- 新环境变量：`XUAN_ENTER_RULE`（默认 `观战`）、`XUAN_REINSTATE_DELAY_MS`（默认 3000，最小 1000）。

### `XuanManager/server/internal/api/automation_agent.go`

- 事件白名单加 `PlayerUnseated`。
- 状态处理 `PlayerUnseated` → `status='idle'`、`seat_no=0`，**保留 room_id**（人还在房里）。

### `XuanManager/server/cmd/xuanagent/terminal.go`

- `forwardRealEvent` 收到 `PlayerUnseated` 只清 `seatNo`，不动 `roomID`。

### `XuanManager/server/bin/xuanagent`

- 已重编（`go build -trimpath -o bin/xuanagent ./cmd/xuanagent`，8.2M）。`bin/` 不在 git 跟踪内。

## 已核对、确认**不改**的

- `captureId` 每条 `决策_信息_消息` 自增：与官方客户端 `DrhPlayerLogic.nCaptureID`（初始 100、self 时 ++）完全一致，不是 bug。
- `pause` 只离桌不断连：账号仍在大厅，要彻底下线必须 `stop`。既有设计，仅记录。
- GPS 上报成都随机坐标，但连接 IP 是本机真实公网 IP，后台 IP/GPS 会互相矛盾——代码没动，属部署侧待决。

## 验证

- `node --check client.js`、`node --check strategy.js` 通过。
- `gofmt -l` 无输出；`go build ./...`、`go vet ./internal/api ./cmd/xuanagent`、`go test ./internal/api`（ok 2.35s）通过。
- 离线冒烟（假 `kbengine.js` + 假 account，`/tmp` 临时脚本，跑完已删）：
  1. **未超目标 → 离房换桌 + 避让**：结算 `is_exit` → 3 秒后 `afterSettle` 判 `neutral` → `leaveRoom` +
     把 7001 放进避让；随后同一份房间列表到达两次，`pickRoom` 全被避让过滤，`reqEnterRoom` 仍只 1 次。
     日志：`本轮结束，离房换桌（距目标还差 1100…）`、`本轮结束，离开房间 7001（10 分钟内不再进）`。**PASS**
  2. **超目标 → 原房连输 2 次再离房**：`net=3000 / target=1000`，三次结算依次得到
     `原房继续带入来输（1/2）` → `（2/2）` → `已超目标且原房带入次数用完，离房换桌`；
     带入共 3 次（首次 + 原房 2 次）、`reqLeaveRoom` 1 次；两局开局日志均为「争取输」。**PASS**
  3. **留座到期丢座**：`PlayerList` 不含自己 → `PlayerUnseated` 1 次 → 重新预坐 + 再次带入。**PASS**
  4. **俱乐部前置**：`club_join` 为空时收到房间列表 → 只发 `p@club:join`，`reqEnterRoom` 0 次。**PASS**

## 未验证 / 下一步

- **「已结算」提示与 `is_exit` 谁先到、是否会重复**：现在 5 秒内只处理一次，且两条信号都会走 `afterSettle`。
  实跑要确认：提示到达时 `is_exit` 是否已经来过（否则 3 秒兜底会和提示撞车，虽有去重但可能抢在前头判错）。
- **留房重新带入是否被服务端接受**：人还在座位上直接发 `坐下_事件`（不带 site），这一步是照官方「确认带入」
  按钮写的，但机器人没有 UI 状态，服务端是否因为「已结算」拒绝第二次带入，需要真机验证。
- **避让 10 分钟是否够**：现在是离开后 10 分钟内不进；如果俱乐部房很少，机器人可能长时间空转等房。
  `XUAN_ROOM_AVOID_MS` 可调。
- 带入金额目前固定 `最小带入 × buyinMultiple`（受余额限制）。如果运营希望「按上轮带入金额补」，
  `state.selfBeginScore` 已经存了上次的带入值，可直接用。
- **远程节点同步**：`agent-client/` 不在部署包里，远端 worker 节点要手动拷贝一份（本机节点已是最新的）。
- 未连真服跑过；`XUAN_REINSTATE_DELAY_MS`、8 秒带入节流、3 秒兜底都是保守值，实跑后可调。
