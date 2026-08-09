-- +xuan Statement
INSERT INTO mgr_module (id, parent_id, code, name, route, icon, sort_order, visible, status) VALUES
  (22, 20, 'game.agents', '代理管理', '/game/agents', 'agents', 20, 1, 'enabled')
ON DUPLICATE KEY UPDATE parent_id = VALUES(parent_id), name = VALUES(name), route = VALUES(route), icon = VALUES(icon), sort_order = VALUES(sort_order), visible = VALUES(visible), status = VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (id, module_id, code, name, action, description, status) VALUES
  (2201, 22, 'game.agent.view', '查看代理', 'view', '只读查询 BOSS、代理、盟主、上下级链路、下级玩家及分红比例', 'enabled')
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action), description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code = 'game.agent.view'
