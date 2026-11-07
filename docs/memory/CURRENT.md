# qing 当前状态

更新时间：2026-11-07

规则见 `AGENTS.md`；版本与 UI 见 [决策](DECISIONS.md)、[专题](topics/v7-ui.md)。未发布与待验证汇总见[剩余问题清单](handoffs/2026-10-28-open-issues-backlog.md)。

## 2026-11-07 后台代理贡献展示规则拆两项（已改代码、未部署）

- 输赢改 `score_percent`（0~100，只调少）、贡献改 `contrib_add`（分，只调增），两项各自继承；`show_percent` 只留红利/抽水/业绩；清空用 `-1`，发 `100` 会阻断继承。后台 Go/Web 已同步（弹窗两个输入、列表输赢 % + 贡献 +¥），go test/tsc/vite build 通过；未部署、未联调。接口文档已更新。

## 2026-11-07 后台代理贡献管理：暗抽比例列 + 调整入口（已部署）

- 游戏服 `异步_查询_代理_展示数据` 新增顶层 `bonus_dark_percent`（该代理自己的红利暗抽，0~100，不参与 `show_percent` 缩放），成员行也带同名行级值；后台透传为 `bonusDarkPercent`。
- 列表在「贡献」组后新增「暗抽比例」列，操作列在「展示调整」后新增「暗抽比例调整」（弹窗读当前值→保存/设为 0%）；新增 `GET/PUT .../agents/{agentId}/bonus-dark`，底层命令 `设置_俱乐部_代理_红利暗抽`（不传比例=只读回显，写入 `club_agent_info.bonus_dark_percent`）。
- 19:07 部署二进制 `d8f6677b…` + 前端 `index-Dk2KU1jc.js`/`index-D9kgAfEm.css`（回滚 `backups/xuanmanager.20261107-1907-rollback`、`web.previous-bonus-dark-20261107-1907`）；health 200、新路由未登录 401。真实保存与目视待验，详见[交接](handoffs/2026-11-07-agent-bonus-dark-percent.md)。

## 2026-11-07 局末人数不足时收起桌面牌（未构建、待真机）

- 一局打完但人数不足、下一局不开时，界面会一直停在上一局（摊开的牌留着）。改为本局结束（结算动画播完）5 秒后仍未开局就收起全部桌面牌，`GameStatus` 回 `init` 兜底再排一次；`running`/`ready`、发牌与开局事件、全量恢复都会取消或恢复，避免误藏新一局的牌。
- 只收容器（`handstop`/`展示牌`/`下一张牌`/`下一张牌1`/`三花`），不动牌节点 `active`。改 `DrhLogicMgr.ts`+`DrhPlayerLogic.ts`，tsc 通过；Creator/真机待验。

## 2026-11-07 客服登录即在线 + 托管跳转游戏后台（已部署）

- 修「接待量已达上限或客服不在线」：实为 `kefuadmin` 被判 offline。心跳旧实现带 `presence<>'offline'`，一旦超时判离线永不恢复；改为心跳无条件回 online，维护任务只在会话过期后踢下线，claim 拆成「不在线」/「接待量 x/y 已满」。
- 托管「账号资料」加「在游戏后台查看 / 处理」（托管账号 guuid），当前会话「对方」加「对方后台」，与客服侧同一 `gameAdminPlayerURL`。
- 16:32 部署 `62571121…` + `index-DWH6KahC.js`（回滚 `*.previous-onlinelogin-20261107-1632`，旧 `c7f6cd15…`），health 200，客服 presence 已自动回 online；登录目视待验。详见[交接](handoffs/2026-11-07-agent-online-and-hosted-admin-link.md)。

## 2026-11-07 大厅房间推送（未构建）

- 全量/推送同构 12 位：关闭删行、已有替换、新增按 `[11]` 插入；筛选态防抖全量；`[2]` 收到即校准并本地倒计时。待联调。

## 2026-11-07 后台玩家管理「用户密码」列显示明文（已部署）

- 列仅管理员（`super_admin` 角色，含 admin999 与普通管理员 admin）可见。游戏端只有 MD5、不能解密，因此新增 `mgr_player_login_password`（migration 046）用 AES-GCM 存明文副本，在注册/后台重置/玩家自助改密三处收录；无记录显示「未收录」，不回退摘要。
- 存量字典回填命中 62/63（`source='recovered'`，未命中 `37022268`）；游戏端内部改密不经后台时副本会过期。
- 00:40 部署（`285c62b3…` + `index-DoJnkJZt.js`）：health 200、未登录 401、公网指向新 js、进程密钥与 `runtime.env` 同哈希；回滚 `bin/xuanmanager.previous-pwdplain-20261107`、`web.previous-pwdplain-20261107`。登录态目视待验，详见[交接](handoffs/2026-11-07-admin-player-password-column.md)。


## 2026-11-06 默认对话只留盟主 / 大盟主（已部署）

- 玩家、合伙人的消息首页默认对话只剩 BF客服、盟主（未入盟为群主）、大盟主；直属上级合伙人等代理层级不再生成入口，历史会话降为普通会话。
- 22:28 部署 ChatTool `bce3b475…`（回滚 `bin/chattool.previous-defaultchat-20261106-2228`，旧 `c7f6cd15…`），健康 200、未登录 401；客户端缓存版本 1→2 待构建。详见[交接](handoffs/2026-11-06-default-chat-targets.md)。

## 2026-11-06 后台俱乐部列表新增「俱乐部总积分」（已部署）

- 俱乐部管理列表在「钻石池」后新增「俱乐部总积分」列，单位元；详情接口同字段一并返回。
- 游戏服 `查询_俱乐部_成员_总分` 的同步回包是空对象（数据只推玩家端 `AllPlayerGold`），后台拿不到；改为聚合 `tbl_Account.sm_club_gold/sm_club_gold2` 的 `{"俱乐部ID": 积分}` 映射，mode 2/3 优先 `*_2` 列，`-99` 不计入。
- 部署 19:14：二进制 `e9fd5d74…` + 前端 `index-6HAkVMKQ.js`（CSS 未变），回滚 `bin/xuanmanager.previous-clubtotalgold-20261106`、`web.previous-clubtotalgold-20261106`；health 200、未登录 clubs 接口 401。真实登录态目视待验。详见[交接](handoffs/2026-11-06-admin-club-total-gold.md)。

## 2026-11-06 聊天托管：备注 / 置顶 / 快捷话术 / 删除单条会话（已部署）

- 「聊天托管」四项上线：玩家备注名（全团队共享，显示「原名（备注）」，原名保留）、三级置顶（俱乐部/联盟、盟主/群主、会话）、快捷话术一键以托管账号发送、永久删除单条会话。
- 部署 19:19 服务端 `c7f6cd15…` + 前端 19:32 `index-BSPwxQGC.js`：migration 011+012 已执行，health 200，7 条新路由未登录均 401，回滚 `*.previous-pins3-20261106-191813` / `web.previous-pinconv-20261106-193223`。三级「置顶」按钮统一在每行右侧（分组/账号/会话），同版修：已取消徽标改实心橙底、话术按钮不再随只读会话置灰、工具栏按钮不被压窄。真实账号交互与玩家端表现待验，详见[交接](handoffs/2026-11-06-hosted-chat-prefs.md)。

## 2026-11-06 赢家留座限时 + 局中预约退房（未构建、未真机）

- 「留座离桌」：局中未结算判不出输赢，一律弹「限时3分钟、超时按逃跑结算」；局间只给赢家弹，输家直接留座。倒计时读服务端 `site_countdown`。
- 「退出房间」不再拦「已经开局不能退出」：赢家先确认「离开或站起扣30%盈利」，确认后与输家一样提示「当前牌局结束后，下手将退出房间」，只挂预约标记，本手结算完自动退房；不在局中则直接退。
- 只改 `panelGameView.ts`；**3 分钟时长、超时逃跑结算、局间允许退房三项需服务端实现**。tsc 无新增诊断，Creator/真机待验。详见[交接](handoffs/2026-11-06-win-seat-limit-exit.md)。

## 2026-11-06 私聊详情 V2 + 单方清除聊天（服务端已部署，客户端未构建）

- 按效果图重做聊天皮肤（蓝/金气泡、金色发送、圆形返回/删除），底部新增「清除聊天」；只清自己这一侧，消息与对方/客服视图保留。
- ChatTool 已部署（00:08）：migration 009 已执行，`/api/health` 200，clear 路由未登录 401；新二进制 `b163889d…`，回滚 `bin/chattool.previous-clear-chat-20261106-000856`，未替换 `web/`。Prefab/引用、`go test`、定向 tsc 通过；Creator、真机与真实会话联调待验。详见[交接](handoffs/2026-11-06-chat-detail-v2-clear.md)。

## 2026-11-06 托管保留 + 上下分对账、后台玩家头像（已部署，已归档）

- 原文见[归档](archive/2026-11-07/current-nov06-kefu-admin.md)。

## 2026-11-05 消息列表置顶官方客服 BF（未构建、未真机）

- 「全部会话」固定置顶「官方客服 BF」，头像用 `shield_room_exact`；点击进入游戏内直聊，复用 `/chattool/api/player/*`，支持文字和拍照/发图；后台「我的会话」改名「客服消息」。
- 客服不在线也可先留言：文字/图片入库排队，客服登录/上线后自动接入；客户端只禁用已结束会话。
- 客服工作台取消上下线和「立即接入」：登录即在线，点开有消息的待接入会话自动接入；「聊天托管」改为 V8 胶囊开关，会话行间距 16。
- 官方联盟 hash 方案未落地、不再引入。已部署服务端 `7db76dcb…` 等四版二进制与客服站 `index-Dh-vyT3v.js`，回滚点见服务器备份。
- Prefab/定向 tsc/Go test 通过；Creator 导入、真机、真实排队/回复/图片联调待验证。详见[交接](handoffs/2026-11-05-official-kefu-entry.md)。

## 2026-11-05 牌桌客服改开消息页 + 半透明（未构建、未真机）

- 牌桌「联系客服」不再打开网页客服 `panelKefu`，改为以 `Cover` 打开大厅同一个 `panelMessage`（含直属代理/群主固定入口），并透传「游戏内」：隐藏实心背景、显示 0.47 深色遮罩与左上返回，标题居中；进入会话时隐藏列表只保留一层，关闭会话回到列表，可正常发送/回复。
- `panelMessage`/`panelMessageChat` Prefab 各加默认隐藏的「游戏内遮罩」，列表页另加默认隐藏「返回」；大厅分页与后台进入会话的外观不变。详见[交接](handoffs/2026-11-05-ingame-message-overlay.md)。
- Prefab JSON/引用检查与定向 tsc 通过；Creator 导入、网页/真机实际点击与真实会话待验证。

## 2026-11-05 代理贡献管理（后台已部署）

- 后台「代理贡献管理」联盟→俱乐部→代理/玩家逐层展开，真实值与展示值分列，展示值走 `异步_查询_代理_展示数据`；部署与回滚记录见[交接](handoffs/2026-11-05-agent-contributions.md)。
- 当时的 `show_percent` 单口径已被 2026-11-07 拆两项取代；客户端 `*` 模拟标记仍缺字段，Creator/真机待验。

## 2026-11-05 搓牌 / 玩家设置代理暗扣比例（未构建、未真机，已归档）

- 原文与交接链接见[归档](archive/2026-11-07/current-nov05-client-items.md)。

## 2026-11-05 聊天托管（服务端/客服站已部署，客户端未构建，已归档）

- 原文见[归档](archive/2026-11-07/current-nov05-chat-hosting.md)；后续进展见 `2026-11-06` 两条托管条目。

## 2026-11-05 游戏内俱乐部角色称谓统一（未构建、未真机）

- 统一显示口径：联盟创始人=大盟主，已入盟俱乐部创始人=盟主，俱乐部代理=合伙人；未入盟创始人显示群主。只改文案，不改服务端命令、`role` 内部值、节点名和权限。
- 覆盖玩家信息/成员列表身份、我的俱乐部卡片、俱乐部列表、盟友行、直聊角色、兑换弹窗、房间提示、旧红利面板及静态 Prefab；未入盟俱乐部在「我的 → 当前俱乐部」不再显示额度。详见[交接](handoffs/2026-11-05-role-naming.md)与[决策 D09](DECISIONS.md)。
- 静态 Prefab JSON 与定向 TS 检查通过；Creator 导入、构建、真机和真实三角色回包待验证。

## 2026-11-05 玩家信息弹窗：页签换装 + 额度记录（未构建、未真机）

- 「成员设置/下级成员」改金色胶囊页签并新增「额度记录」（上下分/牌局流水）；搜索框改 SINGLE_LINE 支持中英文昵称；改 `ClubManagementView.ts`、`ClubManagementApi.ts`、`panelMain.prefab`，新增 `tools/apply_player_quota_records.py`。
- 额度记录口径、末列显示 `name`、盟主下级查询带 `agent_id+club_id`、身份判定创建者优先等细节见[交接](handoffs/2026-11-05-player-record-tabs.md)。
- Prefab/引用/离屏预览与定向 TS 检查通过；Creator 导入、构建、真机、真实回包待验证。

## 2026-11-04 消息列表 / 盟友管理 / 游戏设置 / 房间奖池（已归档）

- 原文见[归档](archive/2026-11-05/current-nov04-message-list.md)与[盟友管理](archive/2026-11-05/current-nov04-ally-management.md)、[游戏设置](archive/2026-11-06/current-nov04-game-settings.md)、[房间奖池](archive/2026-11-05/current-nov04-room-jackpot.md)；细节见[滚动分页交接](handoffs/2026-11-04-message-list-scroll-paging.md)、[奖池交接](handoffs/2026-11-04-game-settings-jackpot.md)、[规则交接](handoffs/2026-11-04-game-settings-rules.md)。

## 2026-11-04～11-06 我的红利：V2 统计 / 联盟红利 / 合伙人入口（未构建、未真机）

- 「我的」→ 当前俱乐部卡片的「我的收益」（打开 `panelMyHongli` 我的红利）原只给创建者，11-06 起创建者 + 合伙人（V2 权限表该接口为「代理自己 / 群主」）。`ClubContext` 补 `isAgent`（`role` 会被管理员占用），并重排「操作」行 Layout（合伙人 2 个按钮时居中）。详见[交接](handoffs/2026-11-06-agent-my-hongli-entry.md)。
- 面板口径全部换俱乐部 V2：`ClubBonusStats`（今日/昨日新增、未提取、累计提取，累计=未提取+累计提取）、`ClubBonusList`、`提取_俱乐部_红利`（全部整数元）；删除账号 `hongli`/`all_hongli`、旧 `查询_俱乐部_代理_收益` 与 `HongliList` 回退，无 `club_id` 只提示无俱乐部。详见[交接](handoffs/2026-11-04-my-hongli-club-stats.md)。
- 联盟区「联盟红利」仅联盟创建者可见，`panelMyHongli` 加 `mode=union` 走 `ClubUnionBonusStats`/`ClubUnionBonusList`/`提取_联盟_红利`，卡片高度 320→410。详见[交接](handoffs/2026-11-04-union-hongli-panel.md)。
- 各阶段只做 tsc/Prefab 引用检查；Creator 导入、构建、真机与真实回包待验证（曾遇 0x200 先到清 pending 把随后推送丢弃，已修）。

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
