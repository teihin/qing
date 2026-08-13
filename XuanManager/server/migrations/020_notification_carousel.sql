-- +xuan Statement
CREATE TABLE IF NOT EXISTS mgr_notification_carousel_setting (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  interval_seconds INT UNSIGNED NOT NULL DEFAULT 60,
  start_at DATETIME NULL,
  loop_count INT UNSIGNED NOT NULL DEFAULT 0,
  completed_loops INT UNSIGNED NOT NULL DEFAULT 0,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  last_sent_item_id BIGINT UNSIGNED NULL,
  last_sent_at DATETIME NULL,
  last_status VARCHAR(20) NOT NULL DEFAULT '',
  last_message VARCHAR(255) NOT NULL DEFAULT '',
  updated_by BIGINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

-- +xuan Statement
INSERT IGNORE INTO mgr_notification_carousel_setting (id, enabled, interval_seconds, revision)
VALUES (1, 0, 60, 1)

-- +xuan Statement
CREATE TABLE IF NOT EXISTS mgr_notification_carousel_item (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  content VARCHAR(500) NOT NULL,
  sort_order INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_mgr_notification_carousel_sort (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

-- +xuan Statement
INSERT INTO mgr_permission (id, module_id, code, name, action, description, status) VALUES
  (3203, 32, 'configuration.notification.carousel.update', '配置轮播公告', 'update', '新增、删除、排序并启停游戏全服轮播公告', 'enabled')
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action), description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code = 'configuration.notification.carousel.update'
