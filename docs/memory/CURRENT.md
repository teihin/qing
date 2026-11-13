# qing 当前状态

更新时间：2026-11-13

规则见 `AGENTS.md`；版本与 UI 见 [决策](DECISIONS.md)、[专题](topics/v7-ui.md)。未发布与待验证汇总见[剩余问题清单](handoffs/2026-10-28-open-issues-backlog.md)。

## 2026-11-13 BF 聊天开关移交后台（已部署 8891/8893）

- 隐藏开关，置顶入口保留；后台按俱乐部开关，默认开启。ChatTool 迁移 014 建 `chat_direct_bf_club`，拒绝客户端写入；XuanManager 迁移 063 建 `game.club.bf_chat` 与 `PUT /api/game/clubs/{clubId}/bf-chat`。两端 health 200；客户端未构建。见[交接](handoffs/2026-11-13-club-bf-chat-admin.md)。

## 2026-11-13 业绩核心共享：发放改三阶段（已部署 8891，真实发放待验）

- 「确认并发放」改为：① `发放_总群主_奖励` 把本批总额（元×100=额度分）注入大盟主联盟池；② 按俱乐部汇总下属成员金额，`发放_盟主_奖励` 下划到各盟主俱乐部；③ `异步_发放_玩家_奖励` 给成员发俱乐部积分（同俱乐部同金额合并、单批 20 人）。
- 迁移 `062_agent_reward_club_payout.sql` 给 `mgr_agent_reward_payout` 加 `stage/club_id/club_name/subject_name/description/quota_before/quota_after`；账单按「平台→大盟主→盟主→成员」分组展示并给出详细说明。
- 批次一旦产生 `paid/pending/waiting/mismatch` 流水，总额/金额/重新分摊全部锁定；重试按额度余额、积分流水与房间状态幂等处理。
- 已部署：二进制 `b6d68684…`、前端 `index-BIGNTpl-.js`；迁移已自动执行，health 200、账单未登录 401。账单弹窗已改为 1180px 宽 + 6 列合并 + 吸顶表头；名单新增「代理链」列并同步导出 CSV（按 `upper_id` 回溯，超长省略/悬停看全链）。回滚：`backups/xuanmanager.20261113-2221-rollback`、`backups/web.20261113-2223-rollback`。
- 未做真实发放（未动真实资金/积分）；登录态页面与到账需用测试联盟实测。详见[交接](handoffs/2026-11-13-agent-reward-club-payout.md)。

## 2026-11-13 客户端「额度授权记录」增加类型显示（未构建、未真机）

- 行模板 `额度授权记录对象.prefab` 新增 `typelabel`，在盟主名下方显示「类型：授信/收回/注资/注资扣减/额度奖励」；`panelQuotaGrantRecord.ts` 读取 `type` 写入。
- 未运行 Creator 导入/编译/构建；需重导 Prefab、编译脚本并热更后实机确认长类型不截断。详见[交接](handoffs/2026-11-13-client-quota-grant-type.md)。

## 2026-11-13 后台「用户端数据查询」（已部署 8891）

- 游戏管理只读入口 `/game/user-data`：按玩家 ID 查看基本信息（角色、注册时间、版本、管理范围）、所在俱乐部与身份、代理链，以及上下分、赠送金币、金币流向、钻石流向、收益红利（排除 `clubtotal` 基线）五类明细。
- 大盟主 / 盟主（已入盟俱乐部的创建者）额外显示「额度变化记录」：`club_history_info` 的 `opt_type LIKE '额度%' AND user_quota<>0`，分→元，涵盖带入/结算/联盟授信/平台注资/平台奖励；其他玩家请求返回 403。代理链按每个俱乐部独立回溯 `club_agent_info.upper_guuid` 到创建者再到大盟主，合伙人以 used 邀请码为准。
- 迁移 `061_user_data_query.sql`：模块 `game.user_data`、权限 `game.user_data.view`。接口 `GET /api/game/user-data/profile|records`，默认最近 7 天、单次最多 31 天。
- 已部署 8891：后端 `c3b81f4f…`、前端 `index-BlT_8jCE.js` + `index-CLlbA0eV.css`；health 200、未登录接口 401。回滚：`backups/xuanmanager.20261113-2244-rollback`（原始 `b6d68684…`）、`web.previous-userdata-20261113-2244`。未做登录态页面视觉验收。详见[交接](handoffs/2026-11-13-admin-user-data-query.md)。

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
- 牌局回顾：remark 第 12 段原样显示服务端字符串（不再拼前缀），缺段隐藏；`panelGameView.prefab`/`drh8.fire` 已加节点，待验。

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

## 2026-11-11 牌桌「带入积分」V10（未构建、未真机）

- `panelGameView.prefab` / `drh8.fire` 重做 V10 并接入钻石扣费；Creator、构建、真机、回包待验。详见[交接](handoffs/2026-11-11-buyin-points-v9.md)。

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

## 2026-11-11 玩家信息卡片（未构建、未真机）

- `panelUserInfo` 统计区改为两排三列蓝卡：上排总手数/总胜率/摊牌率，下排胜利/平局/失败；沿用 `remark[3]`。
- 统计框调整、道具下移并补 Widget；TS、引用、1334/1624 预览通过，构建/真机/联调待验。详见[交接](handoffs/2026-11-11-userinfo-stats-layout.md)。

## 2026-11-09 后台玩家管理：发放钻石 + 发放记录（已部署，游戏服命令待部署）

- 新增「发放钻石」与「发放记录」，走游戏服 `异步_增加_玩家_钻石` 并回读审计；权限 `game.player.grant_stone`，迁移 053/054 已修正权限 id 冲突。
- XuanManager 已发布 8891；游戏服命令当时探测 769 未注册。详见[交接](handoffs/2026-11-09-admin-player-stone-grant.md)。

## 2026-11-09 我的红利（俱乐部/联盟）：金框 + 金色美术字（未构建、未真机）

- B3 金框版（深蓝玻璃/金双线/桂冠金币礼盒）已写入两套 Prefab 与 `hongli_v8_*`，表头 Label 启用、提取按钮 130→150 宽，占位符改 `-`；两档反渲染通过。详见[交接](handoffs/2026-11-09-my-hongli-v8-restyle.md)。

## 2026-11-07 已部署批次（客服在线、密码明文列）

- 客服被误判 offline 后心跳永不恢复已修；托管页加「游戏后台查看」。玩家管理「用户密码」明文列（mgr_player_login_password，AES-GCM）已上线。详见[客服在线交接](handoffs/2026-11-07-agent-online-and-hosted-admin-link.md)、[密码列交接](handoffs/2026-11-07-admin-player-password-column.md)。

## 2026-11-03～11-10 历史批次（已归档）

- 客户端：[11-10 客户端批次](archive/2026-11-12/current-nov10-client-batches.md) · [带入钻石开关](archive/2026-11-11/current-nov10-club-seat-stone.md) · [付费输赢统计](archive/2026-11-11/current-nov10-userinfo-stats.md) · [牌局优化](archive/2026-11-11/current-nov10-game-optimize.md) · [后台发牌优化](archive/2026-11-12/current-nov10-player-optimization.md)。
- 业绩/徽章/额度：[业绩占比与徽章](archive/2026-11-11/current-nov09-agent-reward-and-badges.md) · [钻石池入口](archive/2026-11-10/current-nov09-stone-pool-entry.md) · [额度授权记录](archive/2026-11-12/current-nov09-quota-grant-record.md)。
- 其它：[11-08 交互与键盘](archive/2026-11-10/current-nov08-client-ui-and-keyboard.md) · [11-07 数据统计/杂项](archive/2026-11-10/current-nov07-misc.md) · [11-07 代理贡献两项](archive/2026-11-12/current-nov07-agent-contrib-two-fields.md) · [11-03～11-06](archive/2026-11-12/current-nov03-to-nov06-batches.md)。

## 本轮实时核对：记忆整理

## 最近报告的 UI 状态

## 待核实项与工作边界

- 2026-09 原文见[归档](archive/2026-11-06/current-sep-consolidation.md)；待验证项不构成执行授权，动手前重新核实未提交差异。
