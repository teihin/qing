# 2026-11-12 批次归档（原 CURRENT.md 小节）

移出时间：2026-11-15。内容与链接原样保留，仅调整相对路径。

## 2026-11-12 客户端两个 BOSS 入口改按管理范围（已改代码、未构建）

- 「我的→数据统计」和「牌桌点头像进 BOSS 面板」改用 `GameDataManager.HasManageScope()`（`club_manage`/`union_manage` 非空），不再看 `level>=99`/董事长/总裁。
- 玩家列表/代理列表默认不带 `club_id`，查账号管理的全部俱乐部；手动选「一级过滤：俱乐部」时才带。
- 修代理链 `club_id`：列表/玩家信息/分组行点「代理链」传被查玩家自己的俱乐部，不再用当前房间俱乐部；按 ID/昵称搜索无俱乐部时回落当前 club。
- 分组：列表/成员/创建/删除/设置/移除不再传 `club_id`；四处行内恢复「分组名/添加到分组」；删除分组二次确认（继续→确认删除）。
- 未构建：`build/jsb-link` 仍是 01:21 旧产物，Creator 需重新编译/构建后再生成热更新。详见[交接](../../handoffs/2026-11-12-client-boss-entry-scope.md)。

## 2026-11-12 后台玩家管理：大小BOSS = union_manage / club_manage（已部署 8891）

- 「大小BOSS」筛选/浅红行改看 `sm_union_manage` 或 `sm_club_manage` 非空；新增「设置管理员」弹窗（迁移 059、权限 `game.player.manage_scope`），调游戏服 `异步_设置_俱乐部_管理范围` 并回读校验/审计。
- 列表与详情批量补管理范围名称；已部署 8891（二进制 `87a9b52a…`、前端 `index-CnQgFCHa.js` + `index-BXvdQkqt.css`，回滚备份见交接）。详见[交接](../../handoffs/2026-11-12-admin-player-manage-scope.md)。

## 2026-11-12 业绩核心共享：写操作改用日期框当前日期（已部署 8891）

- 计划总额/分配/分摊/发放改用日期框 `date` + 当前 `kind`，不再用 `data.plan.date`；数据与选择不一致时按钮禁用，`load/loadSummary` 丢弃过期响应。
- 前端 `index-ClSOsNS9.js` 已部署（回滚 `backups/web.20261112-2105-rollback`），登录态待验；牌局回顾 remark 第 12 段原样显示、缺段隐藏，Prefab 已加节点待验。

## 2026-11-12 后台新增「业绩股」总览（已部署 8891，页面待验）

- 游戏管理 → 业绩股：先列联盟，进入后**只展示已授权人员**（未授权不显示，已授权下级上提），含上下级与业绩比例；默认只展开根。
- 详情页「＋ 新增开通人员」：只列当前联盟**未开通的所有层级代理**（创建者或有可用邀请码 is_agent；percent=0 也可能是代理），玩家和已开通者不显示；支持ID/昵称搜索，走 `设置_俱乐部_业绩_授权`；迁移 059 加候选/授权接口与权限。
- `unions|overview`：树读 `club_agent_info`，业绩走 `异步_查询_俱乐部_业绩_报表(union_id)`，未命中即未开通。旧「奖池业绩」菜单迁移 060 隐藏（visible=0，数据和权限保留）。
- 已部署：`9708117b…`、前端 `index-OJTIozTJ.js`；health 200、未登录 401。回滚：`backups/xuanmanager.20261113-0048-rollback`、前端 `web.previous-club-perf-available-20261113-0048`。
- 未做登录态验收；报表/授权需真实联盟验证。详见[交接](../../handoffs/2026-11-12-club-perf-admin-module.md)。

## 2026-11-12 初始化交易密码改独立 Prefab（未构建、未真机）

- 初始化弹窗抽成 `panelInitTradePwd.prefab` 并以 `ShowPanelMode.Top` 打开，避免被上下分/赠送面板挡住；`panelMain.prefab` 已移除原节点，Creator/真机待验。

## 2026-11-12 后台登录接入谷歌验证 TOTP（已部署 8891，待真实账号验收）

- 登录两阶段：已绑定用户密码通过后只返回 5 分钟挑战，不建会话、不踢旧会话；校验动态码后才走原单点登录。
- 迁移 057 已执行：`mgr_user` 四个 totp 字段、恢复码表、登录挑战表、`user.reset_totp`（id=5818）。密钥 AES-GCM 加密落库；恢复码 10 个、只存哈希、一次性。
- 前端登录二步 + 顶栏「安全」绑定/恢复码/关闭；每次密码登录后未绑定弹一次提醒（可稍后）；用户管理显示绑定状态并可重置（根账号/超管不可重置）。本轮未做强制开关。
- 部署：二进制 `195001be…`、前端 `index-Zr6oThDd.js` + `index-CLU3S7Gn.css`（含输入框样式修正）；health 200、未登录接口 401。回滚：`backups/xuanmanager.20261112-1413-rollback`、`web.previous-totp-css-20261112-1436`。
- 真实绑定/扫码/二步登录/恢复码/重置待主人验收。详见[交接](../../handoffs/2026-11-12-xuanmanager-totp.md)。

## 2026-11-12 客服系统：谷歌验证 + 隐藏账号（已部署 8893）

- 登录两阶段、绑定/恢复码/关闭、登录提醒、主管重置；迁移 014/015 已执行。
- 隐藏账号 `admin999`（客服z）对他人不可见，团队/转接/在线数已过滤；前端 `index-DjuST7cE.js`；回滚 `web.previous-no-super-label-20261112-1457`。详见[交接](../../handoffs/2026-11-12-chattool-totp.md)。

