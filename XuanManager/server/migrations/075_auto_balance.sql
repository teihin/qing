-- 自动输赢平衡：后台新增独立模块，读写游戏服 8890 的 auto_balance 命令族。
-- 配置、候选、伙牌名单全部在游戏服侧（usr_hash_info / usr_partner_team_member），
-- 后台不建业务表，只新增模块与操作权限。
-- 注意：模块 id 用自增（不写死），避免与既有模块撞号覆盖对方名称。

-- +xuan Statement
INSERT INTO mgr_module (parent_id, code, name, route, icon, sort_order, visible, status)
SELECT 20, 'game.auto_balance', '自动输赢平衡', '/game/auto-balance', 'balance', 72, 1, 'enabled'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM mgr_module WHERE code = 'game.auto_balance')

-- +xuan Statement
UPDATE mgr_module
SET parent_id = 20, name = '自动输赢平衡', route = '/game/auto-balance', icon = 'balance',
    sort_order = 72, visible = 1, status = 'enabled'
WHERE code = 'game.auto_balance'

-- +xuan Statement
INSERT INTO mgr_permission (module_id, code, name, action, description, status)
SELECT id, 'game.auto_balance.view', '查看自动输赢平衡', 'view', '查看平衡配置、今日计数、候选玩家与伙牌名单', 'enabled'
FROM mgr_module WHERE code = 'game.auto_balance'
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action),
  description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (module_id, code, name, action, description, status)
SELECT id, 'game.auto_balance.config', '修改平衡配置', 'config', '修改总开关、运行模式、阈值、限额与按底皮覆盖', 'enabled'
FROM mgr_module WHERE code = 'game.auto_balance'
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action),
  description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (module_id, code, name, action, description, status)
SELECT id, 'game.auto_balance.execute', '执行平衡下发', 'execute', '手动执行一次、对指定玩家落地建议、一键全停', 'enabled'
FROM mgr_module WHERE code = 'game.auto_balance'
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action),
  description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (module_id, code, name, action, description, status)
SELECT id, 'game.auto_balance.team', '维护伙牌名单', 'team', '新增或移除伙牌名单成员，并从玩家分组批量导入', 'enabled'
FROM mgr_module WHERE code = 'game.auto_balance'
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action),
  description = VALUES(description), status = VALUES(status)

-- 角色继承：能看/管玩家控制的角色，默认获得查看与执行；配置与名单同样继承，
-- 后续可在「角色与权限」里单独收回。
-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT rp.role_id, target.id
FROM mgr_role_permission rp
JOIN mgr_permission source ON source.id = rp.permission_id
JOIN mgr_permission target ON target.code = 'game.auto_balance.view'
WHERE source.code = 'game.player_optimization.view'

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT rp.role_id, target.id
FROM mgr_role_permission rp
JOIN mgr_permission source ON source.id = rp.permission_id
JOIN mgr_permission target ON target.code = 'game.auto_balance.config'
WHERE source.code = 'game.player_optimization.update'

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT rp.role_id, target.id
FROM mgr_role_permission rp
JOIN mgr_permission source ON source.id = rp.permission_id
JOIN mgr_permission target ON target.code = 'game.auto_balance.execute'
WHERE source.code = 'game.player_optimization.update'

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT rp.role_id, target.id
FROM mgr_role_permission rp
JOIN mgr_permission source ON source.id = rp.permission_id
JOIN mgr_permission target ON target.code = 'game.auto_balance.team'
WHERE source.code = 'game.player_optimization.update'

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code LIKE 'game.auto_balance.%'
