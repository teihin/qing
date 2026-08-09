-- +xuan Statement
INSERT INTO mgr_module (id, parent_id, code, name, route, icon, sort_order, visible, status) VALUES
  (30, NULL, 'configuration', '系统配置', '', 'configuration', 30, 1, 'enabled'),
  (31, 30, 'configuration.announcement', '游戏公告设置', '/configuration/announcement', 'announcement', 10, 1, 'enabled'),
  (32, 30, 'configuration.notifications', '游戏通知发送', '/configuration/notifications', 'notifications', 20, 1, 'enabled')
ON DUPLICATE KEY UPDATE parent_id = VALUES(parent_id), name = VALUES(name), route = VALUES(route), icon = VALUES(icon), sort_order = VALUES(sort_order), visible = VALUES(visible), status = VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (id, module_id, code, name, action, description, status) VALUES
  (3101, 31, 'configuration.announcement.view', '查看游戏公告', 'view', '查看游戏大厅当前长期公告和最近修改信息', 'enabled'),
  (3102, 31, 'configuration.announcement.update', '修改游戏公告', 'update', '修改游戏大厅长期公告内容并写入审计', 'enabled'),
  (3201, 32, 'configuration.notification.view', '查看通知记录', 'view', '查看后台最近发送的全服游戏通知', 'enabled'),
  (3202, 32, 'configuration.notification.send', '发送全服通知', 'send', '向当前在线游戏玩家发送即时全服通知', 'enabled')
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action), description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code IN (
  'configuration.announcement.view',
  'configuration.announcement.update',
  'configuration.notification.view',
  'configuration.notification.send'
)
