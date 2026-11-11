-- 暗抽开关：按俱乐部/联盟控制开房-游戏设置里的暗抽是否显示。
-- 存储走游戏端哈希表 kbedm.usr_hash_info：「暗抽_俱乐部_<clubId>」= 1/0；
-- 联盟开关写联盟总群主俱乐部的同一个 key，客户端用「查询_哈希_信息」读取。
-- 后台不能通过 /hall/command 调 Account 命令，所以后端直接读写哈希表。
-- +xuan Statement
INSERT INTO mgr_permission (module_id, code, name, action, description, status) VALUES
  (54, 'game.club.dark_setting', '暗抽开关', 'dark_setting', '按俱乐部开启或关闭开房-游戏设置里的暗抽；写入游戏端哈希表并由客户端读取', 'enabled'),
  (55, 'game.union.dark_setting', '暗抽开关', 'dark_setting', '按联盟开启或关闭总群主俱乐部的暗抽；写入总群主俱乐部的哈希 key', 'enabled')
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action), description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code IN ('game.club.dark_setting', 'game.union.dark_setting')
