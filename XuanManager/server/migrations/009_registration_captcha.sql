-- +xuan Statement
CREATE TABLE IF NOT EXISTS mgr_platform_setting (
  setting_key VARCHAR(64) NOT NULL,
  setting_value TEXT NOT NULL,
  updated_by VARCHAR(64) NOT NULL DEFAULT '',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4

-- +xuan Statement
INSERT INTO mgr_platform_setting (setting_key, setting_value) VALUES
  ('registration.captcha.enabled', 'false')
ON DUPLICATE KEY UPDATE setting_key = VALUES(setting_key)

-- +xuan Statement
INSERT INTO mgr_module (id, parent_id, code, name, route, icon, sort_order, visible, status) VALUES
  (34, 30, 'configuration.security', '注册防护', '/configuration/security', 'shield', 40, 1, 'enabled')
ON DUPLICATE KEY UPDATE parent_id = VALUES(parent_id), name = VALUES(name), route = VALUES(route), icon = VALUES(icon), sort_order = VALUES(sort_order), visible = VALUES(visible), status = VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (id, module_id, code, name, action, description, status) VALUES
  (3401, 34, 'configuration.security.view', '查看注册防护', 'view', '查看注册滑动验证开关状态', 'enabled'),
  (3402, 34, 'configuration.security.update', '修改注册防护', 'update', '开启或关闭注册滑动验证并写入审计', 'enabled')
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action), description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code IN (
  'configuration.security.view',
  'configuration.security.update'
)
