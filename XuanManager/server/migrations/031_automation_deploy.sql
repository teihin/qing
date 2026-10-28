-- +xuan Statement
ALTER TABLE mgr_automation_club
  ADD COLUMN max_per_room INT NOT NULL DEFAULT 2 AFTER seat_ratio,
  ADD COLUMN invite_code VARCHAR(16) NOT NULL DEFAULT '' AFTER max_per_room

-- +xuan Statement
ALTER TABLE mgr_automation_group
  ADD COLUMN default_intelligence INT NOT NULL DEFAULT 50 AFTER buyin_ratio,
  ADD COLUMN profit_mode VARCHAR(16) NOT NULL DEFAULT 'daily' AFTER default_intelligence,
  ADD COLUMN profit_target BIGINT NOT NULL DEFAULT 0 AFTER profit_mode,
  ADD COLUMN period_start DATE NULL AFTER profit_target,
  ADD COLUMN period_end DATE NULL AFTER period_start

-- +xuan Statement
ALTER TABLE mgr_automation_robot
  ADD COLUMN intelligence INT NOT NULL DEFAULT 0 AFTER buyin,
  ADD COLUMN profit_mode VARCHAR(16) NOT NULL DEFAULT '' AFTER intelligence,
  ADD COLUMN profit_target BIGINT NOT NULL DEFAULT 0 AFTER profit_mode,
  ADD COLUMN period_start DATE NULL AFTER profit_target,
  ADD COLUMN period_end DATE NULL AFTER period_start,
  ADD COLUMN period_net BIGINT NOT NULL DEFAULT 0 AFTER period_end,
  ADD COLUMN enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER period_net,
  ADD COLUMN invite_code VARCHAR(16) NOT NULL DEFAULT '' AFTER enabled,
  ADD COLUMN join_status VARCHAR(20) NOT NULL DEFAULT 'joined' AFTER invite_code,
  ADD COLUMN joined_at DATETIME NULL AFTER join_status

-- +xuan Statement
UPDATE mgr_automation_club SET max_per_room = 2, invite_code = '880101' WHERE club_id = '448001'

-- +xuan Statement
UPDATE mgr_automation_club SET max_per_room = 2, invite_code = '880102' WHERE club_id = '448002'

-- +xuan Statement
UPDATE mgr_automation_club SET max_per_room = 1, invite_code = '880103' WHERE club_id = '448003'

-- +xuan Statement
UPDATE mgr_automation_group SET default_intelligence = 65, profit_mode = 'daily', profit_target = 5000 WHERE id = 1

-- +xuan Statement
UPDATE mgr_automation_group SET default_intelligence = 45, profit_mode = 'daily', profit_target = 2000 WHERE id = 2

-- +xuan Statement
UPDATE mgr_automation_group
SET default_intelligence = 55, profit_mode = 'period', profit_target = 12000,
period_start = '2026-10-01', period_end = '2026-10-31'
WHERE id = 3

-- +xuan Statement
UPDATE mgr_automation_group SET default_intelligence = 35, profit_mode = 'daily', profit_target = 800 WHERE id = 4

-- +xuan Statement
UPDATE mgr_automation_robot
SET invite_code = '880101', join_status = 'joined', joined_at = COALESCE(joined_at, created_at), period_net = today_net
WHERE club_id = '448001'

-- +xuan Statement
UPDATE mgr_automation_robot
SET invite_code = '880102', join_status = 'joined', joined_at = COALESCE(joined_at, created_at), period_net = today_net
WHERE club_id = '448002'

-- +xuan Statement
UPDATE mgr_automation_robot
SET invite_code = '880103', join_status = 'joined', joined_at = COALESCE(joined_at, created_at), period_net = today_net
WHERE club_id = '448003'

-- +xuan Statement
UPDATE mgr_automation_robot SET intelligence = 80, profit_mode = 'daily', profit_target = 1200 WHERE id IN (1, 3)

-- +xuan Statement
UPDATE mgr_automation_robot SET intelligence = 70 WHERE id IN (2, 5, 10, 12)

-- +xuan Statement
UPDATE mgr_automation_robot
SET profit_mode = 'period', profit_target = 3000, period_start = '2026-10-01', period_end = '2026-10-31'
WHERE id IN (4, 11)

-- +xuan Statement
UPDATE mgr_automation_robot SET enabled = 0, join_status = 'failed' WHERE id IN (8, 21)

-- +xuan Statement
UPDATE mgr_automation_robot SET enabled = 0 WHERE id IN (9, 15)

-- +xuan Statement
INSERT INTO mgr_module (id,parent_id,code,name,route,icon,sort_order,visible,status) VALUES
  (53,40,'automation.deploy','投放管理','/automation/deploy','automation-deploy',5,1,'enabled')
ON DUPLICATE KEY UPDATE parent_id=VALUES(parent_id),name=VALUES(name),route=VALUES(route),icon=VALUES(icon),sort_order=VALUES(sort_order),visible=VALUES(visible),status=VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (id,module_id,code,name,action,description,status) VALUES
  (5401,53,'automation.deploy.view','查看投放管理','view','查看俱乐部投放数量、每房上限和机器人分组','enabled'),
  (5402,53,'automation.deploy.manage','管理投放管理','manage','修改投放配置、分组默认值和机器人智力与输赢目标','enabled')
ON DUPLICATE KEY UPDATE module_id=VALUES(module_id),name=VALUES(name),action=VALUES(action),description=VALUES(description),status=VALUES(status)

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code IN ('automation.deploy.view','automation.deploy.manage')

-- +xuan Statement
UPDATE mgr_module SET visible = 0 WHERE id IN (41,42,43,45,46,47,50,52)

-- +xuan Statement
UPDATE mgr_module SET visible = 1, sort_order = 10 WHERE id = 44

-- +xuan Statement
UPDATE mgr_module SET visible = 1, sort_order = 20 WHERE id = 48

-- +xuan Statement
UPDATE mgr_module SET visible = 1, sort_order = 30 WHERE id = 49

-- +xuan Statement
UPDATE mgr_module SET visible = 1, sort_order = 40 WHERE id = 51
