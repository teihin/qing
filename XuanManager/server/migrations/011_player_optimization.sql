-- +xuan Statement
INSERT INTO mgr_module (id, parent_id, code, name, route, icon, sort_order, visible, status) VALUES
  (27, 20, 'game.player_optimization', '玩家优化', '/game/player-optimization', 'player-optimization', 70, 1, 'enabled')
ON DUPLICATE KEY UPDATE parent_id = VALUES(parent_id), name = VALUES(name), route = VALUES(route), icon = VALUES(icon), sort_order = VALUES(sort_order), visible = VALUES(visible), status = VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (id, module_id, code, name, action, description, status) VALUES
  (2701, 27, 'game.player_optimization.view', '查看发牌优化', 'view', '查询玩家当前发牌优化设置人、剩余次数和触发概率', 'enabled'),
  (2702, 27, 'game.player_optimization.update', '调整发牌优化', 'update', '调整已启用玩家的发牌优化参数，仅超级管理员可执行', 'enabled')
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action), description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code IN (
  'game.player_optimization.view',
  'game.player_optimization.update'
)
