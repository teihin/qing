# CURRENT.md 归档：2026-11-15 批次

从 docs/memory/CURRENT.md 移出（2026-11-18 新增汇总条条目时控制文件体积）。原文如下。

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

- 新菜单 `/game/honor-rank`（模块 `game.honor_rank`，迁移 068）支持活动留档、修改和三榜实时排名，排名按活动时间窗直读游戏库。
- 已部署二进制 `9a34fd94…`、前端 `index-BcwSx34z.js`；迁移已执行，登录态实操待验收。详见[交接](handoffs/2026-11-15-honor-rank-module.md)。

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
