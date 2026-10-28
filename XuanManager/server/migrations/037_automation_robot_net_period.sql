-- 净分归属日期：daily 目标按天累计、period 目标按周期累计，
-- 心跳时发现跨天/进入新周期就把累计值清零，避免沿用上一段时间的净分。
-- +xuan Statement
ALTER TABLE mgr_automation_robot ADD COLUMN today_net_date DATE NULL AFTER today_net
-- +xuan Statement
ALTER TABLE mgr_automation_robot ADD COLUMN period_net_start DATE NULL AFTER period_net
