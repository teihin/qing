-- 业绩股：后台「新增开通人员」写权限。
-- 实际授权调用游戏服「设置_俱乐部_业绩_授权」，服务端仍按调用者权限校验。
-- +xuan Statement
INSERT INTO mgr_permission (module_id, code, name, action, description, status)
SELECT id, 'game.club_perf.grant', '授权业绩股', 'grant', '在业绩股总览为联盟代理开通业绩股，走游戏服授权命令', 'enabled'
FROM mgr_module WHERE code = 'game.club_perf'
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action), description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code = 'game.club_perf.grant'
