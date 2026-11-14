-- 靓号管理：运营在后台把 6 位号码入池，绑定到个人ID或俱乐部邀请码，并可解绑停用。
-- 号池与绑定关系全部由游戏服维护（usr_pretty_no_info），后台只做命令代理与只读展示。
-- +xuan Statement
INSERT INTO mgr_module (parent_id, code, name, route, icon, sort_order, visible, status) VALUES
  (20, 'game.pretty_numbers', '靓号管理', '/game/pretty-numbers', 'pretty', 46, 1, 'enabled')
ON DUPLICATE KEY UPDATE parent_id = VALUES(parent_id), name = VALUES(name), route = VALUES(route),
  icon = VALUES(icon), sort_order = VALUES(sort_order), visible = VALUES(visible), status = VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (module_id, code, name, action, description, status)
SELECT id, 'game.pretty_no.view', '查看靓号', 'view', '查看靓号号池、绑定状态与候选号码', 'enabled'
FROM mgr_module WHERE code = 'game.pretty_numbers'
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action),
  description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (module_id, code, name, action, description, status)
SELECT id, 'game.pretty_no.manage', '管理靓号', 'manage', '号码入池、绑定个人ID或俱乐部邀请码、解绑停用', 'enabled'
FROM mgr_module WHERE code = 'game.pretty_numbers'
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action),
  description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code IN ('game.pretty_no.view', 'game.pretty_no.manage')

-- +xuan Statement
-- 能看玩家的角色默认能看靓号；能调整余额或发放钻石的运营角色默认能管理。
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT rp.role_id, target.id
FROM mgr_role_permission rp
JOIN mgr_permission source ON source.id = rp.permission_id
JOIN mgr_permission target ON target.code = 'game.pretty_no.view'
WHERE source.code = 'game.player.view'

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT DISTINCT rp.role_id, target.id
FROM mgr_role_permission rp
JOIN mgr_permission source ON source.id = rp.permission_id
JOIN mgr_permission target ON target.code = 'game.pretty_no.manage'
WHERE source.code IN ('game.player.balance_adjust', 'game.player.grant_stone')