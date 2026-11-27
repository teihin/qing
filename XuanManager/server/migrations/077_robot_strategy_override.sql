-- 机器人在绑定策略之上的自定义参数：只存被覆盖的字段（JSON），空表示完全跟随策略。
-- 下发时后端把这份字段合并进 strategyConfig 再给节点，客户端不需要知道有两层。
ALTER TABLE mgr_automation_robot ADD COLUMN strategy_override_json LONGTEXT NULL;
