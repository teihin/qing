-- 业绩股总览：按联盟查看整个代理树的业绩股开通状态、上级下级关系与业绩比例。
-- 只读页面：数据来自游戏库代理树和游戏服「异步_查询_俱乐部_业绩_报表」。
-- +xuan Statement
INSERT INTO mgr_module (parent_id, code, name, route, icon, sort_order, visible, status) VALUES
  (20, 'game.club_perf', '业绩股', '/game/club-perf', 'agents', 40, 1, 'enabled')
ON DUPLICATE KEY UPDATE parent_id = VALUES(parent_id), name = VALUES(name), route = VALUES(route), icon = VALUES(icon), sort_order = VALUES(sort_order), visible = VALUES(visible), status = VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (module_id, code, name, action, description, status)
SELECT id, 'game.club_perf.view', '查询业绩股', 'view', '按联盟查看全部代理的业绩股开通状态、代理树与业绩比例', 'enabled'
FROM mgr_module WHERE code = 'game.club_perf'
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action), description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code = 'game.club_perf.view'
