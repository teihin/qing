-- 修复 053 首版显式使用 id=2103 与既有「重置玩家密码」权限冲突的问题：
-- 053 首版在已有环境把 2103 的名称/动作/说明覆盖成了钻石发放，但保留原 code，
-- 同时因主键冲突没有插入 game.player.grant_stone。本迁移恢复 2103 并补齐新权限。
-- +xuan Statement
UPDATE mgr_permission
SET name = '重置玩家密码', action = 'reset_password',
    description = '为指定游戏玩家重置登录密码；不读取或显示原密码'
WHERE id = 2103 AND code = 'game.player.reset_password'

-- +xuan Statement
INSERT INTO mgr_permission (module_id, code, name, action, description, status) VALUES
  (21, 'game.player.grant_stone', '发放玩家钻石', 'grant_stone', '向指定游戏玩家直接发放钻石，调用游戏服并回读玩家钻石余额校验', 'enabled')
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action), description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT rp.role_id, target.id
FROM mgr_role_permission rp
JOIN mgr_permission source ON source.id = rp.permission_id
JOIN mgr_permission target ON target.code = 'game.player.grant_stone'
WHERE source.code = 'game.player.balance_adjust'

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code = 'game.player.grant_stone'
