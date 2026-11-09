-- 玩家钻石发放：玩家管理页面直接给指定玩家增加 Account.stone。
-- 发放走游戏服命令「异步_增加_玩家_钻石」，成功回读 sm_stone 并写操作审计；
-- 「发放记录」直接读 mgr_audit_log 的 game.player.grant_stone 成功记录。
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
