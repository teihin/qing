-- +xuan Statement
UPDATE mgr_module
SET name = '系统设置', icon = 'system', sort_order = 90
WHERE code = 'system'

-- +xuan Statement
UPDATE mgr_module SET name = '后台用户' WHERE code = 'system.users'

-- +xuan Statement
UPDATE mgr_module SET name = '角色权限' WHERE code = 'system.roles'

-- +xuan Statement
UPDATE mgr_module SET name = '功能模块' WHERE code = 'system.modules'

-- +xuan Statement
INSERT INTO mgr_module (id, parent_id, code, name, route, icon, sort_order, visible, status) VALUES
  (20, NULL, 'game', '游戏管理', '', 'game', 20, 1, 'enabled'),
  (21, 20, 'game.players', '玩家管理', '/game/players', 'players', 10, 1, 'enabled')
ON DUPLICATE KEY UPDATE parent_id = VALUES(parent_id), name = VALUES(name), route = VALUES(route), icon = VALUES(icon), sort_order = VALUES(sort_order), visible = VALUES(visible), status = VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (id, module_id, code, name, action, description, status) VALUES
  (2101, 21, 'game.player.view', '查看玩家', 'view', '查询游戏玩家、账号、代理和游戏状态信息', 'enabled')
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action), description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code = 'game.player.view'
