-- +xuan Statement
INSERT INTO mgr_module (id, parent_id, code, name, route, icon, sort_order, visible, status) VALUES
  (36, 20, 'game.platform_revenue', '平台收益', '/game/platform-revenue', 'platform-revenue', 38, 1, 'enabled')
ON DUPLICATE KEY UPDATE parent_id = VALUES(parent_id), name = VALUES(name), route = VALUES(route), icon = VALUES(icon), sort_order = VALUES(sort_order), visible = VALUES(visible), status = VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (id, module_id, code, name, action, description, status) VALUES
  (3601, 36, 'game.platform_revenue.view', '查看平台收益', 'view', '查看大厅抽水、奖池中奖折扣、玩家消费、代理红利支出及平台运营净收益', 'enabled')
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action), description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code = 'game.platform_revenue.view'

-- +xuan Statement
CREATE TABLE IF NOT EXISTS mgr_platform_revenue_daily (
  metric_date DATE NOT NULL PRIMARY KEY,
  normal_water DECIMAL(20,2) NOT NULL DEFAULT 0.00,
  normal_proxy_payout DECIMAL(20,2) NOT NULL DEFAULT 0.00,
  reward_discount DECIMAL(20,2) NOT NULL DEFAULT 0.00,
  reward_proxy_payout DECIMAL(20,2) NOT NULL DEFAULT 0.00,
  reward_proxy_pool DECIMAL(20,2) NOT NULL DEFAULT 0.00,
  lottery_pool_transfer DECIMAL(20,2) NOT NULL DEFAULT 0.00,
  player_consumption DECIMAL(20,2) NOT NULL DEFAULT 0.00,
  normal_event_count BIGINT NOT NULL DEFAULT 0,
  reward_discount_count BIGINT NOT NULL DEFAULT 0,
  reward_proxy_count BIGINT NOT NULL DEFAULT 0,
  player_consumption_count BIGINT NOT NULL DEFAULT 0,
  refreshed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mgr_platform_revenue_refreshed_at (refreshed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

-- +xuan Statement
CREATE TABLE IF NOT EXISTS mgr_platform_revenue_cache_state (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  source_start_date DATE NULL,
  synced_start_date DATE NULL,
  synced_end_date DATE NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

-- +xuan Statement
INSERT IGNORE INTO mgr_platform_revenue_cache_state (id) VALUES (1)
