-- 周计划：输赢目标按「周一到周日 + 每天多个时段」跑，时段外让出 Worker。
-- profit_schedule 存 [{"weekday":1,"start":"12:00","end":"18:00"}]（weekday 1=周一…7=周日；
-- end 小于等于 start 表示跨到次日，比如 22:00-02:00 算在开始那天的计划上）。
-- schedule_window 记当前时段的键（"2006-01-02 15:04"），换时段时把 window_net 清零；
-- schedule_state 为 released 表示时段外已把 Worker 位置让出来了，通用分配会跳过它，
-- 等下一个时段开始时由巡检恢复分配。profit_mode='schedule' 时才生效。
-- +xuan Statement
ALTER TABLE mgr_automation_robot ADD COLUMN profit_schedule VARCHAR(1024) NOT NULL DEFAULT '' AFTER period_end
-- +xuan Statement
ALTER TABLE mgr_automation_robot ADD COLUMN schedule_window VARCHAR(24) NOT NULL DEFAULT '' AFTER profit_schedule
-- +xuan Statement
ALTER TABLE mgr_automation_robot ADD COLUMN window_net BIGINT NOT NULL DEFAULT 0 AFTER schedule_window
-- +xuan Statement
ALTER TABLE mgr_automation_robot ADD COLUMN schedule_state VARCHAR(16) NOT NULL DEFAULT '' AFTER window_net
