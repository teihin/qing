-- 机器人即游戏账号：机器人管理统一创建、编辑、停用和删除，投放单独在投放管理操作
ALTER TABLE mgr_automation_group MODIFY COLUMN club_id VARCHAR(6) NOT NULL DEFAULT ''

-- +xuan Statement
ALTER TABLE mgr_automation_robot ADD COLUMN avatar TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER nickname

-- +xuan Statement
ALTER TABLE mgr_automation_robot ADD COLUMN buyin_multiple INT NOT NULL DEFAULT 1 AFTER buyin

-- +xuan Statement
UPDATE mgr_automation_group SET club_id = '' WHERE is_demo = 1

-- +xuan Statement
UPDATE mgr_automation_robot SET avatar = 1 + MOD(id * 37, 100) WHERE is_demo = 1

-- +xuan Statement
INSERT INTO mgr_automation_robot
(id, terminal_no, account, nickname, avatar, club_id, group_id, strategy_id, worker_id, egress_ip,
status, desired_status, room_id, seat_no, buyin, balance, today_rounds, today_net,
last_heartbeat, last_error, risk_flag, is_demo,
intelligence, profit_mode, profit_target, period_start, period_end, period_net,
enabled, invite_code, join_status, joined_at)
VALUES
  (31, 'TPOOL01', 'pool_robot01', '备机一', 12, '', 1, 1, NULL, '', 'idle', 'stopped', NULL, 0, 200, 20000, 0, 0, NULL, '', 0, 1, 0, '', 0, NULL, NULL, 0, 1, '', 'unassigned', NULL),
  (32, 'TPOOL02', 'pool_robot02', '备机二', 33, '', 1, 1, NULL, '', 'idle', 'stopped', NULL, 0, 200, 20000, 0, 0, NULL, '', 0, 1, 0, '', 0, NULL, NULL, 0, 1, '', 'unassigned', NULL),
  (33, 'TPOOL03', 'pool_robot03', '备机三', 64, '', 2, 1, NULL, '', 'idle', 'stopped', NULL, 0, 200, 20000, 0, 0, NULL, '', 0, 1, 0, '', 0, NULL, NULL, 0, 1, '', 'unassigned', NULL)
ON DUPLICATE KEY UPDATE account=VALUES(account), nickname=VALUES(nickname), avatar=VALUES(avatar), club_id=VALUES(club_id), group_id=VALUES(group_id),
status=VALUES(status), desired_status=VALUES(desired_status), enabled=VALUES(enabled), invite_code=VALUES(invite_code),
join_status=VALUES(join_status), joined_at=VALUES(joined_at), is_demo=VALUES(is_demo)

-- +xuan Statement
UPDATE mgr_module SET name = '机器人管理', visible = 1, sort_order = 10 WHERE id = 44
