-- BF 聊天（官方客服）入口从游戏内开关改为后台按俱乐部控制。
-- 表与 ChatTool 共享同一个 webcm 库；ChatTool 迁移也会建同名表，这里兜底避免部署顺序依赖。
-- +xuan Statement
CREATE TABLE IF NOT EXISTS chat_direct_bf_club (
  club_id VARCHAR(64) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (club_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

-- +xuan Statement
INSERT INTO mgr_permission (module_id, code, name, action, description, status)
SELECT id, 'game.club.bf_chat', 'BF聊天开关', 'bf_chat', '按俱乐部开启或关闭消息列表置顶的 BF 聊天（官方客服）入口；默认开启', 'enabled'
FROM mgr_module WHERE code = 'game.clubs'
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action), description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT rp.role_id, target.id
FROM mgr_role_permission rp
JOIN mgr_permission source ON source.id = rp.permission_id
JOIN mgr_permission target ON target.code = 'game.club.bf_chat'
WHERE source.code = 'game.club.view'

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code = 'game.club.bf_chat'
