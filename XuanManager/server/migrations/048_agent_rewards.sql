-- 业绩核心共享：代理奖励名单、排除、子账号、每日计划、分配明细、发放流水。
--
-- 历史说明：本功能最初写成 047_agent_rewards.sql 并用模块 id 57 / 权限 id 5801，
-- 与同期上线的「游戏接口日志」(47, system.game_logs, 5801) 撞号，ON DUPLICATE KEY 把
-- 对方的名称和路由覆盖了。本文件改用模块 58 / 权限 5811-5814，并在开头把 57 与 5801 恢复原状。
-- +xuan Statement
DELETE FROM mgr_schema_migration WHERE version = '047_agent_rewards.sql'

-- +xuan Statement
UPDATE mgr_module SET parent_id = 10, name = '游戏接口日志', route = '/system/game-logs',
  icon = 'logs', sort_order = 50
WHERE id = 57 AND code = 'system.game_logs'

-- +xuan Statement
UPDATE mgr_permission SET module_id = 57, name = '查看游戏接口日志'
WHERE id = 5801 AND code = 'system.game_log.view'

-- +xuan Statement
DELETE FROM mgr_role_permission WHERE permission_id IN (5802, 5803, 5804)

-- +xuan Statement
DELETE FROM mgr_permission WHERE id IN (5802, 5803, 5804)
  AND code IN ('game.agent_reward.edit', 'game.agent_reward.pay', 'game.agent_reward.configure')

-- +xuan Statement
INSERT INTO mgr_module (id, parent_id, code, name, route, icon, sort_order, visible, status) VALUES
  (58, 20, 'game.agent_rewards', '业绩核心共享', '/game/agent-rewards', 'agents', 40, 1, 'enabled')
ON DUPLICATE KEY UPDATE parent_id = VALUES(parent_id), code = VALUES(code), name = VALUES(name),
  route = VALUES(route), icon = VALUES(icon), sort_order = VALUES(sort_order),
  visible = VALUES(visible), status = VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (id, module_id, code, name, action, description, status) VALUES
  (5811, 58, 'game.agent_reward.view', '查看代理奖励', 'view', '查看代理奖励名单、每日数据与发放账单', 'enabled'),
  (5812, 58, 'game.agent_reward.edit', '设置奖励金额', 'edit', '设置每日发放总额、调整每个代理的分配金额、维护名单与排除', 'enabled'),
  (5813, 58, 'game.agent_reward.pay', '发放奖励', 'pay', '确认并一键发放业绩/核心/奖池共享奖励，建议仅分配给财务', 'enabled'),
  (5814, 58, 'game.agent_reward.configure', '配置子账号', 'configure', '绑定或解绑主账号与子账号的发放关系', 'enabled')
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action),
  description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code IN
  ('game.agent_reward.view', 'game.agent_reward.edit', 'game.agent_reward.pay', 'game.agent_reward.configure')

-- +xuan Statement
CREATE TABLE IF NOT EXISTS mgr_agent_reward_member (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  agent_id VARCHAR(64) NOT NULL,
  name VARCHAR(64) NOT NULL DEFAULT '',
  role VARCHAR(16) NOT NULL DEFAULT 'agent',
  level INT NOT NULL DEFAULT 0,
  upper_id VARCHAR(64) NOT NULL DEFAULT '',
  club_id VARCHAR(50) NOT NULL DEFAULT '',
  authorized TINYINT(1) NOT NULL DEFAULT 0,
  source VARCHAR(10) NOT NULL DEFAULT 'auto',
  status VARCHAR(10) NOT NULL DEFAULT 'active',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_agent (agent_id),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

-- +xuan Statement
CREATE TABLE IF NOT EXISTS mgr_agent_reward_exclude (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  agent_id VARCHAR(64) NOT NULL,
  kind VARCHAR(16) NOT NULL DEFAULT 'all',
  reason VARCHAR(200) NOT NULL DEFAULT '',
  operator VARCHAR(64) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_agent_kind (agent_id, kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

-- +xuan Statement
CREATE TABLE IF NOT EXISTS mgr_agent_reward_sub_account (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  agent_id VARCHAR(64) NOT NULL,
  sub_guuid VARCHAR(64) NOT NULL,
  sub_name VARCHAR(64) NOT NULL DEFAULT '',
  note VARCHAR(120) NOT NULL DEFAULT '',
  status VARCHAR(10) NOT NULL DEFAULT 'active',
  created_by VARCHAR(64) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_agent_sub (agent_id, sub_guuid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

-- +xuan Statement
CREATE TABLE IF NOT EXISTS mgr_agent_reward_plan (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reward_date DATE NOT NULL,
  kind VARCHAR(16) NOT NULL,
  planned_total BIGINT NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  created_by VARCHAR(64) NOT NULL DEFAULT '',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_date_kind (reward_date, kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

-- +xuan Statement
CREATE TABLE IF NOT EXISTS mgr_agent_reward_item (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  plan_id BIGINT UNSIGNED NOT NULL,
  agent_id VARCHAR(64) NOT NULL,
  agent_name VARCHAR(64) NOT NULL DEFAULT '',
  gross_points DECIMAL(14,2) NOT NULL DEFAULT 0,
  granted_points DECIMAL(14,2) NOT NULL DEFAULT 0,
  net_points DECIMAL(14,2) NOT NULL DEFAULT 0,
  auto_amount BIGINT NOT NULL DEFAULT 0,
  final_amount BIGINT NOT NULL DEFAULT 0,
  split_json TEXT,
  snapshot_json TEXT,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_plan_agent (plan_id, agent_id),
  KEY idx_plan (plan_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

-- +xuan Statement
CREATE TABLE IF NOT EXISTS mgr_agent_reward_payout (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  plan_id BIGINT UNSIGNED NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  agent_id VARCHAR(64) NOT NULL,
  payee_guuid VARCHAR(64) NOT NULL,
  payee_type VARCHAR(10) NOT NULL DEFAULT 'main',
  amount BIGINT NOT NULL DEFAULT 0,
  work_order VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  ret_code INT NOT NULL DEFAULT 0,
  error_message VARCHAR(255) NOT NULL DEFAULT '',
  balance_before BIGINT NOT NULL DEFAULT 0,
  balance_after BIGINT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_order (work_order),
  KEY idx_plan (plan_id),
  KEY idx_agent (agent_id),
  KEY idx_paid (paid_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
