# qing 当前状态

更新时间：2026-11-04

规则见 `AGENTS.md`；版本与 UI 见 [决策](DECISIONS.md)、[专题](topics/v7-ui.md)。未发布与待验证汇总见[剩余问题清单](handoffs/2026-10-28-open-issues-backlog.md)。

## 2026-11-04 盟友管理：盟主比例显示与调整（未构建、未真机）

- 盟友行由 184 加高到 220，新增「盟主比例：X%」；底部改为「减少额度 / 增加额度 / 调整比例」三个并排按钮，输入 0-100 后发 `设置_联盟_盟主_比例`（`club_id`=目标俱乐部，100=不抽），自己俱乐部也可调整。
- 比例以后直接解析 `ClubMyUnion.members` 的 `union_percent`（当前回包只有 `union_quota` 额度/分）；未下发时盟友行显示「—」，自己那行缺省 100%，设置成功后先用本地值。
- 改 `ClubManagementView.ts`、`ClubManagementApi.ts`、`panelMain.prefab`；Prefab JSON/引用检查通过，Creator 导入、构建、真机与真实回包待验证。详见[交接](handoffs/2026-11-04-ally-ratio.md)。

## 2026-11-04 游戏设置 · 奖池设置（未构建、未真机）

- 大厅右上角新增「游戏设置」文字按钮（`发现` 页；仅联盟盟主、或未入盟的俱乐部老板可见），打开 `panelGameSettings`。
- 首个 Tab「奖池设置」：顶部「奖池总开关」对应 `reward_on`（默认关，关=列表置灰不可改、不进池/不派奖，值保留），下方 5 档牌型比例；底皮提留不在客户端展示。用按池命令 `获取/设置_俱乐部_奖池_配置`（只读写 `reward_card_bili` 与 `reward_on`）；获取带池键、回包回填；第 5 档键「丁二皇」/界面「单独丁儿皇」。
- 切图在 `assets/V8/game_settings/`；Prefab/布局/脚本/UUID 检查通过，Creator 导入、构建、真机与真实回包待验证。详见[交接](handoffs/2026-11-04-game-settings-jackpot.md)。

## 2026-11-04 房间内奖池展示按开关隐藏（未构建、未真机）

- 俱乐部房进入时隐藏顶部奖池条、实时战绩与牌局回顾的奖池信息；优先读 `获取_俱乐部_奖池_配置.reward_on` 并校验池键，普通成员无权限时按奖池金额 0 兜底。大厅/房间请求均带 `club_id`（文档已支持，优先于 `pool_key`），大厅设置保存带回读到的 `pool_key` 并校验回包；游戏设置「奖池设置」单页滚动区内含 5 档比例 + 8 档底皮余额，余额按元编辑、接口按分写 `reward_balance`，池关闭时整体置灰不可改；房间奖池弹窗走俱乐部配置接口。节点/Preview 静态核对通过，Creator/构建/真机/真实回包待验证。详见[交接](handoffs/2026-11-04-game-settings-jackpot.md)。

## 2026-11-04 我的页：联盟红利按钮与面板（未构建、未真机）

- 当前俱乐部卡片联盟区新增「联盟红利」，仅联盟创建者可见；复用「我的红利」新增 `panelUnionHongli`，`panelMyHongli` 加 `mode=union`。
- 联盟统计/明细/提取走 `ClubUnionBonusStats`、`ClubUnionBonusList`、`提取_联盟_红利`；累计=未提取+累计提取，明细“类型”列显示来源俱乐部。
- 卡片高度总群主 320→410；tsc 无新增错误、Prefab 引用/UUID 检查通过；Creator 导入/构建/真机和真实回包待验证。详见[交接](handoffs/2026-11-04-union-hongli-panel.md)。

## 2026-11-04 我的红利：改为俱乐部 V2 统计与明细（未构建、未真机）

- 顶部改用 `查询_俱乐部_红利_统计`/`ClubBonusStats`：今日/昨日新增、未提取余额、累计提取；累计红利=未提取+累计提取。明细改用 `查询_俱乐部_红利_明细`/`ClubBonusList`；提取改用 `提取_俱乐部_红利`（按全部整数元）。
- 删除账号 `hongli`/`all_hongli`、旧 `查询_俱乐部_代理_收益`、`异步_查询_红利_信息` 和 `HongliList` 回退；无 `club_id` 只提示无俱乐部。`panelHongli` 打开时补传当前俱乐部 ID。
- tsc 无新增类型错误；00:57 正式机 KBE/8890 不在线，真实回包、Creator/构建/真机待验证。详见[交接](handoffs/2026-11-04-my-hongli-club-stats.md)。

## 2026-11-04 后台玩家管理：移除加减钻石（已部署）

- 玩家管理列表去掉「加减钻石」按钮与弹窗，页头说明同步；后端删除 `POST /api/game/players/{playerId}/stone-adjustments` 及处理文件，`stone_adjust` 审计不再产生。
- 玩家列表/详情仍只读展示钻石余额；`game.player.balance_adjust` 权限与旧金币接口未动，俱乐部群主钻石池加减保留。
- 前端 `index-Cy3VHBNX.js`、后端二进制 `e055e98a…` 已部署（回滚 `backups/xuanmanager.20261104-0016-rollback`）；健康 200，旧接口返回 404，线上 JS 不含「加减钻石」。详见[交接](handoffs/2026-11-04-admin-remove-player-diamonds.md)。

## 2026-11-03 玩家设置：盟主行收起管理操作（未构建、未真机）

- 大群主在成员列表点盟主虚拟行（`role=盟主`）打开玩家设置时，收起「开通代理」开关行、「代理比例」行和「赠送」，上下分保留；改为显示独立「盟主比例」行（额度行位置），「调整」输入 0-100 后发 `设置_联盟_盟主_比例`（`club_id`=盟主俱乐部）。切页签后保持收放，按钮回调按身份拦截。
- 「下级成员」页签不再用 `is_agent=0` 跳过盟主；NumberList 每行都带自己的 `club_id`，查询统一用目标玩家自己的 `club_id` + `agent_id`。盟主行缺 `club_id` 时用 `查询_我的_联盟`（owner→club 缓存）兜底，仍取不到则报错、不回退大群主俱乐部；代理/成员缺才回退当前俱乐部。改动 `ClubManagementView.ts`、`ClubManagementApi.ts`、`panelMain.prefab`，TS/Prefab 结构通过，真实回包/Creator/构建/真机待验证。详见[交接](handoffs/2026-11-03-club-union-apply-review.md)。

## 2026-11-03 俱乐部管理与菜单顺序（已部署）

- 移除俱乐部管理「调整群主额度」按钮与弹窗；「群主额度」改只读，由大群主在游戏内调整。
- 联盟管理「加/减额度」及 `POST /api/game/unions/{unionId}/quota-adjustments` 保留，只调联盟池。
- 菜单顺序改为玩家 → 联盟 → 俱乐部；前端 `index-B77sPvpw.js`、后端 `5751cd60…` 已部署，未登录态验收。详见[交接](handoffs/2026-11-03-admin-union-management.md)。

## 2026-11-03 后台俱乐部钻石池（已部署，扣减待实测）

- 俱乐部列表/详情新增「钻石池」：读 `club_agent_info.stone`（创建者行）；新增 `POST /api/game/clubs/{clubId}/stone-pool-adjustments`，权限 `game.club.stone_pool_adjust`、迁移 `043`，加/减都走 `增加_俱乐部_钻石`（扣减传负数）并回读审计。
- Go 测试/vet、前端 lint/build 通过。已部署正式 8891：二进制 `18351c52…`、前端 `index-DzEoybUS.js`，迁移 043 已执行，健康 200、新路由未登录 401；游戏服负数支持与登录态交互未验证。详见[交接](handoffs/2026-11-03-admin-club-stone-pool.md)。

## 2026-11-03 我的页「钻石池消耗」（未构建、未真机）

- 「我的」第4行右侧新增「钻石池消耗」（有俱乐部显示，第二列版式）；独立 `panelStonePoolCost` 弹窗复用金币流向，标题/表头为时间/玩家/消耗积分/获得钻石，行模板带钻石图标。
- 接口 `查询_俱乐部_钻石兑换_记录` / `ClubStoneExchangeList`；`panelMain` 加入口。TS/Prefab/UUID/贴图检查通过；Creator/构建/真实回包待验证。详见[交接](handoffs/2026-11-03-my-stone-pool-cost.md)。

## 2026-11-03 俱乐部卡片钻石池（未构建、未真机）

- 群主卡片额度下方新增「钻石池」数量（仅群主显示）；值取 `查询_俱乐部_钻石流水`/`ClubStoneWater` 最新 `remark` 后值，进入我的/兑换/推送时刷新；`panelMain` 查询节流+推送，prefab 加文字。TS/Prefab 通过，Creator/构建/真机待验证。详见[交接](handoffs/2026-11-03-club-card-stone-pool.md)。

## 2026-11-03 我的页「上下分记录」（未构建、未真机）

- 「我的」新增「上下分记录」（有俱乐部显示），弹窗复用金币流向；接口 `查询_俱乐部_成员_积分_添加_记录`（整本俱乐部，无 user_id）/ `AddMemberGoldList`，按 `type=添加积分` 过滤；表头时间/玩家/金额/余额，行显示玩家+操作人两行。
- 新增 `panelUpDownRecord` 与两行行模板；TS/Prefab/UUID/贴图检查通过；Creator/构建/真实回包待验证。详见[交接](handoffs/2026-11-03-my-updown-record.md)。

## 2026-11-03 消息/直聊按联盟层级调整（服务端已部署，客户端未构建）

- 固定联系人改为「直属上级代理 + 本俱乐部老板 + 联盟大群主」，三级按 guuid 去重；固定会话服务端拒绝删除。普通玩家默认看到老板与（入盟后的）大群主，代理保留直属上级。
- 联盟大群主可查看联盟内任意俱乐部成员并与其一对一聊天，会话按对方俱乐部各一条；消息首页改为按参与者读取全部会话，跨俱乐部私聊可见。
- 聊天页上下分只给俱乐部老板；赠送给老板和代理；代理不再显示上下分。盟友管理行不再提供成员/聊天入口（点击会误开聊天对象选择，已移除）；成员列表里的盟主虚拟行仍可直接对话。
- 已改 `ChatTool/server/internal/directchat/*`、`DirectChatManager.ts`、`panelMessage.ts`、`panelMessageChat.ts`、`ClubManagementView.ts`、`ClubManagementApi.ts`、`panelMessageMembers.ts`。Go build/vet/test 与 TS 语法检查通过；二进制 `40fc3e4c…` 已部署（回滚 `bin/chattool.previous-union-chat-20261103-1915`），健康 200、联盟表只读可查；已随 `c77b7e5` 提交推送到 `origin/codex/club-ui`；真实账号联调、Creator/真机待验证。详见[交接](handoffs/2026-11-03-direct-chat-union-permissions.md)。

## 2026-11-03 我的页「入盟申请」审批入口（未构建、未真机）

- 联盟区域新增「入盟申请」「盟友管理」按钮：总群主判定为「已入盟且 `unionIsOwner !== false`」，缺 `is_owner` 时保留旧值并用 `查询_我的_联盟` 成功兜底；身份牌按大群主/盟主/老板显示，代理统一「代理」。已入盟以 `info.union_id` 为准，额度失败不覆盖；`union_apply` 只作状态数据，不再隐藏创建/加入联盟。
- 复用俱乐部申请弹窗：入盟申请逐条同意/拒绝（`同意_加入_联盟` / `拒绝_加入_联盟`），盟友管理列联盟池/俱乐部额度，支持增减；发现页、列表、卡片按权限显示。
- 推送实时刷新：审批/盟友列表收到推送即刷新；额度推送同步顶部并重拉「我的联盟」；`ClubUnionApply` 推送计入待审数，亮「入盟申请」红点并播 `eff/申请提示`（登录确认总群主后补查一次）。
- 卡片去掉「当前俱乐部」标题，俱乐部名/邀请码上移放大；俱乐部额度在邀请码行右侧；下方联盟区只放联盟徽记/联盟名(ID)/联盟池，与入盟申请/盟友管理同区；卡片 320 高、内容上移 60。TS/Prefab 检查通过；Creator 自动导入未刷新时需重编译/构建。详见[交接](handoffs/2026-11-03-club-union-apply-review.md)。

## 2026-11-03 我的页与俱乐部列表显示联盟归属（未构建、未真机）

- 「我的 → 当前俱乐部」标题行显示联盟徽记与 `联盟名(联盟号)`；俱乐部列表卡片对联盟俱乐部显示左上角徽记，名称改为 `俱乐部名(联盟名)`。新图 `assets/ImagesLuck/联盟/union_badge.png`。
- 名称读 `查询_俱乐部_信息.union_name`、`ClubUnionQuota`、`ClubMyUnion`；缺失时创建者补查 `查询_我的_联盟`，失败回退联盟号；盟主端名称稳定性依赖服务端补字段。
- TS 语法、Prefab 结构/贴图引用、按 Prefab 渲染预览通过；Creator 导入、真实回包、构建与真机待验证。详见[交接](handoffs/2026-11-03-club-union-display.md)。

## 2026-11-03 我的页「创建联盟 / 加入联盟」入口（未构建、未真机）

- 卡片底部两个入口、10000 钻扣费、图标与 Prefab 细节见[交接](handoffs/2026-11-03-club-union-create-join-ui.md)。

## 2026-11-03 后台玩家管理：钻石余额 + 所在俱乐部（已部署，已被 11-04 移除钻石加减覆盖）

- 详见[交接](handoffs/2026-11-03-admin-player-diamonds-clubs.md)。

## 2026-11-02 玩家设置「赠送」改口径 + 新增「上下分」（未构建、未真机）

- 赠送改走 `赠送_俱乐部_积分`；新增玩家设置上下分复用 `panelClubGoldPad`。TS/Prefab/Creator 编译通过，真实回包、构建、真机待验证。详见[交接](handoffs/2026-11-02-club-gift-updown.md)。

## 2026-11-03 后台联盟管理与「调整群主额度」（已部署）

- 新增 `/game/unions`：联盟列表/联盟池/成员数，详情跳俱乐部管理；行内「加/减额度」调整联盟池。
- 俱乐部列表加联盟列、V2 额度和「调整群主额度」：统一走 `增加_联盟_额度`（扣减传负数）；俱乐部额度仍由总群主授信。
- 09:53 部署首版（迁移 `042`），13:49 部署加/减额度，后端 `37746a0d…`、前端 `index-DY4BzOQU.js`；回滚 `backups/xuanmanager.20261103-1349-rollback` + `web.previous-union-quota-20261103-1349`；登录态/注资扣减待验收。09:59 club 模式导航隐藏「代理管理/交易记录/交易黑名单」，模块与权限保留。

## 2026-11-03 房间战绩俱乐部信息 + 房间维护只读改造（已部署）

- 房间战绩列表/详情增加俱乐部名称、俱乐部 ID、创建者和创建者邀请码；支持按俱乐部 ID/名称和创建者邀请码筛选。
- 房间维护改为按俱乐部聚合的只读页：一级俱乐部、展开二级房间，移除解散/全部解散/全局创建开关；支持按俱乐部/创建者/邀请码查询。
- 10:21 已部署正式：后端 `2865d24c…`、前端 `index-efi7NGCa.js`/`index-BJt7iv_1.css`；新接口未登录 401，已移除写接口 404；回滚 `backups/xuanmanager.20261103-1020-rollback` + `web.previous-room-clubs-20261103-1020`。未做登录态验收；KB 当前 0 个活跃房间。见[交接](handoffs/2026-11-03-admin-room-records-club-maintenance.md)。

## 2026-11-01 资金明细 / 牌桌金币 / 私聊上下分（未构建、未真机）

- 有俱乐部时资金明细走 `查询_俱乐部_积分流水`；牌桌带入/余额/邀请/兑换按房间 `club_id` 读 `Account.club_gold`；私聊四入口用 `panelClubGoldPad`。详见[牌桌金币](handoffs/2026-11-01-ingame-club-gold.md)、[私聊上下分](handoffs/2026-11-01-chat-gold-pad.md)。

## 2026-10-31～11-01（已归档）

- 俱乐部成员额度、赠送金币路由、后台俱乐部管理模块与 1 对 1 私聊的原文与交接链接见[归档](archive/2026-11-04/current-oct31-nov01-links.md)。

## 2026-10-29～10-30（阶段归档）

- 牌局回顾「翻牌」、俱乐部玩家备注、大厅底栏改版、机器人首次登录激活、投放「按周时段」、控制台小步调整、机器人密码密文、Worker 俱乐部模式、牌桌小修与实时战绩：原文与各自交接链接见[归档](archive/2026-11-01/current-oct29-30.md)。

## 2026-10-27 及更早（阶段归档）

- 自动化控制台、我的页滚动、推广下载地址、消费全切钻石与历史 UI 状态见[归档](archive/2026-10-30/current-early-items.md)。

## 本轮实时核对：记忆整理

目录 `/Volumes/SSD/qing`，Creator 2.4.13。见[整理交接](handoffs/2026-09-05-memory-migration.md)。

## 最近报告的 UI 状态

见[全套进度](handoffs/2026-09-11-v8-all-pages.md)与[逐页归档](archive/2026-09-15/ui-status-table.md)。

## 待核实项与工作边界

1. `panelQianBao.ts` “确认充值”仍显示“暂未开通”并提前返回；本轮只修选择和美术，不代表充值业务恢复。
2. V7 只覆盖有实施记录的页面；牌桌、动画等未列入范围的设计不得因归档自动判废。
3. 待验证项不构成执行授权；动手前重新核实未提交差异。

来源：[原文归档](archive/2026-09-05/AGENTS.original.md)；目录 `/Volumes/SSD/qing`，Creator 2.4.13，`build` 与 `runtime-src.zip` 保留。
