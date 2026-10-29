-- 策略中心从「出牌策略草稿」升级为「机器人运行参数模板」：带入倍数、底皮、配牌、
-- 找房与换房节奏、输赢目标都集中在策略里，机器人绑定后随心跳下发到节点注入客户端环境变量。
-- 菜单恢复可见（031 曾把它隐藏），并给策略绑定补一个索引。
-- +xuan Statement
UPDATE mgr_module SET visible = 1, sort_order = 15 WHERE id = 47
-- +xuan Statement
ALTER TABLE mgr_automation_robot ADD INDEX idx_automation_robot_strategy (strategy_id)
