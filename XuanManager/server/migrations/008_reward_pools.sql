-- +xuan Statement
INSERT INTO mgr_module (id, parent_id, code, name, route, icon, sort_order, visible, status) VALUES
  (33, 30, 'configuration.reward_pools', '奖池设置', '/configuration/reward-pools', 'reward-pools', 30, 1, 'enabled')
ON DUPLICATE KEY UPDATE parent_id = VALUES(parent_id), name = VALUES(name), route = VALUES(route), icon = VALUES(icon), sort_order = VALUES(sort_order), visible = VALUES(visible), status = VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (id, module_id, code, name, action, description, status) VALUES
  (3301, 33, 'configuration.reward_pool.view', '查看各皮池奖池', 'view', '查看游戏全部皮池当前奖池金额和总金额', 'enabled'),
  (3302, 33, 'configuration.reward_pool.update', '修改各皮池奖池', 'update', '修改游戏全部皮池奖池并在回读校验后写入审计', 'enabled')
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action), description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code IN (
  'configuration.reward_pool.view',
  'configuration.reward_pool.update'
)
