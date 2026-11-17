# qing 当前状态

更新时间：2026-11-17

规则见 `AGENTS.md`；版本与 UI 见 [决策](DECISIONS.md)、[专题](topics/v7-ui.md)。未发布与待验证汇总见[剩余问题清单](handoffs/2026-10-28-open-issues-backlog.md)。

## 2026-11-17 搓牌开关：标价 `20 钻/次` + 每次搓牌扣钻（后台已部署，客户端未构建/热更）

- 「记录」抽屉的搓牌开关右侧加价签 `20 钻/次`（金色小字，状态行上移 `y=9` 与其成两行；开关下方只有 15px，放不下第三行）。金额实时取后台「钻石消费价格」的 `搓牌` 项，配 0 显示「免费」。
- 扣费点＝搓牌窗口**松手揭开**那一刻（`DelayShowCuoInfo` 开头）发 `玩家_消费_命令`（`consume_type=搓牌`、`money_type=stone`）；按 `round_count` 去重，同一手牌只扣一次，直接点「看牌」不扣。
- 开关是付费开关：余额 < 单价时提示并复位，不下发 `player_setting=True`。
- 后台 catalog 新增 `搓牌`（默认 20，`stone_consume_price.go`），后台页动态渲染无需改前端。**2026-11-17 22:10 已部署 8891**（二进制 `91c44480…`，备份 `xuanmanager.20261117-2210-rollback`，health 200），后台「钻石消费价格」页需保存一次才写进 `usr_hash_info`。服务端是否对 `consume_type` 有白名单待确认。详见[交接](handoffs/2026-11-17-cuo-squeeze-stone-charge.md)。

## 2026-11-17 牌局优化入口改成「当前俱乐部的管理员」（脚本就绪，未构建/热更）

- 电量连点 3 下开「牌局优化」的门禁由 `IsBossAccount()`（level≥99 / 董事长 / 总裁）换成新增的 `GameDataManager.IsCurrentClubAdmin()`：`club_manage` 或 `union_manage` 任一非空（= 后台「设置管理员」的大小BOSS），再按 `roomSetting.club_id` / `union_id` 尽量比对范围。`panelGameView`（电量兜底 + `RoomFrame/完成` 热区）与 `panelGameOptimize.start()` 三处同步。
- 首版只判 `club_manage`，**联盟小BOSS（写的是 `union_manage`）被挡**——真机日志 `club_manage=` 为空即此因，已修正。
- **服务端仍是阻塞**：4 条胜率目标命令只认 `boss` 名单（`opt_target_ctrl.IsBossOnly`），管理员能开面板但设置/停止会回「无权限」，需服务端放行 `club_manage` 并按 `club_id` 限定。详见[交接](handoffs/2026-11-17-game-optimize-club-admin-entry.md)。

## 2026-11-17 后台排行榜名次奖励改成「名次区间 + 奖励」列表（已部署，仅前端）

- 名次奖励从「逗号分隔一整串」改成行列表（最高名次/最低名次/奖励/删除，可新增区间），相邻同额自动合并、改最低名次时下一行顺延。**协议不变**：提交前展开回「第 1 名起、逗号分隔」原串，后端零改动；空洞/重叠/超限红字拦住。
- 活动弹窗与行内配置两处共用 `RankRewardTiers.tsx`；前端 `index-BMTdl6pi.js`（备份 `web.previous-honorrank-tiers-20261117-1320`）。详见[交接](handoffs/2026-11-17-honor-rank-reward-tiers.md)。

## 2026-11-17 带入弹窗：在座补分积分不足也要弹提示（脚本就绪，未构建/热更）

- 根因两条：`BuyinDisplay` 在余额不够最低带入时把「确认带入」置灰（点击无事件）；`坐下_事件1` 在座补分被拒时只刷新弹窗、不弹任何提示。
- 现在「确定」恒可点，余额不足/金额非法/区间不符统一走模态提示（俱乐部房弹「俱乐部金币不足，请联系合伙人上分！」），余额不足不再发无效请求；在座补分被服务端拒绝时刷新金额 + 0.6s 中性兜底提示（服务端 PromptInfo 先到则让位），兜底弹出时**同步关掉带入窗口**。面板内红字与弹窗共用 `GetBuyinShortageText` 一套文案。
- `node tools/tests/buyin_v8_regression.js` 14 条功能用例 PASS（新增 2 条）；prefab 基线对比为既有漂移。未启动 Creator 构建，热更 manifest 仍 6.0.13。详见[交接](handoffs/2026-11-17-buyin-insufficient-prompt.md)。

## 2026-11-17 直聊：隐藏普通成员的历史大盟主会话（服务端已部署）

- 根因：旧实现只隐藏 BF 关闭后的大盟主默认入口，已有真实会话仍返回；生产只读统计有 24 条活跃大盟主会话，分布在 11 个俱乐部。
- 服务端已按 BF 关闭规则过滤会话列表、创建/恢复和消息详情，部署二进制 `a6ecd8b2…`，health 200。客户端缓存版本 `4→5`，首屏等待服务端结果，源码未构建热更；真实账号/真机待验收。详见[交接](handoffs/2026-11-17-direct-chat-union-owner-history-filter.md)。

## 2026-11-17 后台「玩家优化」更名「玩家控制」（已部署 8891）

- 只改显示文案：页面 30 处中文（标题/按钮/空态/校验/消息）、菜单图标字 `优`→`控`、服务端返回消息与游戏服操作备注 31 处、迁移 `071_player_control_rename.sql` 改菜单名与 4 条权限名/描述。模块 code、路由、权限 code、接口路径不变，角色授权不受影响。
- 文案里指向牌桌内的「运维优化」改为「牌桌内胜率目标」——客户端那个面板实际叫「牌局优化」，旧文案本就指错。`go vet`/`tsc -b`/`go test` 通过；**2026-11-17 22:10 已随搓牌价目项一起部署 8891**，迁移 071 启动时执行完毕（回读 `mgr_module.name=玩家控制`、4 条权限名已改）。前端线上包 `index-BMTdl6pi.js` 与 HEAD 构建同名同大小，无需重发。详见[交接](handoffs/2026-11-17-player-control-rename.md)。

## 2026-11-17 客户端「我的」10 个操作按钮统一美术（已替换资源，待导入/构建/真机）

- 用户确认新版效果后，将 `assets/V7/` 下 10 张正式按钮 PNG 按确认预览统一替换：上下记录、钻石池消耗、赠送金币、金币流向、兑换钻石、钻石流向、我的战绩、系统设置、额度授权记录、逃跑惩罚统计。
- 新稿统一深蓝玻璃底、金色描边、立体金色图标、字体和文字阴影；保留原 `.meta`、UUID、Prefab 节点、Button 事件和动态权限显隐，因此未改 `panelMain.prefab` 或业务脚本。
- 静态核对通过：10 个 Prefab SpriteFrame 仍指向对应正式资源 UUID，PNG 尺寸与原 `.meta` 一致，四角透明；全量 `validate_v7_responsive_layout.py` 在既有 `panelLogin.prefab/登录LOGO` alignFlags=18 与预期17处失败，未归因于本轮按钮资源。Creator 导入、网页实际预览、构建、真机和真实账号交互仍待验证。详见[交接](handoffs/2026-11-17-my-buttons-v9.md)。

## 2026-11-16 后台各模块支持按靓号查询（已部署 8891）

- 背景：业务表只存真实 ID，靓号仅在展示层替换，后台原先直接精确匹配 → 运营填靓号永远搜不到。新增 `pretty_lookup.go` 统一反解（uid 靓号→玩家ID、邀请码→俱乐部ID，号池不可用时静默退回原值），接入俱乐部/玩家/交易/用户数据/战绩/代理系/业绩/优化/封号/黑名单/奖池/防盗号/房间维护/荣誉榜/自动化 17 处；前端只改提示文案 + 业绩候选按 `prettyNo` 过滤。
- 部署与修复：21:38 首发（`9f0b72da…` / `index-kEtH9GPs.js`）；21:53 修 `buildClubWhere` 关键字分支少一层括号——追加的 `OR` 落在括号外**绕过 `club_status` 过滤**（搜 555111 捞出 init 空壳俱乐部），解析顺序改为「已绑定邀请码 > used 俱乐部 ID > 历史码」，补了括号结构断言。最终二进制 `383544d1…`、前端 `index-B3RRtU1l.js`；无迁移；health 200、clubs/transactions 未登录 401。
- 线上号池 invite 9/9、uid 12/12 可反查（`555555→828389 全新`、`123321→775447 A1俱乐部`）；`555111` 号池不存在、码表里是 `init` 未分配，属正常查不到。登录态实操待验收，详见[交接](handoffs/2026-11-16-pretty-number-search.md)。

## 2026-11-16 后台「房间战绩」逐局显示奖池 / 芒果 / 输赢 / 下注（已部署 8891）

- 逐局列表改成表格：局数/时间、本局奖池、本局芒果、本局下注、赢分、输分、差额、人数/操作、牌面；点开的每局弹窗新增奖池/芒池/下注/芒果四张摘要卡，每人卡片补「芒果净」「奖池」。
- 口径与客户端牌局回顾一致，全部取自 `usr_round_score.remark` 的 `@` 分段：2=下注、4=芒果（旧）、9=本局奖池、11=芒池、13=芒果净（11-14 起取代下标 4，页面自动择一）。同局奖池/芒池全表一致，聚合用 MAX，不会翻倍。
- 已部署：二进制 `76bc5489…`（备份 `bin/xuanmanager.previous-roomround-20261116-0112`）、前端 `index-CFeY8ZgU.js` + `index-0JIJmIWM.css`（web 备份 `web.previous-roomround2-20261116-0115`）；无迁移；health 200、战绩接口未登录 401。登录态实操待验收。详见[交接](handoffs/2026-11-16-room-round-jackpot-mango.md)。

## 2026-11-15 后台「业绩股」全局折算百分比配置（已部署 8891）

- 服务端在 `usr_hash_info` 的 `俱乐部业绩全局百分比`（**明文整数**，线上已是 `50`，10 秒热加载）折算业绩次数；后台新增 `GET/PUT /api/game/club-perf/scale` + 页面「全局折算设置」弹窗，新权限 `game.club_perf.config`（迁移 070）。
- 顺手修三个会露馅的地方：报表次数原用 `int64(anyFloat())`，50% 的 .5 会被截断（改 `float64`，两位小数）；联盟根 `root.My` 原取原始总次数（改按百分比折算）；报表缺 `scale_percent` 时按 100 兜底，避免根节点变 0。
- 已部署：二进制 `77dbde3c…`（备份 `backups/xuanmanager.20261116-0003-rollback`）、前端 `index-Bg6BsbJD.js` + `index-CCEXCQ45.css`；迁移 070 已执行、`game.club_perf.config` 授 role 1；health 200、新接口未登录 401；覆盖前用 HEAD 基线二进制体积反证同源。登录态实操待验收。详见[交接](handoffs/2026-11-15-club-perf-scale-config.md)。


## 2026-11-15 客户端「我的」新增「逃跑惩罚统计」（大盟主，未构建、未真机）

- 入口：「我的 → 操作」第 10 个按钮（额度授权记录右侧），只对联盟总群主显示；按钮美术新出 `mine_chengfa_exact.png`，同款金币箭头 + 金色描边字，**按钮上不显示金额**。
- 面板 `panelEscapePenalty`：列表/分页沿用上下分记录，表头用新美术 `money_v8_table_chengfa.png`（五列），标题与「今日应扣/到账/笔数·人数」汇总仍是 Label。
- 协议 `查询_逃跑_惩罚_统计`，回包路由 `ClubUnionChengfaStats`（**列表在 `result`，`count` 是当日总条数**），10 条/页。
- 顺带修 `ClubManagementView.syncProfileScroll`：入口行高按实际行数 ×107.17，第 6 行不再被裁。
- 未验证：Creator 未导入、未构建、未真机、接口未联调。详见[交接](handoffs/2026-11-15-escape-penalty-stats.md)。

## 2026-11-15 后台「玩家优化」改接胜率目标（代码就绪，未部署，被游戏服阻塞）

- 后台改成与牌桌内运维优化同一套：输赢金额 + 概率（`异步_设置_胜率目标`），不再用 `optimize01_count/chance`。
- 实测游戏服 4 条命令：`查询_胜率目标_列表`/`查询_胜率目标_日志` 可直接用（3ms 回包）；`设置_胜率目标`/`停止_胜率目标` 走 8890 HTTP **挂死不回包**（12s/45s 超时、无写入），需服务端加 HTTP 同步回包或后台专用命令。
- 后端/前端已改完（`go build/test/vet`、`tsc`、`vite build` 通过），写路径加了 8s 超时 + 回读兜底与明确报错。**故意不部署**：现在上线会让新增/调整/停止全部报错。详见[交接](handoffs/2026-11-15-admin-player-optimization-win-target.md)。

## 2026-11-15 后台「排行榜」独立模块：活动列表 + 创建 + 实时排名（已部署 8891）

- 新菜单 `/game/honor-rank`（模块 `game.honor_rank`，迁移 068）：列表放历史上所有排行榜活动，创建=原有配置 + 选联盟/独立俱乐部，点开可看实时排名（三榜 + 手数 5 档位）。
- 单个活动**可修改**（`PUT /activities/{id}`，就地更新留档并重下发 7 行；被新活动取代的只读）。
- 游戏服只有「每个 scope 一份当前配置」，故后台自建留档表 `mgr_honor_rank_activity`；旧入口（俱乐部/联盟行内）保存也留档（开启新增、关闭标记）。
- 排名**直读游戏库**按活动自己的时间窗统计（后台直调 `查询_俱乐部_活动_*` 客户端命令返回 1280，走不通）。口径见交接。
- 已部署：二进制 `9a34fd94…`（2026-11-15 18:50 二次部署，含活动修改）、前端 `index-BcwSx34z.js` + `index-D8neILzi.css`；迁移 068 已执行（模块 id 64、权限授予 role 1/4、活动表 0 行）；health 200、新接口未登录 401。登录态实操待验收。详见[交接](handoffs/2026-11-15-honor-rank-module.md)。

## 2026-11-15 后台玩家详情「所在俱乐部」显示完整代理链（已部署 8891）

- 玩家管理 → 查看详情 →「所在俱乐部」页签：每个俱乐部卡片新增「完整代理链」，本人 → 直属上级 → … → 群主/盟主 → 大盟主，逐环显示昵称、ID、角色。
- 后端 `handleGetPlayerClubs` 返回 `chain`（新增 `buildPlayerClubChain`）：沿 `club_agent_info.upper_guuid` 回溯，最多 16 环；成环截断；上级不在本俱乐部时标 `missing` 并停止回溯，不伪造；末尾按俱乐部归属补创建者与联盟大盟主。
- 已部署：二进制 `5352ea1f…`、前端 `index-BuFYhlh_.js` + `index-D2TbASBz.css`；备份 `bin/xuanmanager.previous-playerchain-20261115-1740`、`web.previous-playerchain-20261115-1740`。无迁移。登录态人工验收待做。详见[交接](handoffs/2026-11-15-player-club-chain.md)。

## 2026-11-15 俱乐部荣耀榜：后台开关 + 客户端切俱乐部榜（未构建、未部署）

- 需求：大厅全平台排行榜改成俱乐部模式；后台按**联盟/独立俱乐部**单独开榜（总开关 + 手数/赢分/红利三榜开关 + 共用起止时间）。
- 服务端 v2.6 用「`club_honor_rank_reward` 加 5 列 + 扩展原奖励命令」实现，一行 = 一个（scope, 榜, 档位），共 7 行；后台把「总开关+三榜开关+共用时间」展开成 7 行逐条写，读时聚合并标混合状态。
- 本轮落地：后台（`club_honor_rank.go`、`067` 迁移、`HonorRankModal`、俱乐部/联盟行内入口）+ 客户端（`panelPaihangbang` 双通道、俱乐部榜不领取、业务文案直接显示、不可用时回落全平台榜）。
- Go 单测与 `tsc` 通过，客户端未构建；服务端 v2.6 未部署。详见[交接](handoffs/2026-11-15-club-honor-rank.md)。

## 2026-11-15 BF 聊天入口改为默认关闭（已部署 8891/8893）

- 后台「俱乐部管理 → BF聊天」默认值由开启改关闭：无俱乐部记录、无俱乐部账号都看不到消息页置顶入口，需要时后台逐个开启。
- 存量一并关停：`chat_direct_bf_club` 10 行、旧表 `chat_direct_bf_entry` 2 行全部 `enabled=0`。
- 已部署 ChatTool `b1ba8f54…`、XuanManager `580586bf…`、前端 `index-Ccu1-Dt0.js`；health 200、公网页面已换新资源。客户端未改代码（只读 `visible`），未构建/未真机；后台登录态实操待验收。详见[交接](handoffs/2026-11-15-bf-chat-default-off.md)。

## 更早批次

- 2026-11-14 批次（后台靓号、BF 消息规则、玩家关联账号/IP 短码、客户端 BOSS IP 短码）见 [`archive/2026-11-17/current-nov14-batches.md`](archive/2026-11-17/current-nov14-batches.md)。
- 2026-11-13 批次（BF 聊天开关移交后台、业绩核心共享三阶段发放、额度授权记录类型、后台用户端数据查询）见 [`archive/2026-11-15/current-nov13-batches.md`](archive/2026-11-15/current-nov13-batches.md)。
- 2026-11-03～11-09 的历史客户端、额度、牌局和后台批次见 [`docs/memory/archive/`](archive/2026-11-15/)。

## 本轮实时核对：记忆整理

## 最近报告的 UI 状态

## 待核实项与工作边界

- 2026-09 原文见[归档](archive/2026-11-06/current-sep-consolidation.md)；待验证项不构成执行授权，动手前重新核实未提交差异。
