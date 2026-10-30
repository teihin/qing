-- 账号激活：后台建号只写营销表 third_marketing_info，玩家行 tbl_Account 由游戏服在
-- 首次真实登录时创建。没有那一行之前，投放调用 添加_俱乐部_玩家 会回「玩家不存在」。
-- activated_at 记录「这个账号已经真实登录过一次」的时间：为空表示未激活，不能投放；
-- 有空闲 Worker 时由巡检拉一次只登录的终端（XUAN_LOGIN_ONLY）来完成，登录成功后回查
-- kbedm.kbe_accountinfos 确认建号才写值。activation_attempts / activation_attempted_at
-- 用于失败后的冷却与重试上限，error 记录最后一次失败原因。
-- +xuan Statement
ALTER TABLE mgr_automation_robot ADD COLUMN activated_at DATETIME NULL AFTER joined_at
-- +xuan Statement
ALTER TABLE mgr_automation_robot ADD COLUMN activation_error VARCHAR(255) NOT NULL DEFAULT '' AFTER activated_at
-- +xuan Statement
ALTER TABLE mgr_automation_robot ADD COLUMN activation_attempts INT NOT NULL DEFAULT 0 AFTER activation_error
-- +xuan Statement
ALTER TABLE mgr_automation_robot ADD COLUMN activation_attempted_at DATETIME NULL AFTER activation_attempts
