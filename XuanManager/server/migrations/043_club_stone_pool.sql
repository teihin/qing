-- 俱乐部群主钻石池：列表展示与加/减调整（群主账号 sm_stone，玩家兑换钻石从该池扣除）。
-- 调整入口单独授权；默认只授予已有联盟池调整权限的角色和超级管理员。
-- +xuan Statement
INSERT INTO mgr_permission (id, module_id, code, name, action, description, status) VALUES
  (5503, 54, 'game.club.stone_pool_adjust', '调整群主钻石池', 'stone_pool_adjust', '增加或扣减俱乐部群主钻石池，直接写游戏服并回读校验', 'enabled')
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action), description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT rp.role_id, target.id
FROM mgr_role_permission rp
JOIN mgr_permission source ON source.id = rp.permission_id
JOIN mgr_permission target ON target.code = 'game.club.stone_pool_adjust'
WHERE source.code = 'game.union.quota_adjust'

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code = 'game.club.stone_pool_adjust'
