-- 联盟管理（联盟模式 V2）：查看联盟、联盟池额度与关联俱乐部。
-- 平台后台只能给联盟池注资（游戏命令「增加_联盟_额度」，仅 boss）；
-- 俱乐部额度由联盟总群主在游戏内用「授信_联盟_额度」下发，后台不直接分配。
-- +xuan Statement
INSERT INTO mgr_module (id, parent_id, code, name, route, icon, sort_order, visible, status) VALUES
  (55, 20, 'game.unions', '联盟管理', '/game/unions', 'unions', 26, 1, 'enabled')
ON DUPLICATE KEY UPDATE parent_id = VALUES(parent_id), name = VALUES(name), route = VALUES(route), icon = VALUES(icon), sort_order = VALUES(sort_order), visible = VALUES(visible), status = VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (id, module_id, code, name, action, description, status) VALUES
  (5601, 55, 'game.union.view', '查看联盟', 'view', '查看联盟模式 V2 的联盟、总群主、联盟池与关联俱乐部', 'enabled'),
  (5602, 55, 'game.union.quota_adjust', '调整联盟池额度', 'quota_adjust', '给联盟总群主注资，平台只增加联盟池额度，不直接分配俱乐部额度', 'enabled')
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action), description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code IN ('game.union.view', 'game.union.quota_adjust')

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT rp.role_id, target.id
FROM mgr_role_permission rp
JOIN mgr_permission source ON source.id = rp.permission_id
JOIN mgr_permission target ON target.code = 'game.union.view'
WHERE source.code = 'game.club.view'

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT rp.role_id, target.id
FROM mgr_role_permission rp
JOIN mgr_permission source ON source.id = rp.permission_id
JOIN mgr_permission target ON target.code = 'game.union.quota_adjust'
WHERE source.code = 'game.club.quota_adjust'

-- +xuan Statement
DELETE FROM mgr_role_permission
WHERE permission_id = (SELECT id FROM mgr_permission WHERE code = 'game.club.quota_adjust')

-- +xuan Statement
DELETE FROM mgr_permission WHERE code = 'game.club.quota_adjust'
