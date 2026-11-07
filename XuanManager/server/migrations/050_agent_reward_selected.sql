-- 业绩核心共享：把名单拆成「候选池」与「入选名单」。
-- 同步只维护候选池（俱乐部在册代理），是否有资格分配由 selected 决定，默认 0 = 未入选。
-- +xuan Statement
ALTER TABLE mgr_agent_reward_member
  ADD COLUMN selected TINYINT(1) NOT NULL DEFAULT 0 AFTER authorized

-- +xuan Statement
ALTER TABLE mgr_agent_reward_member
  ADD KEY idx_selected (selected)
