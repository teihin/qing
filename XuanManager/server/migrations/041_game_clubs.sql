-- 俱乐部管理：后台按俱乐部维度查看成员树，并给群主（俱乐部创建者）调整俱乐部额度。
-- 额度只走游戏服命令「增加_俱乐部_额度」（接口文档 §7：只给后台/Boss 用，客户端不设入口），
-- 后台本身不保存额度账本，避免与游戏服形成第二份真相。
-- +xuan Statement
INSERT INTO mgr_module (id,parent_id,code,name,route,icon,sort_order,visible,status) VALUES
  (54, 20, 'game.clubs', '俱乐部管理', '/game/clubs', 'clubs', 25, 1, 'enabled')
ON DUPLICATE KEY UPDATE parent_id = VALUES(parent_id), name = VALUES(name), route = VALUES(route), icon = VALUES(icon), sort_order = VALUES(sort_order), visible = VALUES(visible), status = VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (id, module_id, code, name, action, description, status) VALUES
  (5501, 54, 'game.club.view', '查看俱乐部', 'view', '列出所有俱乐部并查看成员代理树与积分', 'enabled'),
  (5502, 54, 'game.club.quota_adjust', '调整俱乐部额度', 'quota_adjust', '给俱乐部群主注资或纠错俱乐部额度，直接写游戏服', 'enabled')
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action), description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code IN ('game.club.view', 'game.club.quota_adjust')
