UPDATE mgr_permission
SET name = '新增发牌优化', action = 'create', description = '为未启用玩家新增发牌优化；由角色权限决定是否可执行', status = 'enabled'
WHERE code = 'game.player_optimization.create'

-- +xuan Statement
UPDATE mgr_permission
SET name = '调整发牌优化', action = 'update', description = '调整已启用玩家的发牌优化参数；由角色权限决定是否可执行', status = 'enabled'
WHERE code = 'game.player_optimization.update'

-- +xuan Statement
UPDATE mgr_permission
SET name = '删除发牌优化', action = 'delete', description = '删除玩家现有发牌优化并清空相关参数；由角色权限决定是否可执行', status = 'enabled'
WHERE code = 'game.player_optimization.delete'
