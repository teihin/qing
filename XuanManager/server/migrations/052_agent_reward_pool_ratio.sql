-- 业绩核心共享 · 奖池共享：计划行记录当日奖池基准与共享比例。
--   pool_base    当天读取到的平台奖池总额快照（各皮池合计），用于事后对账，不再随奖池变动。
--   pool_percent 本次共享比例（按奖池 50% 计算，例如 60 表示奖池 50% 的 60%）。
-- 计划发放总额仍存 planned_total，允许客服在上述自动值之外手动覆盖。
-- +xuan Statement
ALTER TABLE mgr_agent_reward_plan
  ADD COLUMN pool_base BIGINT NOT NULL DEFAULT 0 AFTER planned_total

-- +xuan Statement
ALTER TABLE mgr_agent_reward_plan
  ADD COLUMN pool_percent DECIMAL(6,2) NOT NULL DEFAULT 60.00 AFTER pool_base

-- +xuan Statement
-- 名单来源标记：手工按 ID 添加的行要能在同步时保留，且加入后默认参与分配。
UPDATE mgr_agent_reward_member SET selected = 1 WHERE source = 'manual' AND selected = 0
