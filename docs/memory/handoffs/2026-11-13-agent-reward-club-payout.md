# 2026-11-13 业绩核心共享：发放改三阶段（联盟池 → 盟主 → 成员积分）

## 目录 / 分支

- 项目根：`/Volumes/SSD/qing`
- 分支：`codex/club-ui`
- 本次只改 XuanManager 后端/前端与迁移；游戏服 KBE 未改，三个后台专用命令已在正式服可用。

## 目标

「业绩核心共享」列表里每个人分配好金额后，点「确认并发放」不再走旧金币 exchange，而是：

1. 平台把本批总额（元 × 100 = 额度分）通过 `发放_总群主_奖励` 注入大盟主的联盟额度池；
2. 大盟主按俱乐部汇总下属成员金额，通过 `发放_盟主_奖励` 把额度下划到各盟主俱乐部；
3. 各盟主通过 `异步_发放_玩家_奖励` 给成员发放对应俱乐部积分（同俱乐部同金额合并，单批 20 人）。

账单按「平台 → 大盟主」「大盟主 → 盟主」「盟主 → 成员」逐层记录金额、对象、俱乐部、状态与详细说明。

依据：`服务器文档整理/俱乐部后台发放奖励-后台接口文档.md` v1.3（2026-11-13）。

## 改动文件

新增：

- `XuanManager/server/migrations/062_agent_reward_club_payout.sql`
  - `mgr_agent_reward_payout` 增加 `stage`、`club_id`、`club_name`、`subject_name`、`description`、`quota_before`、`quota_after`，并加 `(plan_id, stage)`、`club_id` 索引。
  - `stage` 默认 `player`，历史发钱记录自动归为成员层，兼容旧账单。

修改：

- `XuanManager/server/internal/api/agent_rewards.go`
  - 新增三阶段常量与 `rewardPayoutWaiting`（房间内待补发）。
  - `handlerRewardPay` 重写为三阶段发放；按俱乐部汇总金额、按金额合并玩家批次；记录每阶段流水与说明。
  - 幂等：联盟/盟主层重试前核对额度余额；成员层 `pending` 先查积分流水/房间状态；已结算行跳过；无成功流水时清理旧失败行再重算。
  - 金额锁定：`rewardPlanStarted` 阻止已产生 `paid/pending/waiting/mismatch` 的批次再改总额/金额/重新分摊。
  - 账单 `handlerRewardLedger` 返回 `planId/stage/clubId/clubName/quotaAfter/description`，汇总拆成「成员到账 / 平台拨入联盟池 / 下划盟主 / 待补发」。
  - 新增单测：回包三种包裹解析、success/pending/failed 解析、pending 不视为已结算。
- `XuanManager/web/src/pages/AgentRewardsPage.tsx`
  - 发放弹窗改为三阶段说明与结果；移除子账号笔数口径（拆分仅记录，不参与本流程）。
  - 账单弹窗按批次分组，逐层展示平台→大盟主、大盟主→盟主、盟主→成员的明细与说明；CSV 增加流转/对象/俱乐部/单位/说明/错误。
  - 2026-11-13 晚：账单弹窗从 `wide`(900px) 改为 `xwide`(1180px)；表格合并为 6 列（俱乐部并入对象列、操作单号并入说明列），说明列可换行，表头吸顶，表格区 62vh；汇总卡自动单行排列。已用同源 CSS 静态样例在 1180px 宽度核对无横向挤压/重叠。
  - 2026-11-13 晚：名单新增「代理链」列。后端 `handlerRewardOverview` 用联盟内全部在册代理按 `upper_id` 回溯（最多 16 级、断链/循环截断），返回 `chain`；前端显示「盟主 X → 合伙人 Y → 本人」，超长省略、悬停看完整链路（含 ID）。
  - 文案由「金币」改为「俱乐部积分」（奖池来源仍按金币展示）。
- `XuanManager/web/src/styles.css`
  - 新增阶段标签、批次分组行、说明列样式。
  - 新增 `reward-ledger-*` 弹窗宽度、固定列宽、吸顶表头、7 列汇总响应式样式。

## 部署（正式 8891）

- 后端：`c9be4aa5…` → `29ea2e5b…` → 最终 `b6d686842e6ed6c3ce39f8ef98d85428dca713f83fb4b40870a206140ae87ace`
- 前端：`index-BIGNTpl-.js`（`3b3dda73…`）+ `index-BlvuVD52.css`（`80c14a03…`）
- 迁移 `062_agent_reward_club_payout.sql` 已由启动迁移自动执行（`applied_at=2026-11-13 21:51:24`）。
- 校验：`/api/health` 200；未登录 `/api/game/agent-rewards/ledger` 401；公网 `http://154.37.155.17/xuanmanager/` 已引用新前端资源。
- 回滚点：
  - 二进制 `backups/xuanmanager.20261113-2152-rollback`（原始 `9708117b…`）
  - 二进制 `backups/xuanmanager.20261113-2157-before-fix`（第一版 `c9be4aa5…`）
  - 二进制 `backups/xuanmanager.20261113-2205-before-final`（第二版 `0095d7e7…`）
  - 二进制 `backups/xuanmanager.20261113-2221-rollback`（第三版 `29ea2e5b…`）
  - 前端 `backups/web.20261113-2152-rollback`（原始）
  - 前端 `backups/web.20261113-2208-rollback`（第一版）
  - 前端 `backups/web.20261113-2213-rollback`（加大账单弹窗前）
  - 前端 `backups/web.20261113-2217-rollback`（6 列改版前）
  - 前端 `backups/web.20261113-2223-rollback`（代理链列+CSV 前）

## 验证

- `cd XuanManager/server && gofmt -w ... && go vet ./... && go test ./...`：通过。
- `cd XuanManager/web && npm run lint && npm run build`：通过。
- 游戏服三个命令探测（只读/非法参数）：`发放_总群主_奖励` 返回「联盟不存在」、`发放_盟主_奖励` 返回「俱乐部不存在」、`异步_发放_玩家_奖励` 返回「俱乐部不存在」，说明命令已注册且后台权限通过。

## 未验证 / 注意事项

- **未做真实发放**：没有在正式环境执行任何一笔真实额度/积分发放，避免动真实资金。登录态页面与三阶段到账需主人用测试联盟实测。
- 旧批次（迁移前）账单行 `stage` 默认 `player`，显示为「盟主 → 成员」，属于历史金币发放，金额单位仍是当时口径。
- 房间内成员会记为「待补发」（`waiting`），结算后由游戏服自动入账；此时批次仍可为 `paid`，账单单独展示待补发金额。
- 子账号拆分功能保留但不再参与发放；发放按代理本人账号到账俱乐部积分。
- 若成员未绑定俱乐部或俱乐部不在当前联盟，后端会直接拒绝整批，需先修正名单/俱乐部归属。
