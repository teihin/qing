# 2026-11-08 客户端交互与安卓键盘修复（批次归档）

> 从 `docs/memory/CURRENT.md` 归档（2026-11-10，为控制入口文档体积）。逐条交接见各条链接。

## 我的红利明细：玩家列改取 player、类型列改显房间号（未构建、未真机）

- 玩家列原取 `row.name || row.guuid`，那是分成接收者（群主自己）；改为 `row.player || row.name || row.guuid`，无 `player` 时兜底旧字段。
- 「类型」列去掉，改显「房间号」= `row.room_id`；表头文字烤在 `assets/V7/money_v8_table_my_hongli.png`，已原位替换字形，尺寸/alpha/`.meta` 未变并重新导入；Prefab 隐藏 Label 文案同步改「房间号」，行内节点名未动。

## 安卓键盘：贴键盘上沿 + 点上半屏收起（真机已验证）

- 根因：`Cocos2dxEditBox.addItems` 把带 `ALIGN_PARENT_BOTTOM` 的 `RelativeLayout.LayoutParams` 加进 `FrameLayout`，规则被 `generateLayoutParams` 吞掉，容器钉在窗口左上角——写的 `topMargin` 一直是「距屏幕顶」，只能靠倍数凑。
- 修法：容器改 `FrameLayout.LayoutParams` + `gravity=BOTTOM`，位置改 `bottomMargin = 键盘高度`（`Type.ime()` → `getSystemWindowInsetBottom()` → 可见区差值回退），每次变化重算；删 `setFitsSystemWindows(true)`。
- 另恢复官方语义：点上半屏 `complete()` 收起键盘（2026-07-23 把 `Cocos2dxGLSurfaceView` 里那行注释掉了，才只能点「完成」）。
- 两个引擎文件都在 Creator 安装目录、重装会被覆盖：`tools/apply_editbox_ime_patch.py`（幂等 + 备份）。**Java 改动热更下发不了，必须重新出 APK。**
- 小米 9 SE（A11）、MIX 4（A14）真机通过；其余机型与 iOS 未验。详见[交接](../../handoffs/2026-11-08-editbox-ime-position.md)。

## 数据统计列表：无俱乐部玩家隐藏「查看 / 代理链」（未构建、待真机）

- 现象：玩家列表点 q1（166258）的「查看」服务端查不到人。根因 `BindListRowButtons` 用 `clubId || this.userClubId || this.roomClubId` 兜底，把 boss 自己俱乐部 ID 当成别人的俱乐部。
- 改为 `hasClub = id !== "" && clubId !== ""`，没有俱乐部就隐藏「查看」「代理链」；「战绩」走只认 user_id 的接口保留。只改 `panelBossPlayerInfo.ts`，构建/真机待验。

## 玩家信息弹窗 / 牌桌「联系上级」/ 局内消息提醒（未构建、未真机）

- 成员设置弹窗 BOSS 可见「当前IP / 最后登录」两行，仅 `IsBossAccount()` 发 `查询_玩家_扩展_信息`（context `playerext:`），失败或 8s 显示「—」；大厅那份卡片有意不发。接口已上传测试服但**待重启 baseapp**，Web 端 IP 会是 `127.0.0.1`。详见[交接](../../handoffs/2026-11-08-player-info-ext-ip-lastlogin.md)。
- `ConfigMain/联系客服` → `联系上级`（Scene/prefab 同名改），`ingame_menu_v8_service.png` 只重绘文字带、`.meta` 未变。
- 局内提醒根因：进桌销毁 `panelMain` 导致直聊监听注销；牌桌自挂 `SetupDirectChatNotice`，播 `eff/申请提示` 并驱动两处红点。定向 tsc 0 诊断、Creator 已导入。详见[交接](../../handoffs/2026-11-08-ingame-message-notice-and-contact-superior.md)。

## 退出房间：局中不再误退（未构建、未真机）

- 现象：局中点「退出房间」有时直接退、随后被拉回。根因是 `IsSelfInRound()` 用 `indexOf("结算")` 判本手结束，而 `等待_结算_状态`/`旁家_等待_结算_状态` 也含「结算」，弃牌等结算的玩家被当成已结算，退房协议被服务端拒绝后送回牌桌。
- 修法：新增 `IsSelfRoundSettled()`（含「等待」一律算本手未结束；另认 `DrhLogicMgr.bRoundSettled`——比牌开始置 true，`StartGame`/`round_count` 递增置 false，覆盖弃牌玩家状态不变的情况）。退房只在确认本手结束后发出，`DoExitRoom()` 再兜一次，连续两次确认才退。
- 退房回包失败不再切场景：`HandleLeaveRoomRejected()` 还原房间号 + `ResetLeaveRoom()` 撤销冻结并重拉 PlayerList，留在牌桌继续预约；被拒后 3s 冷却且只在 GameStatus 非 running 时重试。
- 只改 `panelGameView.ts`/`DrhLogicMgr.ts`，transpile 0 诊断；Creator、构建、真机、服务端在 running 时是否接受退房均待验。
