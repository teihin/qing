-- +xuan Statement
INSERT INTO mgr_module (id, parent_id, code, name, route, icon, sort_order, visible, status) VALUES
  (28, 20, 'game.anti_theft', '防盗号管理', '/game/anti-theft', 'anti-theft', 80, 1, 'enabled')
ON DUPLICATE KEY UPDATE parent_id = VALUES(parent_id), name = VALUES(name), route = VALUES(route), icon = VALUES(icon), sort_order = VALUES(sort_order), visible = VALUES(visible), status = VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (id, module_id, code, name, action, description, status) VALUES
  (2801, 28, 'game.anti_theft.view', '查看防盗号状态', 'view', '查询玩家防盗号开关、脱敏设备标识、绑定平台和绑定时间', 'enabled'),
  (2802, 28, 'game.anti_theft.unbind', '解除防盗号绑定', 'unbind', '客服完成身份核验后，通过 KB 命令解除玩家的防盗号设备绑定', 'enabled')
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action), description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code IN (
  'game.anti_theft.view',
  'game.anti_theft.unbind'
)
