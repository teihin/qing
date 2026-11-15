-- 俱乐部荣耀榜：按联盟 / 独立俱乐部开启手数榜、赢分榜、红利榜，并设置起止时间与名次奖励。
-- 配置实体存在游戏服（club_honor_rank_config / club_honor_rank_reward），后台不建表，
-- 读写统一走游戏服 异步_查询/设置_俱乐部_活动_配置，这里只新增查看与操作权限。

-- +xuan Statement
INSERT INTO mgr_permission (module_id, code, name, action, description, status)
SELECT id, 'game.club_honor_rank.view', '查看荣耀榜配置', 'view', '查看某个联盟或独立俱乐部的排行榜开关、起止时间与名次奖励', 'enabled'
FROM mgr_module WHERE code = 'game.clubs'
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action), description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (module_id, code, name, action, description, status)
SELECT id, 'game.club_honor_rank.manage', '配置荣耀榜', 'manage', '开启或关闭某个联盟或独立俱乐部的排行榜，并设置起止时间与名次奖励', 'enabled'
FROM mgr_module WHERE code = 'game.clubs'
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action), description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT rp.role_id, target.id
FROM mgr_role_permission rp
JOIN mgr_permission source ON source.id = rp.permission_id
JOIN mgr_permission target ON target.code = 'game.club_honor_rank.view'
WHERE source.code = 'game.club.view'

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT rp.role_id, target.id
FROM mgr_role_permission rp
JOIN mgr_permission source ON source.id = rp.permission_id
JOIN mgr_permission target ON target.code = 'game.club_honor_rank.manage'
WHERE source.code = 'game.club.dark_setting'

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code = 'game.club_honor_rank.view'

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code = 'game.club_honor_rank.manage'
