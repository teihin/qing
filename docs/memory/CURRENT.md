# qing 当前状态

更新时间：2026-11-15

规则见 `AGENTS.md`；版本与 UI 见 [决策](DECISIONS.md)、[专题](topics/v7-ui.md)。未发布与待验证汇总见[剩余问题清单](handoffs/2026-10-28-open-issues-backlog.md)。

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

## 2026-11-13 BF 聊天开关移交后台（已部署 8891/8893）

- 隐藏开关，置顶入口保留；后台按俱乐部开关，默认开启。ChatTool 迁移 014 建 `chat_direct_bf_club`，拒绝客户端写入；XuanManager 迁移 063 建 `game.club.bf_chat` 与 `PUT /api/game/clubs/{clubId}/bf-chat`。两端 health 200；客户端未构建。见[交接](handoffs/2026-11-13-club-bf-chat-admin.md)。

## 2026-11-13 业绩核心共享：发放改三阶段（已部署 8891，真实发放待验）

- 「确认并发放」改为：① `发放_总群主_奖励` 把本批总额（元×100=额度分）注入大盟主联盟池；② 按俱乐部汇总下属成员金额，`发放_盟主_奖励` 下划到各盟主俱乐部；③ `异步_发放_玩家_奖励` 给成员发俱乐部积分（同俱乐部同金额合并、单批 20 人）。
- 迁移 `062_agent_reward_club_payout.sql` 给 `mgr_agent_reward_payout` 加 `stage/club_id/club_name/subject_name/description/quota_before/quota_after`；账单按「平台→大盟主→盟主→成员」分组展示并给出详细说明。
- 批次一旦产生 `paid/pending/waiting/mismatch` 流水，总额/金额/重新分摊全部锁定；重试按额度余额、积分流水与房间状态幂等处理。
- 已部署：二进制 `b6d68684…`、前端 `index-BIGNTpl-.js`；迁移已自动执行，health 200、账单未登录 401。账单弹窗已改为 1180px 宽 + 6 列合并 + 吸顶表头；名单新增「代理链」列并同步导出 CSV（按 `upper_id` 回溯，超长省略/悬停看全链）。回滚：`backups/xuanmanager.20261113-2221-rollback`、`backups/web.20261113-2223-rollback`。
- 未做真实发放（未动真实资金/积分）；登录态页面与到账需用测试联盟实测。详见[交接](handoffs/2026-11-13-agent-reward-club-payout.md)。

## 2026-11-13 客户端「额度授权记录」增加类型显示（未构建、未真机）

- 行模板新增 `typelabel` 显示授信/收回/注资/注资扣减/额度奖励；未构建/热更/真机。详见[交接](handoffs/2026-11-13-client-quota-grant-type.md)。

## 2026-11-13 后台「用户端数据查询」（已部署 8891）

- 游戏管理只读入口 `/game/user-data`：按玩家 ID 查看基本信息（角色、注册时间、版本、管理范围）、所在俱乐部与身份、代理链，以及上下分、赠送金币、金币流向、钻石流向、收益红利（排除 `clubtotal` 基线）五类明细。
- 大盟主 / 盟主（已入盟俱乐部的创建者）额外显示「额度变化记录」：`club_history_info` 的 `opt_type LIKE '额度%' AND user_quota<>0`，分→元，涵盖带入/结算/联盟授信/平台注资/平台奖励；其他玩家请求返回 403。代理链按每个俱乐部独立回溯 `club_agent_info.upper_guuid` 到创建者再到大盟主，合伙人以 used 邀请码为准。
- 迁移 `061_user_data_query.sql`：模块 `game.user_data`、权限 `game.user_data.view`。接口 `GET /api/game/user-data/profile|records`，默认最近 7 天、单次最多 31 天。
- 已部署 8891：后端 `c3b81f4f…`、前端 `index-BlT_8jCE.js` + `index-CLlbA0eV.css`；health 200、未登录接口 401。回滚：`backups/xuanmanager.20261113-2244-rollback`（原始 `b6d68684…`）、`web.previous-userdata-20261113-2244`。未做登录态页面视觉验收。详见[交接](handoffs/2026-11-13-admin-user-data-query.md)。

## 2026-11-12 批次（已归档）

- 客户端：两个 BOSS 入口改按管理范围、额度授权记录加类型、初始化交易密码改独立 Prefab、客服谷歌验证 + 隐藏账号。
- 后台：玩家管理大小BOSS 改看 `union_manage`/`club_manage`、业绩核心共享按日期框、新增「业绩股」总览、登录接入谷歌验证 TOTP。
- 部署与回滚信息、逐项交接链接见[11-12 批次归档](archive/2026-11-15/current-nov12-batches.md)。

## 2026-11-11 牌桌「带入积分」V10（未构建、未真机）

- `panelGameView.prefab` / `drh8.fire` 重做 V10 并接入钻石扣费；Creator、构建、真机、回包待验。详见[交接](handoffs/2026-11-11-buyin-points-v9.md)。

## 2026-11-11 我的红利：新增「业绩股」页签（2026-11-12 按 v6 联盟树改造）

- 双页签，非业绩股成员只隐藏「业绩股」（判断 `ClubPerfInfo.enabled`）；v6 渲染 `leaders`，盟主只授权不取消；服务端需部署后有 `scope`/`leaders`。详见[交接](handoffs/2026-11-11-my-hongli-perf-tab.md)。

## 2026-11-11 后台业绩核心共享：改为按联盟发放（已部署）

- 入口先列联盟，名单/方案/金额/发放/账单按当前联盟过滤；迁移 055 加 `union_id` 并回填，跨联盟选人由后端拒绝。
- 已部署 8891；`go build/test/vet`、前端构建通过，登录态未验。详见[交接](handoffs/2026-11-11-agent-reward-union-scope.md)。

## 2026-11-11 玩家信息卡片（未构建、未真机）

- `panelUserInfo` 统计区改为两排三列蓝卡：上排总手数/总胜率/摊牌率，下排胜利/平局/失败；沿用 `remark[3]`。
- 统计框调整、道具下移并补 Widget；TS、引用、1334/1624 预览通过，构建/真机/联调待验。详见[交接](handoffs/2026-11-11-userinfo-stats-layout.md)。

## 2026-11-09 后台玩家管理：发放钻石 + 发放记录（已部署，游戏服命令待部署）

- 新增「发放钻石」与「发放记录」，走游戏服 `异步_增加_玩家_钻石` 并回读审计；权限 `game.player.grant_stone`，迁移 053/054 已修正权限 id 冲突。
- XuanManager 已发布 8891；游戏服命令当时探测 769 未注册。详见[交接](handoffs/2026-11-09-admin-player-stone-grant.md)。

## 2026-11-09 我的红利（俱乐部/联盟）：金框 + 金色美术字（未构建、未真机）

- B3 金框版已写入两套 Prefab 与 `hongli_v8_*`，表头 Label 启用、提取按钮 130→150 宽，占位符改 `-`；两档反渲染通过。详见[交接](handoffs/2026-11-09-my-hongli-v8-restyle.md)。

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
