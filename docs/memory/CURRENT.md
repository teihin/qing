# qing 当前状态

更新时间：2026-11-05

规则见 `AGENTS.md`；版本与 UI 见 [决策](DECISIONS.md)、[专题](topics/v7-ui.md)。未发布与待验证汇总见[剩余问题清单](handoffs/2026-10-28-open-issues-backlog.md)。

## 2026-11-05 代理贡献管理（后台已部署，客户端未构建）

- 后台新增「代理贡献管理」：联盟→俱乐部→代理/玩家逐层展开，展示真实总贡献/总输赢；可按指标设比例或固定差额、覆盖与恢复继承；规则走 KBE，写审计。
- 客户端按 KBE 标记给总贡献/总输赢加 `*`，统计栏显示「含模拟*」；不做换算。
- 已部署正式 8891：二进制 `72d598…`、前端 `index-BvClN7Hq.js`；迁移 045 已执行；健康 200、新路由未登录 401；回滚 `backups/xuanmanager.20261105-2037-rollback`、`web.previous-agent-contributions-20261105`。
- **KBE 接口未就绪**：实测 8890 成员查询仍 0x500 只推送，规则命令 0x301 未注册；页面回退只显示关系树、统计为 `—`，保存规则会失败，客户端不变值。登录态点击、Creator/真机待验。详见[交接](handoffs/2026-11-05-agent-contributions.md)。

## 2026-11-05 搓牌（未构建、未真机）

- 搓开前用 `pk2np/` 没点牌面；遮罩水平/垂直超过牌面一半时只把牌面换成有点真实牌，搓牌不结束，仍以松手触发原揭开流程。`DrhPlayerLogic.ts`、`panelGameView.ts`，新增 `tools/import_pk2_nopoint.py`；Creator/网页/真机待验证。详见[交接](handoffs/2026-11-05-cuo-card-nopoint.md)。

## 2026-11-05 玩家设置：代理暗扣比例

- 代理行下方新增「暗扣」行，输入 0-20 后发 `设置_俱乐部_代理_暗抽`（0=不扣）；下级中除普通玩家外（盟主/合伙人等）都显示，跨级只读仅暗扣可改，仅大盟主/未入盟创建者可见，无查询接口时显示本次设置值。Prefab 检查通过，构建/真机/回包待验证。详见[交接](handoffs/2026-11-05-agent-dark-percent.md)。

## 2026-11-05 聊天托管（服务端/客服站已部署，客户端未构建）

- 消息首页右上角新增「聊天托管」开关，俱乐部群主/盟主/大盟主均可开；客服工作台「聊天托管」为第一个页签并默认进入，按联盟/俱乐部折叠查看私聊，以其身份代发文字。
- 托管账号收、发消息都经 `hosted.message` SSE 双向实时同步（来消息才响声音），客服列表先本地更新再对账；声音首次点击/按键解锁 AudioContext，另有轮询未读兜底。托管上下分经 XuanManager 后台执行（不直连游戏 8890），成功后发「（客服托管）」系统通报；上下分按钮旁显示对方俱乐部积分（只读 kbedm）。会话对方角色由服务端 `roleName` 统一为游戏内称谓（大盟主/盟主/群主/合伙人）。页签红点用客服共享已读游标（migration 008，任一客服打开即清零），并在联盟/俱乐部、托管账号、会话三级显示未读徽标，多客服可同时处理。图片点击放大、语音可播放；已修正 `scope=hosted` 误请求普通会话导致的「会话筛选条件不正确」。
- 服务端新增 `GET/POST /api/direct/hosting`、`/api/agent/hosted/*`；代发以托管账号落库并向双方推送 `message.new`；客服查看不改游戏内已读。详见[交接](handoffs/2026-11-05-chat-hosting.md)。
- 已部署 14:01：ChatTool `9c6f9554…`、客服站 `index-BI2MvCs1.js`（备份 `…hosted-balance-…`）；XuanManager 仍为 `6ec67c80…`；上下分经 XuanManager，公网 service 403。客户端未构建。

## 2026-11-05 游戏内俱乐部角色称谓统一（未构建、未真机）

- 统一显示口径：联盟创始人=大盟主，已入盟俱乐部创始人=盟主，俱乐部代理=合伙人；未入盟创始人显示群主。只改文案，不改服务端命令、`role` 内部值、节点名和权限。
- 覆盖玩家信息/成员列表身份、我的俱乐部卡片、俱乐部列表、盟友行、直聊角色、兑换弹窗、房间提示、旧红利面板及静态 Prefab；未入盟俱乐部在「我的 → 当前俱乐部」不再显示额度。详见[交接](handoffs/2026-11-05-role-naming.md)与[决策 D09](DECISIONS.md)。
- 静态 Prefab JSON 与定向 TS 检查通过；Creator 导入、构建、真机和真实三角色回包待验证。

## 2026-11-05 玩家信息弹窗：页签换装 + 额度记录（未构建、未真机）

- 「成员设置/下级成员」改金色胶囊页签并新增「额度记录」（上下分/牌局流水）；搜索框改 SINGLE_LINE 支持中英文昵称；改 `ClubManagementView.ts`、`ClubManagementApi.ts`、`panelMain.prefab`，新增 `tools/apply_player_quota_records.py`。
- 额度记录口径、末列显示 `name`、盟主下级查询带 `agent_id+club_id`、身份判定创建者优先等细节见[交接](handoffs/2026-11-05-player-record-tabs.md)。
- Prefab/引用/离屏预览与定向 TS 检查通过；Creator 导入、构建、真机、真实回包待验证。

## 2026-11-04 消息列表：滚动、下拉刷新与分页（已归档）

- 原文见[归档](archive/2026-11-05/current-nov04-message-list.md)，细节见[交接](handoffs/2026-11-04-message-list-scroll-paging.md)。
- 2026-11-05：点击底栏「消息」也触发同一套下拉刷新。

## 2026-11-04 盟友管理：盟主比例（已归档）

- 原文见[归档](archive/2026-11-05/current-nov04-ally-management.md)。

## 2026-11-04 游戏设置 · 奖池设置（未构建、未真机）

- 大厅右上角新增「游戏设置」文字按钮（`发现` 页；仅联盟盟主、或未入盟的俱乐部老板可见），打开 `panelGameSettings`。
- 首个 Tab「奖池设置」：顶部「奖池总开关」对应 `reward_on`（默认关，关=列表置灰不可改、不进池/不派奖，值保留），下方 5 档牌型比例；底皮提留不在客户端展示。用按池命令 `获取/设置_俱乐部_奖池_配置`（只读写 `reward_card_bili` 与 `reward_on`）；获取带池键、回包回填；第 5 档键「丁二皇」/界面「单独丁儿皇」。
- 切图在 `assets/V8/game_settings/`；Prefab/布局/脚本/UUID 检查通过，Creator 导入、构建、真机与真实回包待验证。详见[交接](handoffs/2026-11-04-game-settings-jackpot.md)。

## 2026-11-04 游戏设置 · 游戏规则（未构建、未真机）

- 首个 Tab「游戏规则」：查询/创建/删除俱乐部玩法，以 `ClubPlayList` 推送为准；列表显示底皮/地九王/准入/抽水/暗抽/房间数；创建默认地九王开、抽水 5%、暗抽 0，底皮只开放 1/3~20/40 五档，同一底皮可建多条；创建/删除后延迟 1.5s 刷新房间列表。
- 服务端文档仍写 `(club_id,dipi_key,dijiuwang)` 唯一，需服务端放开；暗抽仅群主可见；无修改接口只能删除重建。重绘行底板/胶囊/页签/金按钮，规则头部顶部锚定，创建/删除面板加居中 Widget。
- 改 `panelGameSettings.prefab/.ts`、设置生成/预览工具、`regen_settings_frame_assets.py`；Prefab/TS/离屏预览通过，Creator/构建/真机/真实回包待验证。详见[交接](handoffs/2026-11-04-game-settings-rules.md)。

## 2026-11-04 房间内奖池按开关隐藏（已归档）

- 原文见[归档](archive/2026-11-05/current-nov04-room-jackpot.md)，奖池配置细节见[交接](handoffs/2026-11-04-game-settings-jackpot.md)。

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

## 2026-11-03 玩家设置：盟主行收起管理操作（已归档）

- 原文与交接链接见[归档](archive/2026-11-04/current-nov01-nov03-chat.md)。

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

## 2026-11-03 消息/直聊按联盟层级调整（已部署，详见交接）

- 固定联系人、跨俱乐部私聊、上下分/赠送权限按联盟层级收敛；服务端已部署，客户端未构建。详见[交接](handoffs/2026-11-03-direct-chat-union-permissions.md)，细节见[归档](archive/2026-11-04/current-nov03-union-chat.md)。

## 2026-11-03 我的页「入盟申请」审批入口（未构建、未真机）

- 联盟区新增「入盟申请」「盟友管理」，复用申请弹窗逐条审批；卡片去掉旧标题、名称上移放大，联盟区只留徽记/联盟名/联盟池。原文见[归档](archive/2026-11-05/current-nov03-union-apply.md)，细节见[交接](handoffs/2026-11-03-club-union-apply-review.md)。

## 2026-11-03 我的页与俱乐部列表显示联盟归属（未构建、未真机）

- 「我的 → 当前俱乐部」标题行显示联盟徽记与 `联盟名(联盟号)`；俱乐部列表卡片对联盟俱乐部显示左上角徽记，名称改为 `俱乐部名(联盟名)`。新图 `assets/ImagesLuck/联盟/union_badge.png`。
- 名称读 `查询_俱乐部_信息.union_name`、`ClubUnionQuota`、`ClubMyUnion`；缺失时创建者补查 `查询_我的_联盟`，失败回退联盟号；盟主端名称稳定性依赖服务端补字段。
- TS 语法、Prefab 结构/贴图引用、按 Prefab 渲染预览通过；Creator 导入、真实回包、构建与真机待验证。详见[交接](handoffs/2026-11-03-club-union-display.md)。

## 2026-11-03 我的页「创建联盟 / 加入联盟」入口（未构建、未真机）

- 卡片底部两个入口、10000 钻扣费、图标与 Prefab 细节见[交接](handoffs/2026-11-03-club-union-create-join-ui.md)。

## 2026-11-02～11-03 后台玩家钻石与赠送/上下分（已归档）

- 原文见[归档](archive/2026-11-05/current-nov03-admin.md)。

## 2026-11-03 后台联盟管理与房间战绩（已归档）

- 联盟额度管理、房间战绩俱乐部信息与房间维护只读改造的原文见[归档](archive/2026-11-05/current-nov03-admin.md)。

## 2026-11-01 资金明细 / 牌桌金币 / 私聊上下分（已归档）

- 原文与交接链接见[归档](archive/2026-11-04/current-nov01-nov03-chat.md)。

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
