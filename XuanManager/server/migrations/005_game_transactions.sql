-- +xuan Statement
INSERT INTO mgr_module (id, parent_id, code, name, route, icon, sort_order, visible, status) VALUES
  (23, 20, 'game.transactions', '交易记录', '/game/transactions', 'transactions', 30, 1, 'enabled')
ON DUPLICATE KEY UPDATE parent_id = VALUES(parent_id), name = VALUES(name), route = VALUES(route), icon = VALUES(icon), sort_order = VALUES(sort_order), visible = VALUES(visible), status = VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (id, module_id, code, name, action, description, status) VALUES
  (2301, 23, 'game.transaction.view', '查看交易记录', 'view', '按玩家ID只读查询游戏内全部金币变化记录', 'enabled')
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action), description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code = 'game.transaction.view'
