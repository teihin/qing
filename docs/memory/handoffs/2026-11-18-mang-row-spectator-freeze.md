# 2026-11-18 观战/观众时芒果分类行与皮池行不刷新（已修，未联调）

- 目录/分支：`/Volumes/SSD/qing`，`codex/club-ui`，未提交
- 现象：坐桌打牌时 `ExShow/芒池`（圈芒/休芒/揍芒）和 `RoomFrame/底分`（皮池）正常刷新；站起围观或作为观众进房时，这两行停在上一次的值不动

## 根因

`DrhLogicMgr.IsSharedMangDisplaySource()` 把这两行绑到「唯一数据源座位」：自己座位优先，纯观众回退「数组里第一个有 strUserID 的座位」。而这两行只在收到 `当前_玩家_消息` 时才刷新（`DrhPlayerLogic.ts` 884/892/897 与 818→`UpdateDiFenShow`，闸门在 2193/3237）。只要数据源座位本手不产生这条消息，公共行就永久冻结：

- 站起围观：本手内座位仍保留、`PlayerList` 里仍算自己（`panelGameView.ts:2949`、`IsSelfActuallySeated()`），数据源锁在自己的空座位上，自己不打就没有消息。
- 纯观众：回退只是「第一个有 id 的座位」，没排除留坐（`site_countdown != "0"`）座位，选中就同样冻死。截图房间 a2/a4 都是留坐。

## 改动

`assets/scripts/logic/DrhLogicMgr.ts`

- 新增 `IsSeatInRound(player, bStrict)`：排除法判定——`strUserID` 空/`init`、`site_countdown` 非 0（留坐）、`emState` 为 init/offline/leave 都不算在局中；严格口径再把 `is_can_return == "True"`（起立围观保留的座位）排掉。
- 新增 `PickSharedMangSource(bStrict)` / `GetSharedMangDisplaySource()`：本人座位优先，其次第一个在局中的座位；先严格、挑不到再放宽，最后才退回「第一个有人的座位 / 数组首位」。
- `IsSharedMangDisplaySource()` 改用上面的结果；数据源每条消息都重算，源座位留坐/离座后自动切到下一个在局中的座位。

`assets/scripts/logic/DrhPlayerLogic.ts`

- 新增 `IsSelfSeat()`。
- `UpdateDiFenShow()`、`UpdateMangpiXiumang()` 的老协议分支（读个人 `table_times` / `mang_pi_times` / `xiu_mang_times`）加 `IsSelfSeat()` 守卫：换源后这些个人字段不能显示别人的数字；新协议字段（`mang_show_*`、`mang_pi_hand_amount`）是房间级公共值，观战/观众照常刷新。

## 验证

- `ts.transpileModule` 语法检查 0 诊断（本机无 tsc，仅语法）。
- 未执行 Creator 构建、网页版 Recompile、真机联调；观战/观众两种场景需实测。

## 待确认

服务端是否把 `当前_玩家_消息`（含 `mang_show_*`）也广播给旁观者。若观战时日志里没有这条消息，则还需服务端补广播；本机 `client_update` 无权读 `/home/release/kbe`（root 才可）。
