-- 用户端数据查询：按游戏用户ID查询客户端可见的全部资金/分红明细。
-- 纯只读页面，数据来自游戏库 usr_cash_water / club_history_info / usr_income_info。
-- +xuan Statement
INSERT INTO mgr_module (parent_id, code, name, route, icon, sort_order, visible, status) VALUES
  (20, 'game.user_data', '用户端数据查询', '/game/user-data', 'user-data', 15, 1, 'enabled')
ON DUPLICATE KEY UPDATE parent_id = VALUES(parent_id), name = VALUES(name), route = VALUES(route), icon = VALUES(icon), sort_order = VALUES(sort_order), visible = VALUES(visible), status = VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (module_id, code, name, action, description, status)
SELECT id, 'game.user_data.view', '查询用户端明细', 'view', '按游戏用户ID查询上下分记录、赠送金币、金币流向、钻石流向和收益红利明细', 'enabled'
FROM mgr_module WHERE code = 'game.user_data'
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action), description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT rp.role_id, target.id
FROM mgr_role_permission rp
JOIN mgr_permission source ON source.id = rp.permission_id
JOIN mgr_permission target ON target.code = 'game.user_data.view'
WHERE source.code = 'game.player.view'

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code = 'game.user_data.view'
