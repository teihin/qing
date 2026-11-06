# 2026-11-06 赢家留座限时与局中预约退房

## 目录 / 分支

`/Volumes/SSD/qing`，分支 `codex/club-ui`。本次改动未提交，与同期未提交的
BOSS 玩家数据面板改动并存（同一文件 `panelGameView.ts` 各占不同段落）。

## 目标

1. 赢家点左上角菜单「留座离桌」时提示：留座限时 3 分钟，超时未回坐按逃跑结算；
   输家点留座不弹提示，直接留座。
2. 赢家、输家都能点「退出房间」：赢家先确认「赢家离开或站起将扣除 30% 盈利」，
   确认后提示「当前牌局结束后，下手将退出房间」；输家不确认，直接同一条提示。
   本手牌进行中只挂预约，等这手结算完再真正退房；不在局中则直接退。

## 改动

`assets/scripts/UI/panelGameView.ts`

- 新增字段 `pendingExitAfterRound`：局中点退出后挂起，等本手牌结束。
- `退出房间` 分支改为 `RequestExitRoom()`，删除原来「已经开局不能退出！」的拦截：
  - 不在本手牌中（`strGameState != "running"` 或自己不在座位）：走原
    `ConfirmLeaveWhileWinning`（赢家确认，输家直接退），立即 `DoExitRoom()`。
  - 本手牌中 + 赢家：双按钮确认「赢家离开或站起将扣除30%盈利，是否继续？」，
    确定才 `ScheduleExitAfterRound()`。
  - 本手牌中 + 输家：不确认，直接 `ScheduleExitAfterRound()`。
  - `ScheduleExitAfterRound()` 只置标记并提示「当前牌局结束后，下手将退出房间。」。
  - 重复点击时提示「已预约在本手牌结束后退出房间。」，不重复挂起。
- `OnPlayerListUpdatedForPreSit()` 开头调用 `CheckPendingExitAfterRound()`：
  每次 PlayerList 刷新时若已不在本手牌中，延迟 0.8 秒执行 `DoPendingExit()`；
  `DoPendingExit()` 再判一次局中状态，若下一手已经开打就重新挂起，避免打断牌局。
- `DoExitRoom()` 进入时清 `pendingExitAfterRound` 并 `unschedule(DoPendingExit)`。
- `留座离桌` 分支：局中（`IsSelfInRound()`）本手还没结算、`total_score` 里含已下注
  扣分，判不出真实输赢，统一弹「留座限时3分钟，超时未回坐将按逃跑结算；
  牌局结束后开始留坐！」；局间按 `IsSelfWinning()` 只给赢家弹，输家不弹，
  直接发 `留座_事件`。
- `IsSelfWinning()`：`total_score` 为 `0` 时也走 `begin_score`/当前分兜底
  （原来把 `"0"` 当有效值直接判负，局间刚结算到 0 的赢家会被漏判）。
- `ConfirmLeaveWhileWinning()` 文案统一为「赢家离开或站起将扣除30%盈利，是否继续？」，
  「站起围观」仍走同一确认入口。
- 判定沿用 `IsSelfWinning()`（`PlayerList.total_score` 当前盈亏 > 0，缺失时回退
  `nGoldNum - begin_score`）。「赢家」口径是累计盈亏为正，不是单局输赢。

## 服务端依赖（客户端无法自实现）

1. 赢家留座时长改为 180 秒（现为 300 秒，客户端只展示服务端下发的
   `site_countdown`，座位留坐倒计时按秒递减）。输家留座时长按产品另定。
2. 赢家留座倒计时走完仍未回坐继续，按逃跑结算（扣 30% 盈利）。
3. 局间（`GameStatus=init`）接受 `reqLeaveRoom`，预约退房才能落地。

## 验证

- `tsc -p tsconfig.json --noEmit` 过滤 `assets/scripts/UI/panelGameView.ts`
  只剩既有第 25 行 `require` 报错，无新增诊断。
- **未在 Creator 预览 / 未构建 / 未真机**。

## 未完成 / 下一步

1. 服务端三项依赖落地后，真机分别验证：赢家留座（提示 + 3 分钟倒计时 + 超时逃跑）、
   输家留座（无提示）、局中赢家/输家退出（确认差异 + 本手结束自动退）、
   局间退出（立即退）。
2. 文案里的「下手」按原文保留（方言＝下一手）；若产品要写成「下一手」需同步改
   `ScheduleExitAfterRound()`。
3. 局中点留座按「一律提示」处理（本手未结算，客户端判不出输赢）。若产品要求局中
   也严格只提示赢家，需要服务端在 `PlayerList` 提供不带下注扣分的本手实时盈亏。
4. `panelRecordInfo` 关闭退房路径（`HandleRecordInfoClose`）未接入本次确认流程。
