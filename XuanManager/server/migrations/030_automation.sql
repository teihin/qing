-- +xuan Statement
CREATE TABLE IF NOT EXISTS mgr_automation_club (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  club_id VARCHAR(6) NOT NULL,
  name VARCHAR(64) NOT NULL,
  mode TINYINT NOT NULL DEFAULT 1,
  member_count INT NOT NULL DEFAULT 0,
  union_name VARCHAR(64) NOT NULL DEFAULT '',
  robot_quota INT NOT NULL DEFAULT 20,
  seat_ratio INT NOT NULL DEFAULT 50,
  status VARCHAR(20) NOT NULL DEFAULT 'enabled',
  notes VARCHAR(255) NOT NULL DEFAULT '',
  is_demo TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_automation_club (club_id),
  KEY idx_automation_club_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

-- +xuan Statement
CREATE TABLE IF NOT EXISTS mgr_automation_room_snapshot (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  room_id BIGINT NOT NULL,
  club_id VARCHAR(6) NOT NULL,
  room_name VARCHAR(64) NOT NULL DEFAULT '',
  tier VARCHAR(16) NOT NULL DEFAULT '',
  base_score INT NOT NULL DEFAULT 0,
  duration_min INT NOT NULL DEFAULT 60,
  status VARCHAR(16) NOT NULL DEFAULT '准备',
  seated INT NOT NULL DEFAULT 0,
  max_seats INT NOT NULL DEFAULT 8,
  observers INT NOT NULL DEFAULT 0,
  remaining_min INT NOT NULL DEFAULT 60,
  captured_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_demo TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY uk_automation_room (room_id),
  KEY idx_automation_room_club (club_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

-- +xuan Statement
CREATE TABLE IF NOT EXISTS mgr_automation_strategy (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  code VARCHAR(64) NOT NULL,
  version INT NOT NULL DEFAULT 1,
  play_style VARCHAR(16) NOT NULL DEFAULT 'balanced',
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  config_json LONGTEXT NULL,
  previous_config_json LONGTEXT NULL,
  previous_version INT NOT NULL DEFAULT 0,
  updated_by VARCHAR(64) NOT NULL DEFAULT '',
  is_demo TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_automation_strategy_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

-- +xuan Statement
CREATE TABLE IF NOT EXISTS mgr_automation_group (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(64) NOT NULL,
  club_id VARCHAR(6) NOT NULL,
  strategy_id BIGINT UNSIGNED NULL,
  target_seated INT NOT NULL DEFAULT 0,
  max_robots INT NOT NULL DEFAULT 20,
  tier_pref VARCHAR(32) NOT NULL DEFAULT '',
  duration_pref VARCHAR(32) NOT NULL DEFAULT '',
  buyin_ratio INT NOT NULL DEFAULT 80,
  status VARCHAR(20) NOT NULL DEFAULT 'enabled',
  notes VARCHAR(255) NOT NULL DEFAULT '',
  is_demo TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_automation_group_club (club_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

-- +xuan Statement
CREATE TABLE IF NOT EXISTS mgr_automation_worker (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  node_code VARCHAR(32) NOT NULL,
  host VARCHAR(128) NOT NULL DEFAULT '',
  os VARCHAR(32) NOT NULL DEFAULT '',
  version VARCHAR(32) NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'offline',
  robot_count INT NOT NULL DEFAULT 0,
  max_robots INT NOT NULL DEFAULT 20,
  cpu_pct INT NOT NULL DEFAULT 0,
  mem_pct INT NOT NULL DEFAULT 0,
  egress_cidr VARCHAR(64) NOT NULL DEFAULT '',
  last_heartbeat DATETIME NULL,
  is_demo TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_automation_worker_code (node_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

-- +xuan Statement
CREATE TABLE IF NOT EXISTS mgr_automation_robot (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  terminal_no VARCHAR(32) NOT NULL,
  account VARCHAR(64) NOT NULL,
  nickname VARCHAR(64) NOT NULL DEFAULT '',
  club_id VARCHAR(6) NOT NULL,
  group_id BIGINT UNSIGNED NULL,
  strategy_id BIGINT UNSIGNED NULL,
  worker_id BIGINT UNSIGNED NULL,
  egress_ip VARCHAR(64) NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'created',
  desired_status VARCHAR(20) NOT NULL DEFAULT 'stopped',
  room_id BIGINT NULL,
  seat_no INT NOT NULL DEFAULT 0,
  buyin INT NOT NULL DEFAULT 0,
  balance BIGINT NOT NULL DEFAULT 0,
  today_rounds INT NOT NULL DEFAULT 0,
  today_net BIGINT NOT NULL DEFAULT 0,
  last_heartbeat DATETIME NULL,
  last_error VARCHAR(255) NOT NULL DEFAULT '',
  risk_flag TINYINT(1) NOT NULL DEFAULT 0,
  is_demo TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_automation_robot_terminal (terminal_no),
  UNIQUE KEY uk_automation_robot_account (account),
  KEY idx_automation_robot_club (club_id, status),
  KEY idx_automation_robot_group (group_id),
  KEY idx_automation_robot_room (room_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

-- +xuan Statement
CREATE TABLE IF NOT EXISTS mgr_automation_task (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  task_no VARCHAR(32) NOT NULL,
  type VARCHAR(32) NOT NULL,
  target_type VARCHAR(16) NOT NULL,
  target_id VARCHAR(64) NOT NULL,
  params_json LONGTEXT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'queued',
  priority INT NOT NULL DEFAULT 5,
  total INT NOT NULL DEFAULT 0,
  succeeded INT NOT NULL DEFAULT 0,
  failed INT NOT NULL DEFAULT 0,
  created_by VARCHAR(64) NOT NULL DEFAULT '',
  started_at DATETIME NULL,
  finished_at DATETIME NULL,
  is_demo TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_automation_task_no (task_no),
  KEY idx_automation_task_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

-- +xuan Statement
CREATE TABLE IF NOT EXISTS mgr_automation_session (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  robot_id BIGINT UNSIGNED NOT NULL,
  club_id VARCHAR(6) NOT NULL,
  room_id BIGINT NOT NULL,
  seat_no INT NOT NULL DEFAULT 0,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at DATETIME NULL,
  rounds INT NOT NULL DEFAULT 0,
  buyin INT NOT NULL DEFAULT 0,
  net_win BIGINT NOT NULL DEFAULT 0,
  end_reason VARCHAR(32) NOT NULL DEFAULT '',
  is_demo TINYINT(1) NOT NULL DEFAULT 0,
  KEY idx_automation_session_robot (robot_id, started_at),
  KEY idx_automation_session_club (club_id, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

-- +xuan Statement
CREATE TABLE IF NOT EXISTS mgr_automation_session_event (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT UNSIGNED NOT NULL,
  event_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  event_type VARCHAR(32) NOT NULL,
  detail VARCHAR(255) NOT NULL DEFAULT '',
  KEY idx_automation_session_event (session_id, event_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

-- +xuan Statement
CREATE TABLE IF NOT EXISTS mgr_automation_credential (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  account VARCHAR(64) NOT NULL,
  club_id VARCHAR(6) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'configured',
  secret_configured TINYINT(1) NOT NULL DEFAULT 1,
  last_login DATETIME NULL,
  fail_count INT NOT NULL DEFAULT 0,
  remark VARCHAR(255) NOT NULL DEFAULT '',
  is_demo TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_automation_credential_account (account)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

-- +xuan Statement
CREATE TABLE IF NOT EXISTS mgr_automation_ip_pool (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ip VARCHAR(64) NOT NULL,
  region VARCHAR(64) NOT NULL DEFAULT '',
  bound_count INT NOT NULL DEFAULT 0,
  max_count INT NOT NULL DEFAULT 8,
  health VARCHAR(20) NOT NULL DEFAULT 'healthy',
  banned_count INT NOT NULL DEFAULT 0,
  remark VARCHAR(255) NOT NULL DEFAULT '',
  is_demo TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_automation_ip (ip)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

-- +xuan Statement
CREATE TABLE IF NOT EXISTS mgr_automation_alert (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  level VARCHAR(8) NOT NULL DEFAULT 'P2',
  category VARCHAR(32) NOT NULL,
  target_type VARCHAR(32) NOT NULL DEFAULT '',
  target_id VARCHAR(64) NOT NULL DEFAULT '',
  title VARCHAR(128) NOT NULL,
  detail VARCHAR(512) NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  assignee VARCHAR(64) NOT NULL DEFAULT '',
  note VARCHAR(512) NOT NULL DEFAULT '',
  first_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME NULL,
  is_demo TINYINT(1) NOT NULL DEFAULT 0,
  KEY idx_automation_alert_status (status, level, last_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

-- +xuan Statement
CREATE TABLE IF NOT EXISTS mgr_automation_scope (
  user_id BIGINT UNSIGNED NOT NULL,
  club_id VARCHAR(6) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, club_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

-- +xuan Statement
CREATE TABLE IF NOT EXISTS mgr_automation_approval (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  action VARCHAR(64) NOT NULL,
  target_type VARCHAR(32) NOT NULL DEFAULT '',
  target_id VARCHAR(64) NOT NULL DEFAULT '',
  params_json LONGTEXT NULL,
  reason VARCHAR(255) NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  requester_id BIGINT UNSIGNED NULL,
  requester_name VARCHAR(64) NOT NULL DEFAULT '',
  approver_id BIGINT UNSIGNED NULL,
  approver_name VARCHAR(64) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at DATETIME NULL,
  is_demo TINYINT(1) NOT NULL DEFAULT 0,
  KEY idx_automation_approval_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

-- +xuan Statement
INSERT INTO mgr_module (id,parent_id,code,name,route,icon,sort_order,visible,status) VALUES
  (40,NULL,'automation','自动化','','automation',40,1,'enabled'),
  (41,40,'automation.overview','自动化总览','/automation/overview','automation-overview',10,1,'enabled'),
  (42,40,'automation.clubs','俱乐部接入','/automation/clubs','automation-clubs',20,1,'enabled'),
  (43,40,'automation.rooms','房间监控','/automation/rooms','automation-rooms',30,1,'enabled'),
  (44,40,'automation.robots','机器人终端','/automation/robots','automation-robots',40,1,'enabled'),
  (45,40,'automation.groups','自动化组','/automation/groups','automation-groups',50,1,'enabled'),
  (46,40,'automation.tasks','任务中心','/automation/tasks','automation-tasks',60,1,'enabled'),
  (47,40,'automation.strategies','策略中心','/automation/strategies','automation-strategies',70,1,'enabled'),
  (48,40,'automation.sessions','对局记录','/automation/sessions','automation-sessions',80,1,'enabled'),
  (49,40,'automation.workers','Worker 节点','/automation/workers','automation-workers',90,1,'enabled'),
  (50,40,'automation.credentials','凭据与设备','/automation/credentials','automation-credentials',100,1,'enabled'),
  (51,40,'automation.alerts','告警中心','/automation/alerts','automation-alerts',110,1,'enabled'),
  (52,40,'automation.audit','自动化审计','/automation/audit','automation-audit',120,1,'enabled')
ON DUPLICATE KEY UPDATE parent_id=VALUES(parent_id),name=VALUES(name),route=VALUES(route),icon=VALUES(icon),sort_order=VALUES(sort_order),visible=VALUES(visible),status=VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (id,module_id,code,name,action,description,status) VALUES
  (4001,41,'automation.overview.view','查看自动化总览','view','查看在线终端、容量、告警和待审批汇总','enabled'),
  (4101,42,'automation.club.view','查看俱乐部接入','view','查看已接入自动化的俱乐部和房间池','enabled'),
  (4102,42,'automation.club.update','编辑俱乐部接入','update','修改俱乐部机器人配额、占座比例和备注','enabled'),
  (4103,42,'automation.club.refresh','刷新俱乐部房间池','refresh','触发一次俱乐部房间池快照刷新','enabled'),
  (4104,42,'automation.club.scope','管理俱乐部数据范围','scope','配置后台用户可见的俱乐部范围','enabled'),
  (4201,43,'automation.room.view','查看自动化房间','view','查看俱乐部房间池、座位和机器人分布','enabled'),
  (4202,43,'automation.room.assign','指派房间机器人','assign','把机器人指派进房或从房间召回','enabled'),
  (4301,44,'automation.robot.view','查看机器人终端','view','查看机器人终端列表、详情和日志','enabled'),
  (4302,44,'automation.robot.create','新建机器人终端','create','新增机器人终端记录','enabled'),
  (4303,44,'automation.robot.update','编辑机器人终端','update','修改机器人终端绑定和参数','enabled'),
  (4304,44,'automation.robot.operate','启停机器人终端','operate','启动、暂停、排空、停止和重启终端','enabled'),
  (4305,44,'automation.robot.delete','删除机器人终端','delete','删除机器人终端并结束关联对局','enabled'),
  (4401,45,'automation.group.view','查看自动化组','view','查看自动化组及成员容量','enabled'),
  (4402,45,'automation.group.create','新建自动化组','create','创建自动化组','enabled'),
  (4403,45,'automation.group.update','编辑自动化组','update','修改组的目标在座、策略和房间偏好','enabled'),
  (4404,45,'automation.group.delete','删除自动化组','delete','删除没有终端的自动化组','enabled'),
  (4501,46,'automation.task.view','查看任务','view','查看自动化任务和审批单','enabled'),
  (4502,46,'automation.task.create','创建任务','create','创建进房、补位、排空等任务','enabled'),
  (4503,46,'automation.task.cancel','取消任务','cancel','取消排队中或执行中的任务','enabled'),
  (4601,47,'automation.strategy.view','查看策略','view','查看策略版本和参数','enabled'),
  (4602,47,'automation.strategy.create','新建策略','create','创建策略草稿','enabled'),
  (4603,47,'automation.strategy.update','编辑策略','update','编辑策略参数并生成新版本','enabled'),
  (4604,47,'automation.strategy.publish','发布策略','publish','灰度或全量发布策略并允许回滚','enabled'),
  (4701,48,'automation.session.view','查看对局记录','view','查看机器人会话和对局时间线','enabled'),
  (4801,49,'automation.worker.view','查看 Worker 节点','view','查看 Worker 承载、健康状态和版本','enabled'),
  (4802,49,'automation.worker.manage','管理 Worker 节点','manage','启用、排空和重启 Worker 节点','enabled'),
  (4901,50,'automation.credential.view','查看凭据与设备','view','查看账号凭据状态、代理和出口 IP','enabled'),
  (4902,50,'automation.credential.manage','管理凭据与设备','manage','导入凭据、重置密码和维护 IP 池','enabled'),
  (5001,51,'automation.alert.view','查看告警','view','查看自动化告警列表','enabled'),
  (5002,51,'automation.alert.handle','处理告警','handle','认领、解决或忽略自动化告警','enabled'),
  (5101,52,'automation.audit.view','查看自动化审计','view','查看自动化域的后台操作审计','enabled'),
  (5201,46,'automation.approval.view','查看审批单','view','查看高风险操作审批单','enabled'),
  (5202,46,'automation.approval.decide','审批高风险操作','decide','批准或驳回批量停止等高风险操作','enabled'),
  (5301,42,'automation.scope.manage','管理数据范围','scope_manage','配置用户可见的俱乐部范围','enabled'),
  (5302,42,'automation.scope.all','查看全部俱乐部','scope_all','不受俱乐部数据范围限制','enabled')
ON DUPLICATE KEY UPDATE module_id=VALUES(module_id),name=VALUES(name),action=VALUES(action),description=VALUES(description),status=VALUES(status)

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code LIKE 'automation.%'

-- +xuan Statement
INSERT INTO mgr_automation_club (id,club_id,name,mode,member_count,union_name,robot_quota,seat_ratio,status,notes,is_demo) VALUES
  (1,'448001','星辰俱乐部',1,286,'星河联盟',14,50,'enabled','主推俱乐部，晚高峰优先补位。',1),
  (2,'448002','云顶俱乐部',2,168,'星河联盟',10,40,'enabled','茶楼模式，注意真人占座比例。',1),
  (3,'448003','海岸俱乐部',3,92,'独立',8,35,'enabled','积分俱乐部，仅低峰驻场。',1)
ON DUPLICATE KEY UPDATE name=VALUES(name),mode=VALUES(mode),member_count=VALUES(member_count),union_name=VALUES(union_name),robot_quota=VALUES(robot_quota),seat_ratio=VALUES(seat_ratio),status=VALUES(status),notes=VALUES(notes)

-- +xuan Statement
INSERT INTO mgr_automation_room_snapshot (room_id,club_id,room_name,tier,base_score,duration_min,status,seated,max_seats,observers,remaining_min,captured_at,is_demo) VALUES
  (851724,'448001','1-851724','1',100,60,'游戏中',6,8,1,38,NOW() - INTERVAL 1 MINUTE,1),
  (851725,'448001','2-851725','2',200,60,'游戏中',5,8,0,41,NOW() - INTERVAL 1 MINUTE,1),
  (851726,'448001','3-851726','3',500,60,'准备',4,8,2,52,NOW() - INTERVAL 1 MINUTE,1),
  (851727,'448001','4-851727','4',1000,60,'准备',3,8,0,55,NOW() - INTERVAL 1 MINUTE,1),
  (851728,'448001','5-851728','5',2000,60,'准备',2,8,0,57,NOW() - INTERVAL 1 MINUTE,1),
  (851729,'448001','6-851729','6',5000,60,'参与过',1,8,0,8,NOW() - INTERVAL 1 MINUTE,1),
  (851730,'448001','7-851730','7',10000,60,'准备',0,8,0,60,NOW() - INTERVAL 1 MINUTE,1),
  (851731,'448002','1-851731','1',100,60,'游戏中',6,8,0,33,NOW() - INTERVAL 1 MINUTE,1),
  (851732,'448002','2-851732','2',200,60,'准备',4,8,1,48,NOW() - INTERVAL 1 MINUTE,1),
  (851733,'448002','3-851733','3',500,60,'准备',3,8,0,51,NOW() - INTERVAL 1 MINUTE,1),
  (851734,'448002','4-851734','4',1000,60,'准备',2,8,0,56,NOW() - INTERVAL 1 MINUTE,1),
  (851735,'448002','5-851735','5',2000,60,'准备',1,8,0,59,NOW() - INTERVAL 1 MINUTE,1),
  (851736,'448002','6-851736','6',5000,60,'参与过',0,8,0,12,NOW() - INTERVAL 1 MINUTE,1),
  (851737,'448002','7-851737','7',10000,60,'准备',0,8,0,60,NOW() - INTERVAL 1 MINUTE,1),
  (851738,'448003','1-851738','1',100,60,'游戏中',5,8,0,27,NOW() - INTERVAL 1 MINUTE,1),
  (851739,'448003','2-851739','2',200,60,'准备',3,8,0,46,NOW() - INTERVAL 1 MINUTE,1),
  (851740,'448003','3-851740','3',500,60,'准备',2,8,0,54,NOW() - INTERVAL 1 MINUTE,1),
  (851741,'448003','4-851741','4',1000,60,'准备',1,8,0,58,NOW() - INTERVAL 1 MINUTE,1),
  (851742,'448003','5-851742','5',2000,60,'参与过',0,8,0,5,NOW() - INTERVAL 1 MINUTE,1),
  (851743,'448003','6-851743','6',5000,60,'准备',0,8,0,60,NOW() - INTERVAL 1 MINUTE,1),
  (851744,'448003','7-851744','7',10000,60,'准备',0,8,0,60,NOW() - INTERVAL 1 MINUTE,1)
ON DUPLICATE KEY UPDATE club_id=VALUES(club_id),room_name=VALUES(room_name),tier=VALUES(tier),base_score=VALUES(base_score),duration_min=VALUES(duration_min),status=VALUES(status),seated=VALUES(seated),max_seats=VALUES(max_seats),observers=VALUES(observers),remaining_min=VALUES(remaining_min),captured_at=VALUES(captured_at)

-- +xuan Statement
INSERT INTO mgr_automation_strategy (id,name,code,version,play_style,status,config_json,updated_by,is_demo) VALUES
  (1,'星辰稳健版','star_stable',3,'balanced','enabled','{"followCap":3,"raiseRule":"仅强牌加注","cheEnabled":false,"maxLossPerRound":200,"maxDrawdown":1500,"lossStreakPause":3,"maxRoundsPerDay":180,"restSeconds":90,"tiers":["1","2","3"]}','策略管理员',1),
  (2,'星辰均衡版','star_balance',5,'balanced','gray','{"followCap":4,"raiseRule":"两对以上加注","cheEnabled":true,"maxLossPerRound":300,"maxDrawdown":2000,"lossStreakPause":4,"maxRoundsPerDay":220,"restSeconds":60,"tiers":["1","2","3","4"]}','策略管理员',1),
  (3,'低峰驻场版','offpeak_hold',2,'conservative','enabled','{"followCap":2,"raiseRule":"仅顶对加注","cheEnabled":false,"maxLossPerRound":120,"maxDrawdown":800,"lossStreakPause":3,"maxRoundsPerDay":120,"restSeconds":120,"tiers":["1","2"]}','策略管理员',1)
ON DUPLICATE KEY UPDATE name=VALUES(name),version=VALUES(version),play_style=VALUES(play_style),status=VALUES(status),config_json=VALUES(config_json),updated_by=VALUES(updated_by)

-- +xuan Statement
INSERT INTO mgr_automation_worker (id,node_code,host,os,version,status,robot_count,max_robots,cpu_pct,mem_pct,egress_cidr,last_heartbeat,is_demo) VALUES
  (1,'worker-01','10.20.0.11','linux','0.9.3','online',9,24,34,48,'203.0.113.0/28',NOW() - INTERVAL 8 SECOND,1),
  (2,'worker-02','10.20.0.12','linux','0.9.3','online',8,24,41,52,'198.51.100.0/28',NOW() - INTERVAL 11 SECOND,1),
  (3,'worker-03','10.20.0.13','windows','0.9.2','offline',4,20,0,0,'192.0.2.0/28',NOW() - INTERVAL 26 MINUTE,1)
ON DUPLICATE KEY UPDATE host=VALUES(host),os=VALUES(os),version=VALUES(version),status=VALUES(status),robot_count=VALUES(robot_count),max_robots=VALUES(max_robots),cpu_pct=VALUES(cpu_pct),mem_pct=VALUES(mem_pct),egress_cidr=VALUES(egress_cidr),last_heartbeat=VALUES(last_heartbeat)

-- +xuan Statement
INSERT INTO mgr_automation_group (id,name,club_id,strategy_id,target_seated,max_robots,tier_pref,duration_pref,buyin_ratio,status,notes,is_demo) VALUES
  (1,'星辰主推组','448001',1,8,12,'1,2,3','60','80','enabled','晚高峰优先补位，单房最多 2 台。',1),
  (2,'星辰备用组','448001',2,4,6,'2,3,4','60','60','enabled','主推组满员后接管。',1),
  (3,'云顶驻场组','448002',1,6,10,'1,2,3','60','70','enabled','茶楼模式，机器人占比不超过 40%。',1),
  (4,'海岸低峰组','448003',3,3,8,'1,2','60','50','enabled','22:00 后开始驻场。',1)
ON DUPLICATE KEY UPDATE name=VALUES(name),club_id=VALUES(club_id),strategy_id=VALUES(strategy_id),target_seated=VALUES(target_seated),max_robots=VALUES(max_robots),tier_pref=VALUES(tier_pref),duration_pref=VALUES(duration_pref),buyin_ratio=VALUES(buyin_ratio),status=VALUES(status),notes=VALUES(notes)

-- +xuan Statement
INSERT INTO mgr_automation_robot (id,terminal_no,account,nickname,club_id,group_id,strategy_id,worker_id,egress_ip,status,desired_status,room_id,seat_no,buyin,balance,today_rounds,today_net,last_heartbeat,last_error,risk_flag,is_demo) VALUES
  (1,'T1001','A1001','阿星',  '448001',1,1,1,'203.0.113.11','playing','running',851724,1,100,128000,42,3200,NOW() - INTERVAL 5 SECOND,'',0,1),
  (2,'T1002','A1002','小满',  '448001',1,1,1,'203.0.113.12','playing','running',851724,2,100,96400,38,-1200,NOW() - INTERVAL 9 SECOND,'',0,1),
  (3,'T1003','A1003','阿泽',  '448001',1,2,1,'203.0.113.11','playing','running',851725,3,100,152000,46,5100,NOW() - INTERVAL 7 SECOND,'',0,1),
  (4,'T1004','A1004','小北',  '448001',1,2,1,'203.0.113.12','playing','running',851725,4,100,88300,35,900,NOW() - INTERVAL 4 SECOND,'',0,1),
  (5,'T1005','A1005','青禾',  '448001',1,1,2,'203.0.113.13','seated','running',851726,2,100,110000,22,400,NOW() - INTERVAL 12 SECOND,'',0,1),
  (6,'T1006','A1006','小鹿',  '448001',1,1,2,'203.0.113.13','idle','running',NULL,0,0,76000,0,0,NOW() - INTERVAL 6 SECOND,'',0,1),
  (7,'T1007','A1007','阿岚',  '448001',1,3,2,'203.0.113.13','paused','paused',NULL,0,0,64000,16,-600,NOW() - INTERVAL 20 SECOND,'',0,1),
  (8,'T1008','A1008','小海',  '448001',2,2,2,'203.0.113.12','faulted','stopped',NULL,0,0,41000,0,0,NOW() - INTERVAL 3 MINUTE,'登录连续失败：0x306 同 IP 冲突',1,1),
  (9,'T1009','A1009','阿洛',  '448001',2,1,2,'203.0.113.11','stopped','stopped',NULL,0,0,52000,0,0,NOW() - INTERVAL 50 MINUTE,'',0,1),
  (10,'T2001','B2001','云舟',  '448002',3,1,1,'198.51.100.21','playing','running',851731,1,100,134000,44,4300,NOW() - INTERVAL 6 SECOND,'',0,1),
  (11,'T2002','B2002','听雨',  '448002',3,2,1,'198.51.100.21','playing','running',851731,2,100,101000,40,1500,NOW() - INTERVAL 8 SECOND,'',0,1),
  (12,'T2003','B2003','阿棠',  '448002',3,1,3,'198.51.100.22','seated','running',851732,5,100,72000,18,-300,NOW() - INTERVAL 15 SECOND,'',0,1),
  (13,'T2004','B2004','小满',  '448002',3,1,3,'198.51.100.22','seated','running',851733,4,100,68000,14,200,NOW() - INTERVAL 17 SECOND,'',0,1),
  (14,'T2005','B2005','阿青',  '448002',3,2,3,'198.51.100.22','idle','running',NULL,0,0,59000,0,0,NOW() - INTERVAL 10 SECOND,'',0,1),
  (15,'T2006','B2006','小洲',  '448002',3,2,3,'198.51.100.21','offline','running',NULL,0,0,47000,0,0,NOW() - INTERVAL 26 MINUTE,'Worker 心跳丢失',0,1),
  (16,'T2007','B2007','阿岩',  '448002',3,1,3,'198.51.100.22','paused','paused',851734,1,100,55000,9,-100,NOW() - INTERVAL 22 SECOND,'',0,1),
  (17,'T3001','C3001','海风',  '448003',4,1,2,'192.0.2.31','playing','running',851738,1,100,87000,20,1200,NOW() - INTERVAL 5 SECOND,'',0,1),
  (18,'T3002','C3002','阿潮',  '448003',4,1,2,'192.0.2.31','playing','running',851738,2,100,79000,19,-400,NOW() - INTERVAL 9 SECOND,'',0,1),
  (19,'T3003','C3003','小汐',  '448003',4,3,2,'192.0.2.32','seated','running',851739,3,100,61000,11,300,NOW() - INTERVAL 13 SECOND,'',0,1),
  (20,'T3004','C3004','阿屿',  '448003',4,3,2,'192.0.2.32','idle','running',NULL,0,0,48000,0,0,NOW() - INTERVAL 7 SECOND,'',0,1),
  (21,'T3005','C3005','小港',  '448003',4,1,2,'192.0.2.31','faulted','stopped',NULL,0,0,22000,0,0,NOW() - INTERVAL 5 MINUTE,'余额低于带入阈值',1,1)
ON DUPLICATE KEY UPDATE nickname=VALUES(nickname),club_id=VALUES(club_id),group_id=VALUES(group_id),strategy_id=VALUES(strategy_id),worker_id=VALUES(worker_id),egress_ip=VALUES(egress_ip),status=VALUES(status),desired_status=VALUES(desired_status),room_id=VALUES(room_id),seat_no=VALUES(seat_no),buyin=VALUES(buyin),balance=VALUES(balance),today_rounds=VALUES(today_rounds),today_net=VALUES(today_net),last_heartbeat=VALUES(last_heartbeat),last_error=VALUES(last_error),risk_flag=VALUES(risk_flag)

-- +xuan Statement
INSERT INTO mgr_automation_session (id,robot_id,club_id,room_id,seat_no,started_at,ended_at,rounds,buyin,net_win,end_reason,is_demo) VALUES
  (1,1,'448001',851724,1,NOW() - INTERVAL 42 MINUTE,NULL,18,100,1200,'',1),
  (2,2,'448001',851724,2,NOW() - INTERVAL 38 MINUTE,NULL,16,100,-800,'',1),
  (3,3,'448001',851725,3,NOW() - INTERVAL 35 MINUTE,NULL,15,100,2100,'',1),
  (4,4,'448001',851725,4,NOW() - INTERVAL 31 MINUTE,NULL,13,100,300,'',1),
  (5,5,'448001',851726,2,NOW() - INTERVAL 26 MINUTE,NULL,9,100,400,'',1),
  (6,10,'448002',851731,1,NOW() - INTERVAL 44 MINUTE,NULL,21,100,2600,'',1),
  (7,11,'448002',851731,2,NOW() - INTERVAL 40 MINUTE,NULL,19,100,900,'',1),
  (8,12,'448002',851732,5,NOW() - INTERVAL 28 MINUTE,NULL,11,100,-300,'',1),
  (9,13,'448002',851733,4,NOW() - INTERVAL 25 MINUTE,NULL,8,100,200,'',1),
  (10,17,'448003',851738,1,NOW() - INTERVAL 32 MINUTE,NULL,14,100,900,'',1),
  (11,18,'448003',851738,2,NOW() - INTERVAL 30 MINUTE,NULL,13,100,-500,'',1),
  (12,19,'448003',851739,3,NOW() - INTERVAL 22 MINUTE,NULL,7,100,300,'',1),
  (13,6,'448001',851724,5,NOW() - INTERVAL 3 HOUR,NOW() - INTERVAL 2 HOUR,32,100,-800,'drain',1),
  (14,9,'448001',851725,6,NOW() - INTERVAL 5 HOUR,NOW() - INTERVAL 4 HOUR,28,100,600,'stop',1),
  (15,14,'448002',851732,6,NOW() - INTERVAL 4 HOUR,NOW() - INTERVAL 3 HOUR,26,100,-400,'drain',1),
  (16,15,'448002',851733,7,NOW() - INTERVAL 6 HOUR,NOW() - INTERVAL 5 HOUR,24,100,1100,'disconnected',1),
  (17,20,'448003',851740,4,NOW() - INTERVAL 3 HOUR,NOW() - INTERVAL 2 HOUR,18,100,-200,'drain',1),
  (18,21,'448003',851741,5,NOW() - INTERVAL 8 HOUR,NOW() - INTERVAL 7 HOUR,15,100,-1500,'fault',1)
ON DUPLICATE KEY UPDATE rounds=VALUES(rounds),net_win=VALUES(net_win),end_reason=VALUES(end_reason)

-- +xuan Statement
INSERT INTO mgr_automation_session_event (session_id,event_at,event_type,detail) VALUES
  (1,NOW() - INTERVAL 42 MINUTE,'seated','已进入 851724 房，1 号座'),
  (1,NOW() - INTERVAL 41 MINUTE,'buyin','带入 100，余额校验通过'),
  (1,NOW() - INTERVAL 30 MINUTE,'round','第 10 局：跟注至 3 倍，赢 400'),
  (1,NOW() - INTERVAL 15 MINUTE,'round','第 15 局：弃牌，损失底注 20'),
  (1,NOW() - INTERVAL 5 MINUTE,'round','第 18 局：两对加注，赢 600'),
  (13,NOW() - INTERVAL 3 HOUR,'seated','已进入 851724 房，5 号座'),
  (13,NOW() - INTERVAL 2 HOUR,'drain','收到排空命令，本局结束后离座'),
  (13,NOW() - INTERVAL 2 HOUR,'left','已离房，结束原因 drain'),
  (18,NOW() - INTERVAL 8 HOUR,'seated','已进入 851741 房，5 号座'),
  (18,NOW() - INTERVAL 7 HOUR,'fault','余额不足，自动停止并转故障')

-- +xuan Statement
INSERT INTO mgr_automation_task (id,task_no,type,target_type,target_id,params_json,status,priority,total,succeeded,failed,created_by,started_at,finished_at,is_demo,created_at) VALUES
  (1,'TASK-20261027-001','fill_seat','group','1','{"tier":"1,2","maxPerRoom":2}','success',5,9,9,0,'值班运维',NOW() - INTERVAL 2 HOUR,NOW() - INTERVAL 118 MINUTE,1,NOW() - INTERVAL 2 HOUR),
  (2,'TASK-20261027-002','enter_room','group','3','{"tier":"1,2,3"}','queued',5,7,0,0,'值班运维',NULL,NULL,1,NOW() - INTERVAL 18 MINUTE),
  (3,'TASK-20261027-003','drain','group','2','{"reason":"低峰排空"}','cancelled',3,3,0,0,'自动化管理员',NOW() - INTERVAL 3 HOUR,NOW() - INTERVAL 175 MINUTE,1,NOW() - INTERVAL 3 HOUR),
  (4,'TASK-20261027-004','restart','robot','4','{}','failed',8,1,0,1,'值班运维',NOW() - INTERVAL 40 MINUTE,NOW() - INTERVAL 39 MINUTE,1,NOW() - INTERVAL 40 MINUTE),
  (5,'TASK-20261027-005','snapshot','club','448001','{}','success',2,1,1,0,'自动化管理员',NOW() - INTERVAL 20 MINUTE,NOW() - INTERVAL 19 MINUTE,1,NOW() - INTERVAL 20 MINUTE)
ON DUPLICATE KEY UPDATE status=VALUES(status),total=VALUES(total),succeeded=VALUES(succeeded),failed=VALUES(failed)

-- +xuan Statement
INSERT INTO mgr_automation_credential (id,account,club_id,status,secret_configured,last_login,fail_count,remark,is_demo) VALUES
  (1,'A1001','448001','configured',1,NOW() - INTERVAL 2 HOUR,0,'主推组账号',1),
  (2,'A1002','448001','configured',1,NOW() - INTERVAL 2 HOUR,0,'主推组账号',1),
  (3,'A1008','448001','locked',1,NOW() - INTERVAL 3 MINUTE,5,'0x306 连续失败，待换出口 IP',1),
  (4,'B2001','448002','configured',1,NOW() - INTERVAL 1 HOUR,0,'云顶驻场账号',1),
  (5,'B2006','448002','missing',0,NULL,2,'未配置密码，等待导入',1),
  (6,'C3005','448003','locked',1,NOW() - INTERVAL 5 MINUTE,3,'余额不足且登录失败',1)
ON DUPLICATE KEY UPDATE club_id=VALUES(club_id),status=VALUES(status),secret_configured=VALUES(secret_configured),last_login=VALUES(last_login),fail_count=VALUES(fail_count),remark=VALUES(remark)

-- +xuan Statement
INSERT INTO mgr_automation_ip_pool (id,ip,region,bound_count,max_count,health,banned_count,remark,is_demo) VALUES
  (1,'203.0.113.11','华东',4,8,'healthy',0,'星辰主用出口',1),
  (2,'203.0.113.12','华东',3,8,'healthy',0,'星辰备选出口',1),
  (3,'203.0.113.13','华东',6,8,'risk',1,'近期出现同 IP 冲突',1),
  (4,'198.51.100.21','华南',2,8,'healthy',0,'云顶出口 A',1),
  (5,'198.51.100.22','华南',8,8,'banned',3,'已暂停分配，等待更换',1)
ON DUPLICATE KEY UPDATE region=VALUES(region),bound_count=VALUES(bound_count),max_count=VALUES(max_count),health=VALUES(health),banned_count=VALUES(banned_count),remark=VALUES(remark)

-- +xuan Statement
INSERT INTO mgr_automation_alert (id,level,category,target_type,target_id,title,detail,status,assignee,note,first_seen,last_seen,resolved_at,is_demo) VALUES
  (1,'P0','worker_offline','worker','3','Worker-03 心跳丢失','节点 3 已 26 分钟无心跳，承载 4 个终端，其中 1 个已离线。','open','','',NOW() - INTERVAL 26 MINUTE,NOW() - INTERVAL 3 MINUTE,NULL,1),
  (2,'P1','ip_conflict','robot','8','终端 T1008 登录触发 0x306','同 IP 出口 203.0.113.12 已有 3 台终端在线，登录被拒绝。','open','','',NOW() - INTERVAL 3 MINUTE,NOW() - INTERVAL 3 MINUTE,NULL,1),
  (3,'P1','low_balance','robot','21','终端 T3005 余额低于带入阈值','余额 22,000，低于该组带入上限警戒线，已被熔断。','open','','',NOW() - INTERVAL 5 MINUTE,NOW() - INTERVAL 5 MINUTE,NULL,1),
  (4,'P2','room_expiring','room','851729','房间 851729 剩余时间不足 10 分钟','剩余 8 分钟，若有驻场任务请提前换房。','ack','值班运维','已通知补位组',NOW() - INTERVAL 12 MINUTE,NOW() - INTERVAL 2 MINUTE,NULL,1),
  (5,'P2','task_backlog','task','2','任务 TASK-20261027-002 排队超过 15 分钟','目标组 7 台终端，当前在线可执行 6 台。','open','','',NOW() - INTERVAL 18 MINUTE,NOW() - INTERVAL 4 MINUTE,NULL,1),
  (6,'P2','strategy_stop_loss','robot','1','终端 T1001 触发策略止损','当日回撤达到阈值后暂停 90 秒，现已恢复。','resolved','值班运维','策略自动恢复，无需处理',NOW() - INTERVAL 1 HOUR,NOW() - INTERVAL 55 MINUTE,NOW() - INTERVAL 54 MINUTE,1)
ON DUPLICATE KEY UPDATE level=VALUES(level),category=VALUES(category),title=VALUES(title),detail=VALUES(detail),status=VALUES(status),assignee=VALUES(assignee),note=VALUES(note)

-- +xuan Statement
INSERT INTO mgr_automation_approval (id,action,target_type,target_id,params_json,reason,status,requester_id,requester_name,approver_id,approver_name,created_at,decided_at,is_demo) VALUES
  (1,'robot.batch_stop','robot','1,3,5,6,7','{"ids":[1,3,5,6,7]}','凌晨低峰，排空星辰主推组在线终端','pending',NULL,'值班运维',NULL,'',NOW() - INTERVAL 35 MINUTE,NULL,1),
  (2,'strategy.publish','strategy','2','{"id":2,"scope":"all"}','星辰均衡版结束灰度，全量给主推组使用','pending',NULL,'策略管理员',NULL,'',NOW() - INTERVAL 20 MINUTE,NULL,1),
  (3,'robot.delete','robot','9','{"ids":[9]}','账号已停用，清理终端记录','approved',NULL,'自动化管理员',NULL,'超级管理员',NOW() - INTERVAL 2 HOUR,NOW() - INTERVAL 110 MINUTE,1)
ON DUPLICATE KEY UPDATE status=VALUES(status),reason=VALUES(reason)
