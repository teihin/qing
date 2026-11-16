-- +xuan Statement
-- 后台「玩家优化」模块更名为「玩家控制」，菜单、权限名称与描述同步改为「控制」。
-- 只改显示文案：模块 code、路由、图标 key 与权限 code 全部保持原值，
-- 避免角色授权、接口路径和前端路由失效。
UPDATE mgr_module SET name = '玩家控制'
WHERE code = 'game.player_optimization'

-- +xuan Statement
UPDATE mgr_permission SET name = '查看发牌控制', description = '查询玩家当前发牌控制设置人、剩余次数和触发概率'
WHERE code = 'game.player_optimization.view'

-- +xuan Statement
UPDATE mgr_permission SET name = '新增发牌控制', description = '为未启用玩家新增发牌控制；由角色权限决定是否可执行'
WHERE code = 'game.player_optimization.create'

-- +xuan Statement
UPDATE mgr_permission SET name = '调整发牌控制', description = '调整已启用玩家的发牌控制参数；由角色权限决定是否可执行'
WHERE code = 'game.player_optimization.update'

-- +xuan Statement
UPDATE mgr_permission SET name = '删除发牌控制', description = '删除玩家现有发牌控制并清空相关参数；由角色权限决定是否可执行'
WHERE code = 'game.player_optimization.delete'
