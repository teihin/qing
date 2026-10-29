# 留座倒计时结束后收起带入窗口

目录 `/Volumes/SSD/qing`，分支 `codex/club-ui`。未提交。

## 现象与目标

玩家带入后进入留座（`site_countdown > 0`），留座到点座位被服务端收回、人自动站起，但「带入窗口」还留在屏幕上——此时已经没座位，窗口里的确认按钮点了也没用。要求留座倒计时一结束就把窗口收掉（并且人在座外时不能再留着）。

## 改动

### `assets/scripts/logic/DrhPlayerLogic.ts` · `showLiuZuoCount()`

留座倒计时递减到 `-1` 的收尾分支里，判断 `playerPos === PlayerPos.self` **且** `info.strUserID == 自己 guuid`，`KBEngine.Event.fire("SelfSeatTimeout")`。

- 双重判断是必须的：0 号显示槽在自己没座位时会挂别人的数据，只看 `playerPos` 会把别人的留座结束当成自己的。
- 座位本身不在这里处理，仍由服务端收座后推 `PlayerList`，客户端只做 UI 同步（服务器权威）。

### `assets/scripts/UI/panelGameView.ts`

- `onLoad` 注册 `SelfSeatTimeout` → `OnSelfSeatTimeout()`。
- 新增 `CloseBuyinWindowWithoutSeat()`：`cc.isValid` 检查后关 `带入窗口`，已关则不重复操作。
- `OnPlayerListUpdatedForPreSit()`（`DrhLogicMgr` 每次处理完 `PlayerList` 都会调）在 `preSitState == "idle"` 早退**之前**加兜底：`!isSelfSeated` 就调 `CloseBuyinWindowWithoutSeat()`。这样留座到期、主动站起、被踢、被清座等任何失去座位的情况都会收窗。
- 预坐/选座流程不受影响：那两个流程的窗口是「服务端确认坐上之后才弹」的，弹出时 `isSelfSeated` 已经为真；选座中被释放座位仍走原来的 `ClearPreSitState(true)` + 「占座已超时」提示。

## 验证

- 两个文件 `ts.transpileModule` 均 0 诊断。
- **未构建、未真机验证**。待验：
  - 留座倒计时归零后是否真的立即关窗（本地倒计时比服务端早/晚一秒存在误差）；
  - 服务端在留座到期后是否推 `PlayerList` 收回座位（客户端没做主动 `起立_事件`，如果真机上人还挂在座位上，需要补一次起立兜底）。
