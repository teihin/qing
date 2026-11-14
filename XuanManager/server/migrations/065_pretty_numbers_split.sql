-- 靓号拆成两个独立入口：账号ID靓号（uid）与俱乐部邀请码靓号（invite）。
-- 064 建的合并入口「靓号管理」隐藏并停用（不删，保留历史授权与审计关联）；权限按类型拆成两套。
-- 号池与命令不受影响：游戏服仍是一张 usr_pretty_no_info，用 kind 区分，后台只是分屏操作。

-- +xuan Statement
UPDATE mgr_module SET visible = 0, status = 'disabled' WHERE code = 'game.pretty_numbers'

-- +xuan Statement
UPDATE mgr_permission SET status = 'disabled' WHERE code IN ('game.pretty_no.view', 'game.pretty_no.manage')

-- +xuan Statement
INSERT INTO mgr_module (parent_id, code, name, route, icon, sort_order, visible, status) VALUES
  (20, 'game.pretty_no_uid', '账号ID靓号', '/game/pretty-numbers/uid', 'pretty-uid', 46, 1, 'enabled'),
  (20, 'game.pretty_no_invite', '俱乐部邀请码靓号', '/game/pretty-numbers/invite', 'pretty-invite', 47, 1, 'enabled')
ON DUPLICATE KEY UPDATE parent_id = VALUES(parent_id), name = VALUES(name), route = VALUES(route),
  icon = VALUES(icon), sort_order = VALUES(sort_order), visible = VALUES(visible), status = VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (module_id, code, name, action, description, status)
SELECT id, 'game.pretty_no.uid.view', '查看账号ID靓号', 'view', '查看账号ID靓号号池与候选号码', 'enabled'
FROM mgr_module WHERE code = 'game.pretty_no_uid'
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action),
  description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (module_id, code, name, action, description, status)
SELECT id, 'game.pretty_no.uid.manage', '管理账号ID靓号', 'manage', '账号ID号码入池、绑定玩家、解绑停用', 'enabled'
FROM mgr_module WHERE code = 'game.pretty_no_uid'
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action),
  description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (module_id, code, name, action, description, status)
SELECT id, 'game.pretty_no.invite.view', '查看俱乐部邀请码靓号', 'view', '查看俱乐部邀请码靓号号池与候选号码', 'enabled'
FROM mgr_module WHERE code = 'game.pretty_no_invite'
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action),
  description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (module_id, code, name, action, description, status)
SELECT id, 'game.pretty_no.invite.manage', '管理俱乐部邀请码靓号', 'manage', '邀请码号码入池、绑定俱乐部代理、解绑停用', 'enabled'
FROM mgr_module WHERE code = 'game.pretty_no_invite'
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action),
  description = VALUES(description), status = VALUES(status)

-- +xuan Statement
-- 总管理员直接拿到两套新权限。
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission
WHERE code IN ('game.pretty_no.uid.view', 'game.pretty_no.uid.manage',
               'game.pretty_no.invite.view', 'game.pretty_no.invite.manage')

-- +xuan Statement
-- 原先持有合并入口查看权限的角色，按类型继承到两个新模块的查看权限。
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT DISTINCT rp.role_id, target.id
FROM mgr_role_permission rp
JOIN mgr_permission source ON source.id = rp.permission_id
JOIN mgr_permission target ON target.code IN ('game.pretty_no.uid.view', 'game.pretty_no.invite.view')
WHERE source.code = 'game.pretty_no.view'

-- +xuan Statement
-- 原先持有合并入口管理权限的角色，按类型继承到两个新模块的管理权限。
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT DISTINCT rp.role_id, target.id
FROM mgr_role_permission rp
JOIN mgr_permission source ON source.id = rp.permission_id
JOIN mgr_permission target ON target.code IN ('game.pretty_no.uid.manage', 'game.pretty_no.invite.manage')
WHERE source.code = 'game.pretty_no.manage'
