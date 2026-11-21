-- 大厅排行榜入口开关：按俱乐部/联盟控制「发现」页的排行榜按钮是否显示。
-- 存储走游戏端哈希表 kbedm.usr_hash_info：
--   独立俱乐部 = 「排行榜_俱乐部_<clubId>」= 1/0
--   已入盟俱乐部 = 「排行榜_联盟_<unionId>」= 1/0（联盟统一设置）
-- 客户端用 查询_哈希_信息 读取；后台不能通过 /hall/command 调 Account 命令，所以直接读写哈希表。

-- +xuan Statement
INSERT INTO mgr_permission (module_id, code, name, action, description, status)
SELECT id, 'game.club.leaderboard_entry', '排行榜入口', 'leaderboard_entry', '按独立俱乐部开启或关闭大厅「发现」页的排行榜入口', 'enabled'
FROM mgr_module WHERE code = 'game.clubs'
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action), description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (module_id, code, name, action, description, status)
SELECT id, 'game.union.leaderboard_entry', '排行榜入口', 'leaderboard_entry', '按联盟统一开启或关闭联盟下所有俱乐部的大厅排行榜入口', 'enabled'
FROM mgr_module WHERE code = 'game.unions'
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action), description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT rp.role_id, target.id
FROM mgr_role_permission rp
JOIN mgr_permission source ON source.id = rp.permission_id
JOIN mgr_permission target ON target.code = 'game.club.leaderboard_entry'
WHERE source.code = 'game.club.dark_setting'

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT rp.role_id, target.id
FROM mgr_role_permission rp
JOIN mgr_permission source ON source.id = rp.permission_id
JOIN mgr_permission target ON target.code = 'game.union.leaderboard_entry'
WHERE source.code = 'game.union.dark_setting'

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code IN ('game.club.leaderboard_entry', 'game.union.leaderboard_entry')
