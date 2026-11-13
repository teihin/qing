-- 业绩核心共享：发放改为「联盟池 → 盟主额度 → 成员俱乐部积分」三阶段。
-- 同一张发放流水表记录三个阶段，stage 区分：
--   union   平台发放总额到联盟额度池（大盟主）
--   leader  大盟主从联盟池下划额度到盟主俱乐部
--   player  盟主给俱乐部成员发放俱乐部积分（默认，兼容历史发钱记录）
-- +xuan Statement
ALTER TABLE mgr_agent_reward_payout
  ADD COLUMN stage VARCHAR(16) NOT NULL DEFAULT 'player' AFTER item_id,
  ADD COLUMN club_id VARCHAR(50) NOT NULL DEFAULT '' AFTER agent_id,
  ADD COLUMN club_name VARCHAR(64) NOT NULL DEFAULT '' AFTER club_id,
  ADD COLUMN subject_name VARCHAR(64) NOT NULL DEFAULT '' AFTER club_name,
  ADD COLUMN description VARCHAR(255) NOT NULL DEFAULT '' AFTER amount,
  ADD COLUMN quota_before BIGINT NOT NULL DEFAULT 0 AFTER balance_after,
  ADD COLUMN quota_after BIGINT NOT NULL DEFAULT 0 AFTER quota_before

-- +xuan Statement
ALTER TABLE mgr_agent_reward_payout
  ADD KEY idx_plan_stage (plan_id, stage),
  ADD KEY idx_club (club_id)
