-- 排行榜独立模块：把「按联盟/独立俱乐部开榜」的荣耀榜收进一个单独入口，
-- 每次创建活动在后台留档，形成可回看的历史活动列表。
--
-- 说明：
--   - 游戏服仍按 (scope, rank_type, dipi) 7 行存「当前生效配置」，结构不变；
--   - 本表只记录运营在后台创建的每一次活动（时间、榜开关、名次奖励、创建人），
--     供历史回看与排名查询；游戏服配置被后续活动覆盖后，旧活动标记为「已被取代」；
--   - 排名由后台按同一口径直读游戏库计算，不依赖游戏服当前配置。

-- +xuan Statement
CREATE TABLE IF NOT EXISTS mgr_honor_rank_activity (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  scope_type VARCHAR(10) NOT NULL,
  scope_id VARCHAR(50) NOT NULL,
  scope_name VARCHAR(100) NOT NULL DEFAULT '',
  title VARCHAR(120) NOT NULL DEFAULT '',
  state VARCHAR(16) NOT NULL DEFAULT 'on',
  activity_on TINYINT(1) NOT NULL DEFAULT 0,
  start_date VARCHAR(10) NOT NULL DEFAULT '',
  start_time VARCHAR(8) NOT NULL DEFAULT '',
  end_date VARCHAR(10) NOT NULL DEFAULT '',
  end_time VARCHAR(8) NOT NULL DEFAULT '',
  boards MEDIUMTEXT NOT NULL,
  note VARCHAR(120) NOT NULL DEFAULT '',
  created_by VARCHAR(64) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_scope (scope_type, scope_id, id),
  KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

-- +xuan Statement
INSERT IGNORE INTO mgr_module (parent_id, code, name, route, icon, sort_order, visible, status)
VALUES (20, 'game.honor_rank', '排行榜', '/game/honor-rank', 'rank', 24, 1, 'enabled')

-- +xuan Statement
INSERT INTO mgr_permission (module_id, code, name, action, description, status)
SELECT id, 'game.honor_rank.view', '查看排行榜活动', 'view', '查看历史排行榜活动及其实时排名', 'enabled'
FROM mgr_module WHERE code = 'game.honor_rank'
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action), description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (module_id, code, name, action, description, status)
SELECT id, 'game.honor_rank.manage', '创建排行榜活动', 'manage', '为联盟或独立俱乐部创建、结束排行榜活动', 'enabled'
FROM mgr_module WHERE code = 'game.honor_rank'
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action), description = VALUES(description), status = VALUES(status)

-- 查看权限跟随原「查看荣耀榜配置」，创建权限跟随原「配置荣耀榜」；
-- 若 067 尚未执行（库里没有那两个权限码），退回按俱乐部查看/暗抽权限授权。
-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT rp.role_id, target.id
FROM mgr_role_permission rp
JOIN mgr_permission source ON source.id = rp.permission_id
JOIN mgr_permission target ON target.code = 'game.honor_rank.view'
WHERE source.code IN ('game.club_honor_rank.view', 'game.club.view')

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT rp.role_id, target.id
FROM mgr_role_permission rp
JOIN mgr_permission source ON source.id = rp.permission_id
JOIN mgr_permission target ON target.code = 'game.honor_rank.manage'
WHERE source.code IN ('game.club_honor_rank.manage', 'game.club.dark_setting')

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code = 'game.honor_rank.view'

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code = 'game.honor_rank.manage'
