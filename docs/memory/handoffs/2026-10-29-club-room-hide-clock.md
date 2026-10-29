# 俱乐部房隐藏桌面「剩余时间」

目录 `/Volumes/SSD/qing`，分支 `codex/club-ui`。未提交。

## 需求

游戏内桌面中间那行「剩余时间 00:00」（`RoomFrame/info/游戏时间`）在**俱乐部模式**下隐藏，不显示倒计时。

## 判断口径

俱乐部房 = `account.roomSetting` JSON 里带非空 `club_id`（`panelMain` 进房时 `withRoomClubId(..., ResolveRoomClub())` 写入，玩家没有俱乐部时为空）。没有新增全局状态，也不用 `resolveRoomClubId` —— 那个函数在没有房间 club_id 时会回落到账号的俱乐部，会把平台房误判成俱乐部房。

## 改动：`assets/scripts/logic/DrhLogicMgr.ts`

- 新增字段 `roomClockNode`（持有 `RoomFrame/info/游戏时间` 节点引用）、`roomClockSettingRaw` / `roomClockIsClubRoom`（判定缓存）。
- `onLoad` 里保存节点引用，`roomClockLabel` 仍从它取，供刷新文本用。
- 新增 `IsRoomClockClubRoom()`：按 `roomSetting` **原文**比对，字符串变了才重新 `JSON.parse`，避免每 0.2 秒解析一次。
- `RefreshRoomCountdown()`（0.2 秒一次）开头：节点无效直接返回；俱乐部房把 `roomClockNode.active` 置 false 后返回，不刷文本也不刷新可见性。

为什么在刷新里判而不是只在 `onLoad` 判一次：`panelGameView` 是场景常驻面板，切房不会重跑 `DrhLogicMgr.onLoad`，只在 `onLoad` 判会导致「先进俱乐部房、再进平台房」时剩余时间永远不回来。按 roomSetting 原文缓存判定，切房自动跟着变。

只动这一行；实时战绩抽屉里 `title2/倒计时` 那处房间倒计时不受影响。

## 验证

- `ts.transpileModule` 0 诊断。
- **未构建、未真机**。待验：俱乐部房进入后该行是否消失、退出到平台房后是否恢复显示、房间信息面板其它行（底皮/芒果）布局有没有因为少一行而需要调整。
