-- 强制带入钻石：按俱乐部/联盟强制开房规则同步带入钻石（默认关闭，缺行即关闭）。
-- 存储走游戏端哈希表 kbedm.usr_hash_info：「强制入座扣钻_俱乐部_<clubId>」= 1/0；
-- 联盟开关写联盟总群主俱乐部（club_union_info.club_guuid）的同一个 key。
-- 客户端用 查询_哈希_信息 读取，把创建规则里的「同步带入钻石」默认打开并锁死；
-- 游戏服在「创建_俱乐部_玩法」与建房（BuildClubPlayRoomSetting）两处做强校验。
-- 后台不能通过 /hall/command 调 Account 命令，所以后端直接读写哈希表。

-- +xuan Statement
INSERT INTO mgr_permission (module_id, code, name, action, description, status)
SELECT id, 'game.club.seat_stone_force', '强制开房带钻石', 'seat_stone_force', '按俱乐部强制开房规则同步带入钻石，客户端创建规则时默认打开且不可关闭', 'enabled'
FROM mgr_module WHERE code = 'game.clubs'
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action), description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (module_id, code, name, action, description, status)
SELECT id, 'game.union.seat_stone_force', '强制开房带钻石', 'seat_stone_force', '按联盟强制总群主俱乐部的开房规则同步带入钻石，写总群主俱乐部的哈希 key', 'enabled'
FROM mgr_module WHERE code = 'game.unions'
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action), description = VALUES(description), status = VALUES(status)

-- 角色继承：能管暗抽的角色默认获得强制带入钻石，后续可在「角色与权限」里单独收回。
-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT rp.role_id, target.id
FROM mgr_role_permission rp
JOIN mgr_permission source ON source.id = rp.permission_id
JOIN mgr_permission target ON target.code = 'game.club.seat_stone_force'
WHERE source.code = 'game.club.dark_setting'

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT rp.role_id, target.id
FROM mgr_role_permission rp
JOIN mgr_permission source ON source.id = rp.permission_id
JOIN mgr_permission target ON target.code = 'game.union.seat_stone_force'
WHERE source.code = 'game.union.dark_setting'

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code IN ('game.club.seat_stone_force', 'game.union.seat_stone_force')
