-- 大小BOSS：玩家管理里给账号配置可管理的联盟 / 俱乐部（union_manage / club_manage）。
-- 写入走游戏服「异步_设置_俱乐部_管理范围」，后台只新增操作权限。
-- +xuan Statement
INSERT INTO mgr_permission (module_id, code, name, action, description, status) VALUES
  (21, 'game.player.manage_scope', '配置大小BOSS', 'manage_scope', '设置玩家可管理的联盟与俱乐部（union_manage/club_manage）；配置后玩家在游戏内显示数据统计入口和 BOSS 头像面板', 'enabled')
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action), description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT rp.role_id, target.id
FROM mgr_role_permission rp
JOIN mgr_permission source ON source.id = rp.permission_id
JOIN mgr_permission target ON target.code = 'game.player.manage_scope'
WHERE source.code = 'game.player.balance_adjust'

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code = 'game.player.manage_scope'
