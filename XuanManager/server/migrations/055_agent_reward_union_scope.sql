-- 业绩核心共享：改为按联盟独立发放。
--   - 发放计划从「日期 + 类型」唯一改为「日期 + 类型 + 联盟」唯一；
--   - 名单方案按联盟隔离，同名方案可以在不同联盟各存一份；
--   - 历史计划/方案按成员所属联盟回填，避免老数据失去入口。

-- +xuan Statement
ALTER TABLE mgr_agent_reward_plan
  ADD COLUMN union_id VARCHAR(50) NOT NULL DEFAULT '' AFTER kind

-- +xuan Statement
ALTER TABLE mgr_agent_reward_plan
  DROP INDEX uk_date_kind,
  ADD UNIQUE KEY uk_date_kind_union (reward_date, kind, union_id),
  ADD KEY idx_union (union_id)

-- +xuan Statement
UPDATE mgr_agent_reward_plan p
SET p.union_id = COALESCE((
  SELECT m.union_id
  FROM mgr_agent_reward_item i
  JOIN mgr_agent_reward_member m ON m.agent_id = i.agent_id
  WHERE i.plan_id = p.id AND m.union_id <> ''
  ORDER BY i.id
  LIMIT 1
), '')
WHERE p.union_id = ''

-- +xuan Statement
ALTER TABLE mgr_agent_reward_list
  ADD COLUMN union_id VARCHAR(50) NOT NULL DEFAULT '' AFTER name

-- +xuan Statement
ALTER TABLE mgr_agent_reward_list
  DROP INDEX uk_name,
  ADD UNIQUE KEY uk_union_name (union_id, name)

-- +xuan Statement
UPDATE mgr_agent_reward_list l
SET l.union_id = COALESCE((
  SELECT m.union_id
  FROM mgr_agent_reward_list_member lm
  JOIN mgr_agent_reward_member m ON m.agent_id = lm.agent_id
  WHERE lm.list_id = l.id AND m.union_id <> ''
  ORDER BY lm.id
  LIMIT 1
), '')
WHERE l.union_id = ''
