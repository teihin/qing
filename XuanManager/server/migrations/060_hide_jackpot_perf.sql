-- 奖池业绩模块已废弃：只隐藏菜单入口，保留模块/权限/历史数据，便于回滚。
-- +xuan Statement
UPDATE mgr_module SET visible = 0 WHERE code = 'game.jackpot'
