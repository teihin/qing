-- 代理贡献管理：按联盟/俱乐部逐层查看代理与玩家，并设置总贡献/总输赢的展示规则。
-- 数据与规则都以游戏服为准；后台只负责读取真实值和下发设置。
-- +xuan Statement
INSERT INTO mgr_module (id, parent_id, code, name, route, icon, sort_order, visible, status) VALUES
  (56, 20, 'game.agent_contributions', '代理贡献管理', '/game/agent-contributions', 'contribution', 27, 1, 'enabled')
ON DUPLICATE KEY UPDATE parent_id = VALUES(parent_id), name = VALUES(name), route = VALUES(route),
  icon = VALUES(icon), sort_order = VALUES(sort_order), visible = VALUES(visible), status = VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (id, module_id, code, name, action, description, status) VALUES
  (5701, 56, 'game.agent_contribution.view', '查看代理贡献', 'view', '按联盟/俱乐部逐层查看代理与玩家，并读取真实贡献和输赢', 'enabled'),
  (5702, 56, 'game.agent_contribution.adjust', '调整代理展示规则', 'adjust', '设置代理及其下级线的贡献/输赢展示比例或固定差额，恢复上级继承', 'enabled')
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action),
  description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code IN ('game.agent_contribution.view', 'game.agent_contribution.adjust')

-- +xuan Statement
-- 与俱乐部管理共用权限来源：有 game.club.view 的角色同时已有 game.union.view（042 迁移），
-- 代理贡献管理页面需要读取联盟/俱乐部层级，不能只给俱乐部权限而缺联盟权限。
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT rp.role_id, target.id
FROM mgr_role_permission rp
JOIN mgr_permission source ON source.id = rp.permission_id
JOIN mgr_permission target ON target.code = 'game.agent_contribution.view'
WHERE source.code = 'game.club.view'

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT rp.role_id, target.id
FROM mgr_role_permission rp
JOIN mgr_permission source ON source.id = rp.permission_id
JOIN mgr_permission target ON target.code = 'game.agent_contribution.adjust'
WHERE source.code = 'game.club.view'
