# 业绩核心共享（代理三类奖励）— 实施交接

日期：2026-11-07　分支：`main`（未提交）　部署：正式 8891 已上线

## 目标

把代理方提的「业绩奖励 + 核心奖励 + 奖池共享」三类奖励做成后台一个页面：每天设总额 → 按点数自动分摊或人工填写 → 主子账号拆分 → 一键发放 → 记账对账。

## 改动文件

| 文件 | 说明 |
| --- | --- |
| `XuanManager/server/migrations/048_agent_rewards.sql` | 模块 58、权限 5811–5814、6 张 `mgr_agent_reward_*` 表；开头修复 047 撞号 |
| `XuanManager/server/internal/api/agent_rewards.go` | 全部接口：名单同步/添加、排除、计划、金额、分摊、发放、账单、线数据 |
| `XuanManager/server/internal/api/agent_rewards_test.go` | 分摊算法、角色归类、类型校验单测 |
| `XuanManager/server/internal/api/server.go` | 12 条路由注册 |
| `XuanManager/web/src/pages/AgentRewardsPage.tsx` | 三栏页面、全部弹窗 |
| `XuanManager/web/src/App.tsx` | 路由 `/game/agent-rewards` |
| `XuanManager/web/src/styles.css` | `.reward-*` 样式 |

## 数据库

6 张表都在自有 `webcm` 库，游戏库 `kbedm` 仍然只读：

`mgr_agent_reward_member` / `_exclude` / `_sub_account` / `_plan` / `_item` / `_payout`

- 计划唯一键 `(reward_date, kind)`；明细唯一键 `(plan_id, agent_id)`；发放流水唯一键 `work_order`。
- 排除是独立抑制表，不是删行（每日同步不会把人加回来）。
- 迁移已于 2026-11-07 19:51 应用。

## 关键实现口径

- **业绩点数**取 `异步_查询_奖池业绩_结算报表` 的 `proxy_performance`（毛−下发，服务端已逐级扣减），后台**不再二次扣减**，单位由分转元。
- **线输赢/贡献**取 `异步_查询_代理_展示数据` 的 `team_raw`，只对挂了俱乐部的代理发起调用；无俱乐部直接返回无数据，前端显示「无数据」而不是 0。
- **分摊**用最大余数法，`splitRewardByWeight` 保证合计恒等于计划总额、同输入同结果（有单测）。
- **发放**复用既有 `exchange` 通道，一单一笔、工单 `JL+日期+类型码+序号`，发完统一回读余额比对（前+应发=后 才置 `paid`，否则 `mismatch`）。
- 已发放过的收款账号按 `plan_id + payee` 去重，防重复点击双发；整批用互斥锁串行。

## 验证

已做：

- `go build` / `go vet` / `go test ./...` 通过（含新增 4 个测试）。
- `tsc --noEmit`、`eslint`、`vite build` 通过。
- 候选 8892 启动 + 迁移应用 + 本机健康 200 + 未登录 401。
- 正式部署后：本机与公网健康 200、新接口未登录 401（旧二进制会是 404，可据此判断版本已生效）、进程单实例、watchdog 识别「already running」。
- 线上实测数据：全库 64 账号、代理候选 16 人、`client_prop='True'` 27 个（18 个非代理）、今日业绩全 0、16 人里只有 4 人有俱乐部线数据。

**未验证（需要登录态）**：页面真实渲染、首次自动同步、自动分摊、排除/恢复、分账号、真实发放与账单。这些本轮没有可用后台账号，未做登录态联调。

## 事故与修复（重要）

首次迁移文件命名 `047_agent_rewards.sql` 用了模块 id 57 / 权限 5801，与同期上线的「游戏接口日志」(47, `system.game_logs`) 撞号，`ON DUPLICATE KEY UPDATE` 把对方的 **名称和路由覆盖**了。已改为 `048_agent_rewards.sql`（模块 58、权限 5811-5814），并在迁移开头把 57 与 5801 恢复原状、清掉误插的 5802-5804。修复后已核对：57=游戏接口日志 /system/game-logs，5801=查看游戏接口日志，58=业绩核心共享。

**教训**：新增模块/权限先查 `MAX(id)` 与邻近 id 占用，不能凭手头文档的最大编号往后写；同批次并行上线的迁移可能已经占号。

## 部署与回滚

- 二进制 sha256：`f3e31f48678dd15028bae512044e03d41236fc544da821a884d6e8d056e1f74d`
- 前端入口：`assets/index-BOrm1zqq.js`
- 备份：`/www/html/.xuanmanager/backups/agent-rewards-20261107-195600/`（含上一版二进制与完整 web）
- 回滚：拷回备份的 `bin/xuanmanager` 与 `web`，`bash stop.sh && bash start.sh`。注意保留 `run/supervisor.pid` 与真实 supervise 进程一致，否则 watchdog 会再起一个守护（本次出现过两个 supervise 抢端口，已清理并把 pid 文件指回存活的那个）。

## 待办

1. 登录后台验收页面与发放流程（建议先用 1 个代理、小额金币试发，再用账单核对工单号与流水）。
2. 「流水显示补发」仍需游戏/旧发钱服务加 work_order 前缀，当前写入的是「奖励」。
3. 收返（代理红利）停用需 KBE 服务端改，后台只能展示。
4. 业绩口径：线上当天提留为 0 时全员 0 点，业绩奖分不出去，需要业务确认业绩是否只算提留。

## 口径修正（2026-11-07 20:10，用户指出）

**问题**：首版名单取的是平台账号表的老板/盟主/合伙人/总裁层级（`tbl_Account.sm_bigAgentID` 等），而项目现在是**俱乐部模式**，代理是俱乐部内的角色，名单必须取 `kbedm.club_agent_info`（`status='used'`）。首版 16 人里 12 个根本不在任何俱乐部，同时漏掉了 19 个 level=0 的授权代理。

**现在的实现**：

- 名单：`club_agent_info` 在册记录，按 `sm_guuid` 去重，共 **23 人**（不是 16）。
- 上下级：改用 `club_agent_info.upper_guuid`（俱乐部内代理链），不再用平台 `sm_agentID`。
- 角色判定（`classifyClubRewardRole`，与游戏内称呼一致）：
  1. `sm_role` 含「大盟主」→ **大盟主**
  2. 俱乐部创建者（`club_guuid_info.account_id = tbl_Account.id`）→ **盟主**
  3. `club_agent_info.percent > 0` 或 `sm_level >= 98` → **合伙人**
  4. 其余在册 → **代理**
- 当前分布：1 大盟主、6 盟主、6 合伙人、10 代理。
- 前端角色名同步为 大盟主/盟主/小盟主/合伙人/代理，筛选下拉同样。

**待业务确认**：237737（level 99 老板，但在 885399 挂在 501208 下面）按现规则算「合伙人」；501208（名字叫"测试合伙人下级"、percent=100）算「合伙人」；819586（sm_role=大盟主）算「大盟主」。若游戏内显示与这里不一致，改判定顺序即可。

**过程中出过的事故**：用脚本批量改 Go 文件时切片范围写错，把 `handlerRewardSync` 到 `handlerRewardMemberAdd` 之间约 20 个函数整段删掉了。已按原实现补回，`go build/vet/test` 全过，线上二进制 sha `ceef71b3…`。

## 联盟与俱乐部列（2026-11-07 20:25）

- 迁移 `049_agent_reward_union.sql`：`mgr_agent_reward_member` 增加 `club_name`、`union_id`、`union_name`，并给 `club_id`/`union_id` 建索引。
- 同步 SQL 关联 `club_guuid_info`（俱乐部名、union_id）与 `club_union_info`（联盟名，`status='used'`）；名单表直接冗余存名称，避免每次查询再 join。
- 前端：表格拆出「联盟」「俱乐部」两列（联盟为空显示 —，鼠标悬停看 ID），筛选区新增「全部联盟」「全部俱乐部」两个下拉，俱乐部选项随所选联盟联动，切换联盟时自动重置俱乐部筛选。
- 导出 CSV 增加「联盟」「俱乐部」两列。
- 线上真实分布：复仇者（A1 俱乐部 2 人、A3 俱乐部 3 人）、测试测试1（测试测试 4 人、测试测试2 5 人、踩踩踩 7 人）、H1 俱乐部 2 人无联盟。
- 前端产物 `index-DJ6S5drd.js`，线上哈希与本地产物一致 `d924fd3a…`。

## 业绩口径纠正：奖池提留 → 俱乐部贡献（2026-11-07 20:35）

用户指出需求里的「业绩」就是**贡献**，不是奖池提留。原实现调 `异步_查询_奖池业绩_结算报表` 取 `proxy_performance`，那套数据只覆盖开通了业绩比例的账号、且按平台账号链归属（实测 11-03 全平台仅 2 元且全归 BOSS 648425），俱乐部名单里的代理基本永远拿不到点数。

**现在**：`buildRewardPerfFromLines` 用 `异步_查询_代理_展示数据` 的 `team_raw`：

- 毛（My）= 该代理整条线的**今日贡献**（含自己 + 所有下线）
- 下发（Granted）= **直接下级**整条线今日贡献之和
- 净（Net）= 毛 − 下发（负数归 0）

因为 `team_raw` 是含自己的聚合，逐级相减得到的就是"这一层自己的贡献"，天然的上下级不重复。实测校验（984470）：430994 整线 36852 分，下级 452469(10550) + 352108(20715)，净 5587 分 = 55.87 元，与 `club_member_score_info` 里 430994 自己的贡献 **5587 完全一致**；452469 净 7761 同样吻合。

配套改动：

- 业绩页新增「整条线总贡献」列；去掉「未开通」标签（业绩不再依赖 `client_prop`）。
- 分摊权重改用净点数；当天全 0 时提示"今天所有代理的整条线贡献都是 0"。
- `rewardPerformance`（奖池报表）保留但不再用于本页，奖池业绩页继续用。

## 名单改为显式挑选（2026-11-07 20:50）

需求变化：参与分配的代理**默认空**，要按联盟/俱乐部批量勾选，只有进入名单的人参与分配。

- 迁移 `050_agent_reward_selected.sql`：`mgr_agent_reward_member` 增加 `selected`（默认 0）与索引。同步只维护「候选池」，是否参与由 `selected` 决定。
- 新接口：
  - `GET /api/game/agent-rewards/candidates` 返回候选池（俱乐部在册代理，带 selected、联盟、俱乐部、已选/总数）。
  - `POST /api/game/agent-rewards/select` `{agentIds, selected}` 批量加入或移出，写审计。
- `loadRewardMembers` 只取 `status='active' AND selected=1`，所以概览、分摊、发放天然只处理名单内的人。
- 前端新增「＋ 批量添加」弹窗：联盟/俱乐部联动筛选 + 关键字 + 全选当前/清空 + 逐行勾选，底部显示"待保存：新加入 N / 移出 M"，保存时只提交差异（两次调用 add/remove）。行内「排除」改为「移出」（直接 selected=0）。
- 名单为空时页面顶部提示"点右上「批量添加」…"，空态文案同步。
- 线上状态：候选池 23 人，selected 全 0（默认空名单）。

### 编译环境注意

`internal/api/agent_contributions.go` 在 20:38 被**另一处改动**（字段从 `mode/percent/delta` 改为 `scorePercent/contribAdd` 等），改到一半导致整包编译失败，不是本次功能引入的。处理方式：**没有改动该文件**，而是把 server 目录 rsync 到 `/tmp/xm-build`，用 `git show HEAD:...agent_contributions.go` 覆盖后编译，产出二进制再部署。线上二进制 `f148f602…` 里的「代理贡献管理」仍是 HEAD 版本；等那边改完需要重新编译部署一次。
