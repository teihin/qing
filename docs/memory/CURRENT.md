# qing 当前状态

更新时间：2026-11-10

规则见 `AGENTS.md`；版本与 UI 见 [决策](DECISIONS.md)、[专题](topics/v7-ui.md)。未发布与待验证汇总见[剩余问题清单](handoffs/2026-10-28-open-issues-backlog.md)。

## 2026-11-11 后台业绩核心共享：改为按联盟发放（已部署）

- 入口先列联盟，点进后才进入原发放页；名单、方案、金额、发放、账单、线数据全部按当前联盟过滤。
- 迁移 055 给计划表与名单方案加 `union_id` 并改唯一键/回填历史；跨联盟选人由后端拒绝（选人、金额、排除、子账号、账单都会校验），换联盟同步会把 `selected` 置 0。
- 已部署 8891（二进制 `0c558b28…`、前端 `index-BDfIIHx6.js`）；迁移已执行：7 计划回填、9 无归属，29 代理有联盟、2 无。`go build/test/vet`、`tsc/eslint/vite build` 通过；未登录实操验收。详见[交接](handoffs/2026-11-11-agent-reward-union-scope.md)。

## 2026-11-10 「我的」俱乐部卡片钻石池取错同秒最新行（客户端未构建）

- 现象：卡片显示钻石池 10，库里 `club_agent_info.stone=8`；`查询_俱乐部_钻石流水` 同一秒连续三条 `11→10 / 10→9 / 9→8`，客户端按 `date >=` 取最新，遍历到同秒最后一条较旧行。
- 已改 `panelMain.OnClubStoneWater` 为严格 `>`，保留服务端「最新在前」的第一条；三条同秒模拟从 10 修正为 8。详见[交接](handoffs/2026-11-10-club-stone-pool-tie.md)。

## 2026-11-10 俱乐部「同步带入钻石」开关 + 后台兑换比例（后台已部署；客户端未构建）

- 创建规则弹窗新增「同步带入钻石」开关（默认关），勾选时 `创建_俱乐部_玩法` 带 `"special_rule": "入座扣钻"`；弹窗显示后台比例（`usr_hash_info.俱乐部积分对应钻石输赢比`，默认 1:1，0=不扣）。测试服已加 `club_room_play_info.special_rule` 并回填 play_id=24，**待重启**；规则列表按 `ClubPlayList.special_rule` 显示「带入钻石」，带入弹窗在房间含 token 时显示玩家钻石余额（prefab 与 drh8 场景都已补）。
- 后台「钻石消费价格」页把比例并入主列表、删「原金币价」列，统一确认/保存；复用 `configuration.stone_consume` 权限。Go/Web 已部署 8891（二进制 `123e56f5…`、前端 `index-D0v-JYHS.js`），回滚见[交接](handoffs/2026-11-10-club-seat-stone-ratio.md)。
- 客户端正式 prefab 已改（弹窗高度 1020→1080），1334/1624 布局通过；未 Creator 构建/真机。

## 2026-11-10 钻石池消耗两页签（未构建、未真机）

- 新增「钻石池兑换 / 开房消耗」页签；开房消耗走 `ClubStoneWater` 的 `钻石房间扣费` 行（时间/房间号/消耗钻石/余额，本地 10 条/页）；流水无 `room_id` 时房间号显示 `—`。详见[交接](handoffs/2026-11-10-stone-pool-cost-tabs.md)。

## 2026-11-10 俱乐部实时房房费提示

- 客户端创建规则红字房费说明 + 牌桌钻石池不足解散弹窗（`消费钻石价格.俱乐部实时房间时长费`，默认 0=未开启，不扣费）；后台 catalog 加项并部署 8891，随 HEAD 上线收益对账接口；客户端未构建。详见[交接](handoffs/2026-11-10-club-room-fee-hint.md)。

## 2026-11-10 游戏设置·奖池：比例支持两位小数、隐藏低底皮（未构建、未真机）

- 「修改奖池比例」改为小数输入（网页端文本框、原生端小数键盘），0~100、最多两位小数（如 0.5），列表/合计/「其余牌型共占」提示统一去尾零显示；牌桌奖池弹窗同口径。
- 「底皮奖池数量」隐藏已停用的 `0.1/0.3`、`0.2/0.5` 两行（节点保留以对齐服务端 8 个底皮键），滚动 content 高度 1604→1388。
- **服务端仍是「整数 0~100」口径**（服务器文档 §10.4）；若游戏服按整数截断，0.x 会变 0，需服务端同步支持小数。详见[交接](handoffs/2026-11-10-game-settings-jackpot-decimal.md)。

## 2026-11-10 退出房间：点击立即出 loading（未构建、未真机）

- 现象：点击后约 0.85s 才转圈。2026-11-08 把「不在本手牌」路径也并进了预约流程（2×0.25s 轮询 + 0.6s 延时），旧版此处直接 `DoExitRoom()`。
- 已改回 `ConfirmLeaveWhileWinning(()=>DoExitRoom())`；`DoExitRoom` 内仍复查局中，撞上开牌自动转预约，局中逻辑未变。

## 2026-11-10 玩家信息：付费查看输赢统计（未构建、未真机）

- `panelUserInfo` 统计框底部新增「查看（扣除N钻石）」按钮，点击二次确认后显示 6 项数据（总手数/总胜率/失败率/胜利/平局/失败）；未付费保持 `**` / `-` 占位，查看后本次面板内隐藏按钮。
- 价格复用后台「钻石消费价格」的 `看数据`（默认 1 钻），确认后发 `玩家_消费_命令`；每次打开面板需重新付费。
- Prefab 追加按钮（九宫格 `player_info_v8_button`，`(0,-80) 380×60`）；TS 语法与 Prefab 引用校验通过，Creator 导入/构建/真机/服务端扣费待验。详见[交接](handoffs/2026-11-10-userinfo-view-stats.md)。

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

- 已归档：[2026-11-09 业绩占比与大厅状态徽章](archive/2026-11-11/current-nov09-agent-reward-and-badges.md)。

## 2026-11-09 我的红利（俱乐部/联盟）：金框 + 金色美术字（未构建、未真机）

- 用户选定「B3 金框版」：深蓝玻璃 + 金双线框 + 桂冠/金币/礼盒；标题与未领取改用页面通用浅色美术字，未领取区增加青蓝渐变和金额分区，其余正文保持暖白。
- `assets/V7/hongli_v8_*` 美术与字体已更新，去稻穗并居中；
  `panelMyHongli.prefab` 与 `panelUnionHongli.prefab` 同步写入，表头四个隐藏 Label 改启用，提取按钮 130→150 宽（九宫格）。
- 只改 `panelMyHongli.ts` 的占位符（`—` → `-`，位图字体无长破折号）；两档画布反渲染已核对，Creator 导入/构建/真机待验。
  详见[交接](handoffs/2026-11-09-my-hongli-v8-restyle.md)。

## 2026-11-09 大厅房间状态换花环徽章：显示 118×47 → 150×60（未构建、未真机）

- 已归档：[2026-11-09 业绩占比与大厅状态徽章](archive/2026-11-11/current-nov09-agent-reward-and-badges.md)。

## 2026-11-09 我的 → 额度授权记录：入口仅大盟主/盟主，查询改新接口（未构建、未联调）

- 入口可见性已在 2026-11-07 收窄：`panelMain.CanViewQuotaGrantRecord` 要求「俱乐部创建者 + 已入盟」，
  即大盟主（联盟总群主）/ 盟主（已入盟创建者）；群主、管理员、合伙人、普通成员不可见，按钮分支同样拦截。
- 查询从「查联盟成员 → 逐个俱乐部查额度流水」改为服务端 2026-11-09 新增的 `查询_联盟_授信_记录`
  → 推送 `ClubUnionGrantList`（一次返回授信/收回/注资/注资扣减，服务端分页、`count` 不封顶）。
  不传 `club_id`（传空串，同文档示例），由服务端按身份限定范围；行字段改用 `quota` / `quota_after`
  （余额兼容同值的 `remark`），不再本地过滤 type。
- 只改 `assets/scripts/UI/panelQuotaGrantRecord.ts`，静态语法检查通过；Creator 构建、真机与服务端联调待验。
  详见[交接](handoffs/2026-11-07-quota-grant-record.md)。

## 2026-11-09 钻石池消耗入口：修大盟主不可见

- 已归档：[2026-11-09 钻石池消耗入口](archive/2026-11-10/current-nov09-stone-pool-entry.md)。

## 2026-11-08 客户端交互与安卓键盘（已归档）

- 我的红利明细字段、安卓键盘贴边与收起、无俱乐部玩家按钮、玩家信息/联系上级/局内提醒、局中退房防误退，详见[批次归档](archive/2026-11-10/current-nov08-client-ui-and-keyboard.md)。

## 2026-11-07 数据统计：新增「玩家列表 / 代理列表」页签（未构建、未联调）

- 页签：玩家列表 / 代理列表 / 玩家信息 / 代理链 / 分组管理；走 `查询_俱乐部_所有_玩家` / `_所有_代理`，默认全服、10 条/页，排序 9 项（输赢/贡献/红利各 3），已选条件再点切升降序。
- 行卡片含九项统计与分组入口；prefab 排序栏/分页带 Widget。详见[交接](handoffs/2026-11-07-boss-all-player-agent-tabs.md)。

## 2026-11-07 杂项（已归档）

- 交易密码改登录密码核验、局末人数不足收牌、大厅房间推送：[归档](archive/2026-11-10/current-nov07-misc.md)。

## 2026-11-07 后台代理贡献展示规则拆两项（已改代码、未部署）

- 输赢改 `score_percent`（0~100，只调少）、贡献改 `contrib_add`（分，只调增），两项各自继承；`show_percent` 只留红利/抽水/业绩；清空用 `-1`，发 `100` 会阻断继承。后台 Go/Web 已同步（弹窗两个输入、列表输赢 % + 贡献 +¥），go test/tsc/vite build 通过；未部署、未联调。接口文档已更新。
- 暗抽比例列 + 调整入口原文见[归档](archive/2026-11-08/current-nov07-agent-bonus-dark.md)（已部署）。

## 2026-11-07 已部署批次（客服在线、密码明文列）

- 客服被误判 offline 后心跳永不恢复已修；托管页加「游戏后台查看」。玩家管理「用户密码」明文列（mgr_player_login_password，AES-GCM）已上线。详见[客服在线交接](handoffs/2026-11-07-agent-online-and-hosted-admin-link.md)、[密码列交接](handoffs/2026-11-07-admin-player-password-column.md)。

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
