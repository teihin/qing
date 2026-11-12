# qing 当前状态

更新时间：2026-11-12

规则见 `AGENTS.md`；版本与 UI 见 [决策](DECISIONS.md)、[专题](topics/v7-ui.md)。未发布与待验证汇总见[剩余问题清单](handoffs/2026-10-28-open-issues-backlog.md)。

## 2026-11-12 客户端两个 BOSS 入口改按管理范围（已改代码、未构建）

- 「我的→数据统计」和「牌桌点头像进 BOSS 面板」改用 `GameDataManager.HasManageScope()`（`club_manage`/`union_manage` 非空），不再看 `level>=99`/董事长/总裁。
- 玩家列表/代理列表默认不带 `club_id`，查账号管理的全部俱乐部；手动选「一级过滤：俱乐部」时才带。
- 修代理链 `club_id`：列表/玩家信息/分组行点「代理链」传被查玩家自己的俱乐部，不再用当前房间俱乐部；按 ID/昵称搜索无俱乐部时回落当前 club。
- 分组：列表/成员/创建/删除/设置/移除不再传 `club_id`；四处行内恢复「分组名/添加到分组」；删除分组二次确认（继续→确认删除）。
- 未构建：`build/jsb-link` 仍是 01:21 旧产物，Creator 需重新编译/构建后再生成热更新。详见[交接](handoffs/2026-11-12-client-boss-entry-scope.md)。

## 2026-11-12 后台玩家管理：大小BOSS = union_manage / club_manage（已部署 8891）

- 玩家列表浅红行与「大小BOSS」筛选改为 `sm_union_manage` 或 `sm_club_manage` 非空，不再看等级 99 / 董事长 / 总裁；列表新增 `unionManage` / `clubManage`。
- 玩家管理新增「管理范围」弹窗与 `POST /api/game/players/{playerId}/manage-scope`：调游戏服 `异步_设置_俱乐部_管理范围`，回读两列校验、并发旧值 409、全程审计；迁移 059 已执行，权限 `game.player.manage_scope` id=5820、3 个角色授权。
- 弹窗改为直接勾选：`GET /api/game/players/manage-scope/options` 返回全部启用联盟 + 未入盟独立俱乐部，支持搜索多选，不再手输编号。
- 列表与玩家详情按名称展示管理范围（后端批量补 `unionManageNames` / `clubManageNames`），名称缺失回退编号。
- 已部署：二进制 `87a9b52a…`、前端 `index-CnQgFCHa.js` + `index-BXvdQkqt.css`；行内按钮「管理范围」已改名「设置管理员」，仅切前端目录、服务未重启；health 200、未登录接口 401。回滚：二进制 `backups/xuanmanager.20261112-2131-rollback`（`d38c4081…`）、前端 `web.previous-adminlabel-20261112-2229`。
- 游戏服 `sm_union_manage` 列与 `异步_设置_俱乐部_管理范围` 命令已探测可用；当前库中 0 个账号配置范围，需在页面配置后才会标红。页面实操待验。详见[交接](handoffs/2026-11-12-admin-player-manage-scope.md)。

## 2026-11-12 业绩核心共享：写操作改用日期框当前日期（已部署 8891）

- 报错「本次名单在 2026-11-01…」是请求真带了 11-01（审计与游戏服日志同刻 `date=-11`，该标签页日期框就在 11-01）；游戏库 `club_perf_contrib_info` 联盟 196102 仅 11-12 有记录，11-01/11-11 为空，报表全 0。
- 计划总额/分配金额/分摊/发放改用日期框 `date` + 当前 `kind`，不再用 `data.plan.date`；数据与当前选择不一致时按钮禁用并提示；`load`/`loadSummary` 加序号丢弃过期响应。
- 部署前端 `index-ClSOsNS9.js`（`38688b83…`，公网校验一致），health 200、未登录 401；回滚 `backups/web.20261112-2105-rollback`。登录态页面实操待验。

## 2026-11-12 牌局回顾显示本局芒池
- 解析 remark 第 12 段显示「本局芒池:数字」，缺段自动隐藏；`panelGameView.prefab`/`drh8.fire` 已加节点，待验。

## 2026-11-12 后台新增「业绩股」总览（已部署 8891，页面待验）

- 游戏管理 → 业绩股：先列联盟，进入后**只展示已授权人员**（未授权不显示，已授权下级上提），含上下级与业绩比例；默认只展开根。
- 详情页「＋ 新增开通人员」：只列当前联盟**未开通的所有层级代理**（创建者或有可用邀请码 is_agent；percent=0 也可能是代理），玩家和已开通者不显示；支持ID/昵称搜索，走 `设置_俱乐部_业绩_授权`；迁移 059 加候选/授权接口与权限。
- `unions|overview`：树读 `club_agent_info`，业绩走 `异步_查询_俱乐部_业绩_报表(union_id)`，未命中即未开通。旧「奖池业绩」菜单迁移 060 隐藏（visible=0，数据和权限保留）。
- 已部署：`9708117b…`、前端 `index-OJTIozTJ.js`；health 200、未登录 401。回滚：`backups/xuanmanager.20261113-0048-rollback`、前端 `web.previous-club-perf-available-20261113-0048`。
- 未做登录态验收；报表/授权需真实联盟验证。详见[交接](handoffs/2026-11-12-club-perf-admin-module.md)。

## 2026-11-12 初始化交易密码改独立 Prefab（未构建、未真机）

- 「玩家信息 → 上下分」未设交易密码时的初始化弹窗原为 `panelMain` 子节点，被 Top 层上下分/赠送面板挡住；已抽出 `panelInitTradePwd.prefab`，改以 `ShowPanelMode.Top` 打开，校验/提示同走 Top，回包由 `panelMain` 转发给 `OnSubmitResult`。
- 已从 `panelMain.prefab` 移除原节点并重排 `__id__`；引用/可达性检查通过。新脚本补 `@ccclass`（漏写则按钮无响应），Creator 编译/构建/真机待验。

## 2026-11-12 后台登录接入谷歌验证 TOTP（已部署 8891，待真实账号验收）

- 登录两阶段：已绑定用户密码通过后只返回 5 分钟挑战，不建会话、不踢旧会话；校验动态码后才走原单点登录。
- 迁移 057 已执行：`mgr_user` 四个 totp 字段、恢复码表、登录挑战表、`user.reset_totp`（id=5818）。密钥 AES-GCM 加密落库；恢复码 10 个、只存哈希、一次性。
- 前端登录二步 + 顶栏「安全」绑定/恢复码/关闭；每次密码登录后未绑定弹一次提醒（可稍后）；用户管理显示绑定状态并可重置（根账号/超管不可重置）。本轮未做强制开关。
- 部署：二进制 `195001be…`、前端 `index-Zr6oThDd.js` + `index-CLU3S7Gn.css`（含输入框样式修正）；health 200、未登录接口 401。回滚：`backups/xuanmanager.20261112-1413-rollback`、`web.previous-totp-css-20261112-1436`。
- 真实绑定/扫码/二步登录/恢复码/重置待主人验收。详见[交接](handoffs/2026-11-12-xuanmanager-totp.md)。

## 2026-11-12 客服系统：谷歌验证 + 隐藏账号（已部署 8893）

- 登录两阶段、绑定/恢复码/关闭、登录提醒、主管重置；迁移 014/015 已执行。
- 隐藏账号 `admin999`（显示名 客服z）对他人不可见，团队/转接/在线数已过滤；二进制 `ca7715…`、前端 `index-DjuST7cE.js`；回滚 `web.previous-no-super-label-20261112-1457`。详见[交接](handoffs/2026-11-12-chattool-totp.md)。

## 2026-11-12 后台玩家管理：BOSS 号行标红（已被大小BOSS口径替代）

- 原按 `sm_level >= 99` / 董事长 / 总裁 标红；现已改为 `union_manage` / `club_manage` 非空，见上方小节。旧交接：[2026-11-12-player-list-boss-row](handoffs/2026-11-12-player-list-boss-row.md)。

## 2026-11-11 消息页 BF 聊天显示开关（服务端已部署、客户端未构建）

- 顶部新增「BF 聊天」开关，只对俱乐部创建者（大盟主/盟主/未入盟群主）显示，默认开启；关闭后该创建者俱乐部所有层级都看不到置顶 BF 行，创建者自己也隐藏。
- 服务端新增 `chat_direct_bf_entry` 与 `GET/POST /api/direct/bf-entry`（无记录按开启）；`panelMessage.prefab` 加带 Widget 的开关行并按可见性重排列表顶部。
- ChatTool 已部署：二进制 `fc2884e4…`、迁移 013 已执行、`/api/direct/bf-entry` 未登录 401、health 200；Go 测试、TS 语法、prefab 引用与两档反渲染通过。Creator 构建、真机与联调待验。详见[交接](handoffs/2026-11-11-message-bf-entry-switch.md)。

## 2026-11-11 牌桌「带入积分」V10（未构建、未真机）

- `panelGameView.prefab` 与 `assets/Scenes/drh8.fire` 同步重做 V10：深蓝亮蓝光影、干净标题、居中大数字、最低/最高固定列、四处美术字、移除编辑图标、实时扣钻、两行积分、钻石余额和参考图按钮。
- `BuyinDisplay` 按积分→钻石比例刷新扣钻；关闭带入钻石时隐藏两行，原滑杆、确认/取消和协议保留；新增节点带 Widget。
- TS、引用、Widget、两档预览和扣钻回归通过；Creator、构建、真机、回包待验。详见[交接](handoffs/2026-11-11-buyin-points-v9.md)。

## 2026-11-11 我的红利：新增「业绩股」页签（2026-11-12 按 v6 联盟树改造）

- 我的红利/业绩股双页签；联盟红利仍只有红利页。非业绩股成员只隐藏「业绩股」页签（「我的红利」页签保留并居中），判断用 `ClubPerfInfo.enabled`。
- v6：渲染 `leaders`（盟主行含俱乐部/整线次数/占比/授权状态），盟主只授权不取消，已授权显示「已授权」；成员行只读；授权后 1.0s/2.4s 刷新。
- 抓包 775447/267493 已确认是联盟层盟主授权；服务端 v6 需部署重启才有 `scope`/`leaders`。Prefab/TS/JSON 检查通过，Creator/真机/联调待验。详见[交接](handoffs/2026-11-11-my-hongli-perf-tab.md)。

## 2026-11-11 后台业绩核心共享：三类奖励统一按业绩股比例（已部署，游戏服命令待生效）

- 业绩 / 核心 / 奖池共享的自动分摊权重统一改为 `异步_查询_俱乐部_业绩_报表` 的净次数
  （`left_count`），本次名单内归一；核心不再按上次金额、奖池不再按今日输赢。
- 发放日期默认昨天（今天未结算）；未来日期前后端都拦截，业绩报表按批次日期换算 `date` 偏移（昨天 = -1）。
- 奖池历史日期优先用批次保存时的 `pool_base` 快照，没有快照才退回实时奖池并提示；只有当天保存才写快照。
- 页面表格改为业绩(毛次) / 净业绩(次) / 业绩占比，移除线输赢列；Go/Web 构建与检查通过。
- 已部署 8891：二进制 `b2301972…`（10,293,432 字节）、前端 `index-DQ5-lFku.js`（CSS 不变）；health 200、发放接口未登录 401。
  回滚：`backups/xuanmanager.20261111-2306-rollback`、`web.previous-agent-reward-perf-ratio-20261111-2306`。
  新报表命令用真实联盟（名单 6 人）探测 2 分钟未返回，待游戏服重启 baseapp 后复验。详见[交接](handoffs/2026-11-11-agent-reward-perf-ratio.md)。

## 2026-11-11 后台业绩核心共享：改为按联盟发放（已部署）

- 入口先列联盟，点进后才进入原发放页；名单、方案、金额、发放、账单、线数据全部按当前联盟过滤。
- 迁移 055 给计划表与名单方案加 `union_id` 并改唯一键/回填历史；跨联盟选人由后端拒绝（选人、金额、排除、子账号、账单都会校验），换联盟同步会把 `selected` 置 0。
- 已部署 8891（二进制 `0c558b28…`、前端 `index-BDfIIHx6.js`）；迁移已执行：7 计划回填、9 无归属，29 代理有联盟、2 无。`go build/test/vet`、`tsc/eslint/vite build` 通过；未登录实操验收。详见[交接](handoffs/2026-11-11-agent-reward-union-scope.md)。

## 2026-11-10 客户端批次（已归档）

- 钻石池同秒取值、消耗两页签、实时房房费、奖池两位小数、退出 loading，原文见[归档](archive/2026-11-12/current-nov10-client-batches.md)；带入钻石开关见[归档](archive/2026-11-11/current-nov10-club-seat-stone.md)。

## 2026-11-10 玩家信息：付费查看输赢统计（已归档）

- 统计框付费查看 6 项数据与扣钻确认，详见[归档](archive/2026-11-11/current-nov10-userinfo-stats.md)。

## 2026-11-11 玩家信息卡片（未构建、未真机）

- `panelUserInfo` 统计区改为两排三列蓝卡：上排总手数/总胜率/摊牌率，下排胜利/平局/失败；沿用 `remark[3]`。
- 统计框调整、道具下移并补 Widget；TS、引用、1334/1624 预览通过，构建/真机/联调待验。详见[交接](handoffs/2026-11-11-userinfo-stats-layout.md)。

## 2026-11-10 牌桌内「牌局优化」（已归档）

- 电量三连击入口、运维优化页与通用选人弹窗，详见[归档](archive/2026-11-11/current-nov10-game-optimize.md)。

## 2026-11-10 后台发牌优化（已归档）

- 改用 `异步_设置_玩家_属性`、概率正负区间与回读校验，详见[归档](archive/2026-11-12/current-nov10-player-optimization.md)。

## 2026-11-09 后台玩家管理：发放钻石 + 发放记录（已部署，游戏服命令待部署）

- 玩家管理新增「发放钻石」：调游戏服 `异步_增加_玩家_钻石`，回读 `sm_stone` 后写 `game.player.grant_stone` 审计；「发放记录」按操作账号、玩家、数量、前后余额、原因、时间分页追溯成功发放。
- 新权限 `game.player.grant_stone`。首版迁移 053 误用已占用的 id=2103，覆盖了「重置玩家密码」名称；054 已恢复并用自增 id（5815）建新权限，053 源码改为不写死 id。
- XuanManager 已发布 8891（health 200，前端 `index-BL3MOz60.js`，二进制 `97ebc419…`）。**游戏服命令探测仍返回 769 空结果，尚未部署**，复核时 8890 已停止监听。页面会明确提示先部署游戏服。未登录验收、未做真实发放。详见[交接](handoffs/2026-11-09-admin-player-stone-grant.md)。

## 2026-11-09 后台业绩核心共享：三栏常驻「今日业绩占比」

- 已归档：[2026-11-09 业绩占比与大厅状态徽章](archive/2026-11-11/current-nov09-agent-reward-and-badges.md)。

## 2026-11-09 我的红利（俱乐部/联盟）：金框 + 金色美术字（未构建、未真机）

- B3 金框版（深蓝玻璃/金双线/桂冠金币礼盒）已写入两套 Prefab 与 `hongli_v8_*`，表头 Label 启用、提取按钮 130→150 宽，占位符改 `-`；两档反渲染通过。详见[交接](handoffs/2026-11-09-my-hongli-v8-restyle.md)。

## 2026-11-09 大厅花环徽章 / 钻石池消耗入口（已归档）

- 花环徽章 118×47→150×60 与业绩占比见[归档](archive/2026-11-11/current-nov09-agent-reward-and-badges.md)；钻石池入口见[归档](archive/2026-11-10/current-nov09-stone-pool-entry.md)。

## 2026-11-09 我的 → 额度授权记录（已归档）

- 入口限创建者+已入盟，查询 `查询_联盟_授信_记录`、服务端按身份限定俱乐部；未构建未联调，原文见[归档](archive/2026-11-12/current-nov09-quota-grant-record.md)。

## 2026-11-08 客户端交互与安卓键盘（已归档）

- 我的红利明细字段、安卓键盘贴边与收起、无俱乐部玩家按钮、玩家信息/联系上级/局内提醒、局中退房防误退，详见[批次归档](archive/2026-11-10/current-nov08-client-ui-and-keyboard.md)。

## 2026-11-07 数据统计页签 / 杂项（已归档）

- 玩家、代理列表页签与统计见[交接](handoffs/2026-11-07-boss-all-player-agent-tabs.md)；交易密码核验、局末人数不足收牌、大厅房间推送见[归档](archive/2026-11-10/current-nov07-misc.md)。

## 2026-11-07 后台代理贡献展示规则拆两项（已归档）

- 输赢 `score_percent` / 贡献 `contrib_add` 两项独立继承、`show_percent` 只留红抽业绩；原文见[归档](archive/2026-11-12/current-nov07-agent-contrib-two-fields.md)。

## 2026-11-07 已部署批次（客服在线、密码明文列）

- 客服被误判 offline 后心跳永不恢复已修；托管页加「游戏后台查看」。玩家管理「用户密码」明文列（mgr_player_login_password，AES-GCM）已上线。详见[客服在线交接](handoffs/2026-11-07-agent-online-and-hosted-admin-link.md)、[密码列交接](handoffs/2026-11-07-admin-player-password-column.md)。

## 2026-11-03～11-06 历史批次（已归档）

- 11-03～11-06 各批次原文与链接见[归档](archive/2026-11-12/current-nov03-to-nov06-batches.md)。

## 本轮实时核对：记忆整理

## 最近报告的 UI 状态

## 待核实项与工作边界

- 2026-09 原文见[归档](archive/2026-11-06/current-sep-consolidation.md)；待验证项不构成执行授权，动手前重新核实未提交差异。
