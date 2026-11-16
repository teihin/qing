# qing 当前状态

更新时间：2026-11-16

规则见 `AGENTS.md`；版本与 UI 见 [决策](DECISIONS.md)、[专题](topics/v7-ui.md)。未发布与待验证汇总见[剩余问题清单](handoffs/2026-10-28-open-issues-backlog.md)。

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

## 2026-11-14 后台靓号管理（已部署 8891）

- 命令代理、号池/绑定/解绑、玩家/俱乐部展示，页面待验收；单菜单内两页签（账号ID/俱乐部邀请码，权限各自独立），迁移 065/066 已执行、8891 已部署。详见[交接](handoffs/2026-11-14-pretty-numbers.md)。
- 2026-11-15 「我的」ID 改读 `custom_id`（回退 guuid）；未构建/真机。

## 2026-11-14 消息页：BF 关闭隐藏大盟主入口 + 盟主/群主显示（服务端已部署，客户端未构建）

- 关闭俱乐部 BF 后普通合伙人和玩家默认对话只剩所属盟主；盟主仍见大盟主，重开恢复；已有真实会话按普通会话显示。
- ChatTool 改 `defaultTargets`/`isFixedTarget`；后台 BF 弹窗提示同步；客户端缓存 v4。
- 修复已入盟创建者在消息列表、聊天标题、成员选择显示“群主”：客户端改用服务端 `roleName`，成员接口补 `roleName`。
- 修复退会/已删俱乐部的历史未读仍点亮红点：`/unread` 按会话列表可见性过滤俱乐部。
- 已部署 ChatTool `854d01e6…`（备份 `chattool.previous-unread-visible-20261114-221553`）和后台前端 `index-C3HoOUg9.js`；health 200。客户端未构建/未真机。详见[BF 交接](handoffs/2026-11-14-bf-chat-hide-union-owner.md)、[身份显示交接](handoffs/2026-11-14-chat-role-name-union-owner.md)、[红点交接](handoffs/2026-11-14-unread-visible-clubs.md)。

## 2026-11-14 后台玩家管理：关联账号/重复玩家（已部署 8891，数据待采集）

- 按《重复玩家识别-IP设备关联方案》聚合同设备（90天）、同GPS网格（7天）、同公网IP（7天）；单IP>20人、单网格>50人不参与。
- 玩家列表「关联账号数量」列在「玩家」后，表头可点按数量排序（desc→asc→默认，全局计算，上限 2000）；点「关联账号」查看全部关联玩家、方式与强度（最多200条）。
- 已部署：二进制 `bb8bdf37…`、前端 `index-magx5XK-.js` + `index-DeSwv4Lg.css`；备份 `backups/xuanmanager.20261114-005539-rollback`、`web.previous-20261114-005539`。
- 首版误用 `s.db`（webcm）导致 1146「读取关联账号失败」，已改 `s.gameDB`；两表 00:36:56 起已有写入（718968，web/127.0.0.1），采集端正常。正式设备表无 `last_ip`/`last_ip_public`，方案 §4.2/§5.3 不能原样套用。详见[交接](handoffs/2026-11-14-admin-player-relations.md)。

## 2026-11-14 后台玩家管理支持 IP 短码（已部署 8891）

- 玩家列表新增「IP短码」列（6 位 Base62，与客户端同规则），高级筛选新增「IP短码」精确匹配 `tbl_Account.sm_ip`；`admin999` 额外收到原始 `ip` 并在短码下方显示，其他账号无该字段。
- 玩家详情保持原样：明文 IP/GPS 仍仅 `admin999` 可见。
- 已部署修正版：二进制 `f2c47066…`、前端 `index-B_pOglF-.js`；备份 `backups/xuanmanager.20261114-002434-rollback`、`web.previous-20261114-002434`；health 200、未登录接口 401。详见[交接](handoffs/2026-11-14-admin-player-ip-shortcode.md)。

## 2026-11-14 BOSS 玩家信息弹窗 IP 改短码（未构建、未真机）

- `panelClubPlayerInfo.ts` 上屏前把 `ip` 转成 6 位无损可逆短码（Base62），弹窗不再出现明文 IP；IP 行右侧新增「复制」按钮，复制短码本身；非 IPv4 显示「—」。
- 服务端未改，回包仍是明文；解码规则见[接口文档 §8](../../服务器文档整理/玩家扩展信息查询-客户端接口文档.md)。后台后续还原按同一规则实现。
- 未运行 Creator 编译/构建/热更/真机。详见[交接](handoffs/2026-11-14-client-player-ip-shortcode.md)。

## 2026-11-13 批次（已部署 8891 / 8893，细节见各自交接）

- **BF 聊天开关移交后台**：ChatTool 迁移 014 建 `chat_direct_bf_club` 并拒绝客户端写入，XuanManager 迁移 063 建 `game.club.bf_chat` 与 `PUT /api/game/clubs/{clubId}/bf-chat`；客户端未构建。见[交接](handoffs/2026-11-13-club-bf-chat-admin.md)。
- **业绩核心共享发放改三阶段**：总额注入大盟主联盟池 → 下划各盟主俱乐部 → 给成员发积分；迁移 `062` 加 `stage/club_id/…` 与账单分组；有流水后总额/分摊锁定、重试幂等；**未做真实发放**。见[交接](handoffs/2026-11-13-agent-reward-club-payout.md)。
- **额度授权记录加类型显示**：行模板新增 `typelabel`（授信/收回/注资/注资扣减/额度奖励）；未构建/真机。见[交接](handoffs/2026-11-13-client-quota-grant-type.md)。
- **后台用户端数据查询** `/game/user-data`（迁移 `061`）：玩家信息/俱乐部/代理链 + 五类明细，大盟主与盟主额外看额度变化；默认 7 天、单次 ≤31 天。见[交接](handoffs/2026-11-13-admin-user-data-query.md)。

## 2026-11-12 批次（已归档）

- 客户端：两个 BOSS 入口改按管理范围、额度授权记录加类型、初始化交易密码改独立 Prefab、客服谷歌验证 + 隐藏账号。
- 后台：玩家管理大小BOSS 改看 `union_manage`/`club_manage`、业绩核心共享按日期框、新增「业绩股」总览、登录接入谷歌验证 TOTP。
- 部署与回滚信息、逐项交接链接见[11-12 批次归档](archive/2026-11-15/current-nov12-batches.md)。

## 2026-11-11 批次（已归档）

- 牌桌「带入积分」V10、我的红利「业绩股」页签、后台业绩核心共享改按联盟发放、玩家信息卡片两排三列。
- 逐项状态与交接链接见[11-11 批次归档](archive/2026-11-15/current-nov11-batches.md)。

## 2026-11-07～11-09 历史批次（已归档）

- [玩家管理发放钻石](handoffs/2026-11-09-admin-player-stone-grant.md) · [我的红利金框版](handoffs/2026-11-09-my-hongli-v8-restyle.md) · [客服在线修复](handoffs/2026-11-07-agent-online-and-hosted-admin-link.md) · [密码明文列](handoffs/2026-11-07-admin-player-password-column.md)。

## 2026-11-03～11-10 历史批次（已归档）

- 客户端：[11-10 客户端批次](archive/2026-11-12/current-nov10-client-batches.md) · [带入钻石开关](archive/2026-11-11/current-nov10-club-seat-stone.md) · [付费输赢统计](archive/2026-11-11/current-nov10-userinfo-stats.md) · [牌局优化](archive/2026-11-11/current-nov10-game-optimize.md) · [后台发牌优化](archive/2026-11-12/current-nov10-player-optimization.md)。
- 业绩/徽章/额度：[业绩占比与徽章](archive/2026-11-11/current-nov09-agent-reward-and-badges.md) · [钻石池入口](archive/2026-11-10/current-nov09-stone-pool-entry.md) · [额度授权记录](archive/2026-11-12/current-nov09-quota-grant-record.md)。
- 其它：[11-08 交互与键盘](archive/2026-11-10/current-nov08-client-ui-and-keyboard.md) · [11-07 数据统计/杂项](archive/2026-11-10/current-nov07-misc.md) · [11-07 代理贡献两项](archive/2026-11-12/current-nov07-agent-contrib-two-fields.md) · [11-03～11-06](archive/2026-11-12/current-nov03-to-nov06-batches.md)。

## 本轮实时核对：记忆整理

## 最近报告的 UI 状态

## 待核实项与工作边界

- 2026-09 原文见[归档](archive/2026-11-06/current-sep-consolidation.md)；待验证项不构成执行授权，动手前重新核实未提交差异。
