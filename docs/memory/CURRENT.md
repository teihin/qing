# qing 当前状态

更新时间：2026-11-08

规则见 `AGENTS.md`；版本与 UI 见 [决策](DECISIONS.md)、[专题](topics/v7-ui.md)。未发布与待验证汇总见[剩余问题清单](handoffs/2026-10-28-open-issues-backlog.md)。

## 2026-11-08 安卓键盘：贴键盘上沿 + 点上半屏收起（真机已验证）

- 根因：`Cocos2dxEditBox.addItems` 把带 `ALIGN_PARENT_BOTTOM` 的 `RelativeLayout.LayoutParams` 加进 `FrameLayout`，规则被 `generateLayoutParams` 吞掉，容器钉在窗口左上角——写的 `topMargin` 一直是「距屏幕顶」，只能靠倍数凑。
- 修法：容器改 `FrameLayout.LayoutParams` + `gravity=BOTTOM`，位置改 `bottomMargin = 键盘高度`（`Type.ime()` → `getSystemWindowInsetBottom()` → 可见区差值回退），每次变化重算；删 `setFitsSystemWindows(true)`。
- 另恢复官方语义：点上半屏 `complete()` 收起键盘（2026-07-23 把 `Cocos2dxGLSurfaceView` 里那行注释掉了，才只能点「完成」）。
- 两个引擎文件都在 Creator 安装目录、重装会被覆盖：`tools/apply_editbox_ime_patch.py`（幂等 + 备份）。**Java 改动热更下发不了，必须重新出 APK。**
- 小米 9 SE（A11）、MIX 4（A14）真机通过；其余机型与 iOS 未验。详见[交接](handoffs/2026-11-08-editbox-ime-position.md)。

## 2026-11-08 数据统计列表：无俱乐部玩家隐藏「查看 / 代理链」（未构建、待真机）

- 现象：玩家列表点 q1（166258）的「查看」服务端查不到人。根因 `BindListRowButtons` 用 `clubId || this.userClubId || this.roomClubId` 兜底：玩家不在任何俱乐部（行 `club_id` 空、界面「俱乐部」显示「—」）时拿 boss 自己俱乐部的 ID 去查别人，服务端按该俱乐部找成员必然落空。
- 修法：`hasClub = id !== "" && clubId !== ""`，没有俱乐部就隐藏「查看」「代理链」（两者都是俱乐部域查询），不再兜底；「战绩」走 `查询_玩家_所有的牌局_信息`（只认 user_id），保留。
- 只改 `panelBossPlayerInfo.ts`（transpile 0 诊断），构建/真机待验；「添加到分组」未动，无俱乐部玩家点它有同样风险。

## 2026-11-08 玩家信息弹窗：BOSS 增加「当前IP / 最后登录」（未构建、服务端待重启联调）

- `panelClubPlayerInfo.prefab`（`俱乐部玩家设置弹窗/面板`）新增 `玩家IP底/玩家IP/玩家IP值`、`最后登录底/最后登录/最后登录值` 两行，结构照抄「备注」行、默认隐藏；值框 280 宽（与「备注值」左端对齐），22 号字实测不溢出。
- `ClubManagementView`：`layoutMemberSettingRows` 追加这两组自动堆叠到底；新增 `SetPlayerExtInfo(ip,lastLogin,visible)` + `syncExtRows()`，只随「成员设置」页签显示，`openPlayerSettings` 换人时先收起。
- `panelClubPlayerInfo`：仅 `IsBossAccount()` 才发 `查询_玩家_扩展_信息`，独立 context `playerext:`（`onHallCommand` 先于 loading 拦截），回包填 `ip` / `last_login_time`；失败或 8s 无回包显示「—」。
- 大厅 `panelMain` 那份玩家设置卡不发请求、不显示（未加节点即有意）；非 BOSS 入口同样看不到。
- 接口见[玩家扩展信息查询](../../服务器文档整理/玩家扩展信息查询-客户端接口文档.md)：权限 boss/bigboss 名单，2026-11-08 已上传测试服但**待重启 baseapp**；Web 端 IP 会是 `127.0.0.1`（网关未透传 XFF）。transpile 0 诊断、Creator 已导入；构建/真机/真实回包待验。详见[交接](handoffs/2026-11-08-player-info-ext-ip-lastlogin.md)。

## 2026-11-08 牌桌「联系上级」改名 + 局内消息红点/提示音（未构建、未真机）

- `ConfigMain/联系客服` → `联系上级`（Scene 与 prefab 同名改，fileId 一致）；脚本分支认新旧名，点击仍开 `panelMessage`。
- `assets/V7/ingame_menu_v8_service.png` 只重绘文字带，底板/耳机图标保留原像素；尺寸、alpha、`.meta` 未变，48,152B < 原 52,891B。图标仍是耳机，要换人物图标需另出图。
- 局内收不到提醒的根因：进桌 `showPanel(CloseOther)` 销毁 `panelMain`，直聊 `unread`/`realtimeMessage` 监听随之注销。牌桌 `onLoad` 自己挂一份（`SetupDirectChatNotice`），`onDestroy` 注销；新消息播 `eff/申请提示`，未读驱动 `RoomFrame/ConfigBT/红点` + `ConfigMain/联系上级/红点`（新增 Label「●」，默认隐藏，读后自动收）。
- 定向 tsc 0 诊断、Creator 已导入；构建/真机/真实消息联调待验。详见[交接](handoffs/2026-11-08-ingame-message-notice-and-contact-superior.md)。

## 2026-11-08 退出房间：局中不再误退（未构建、未真机）

- 现象：局中点「退出房间」有时直接退、随后被拉回。根因是 `IsSelfInRound()` 用 `indexOf("结算")` 判本手结束，而 `等待_结算_状态`/`旁家_等待_结算_状态` 也含「结算」，弃牌等结算的玩家被当成已结算，退房协议被服务端拒绝后送回牌桌。
- 修法：新增 `IsSelfRoundSettled()`（含「等待」一律算本手未结束；另认 `DrhLogicMgr.bRoundSettled`——比牌开始置 true，`StartGame`/`round_count` 递增置 false，覆盖弃牌玩家状态不变的情况）。退房只在确认本手结束后发出，`DoExitRoom()` 再兜一次，连续两次确认才退。
- 退房回包失败不再切场景：`HandleLeaveRoomRejected()` 还原房间号 + `ResetLeaveRoom()` 撤销冻结并重拉 PlayerList，留在牌桌继续预约；被拒后 3s 冷却且只在 GameStatus 非 running 时重试。
- 只改 `panelGameView.ts`/`DrhLogicMgr.ts`，transpile 0 诊断；Creator、构建、真机、服务端在 running 时是否接受退房均待验。

## 2026-11-07 数据统计：新增「玩家列表 / 代理列表」页签（未构建、未联调）

- 页签顺序：玩家列表 / 代理列表 / 玩家信息 / 代理链 / 分组管理（各 132 宽）。
- 走《俱乐部全量玩家与代理统计》§2/§3（`查询_俱乐部_所有_玩家` / `_所有_代理`，推送 `AllClubPlayerList` / `AllClubAgentList`），默认全服、10 条/页；搜索行左「全部俱乐部」=一级过滤（透传 `club_id`，留空=全部）。
- 排序 9 项（输赢/贡献/红利 各 3），5+4 两行、字号 24；点已选条件切升降序。2026-11-08 服务端已放开红利排序。
- 行卡片克隆 `行模板`（玩家=本人值、代理=本人+整条下线），九项统计齐全，红利未下发显示「—」；行内「添加到分组」（分组随行下发，未分组才出，已分组显示「分组:XXX」）、真实头像（节流绑定）。
- 默认页签：我的→数据统计（无 userId）→玩家列表；牌桌点头像→玩家信息。
- prefab：`排序栏`(h=84)/`分页` 各带 Widget；列表 Widget top=345/bottom=160、卡片 330/145。真机/联调待验。详见[交接](handoffs/2026-11-07-boss-all-player-agent-tabs.md)。

## 2026-11-07 修改交易密码改用登录密码核验（后台已部署、客户端未构建）

- 新增后台 `POST /api/game/change-pay-password`：比对 `player_wxpwd`，经本机 8890 写 `userPWD2` 并回读；客户端「确定修改交易密码」改调它、文案改「登录密码」，初始化交易密码仍走旧协议。8891 已部署 `859202c4…`，测试账号两条路径验证通过。详见[交接](handoffs/2026-11-07-change-pay-password-by-login.md)。

## 2026-11-07 后台代理贡献展示规则拆两项（已改代码、未部署）

- 输赢改 `score_percent`（0~100，只调少）、贡献改 `contrib_add`（分，只调增），两项各自继承；`show_percent` 只留红利/抽水/业绩；清空用 `-1`，发 `100` 会阻断继承。后台 Go/Web 已同步（弹窗两个输入、列表输赢 % + 贡献 +¥），go test/tsc/vite build 通过；未部署、未联调。接口文档已更新。

## 2026-11-07 后台代理贡献管理：暗抽比例列 + 调整入口（已部署，已归档）

- 原文见[归档](archive/2026-11-08/current-nov07-agent-bonus-dark.md)。

## 2026-11-07 局末人数不足时收起桌面牌（未构建、待真机）

- 一局打完但人数不足、下一局不开时，界面会一直停在上一局（摊开的牌留着）。改为本局结束（结算动画播完）5 秒后仍未开局就收起全部桌面牌，`GameStatus` 回 `init` 兜底再排一次；`running`/`ready`、发牌与开局事件、全量恢复都会取消或恢复，避免误藏新一局的牌。
- 只收容器（`handstop`/`展示牌`/`下一张牌`/`下一张牌1`/`三花`），不动牌节点 `active`。改 `DrhLogicMgr.ts`+`DrhPlayerLogic.ts`，tsc 通过；Creator/真机待验。

## 2026-11-07 客服登录即在线 + 托管跳转游戏后台（已部署）

- 修「接待量已达上限或客服不在线」：实为 `kefuadmin` 被判 offline。心跳旧实现带 `presence<>'offline'`，超时判离线后永不恢复；改为心跳无条件回 online，维护任务只在会话过期后踢下线，claim 拆成「不在线」/「接待量已满」。
- 托管「账号资料」加「在游戏后台查看 / 处理」，当前会话「对方」加「对方后台」，与客服侧同一 `gameAdminPlayerURL`。16:32 已部署，health 200，presence 自动回 online。详见[交接](handoffs/2026-11-07-agent-online-and-hosted-admin-link.md)。

## 2026-11-07 大厅房间推送（未构建）

- 推送同构 12 位：关闭删行、已有替换、新增按 `[11]` 插入；筛选态防抖全量；`[2]` 收到即校准倒计时。待联调。

## 2026-11-07 后台玩家管理「用户密码」列显示明文（已部署）

- 列仅管理员（`super_admin`，含 admin999 与 admin）可见。游戏端只有 MD5，故新增 `mgr_player_login_password`（migration 046）用 AES-GCM 存明文副本，在注册/后台重置/自助改密三处收录；无记录显示「未收录」。存量回填 62/63（未命中 `37022268`）；游戏端内部改密不经后台时副本会过期。
- 00:40 已部署，health 200、未登录 401、公网指向新 js；登录态目视待验。详见[交接](handoffs/2026-11-07-admin-player-password-column.md)。

## 2026-11-06 默认对话只留盟主 / 大盟主（已部署）

- 玩家、合伙人的消息首页默认对话只剩 BF客服、盟主（未入盟为群主）、大盟主；直属上级合伙人等代理层级不再生成入口，历史会话降为普通会话。
- 22:28 部署 ChatTool `bce3b475…`（回滚 `bin/chattool.previous-defaultchat-20261106-2228`，旧 `c7f6cd15…`），健康 200、未登录 401；客户端缓存版本 1→2 待构建。详见[交接](handoffs/2026-11-06-default-chat-targets.md)。

## 2026-11-06 后台俱乐部列表新增「俱乐部总积分」（已部署）

- 俱乐部管理列表在「钻石池」后新增「俱乐部总积分」列，单位元；详情接口同字段一并返回。
- 游戏服 `查询_俱乐部_成员_总分` 的同步回包是空对象（数据只推玩家端 `AllPlayerGold`），后台拿不到；改为聚合 `tbl_Account.sm_club_gold/sm_club_gold2` 的 `{"俱乐部ID": 积分}` 映射，mode 2/3 优先 `*_2` 列，`-99` 不计入。
- 部署 19:14：二进制 `e9fd5d74…` + 前端 `index-6HAkVMKQ.js`（CSS 未变），回滚 `bin/xuanmanager.previous-clubtotalgold-20261106`、`web.previous-clubtotalgold-20261106`；health 200、未登录 clubs 接口 401。真实登录态目视待验。详见[交接](handoffs/2026-11-06-admin-club-total-gold.md)。

## 2026-11-06 聊天托管：备注 / 置顶 / 快捷话术 / 删除单条会话（已部署、已归档）

- 四项已上线并部署（服务端 `c7f6cd15…` + 前端 `index-BSPwxQGC.js`），真实账号交互待验，原文见[归档](archive/2026-11-08/current-nov06-hosted-chat.md)。

## 2026-11-06 赢家留座限时（退房部分已归档）

- 「留座离桌」：局中未结算判不出输赢，一律弹「限时3分钟、超时按逃跑结算」；局间只给赢家弹，输家直接留座。倒计时读服务端 `site_countdown`。局中预约退房原文见[归档](archive/2026-11-08/current-nov06-win-seat-exit.md)，3 分钟时长与超时逃跑结算仍待服务端实现。

## 2026-11-06 私聊详情 V2 + 单方清除聊天（服务端已部署，客户端未构建）

- 按效果图重做聊天皮肤（蓝/金气泡、金色发送、圆形返回/删除），底部新增「清除聊天」；只清自己这一侧，消息与对方/客服视图保留。ChatTool 已部署（migration 009、health 200、clear 未登录 401）、`go test` 与定向 tsc 通过；Creator、真机与真实会话联调待验。详见[交接](handoffs/2026-11-06-chat-detail-v2-clear.md)。

## 2026-11-06 托管保留 + 上下分对账、后台玩家头像（已部署，已归档）

- 原文见[归档](archive/2026-11-07/current-nov06-kefu-admin.md)。

## 2026-11-05 消息列表 / 牌桌客服 / 代理贡献（已归档）

- 「全部会话」置顶官方客服 BF、客服离线留言排队、客服站登录即在线、牌桌「联系客服」改开半透明 `panelMessage`、后台代理贡献逐层展开：原文见[归档](archive/2026-11-08/current-nov05-kefu-and-agent.md)；交接见 [official-kefu-entry](handoffs/2026-11-05-official-kefu-entry.md)、[ingame-message-overlay](handoffs/2026-11-05-ingame-message-overlay.md)、[agent-contributions](handoffs/2026-11-05-agent-contributions.md)。

## 2026-11-04 消息列表 / 盟友管理 / 游戏设置 / 房间奖池（已归档）

- 原文见[归档](archive/2026-11-05/current-nov04-message-list.md)与[盟友管理](archive/2026-11-05/current-nov04-ally-management.md)、[游戏设置](archive/2026-11-06/current-nov04-game-settings.md)、[房间奖池](archive/2026-11-05/current-nov04-room-jackpot.md)；细节见[滚动分页交接](handoffs/2026-11-04-message-list-scroll-paging.md)、[奖池交接](handoffs/2026-11-04-game-settings-jackpot.md)、[规则交接](handoffs/2026-11-04-game-settings-rules.md)。

## 2026-11-04～11-06 我的红利：V2 统计 / 联盟红利 / 合伙人入口（未构建、未真机）

- 入口开放创建者 + 合伙人（`ClubContext` 补 `isAgent`，`role` 会被管理员占用）；面板口径全部换俱乐部 V2（`ClubBonusStats`/`ClubBonusList`/`提取_俱乐部_红利`，删账号 `hongli`/`all_hongli` 与旧 `查询_俱乐部_代理_收益`）；联盟区仅联盟创建者可见，`mode=union` 走 `ClubUnionBonusStats` 系列，卡片高 320→410。只做 tsc/Prefab 检查，Creator/构建/真机待验。详见[入口](handoffs/2026-11-06-agent-my-hongli-entry.md)、[俱乐部口径](handoffs/2026-11-04-my-hongli-club-stats.md)、[联盟红利](handoffs/2026-11-04-union-hongli-panel.md)。

## 2026-11-03～11-04（已归档）

- 后台玩家管理移除「加减钻石」并删旧接口：已部署，详见[交接](handoffs/2026-11-04-admin-remove-player-diamonds.md)。
- 后台俱乐部管理与钻石池、我的页钻石池消耗/上下分记录/入盟审批/联盟归属、创建与加入联盟、按联盟层级的直聊权限：原文见[归档](archive/2026-11-05/current-nov03-club.md)。

## 2026-10-31～11-03 阶段归档（链接）

- 玩家钻石与联盟管理见[归档](archive/2026-11-05/current-nov03-admin.md)；资金明细/牌桌金币/私聊上下分见[归档](archive/2026-11-04/current-nov01-nov03-chat.md)；俱乐部成员额度与 1 对 1 私聊见[归档](archive/2026-11-04/current-oct31-nov01-links.md)。

## 阶段归档（2026-10-30 及更早）

- 10-29～10-30 牌局回顾翻牌、俱乐部玩家备注、底栏改版、机器人、投放按周时段等：[oct29-30](archive/2026-11-01/current-oct29-30.md)；10-27 及更早：[early-items](archive/2026-10-30/current-early-items.md)。

## 本轮实时核对：记忆整理

- 2026-09 整理记录见[整理交接](handoffs/2026-09-05-memory-migration.md)。

## 最近报告的 UI 状态

- 见[全套进度](handoffs/2026-09-11-v8-all-pages.md)与[逐页归档](archive/2026-09-15/ui-status-table.md)。

## 待核实项与工作边界

- 2026-09 原文见[归档](archive/2026-11-06/current-sep-consolidation.md)；待验证项不构成执行授权，动手前重新核实未提交差异。
