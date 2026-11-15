-- +xuan Statement
-- 业绩股：新增「全局折算百分比」配置权限。
-- 配置写游戏库 kbedm.usr_hash_info（hash_key='俱乐部业绩全局百分比'，明文整数，默认 50），
-- 服务端 10 秒内热加载。查看沿用 game.club_perf.view，单独拆出 update 权限，
-- 避免只给了查看的人顺手把全服业绩折算改掉。
INSERT INTO mgr_permission (module_id, code, name, action, description, status)
SELECT id, 'game.club_perf.config', '配置业绩折算百分比', 'config', '修改俱乐部业绩全局折算百分比（写入游戏端哈希配置，影响客户端与后台全部业绩展示）', 'enabled'
FROM mgr_module WHERE code = 'game.club_perf'
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action), description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code = 'game.club_perf.config'
