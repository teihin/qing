-- +xuan Statement
UPDATE mgr_permission
SET name = '调整发牌优化', action = 'update', description = '调整已启用玩家的发牌优化参数，仅超级管理员可执行', status = 'enabled'
WHERE code = 'game.player_optimization.update'

-- +xuan Statement
INSERT INTO mgr_permission (id, module_id, code, name, action, description, status) VALUES
  (2703, 27, 'game.player_optimization.create', '新增发牌优化', 'create', '为未启用玩家新增发牌优化，仅超级管理员可执行', 'enabled'),
  (2704, 27, 'game.player_optimization.delete', '删除发牌优化', 'delete', '删除玩家现有发牌优化并清空相关参数，仅超级管理员可执行', 'enabled')
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action), description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code IN (
  'game.player_optimization.create',
  'game.player_optimization.delete'
)
