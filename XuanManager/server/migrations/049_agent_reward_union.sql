-- 业绩核心共享：名单补俱乐部名称与所属联盟，方便按联盟/俱乐部筛选。
-- 俱乐部模式下一个俱乐部可能属于某个联盟（club_guuid_info.union_id → club_union_info）。
-- +xuan Statement
ALTER TABLE mgr_agent_reward_member
  ADD COLUMN club_name VARCHAR(64) NOT NULL DEFAULT '' AFTER club_id,
  ADD COLUMN union_id VARCHAR(50) NOT NULL DEFAULT '' AFTER club_name,
  ADD COLUMN union_name VARCHAR(64) NOT NULL DEFAULT '' AFTER union_id

-- +xuan Statement
ALTER TABLE mgr_agent_reward_member
  ADD KEY idx_club (club_id),
  ADD KEY idx_union (union_id)
