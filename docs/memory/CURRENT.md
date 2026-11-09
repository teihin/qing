# qing 当前状态

更新时间：2026-11-10

规则见 `AGENTS.md`；版本与 UI 见 [决策](DECISIONS.md)、[专题](topics/v7-ui.md)。未发布与待验证汇总见[剩余问题清单](handoffs/2026-10-28-open-issues-backlog.md)。

## 2026-11-10 牌桌内「牌局优化」：电量三连击 + 运维优化页（未构建、未真机）

- BOSS 账号在牌桌连点电量 3 下打开 `panelGameOptimize`；全屏半透明底，首个页签「运维优化」。
- 上方设置个人（本房在座玩家或手动输入数字 ID）/分组（俱乐部分组）的优化概率与目标金额；下方列表轮询 `异步_查询_胜率目标_列表`，显示进度、剩余、局数、已生效与达成情况，行内可停止。
- 选择弹窗已拆成通用 prefab `panelPlayerPicker`（玩家/分组两模式，带手动 ID 输入），其他界面可直接 `panelPlayerPicker.Open(...)` 复用。
- 接口按 `服务器文档整理/胜率目标控制-客户端与后台接口文档.md`；PreFab 由 `tools/apply_ingame_optimize_panel.py` 生成，贴图复用 V8 正式资源。
- 已过 TS 语法/类型检查、prefab 引用校验、1334/1624 离屏布局；Creator 导入、构建、真机与服务端实测待验。
- 修正：电量位置被 `RoomFrame/完成` 隐形按钮覆盖，点电池实际发 `关闭检查_命令`；三连击判定已改到该热区，BOSS 单/双击延迟 900ms 补发关闭检查，三连击只开面板。
- 接口文档更新后已对齐：列表默认查历史（`history=1 + count/page`），点「历史」切回当前目标（不带 history）；`id` 作行 key、`state` 只传单值；设置/停止不自动重试。详见[交接](handoffs/2026-11-10-ingame-game-optimize-panel.md)。

## 2026-11-10 后台发牌优化：改用游戏服 `异步_设置_玩家_属性`（已部署，未真实写入验收）

- 新增/调整/删除不再直连游戏库写 `tbl_Account`，改为调用服务器本机 8890 的 `异步_设置_玩家_属性` 写 `optimize01_chance`、`optimize01_count`（删除写 0），写后 16×300ms 回读数据库校验；第二字段失败或回读失败时把两个字段恢复为操作前值。
- `optimize01_man` 是可选标记、不参与判定，后台不再查询/要求唯一 BOSS，原「无法唯一确定游戏 BOSS」报错消失。历史 `man` 值保留，不再覆盖。
- 概率支持 `1～100`（正优化）与 `-100～-1`（负优化），`0` 不允许；后端校验、范围筛选和前端输入同步放开。
- 已部署正式 8891：二进制 `347a37e0…`（回滚 `backups/xuanmanager.20261110-0026-rollback`），前端 `index-BU2OmBcu.js`（CSS 保持 `index-DCd0vLpS.css`；回滚目录 `web.previous-player-optimization-20261110-0026`）。health 200、发牌优化路由未登录 401、旧 BOSS 报错串为 0；8890 只读查询 `718968` 返回 chance/count 均为 0。未在页面实操新增/调整/删除，未做真实玩家写入验收。详见[交接](handoffs/2026-11-10-player-optimization-game-command.md)。

## 2026-11-09 后台玩家管理：发放钻石 + 发放记录（已部署，游戏服命令待部署）

- 玩家管理新增「发放钻石」：调游戏服 `异步_增加_玩家_钻石`，回读 `sm_stone` 后写 `game.player.grant_stone` 审计；「发放记录」按操作账号、玩家、数量、前后余额、原因、时间分页追溯成功发放。
- 新权限 `game.player.grant_stone`。首版迁移 053 误用已占用的 id=2103，覆盖了「重置玩家密码」名称；054 已恢复并用自增 id（5815）建新权限，053 源码改为不写死 id。
- XuanManager 已发布 8891（health 200，前端 `index-BL3MOz60.js`，二进制 `97ebc419…`）。**游戏服命令探测仍返回 769 空结果，尚未部署**，复核时 8890 已停止监听。页面会明确提示先部署游戏服。未登录验收、未做真实发放。详见[交接](handoffs/2026-11-09-admin-player-stone-grant.md)。

## 2026-11-09 后台业绩核心共享：三栏常驻「今日业绩占比」

- 按用户确认沿用当前后台净点数：占比 = 本人净点数 ÷ 本次名单净点数合计，最大余数法保证合计固定 100.00%；三栏顶部常驻占比条，表格 / CSV 同步。
- 前端每 30 秒静默刷新业绩，不覆盖正在填的金额；未部署、未登录验收。`go build/test/vet`、`tsc/eslint/vite build` 通过。详见[交接](handoffs/2026-11-09-agent-reward-share-percent.md)。

## 2026-11-09 我的红利（俱乐部/联盟）：金框 + 金色美术字（未构建、未真机）

- 用户选定「B3 金框版」：深蓝玻璃 + 金双线框 + 桂冠/金币/礼盒；标题与未领取改用页面通用浅色美术字，未领取区增加青蓝渐变和金额分区，其余正文保持暖白。
- `assets/V7/hongli_v8_*` 美术与字体已更新，去稻穗并居中；
  `panelMyHongli.prefab` 与 `panelUnionHongli.prefab` 同步写入，表头四个隐藏 Label 改启用，提取按钮 130→150 宽（九宫格）。
- 只改 `panelMyHongli.ts` 的占位符（`—` → `-`，位图字体无长破折号）；两档画布反渲染已核对，Creator 导入/构建/真机待验。
  详见[交接](handoffs/2026-11-09-my-hongli-v8-restyle.md)。

## 2026-11-09 大厅房间状态换花环徽章：显示 118×47 → 150×60（未构建、未真机）

- 四张 `状态_*.png` 重画成「金色花环 + 发光底板 + 金属字」，仍是 236×94、`.meta`/UUID 未动；文案与青/绿/金/紫配色沿用 11-08 定案（`准备` 仍写「等待中」）。
- `panelMain.prefab` 的 `房间对象/状态` 改为 150×60、x 263.357（右边缘不变），离屏合成确认真实卡片上不压字不出框。
- 生成脚本 `tools/generate_lobby_status_badges.py`（改色/改字改 `PALETTES` 重跑）；Creator 导入、构建、真机待验。详见[交接](handoffs/2026-11-09-lobby-status-badge-wreath.md)。

## 2026-11-09 我的 → 额度授权记录：入口仅大盟主/盟主，查询改新接口（未构建、未联调）

- 入口可见性已在 2026-11-07 收窄：`panelMain.CanViewQuotaGrantRecord` 要求「俱乐部创建者 + 已入盟」，
  即大盟主（联盟总群主）/ 盟主（已入盟创建者）；群主、管理员、合伙人、普通成员不可见，按钮分支同样拦截。
- 查询从「查联盟成员 → 逐个俱乐部查额度流水」改为服务端 2026-11-09 新增的 `查询_联盟_授信_记录`
  → 推送 `ClubUnionGrantList`（一次返回授信/收回/注资/注资扣减，服务端分页、`count` 不封顶）。
  不传 `club_id`（传空串，同文档示例），由服务端按身份限定范围；行字段改用 `quota` / `quota_after`
  （余额兼容同值的 `remark`），不再本地过滤 type。
- 只改 `assets/scripts/UI/panelQuotaGrantRecord.ts`，静态语法检查通过；Creator 构建、真机与服务端联调待验。
  详见[交接](handoffs/2026-11-07-quota-grant-record.md)。

## 2026-11-09 钻石池消耗入口：修大盟主不可见（未构建、未真机）

- 原判定把「联盟状态已知但 `is_owner` 未回包」当成非总群主，且 `查询_我的_联盟` 确认总群主后没有刷新入口，大盟主首屏被藏后再不出现。
- 改为仅在 `isOwner === false` 时对创建者收起；并在切回「我的」、确认总群主、创建联盟、身份查询失败回包时重算入口。只改 `panelMain.ts`，语法检查通过。

## 2026-11-08 客户端交互与安卓键盘（已归档）

- 我的红利明细字段、安卓键盘贴边与收起、无俱乐部玩家按钮、玩家信息/联系上级/局内提醒、局中退房防误退，详见[批次归档](archive/2026-11-10/current-nov08-client-ui-and-keyboard.md)。

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
- 暗抽比例列 + 调整入口原文见[归档](archive/2026-11-08/current-nov07-agent-bonus-dark.md)（已部署）。

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

## 2026-11-04～11-06 历史批次（已归档）

- 11-06 默认对话/俱乐部总积分、聊天托管、私聊 V2、托管对账、客服后台、赢家留座限时：[归档](archive/2026-11-08/current-nov06-chat-defaults-and-club-total.md)、[托管](archive/2026-11-08/current-nov06-hosted-chat.md)、[私聊](archive/2026-11-08/current-nov06-chat-and-hongli.md)、[客服后台](archive/2026-11-07/current-nov06-kefu-admin.md)、[留座](archive/2026-11-08/current-nov06-win-seat-exit.md)。
- 11-04～05 消息列表/牌桌客服/代理贡献、盟友/游戏设置/房间奖池：[消息列表](archive/2026-11-05/current-nov04-message-list.md)、[客服/代理](archive/2026-11-08/current-nov05-kefu-and-agent.md)、[入口](handoffs/2026-11-05-official-kefu-entry.md)、[浮层](handoffs/2026-11-05-ingame-message-overlay.md)、[贡献](handoffs/2026-11-05-agent-contributions.md)、[盟友](archive/2026-11-05/current-nov04-ally-management.md)、[设置](archive/2026-11-06/current-nov04-game-settings.md)、[奖池](archive/2026-11-05/current-nov04-room-jackpot.md)；交接：[分页](handoffs/2026-11-04-message-list-scroll-paging.md)、[奖池](handoffs/2026-11-04-game-settings-jackpot.md)、[规则](handoffs/2026-11-04-game-settings-rules.md)。

## 2026-11-04～11-06 我的红利（已归档）

- 面板口径全部换俱乐部 V2，联盟区仅联盟创建者可见。原文见[归档](archive/2026-11-08/current-nov06-chat-and-hongli.md)；细节见[入口](handoffs/2026-11-06-agent-my-hongli-entry.md)、[俱乐部口径](handoffs/2026-11-04-my-hongli-club-stats.md)、[联盟红利](handoffs/2026-11-04-union-hongli-panel.md)。

## 2026-11-03～11-04（已归档）

- 后台移除「加减钻石」[交接](handoffs/2026-11-04-admin-remove-player-diamonds.md)；后台俱乐部/钻石池、我的页钻石池消耗/上下分/入盟审批/联盟归属、创建加入联盟、按联盟层级直聊权限：[归档](archive/2026-11-05/current-nov03-club.md)。

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
