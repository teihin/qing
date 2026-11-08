# 业绩核心共享 v2（按代理方新需求补齐）— 实施交接

日期：2026-11-08　分支：`codex/club-ui`（未提交）　部署：未部署

## 目标

按代理方第二条需求文档补齐「业绩核心共享」：修好单个 ID 添加、名单持久、奖池共享关联真实奖池、业绩点数按全树逐级扣减、三栏统一展示代理数据、发放流水走补发口径。

## 改动文件

| 文件 | 说明 |
| --- | --- |
| `XuanManager/server/migrations/052_agent_reward_pool_ratio.sql` | plan 表加 `pool_base`（当日奖池快照）、`pool_percent`（共享比例）；把历史 `source='manual'` 行置为参与 |
| `XuanManager/server/internal/api/agent_rewards.go` | 单个/批量 ID 添加、全树逐级扣减、奖池关联、上次金额、三栏汇总接口、工单前缀 |
| `XuanManager/server/internal/api/agent_rewards_test.go` | 新增 3 个单测（奖池比例、逐级扣减、下级外扩查询） |
| `XuanManager/server/internal/api/server.go` | 新增 `GET /api/game/agent-rewards/summary` |
| `XuanManager/web/src/pages/AgentRewardsPage.tsx` | 三栏并排汇总、单个添加入口、奖池面板、统一数据列、按钮归位 |
| `XuanManager/web/src/styles.css` | `.reward-kinds` / `.reward-kind` / `.reward-pool` 样式 |

## 关键实现

- **单个 ID 添加（原来点了没反应）**：根因有两条——① 页面根本没有触发 `setAddOpen(true)` 的入口；② 后端 `handlerRewardMemberAdd` 插入时没写 `selected=1`，而概览只查 `selected=1`，所以加进去也永远不显示。现在补入口 + 写入 `selected=1`，并支持一次填多个 ID（换行/逗号分隔），后端 `agentIds` 批量、逐个返回失败原因。
- **名单持久**：`selected` 存在自有表，同步只刷候选池，不改 `selected`；`source='manual'` 的行同步时不会被删。所以加过的人明天还在。
- **业绩点数逐级扣减**：`buildRewardPerfFromLines` 改传**全部在册代理**（`loadRewardMembersAll`），不再只传入选名单。原实现只拿名单建父子关系，下级没入选时上级不会扣掉下级的整条线 → 上级被重复计算。新增 `rewardLineTargets` 把「名单成员 + 直接下级」都纳入取数（下级整条线已含更下层，只需一层）。
- **奖池共享关联真实奖池**：复用 `异步_获取_奖池_数据`，`rewardPoolTotal` 汇总各皮池 = 今日奖池总额；`rewardPoolSuggested = 奖池/2 × 比例%`（100000 → 50000 → 60% → 30000）。比例存 `pool_percent`，页面可改；算出的金额可一键写入计划总额，也可手动覆盖。保存计划时把当时奖池写进 `pool_base` 供对账。
- **上次金额参考**：新增 `lastRewardAmountsWithDate`，概览返回 `lastAmounts` + `lastDate`，核心奖励表格显示「上次金额」，配合已有「按上次金额预填」。
- **三栏统一**：新增 `GET /summary`（纯 DB，不起游戏调用）返回三类奖励的计划/已分配/人数/状态，页面顶部三栏并排可点击切换；表格三栏都显示 今日业绩、实际点数、整线总输赢、今日输赢、整线总贡献、本次金额。
- **流水补发**：工单前缀 `JL` → `BF`（旧发钱服务按前缀识别类型，BF=补分/补发）。三类各自保留类型码 `P/C/S` 便于对账。

## 验证

已做：

- `go build ./...`、`go vet ./internal/api/`、`go test ./...` 全过（含新增 3 个测试）。
- `tsc -b`、`eslint src`、`vite build` 全过，产物 `dist/assets/index-Be_qilCX.js`。

未验证（本机无 MySQL/游戏服/后台账号）：

- 登录态下页面渲染、单个添加、奖池读取、发放与账单。
- 迁移 052 在线上库的执行（部署时随服务启动自动跑）。
- BF 前缀在玩家流水中实际显示的文字（取决于旧服务映射，见下）。

## 遗留 / 要外部配合

1. **流水文案**：`BF` 在旧服务里写的类型是「补分」，玩家流水会显示「补分」而不是字面的「补发」。要字面一致必须旧发钱服务加一个前缀映射（如 `JB`→补发）。后台侧已切到补发口径。
2. 业绩口径仍是**俱乐部整条线今日贡献**（11-07 用户确认「业绩就是贡献」），不是奖池提留。当天没有俱乐部贡献时全员 0 点，业绩奖分不出去。
3. 名单人数多时概览会对「名单成员 + 直接下级」逐个调 `异步_查询_代理_展示数据`（并发 4、单次 6s），几十人尚可，上百人需要改成批量命令。

## 部署（2026-11-08 14:36 / 14:45，正式 8891）

已上线。两轮：第一轮漏了奖池金额单位换算（游戏按「分」存，页面按「元/金币」），当场修正后重发。

- 二进制 sha256 `9fcd40c4e3728fc800bcb5ef481c3972c2a2cd8fd17a4bad135081d8bce3a495`（第一轮 `9dff7f04…`）。
- 前端 `index-h0v4SoeH.js` / `index-DTNdwExy.css`（第一轮 `index-CDimi-Xb.js`），公网 200 且 size 与本地一致。
- 迁移 `052_agent_reward_pool_ratio.sql` 已落库；`mgr_agent_reward_plan` 已有 `pool_base`、`pool_percent`。
- 进程单实例：`supervise.sh 14874` → `bin/xuanmanager 14881`，`run/supervisor.pid` = 14874，health 200。
- 新接口 `GET /api/game/agent-rewards/summary` 未登录 401（旧版是 404，可据此判版本）。
- 回滚点：`backups/agent-rewards-v2-20261108-1436/`（部署前二进制 + web）、`web.previous-1445`（第二轮替换的上一版前端）。

### 单位口径（重要，别改回去）

`异步_获取_奖池_数据` 返回的是**分**（与奖池配置页一致：999.99 元 = 99999 分）。
`rewardPoolTotal` 保留分用于精确对账，概览返回前 `/100` 换算成「元/金币」；
`rewardPoolSuggested(poolYuan, percent)` 的基数是元，返回值是整数金币。

线上实测（2026-11-08 14:38 只读）：各皮池 8700 + 17300 + 15500 = **41500 分 = 415.00 金币**，
50% = 207.50，60% → 建议 125 金币。这数字远小于需求里的「10 万」，是因为线上奖池本身只有 415 元，不是算错。

## 追加：添加名单入口合并（2026-11-08 14:55，仅前端热替换）

用户指出「单个添加和批量添加选一个人是一回事，而且单个只能输入不能选」，确认是入口重复 + 体验差。

- 删掉独立的「＋ 单个添加」弹窗（页面级 `addOpen` / `addIds` / `addMember` 全部移除）。
- 只剩一个「＋ 添加代理」（`CandidateModal`，标题改为「添加参与分配的代理」），里面两层能力：
  1. 候选池勾选：可按 ID/昵称搜索、按联盟/俱乐部筛选、全选当前、逐行勾选 → 保存名单；
  2. 「按 ID 直接加入」输入行：候选池里没有的账号（未授权成俱乐部代理、已降级的老代理）填 ID 直接加入，
     走 `POST /members`（`agentIds` 数组），加完刷新候选列表但**不关弹窗**，可继续勾选。
- `CandidateModal` 新增 `onChanged` 回调：按 ID 加入后只刷新外层表格，不关闭弹窗。

部署：只换前端，后端未动、未重启。`index-FSgLiqdb.js` / `index-BtL15sfs.css`，
公网 200 且 size 与本地一致（834828 / 234143），`health` 200。回滚：`web.previous-mergeadd`。
