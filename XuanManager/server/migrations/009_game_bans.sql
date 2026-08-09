-- +xuan Statement
INSERT INTO mgr_module (id, parent_id, code, name, route, icon, sort_order, visible, status) VALUES
  (25, 20, 'game.bans', '封号管理', '/game/bans', 'bans', 50, 1, 'enabled')
ON DUPLICATE KEY UPDATE parent_id = VALUES(parent_id), name = VALUES(name), route = VALUES(route), icon = VALUES(icon), sort_order = VALUES(sort_order), visible = VALUES(visible), status = VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (id, module_id, code, name, action, description, status) VALUES
  (2501, 25, 'game.ban.view', '查看封号账号', 'view', '查询所有 client_status 非空的游戏玩家账号', 'enabled'),
  (2502, 25, 'game.ban.create', '封禁游戏账号', 'create', '按六位游戏玩家 ID 设置封号原因', 'enabled'),
  (2503, 25, 'game.ban.remove', '解除游戏封号', 'remove', '按六位游戏玩家 ID 清空封号状态', 'enabled')
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action), description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code IN (
  'game.ban.view',
  'game.ban.create',
  'game.ban.remove'
)
