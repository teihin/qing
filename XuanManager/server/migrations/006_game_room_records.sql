-- +xuan Statement
INSERT INTO mgr_module (id, parent_id, code, name, route, icon, sort_order, visible, status) VALUES
  (24, 20, 'game.room_records', '房间战绩', '/game/room-records', 'room-records', 40, 1, 'enabled')
ON DUPLICATE KEY UPDATE parent_id = VALUES(parent_id), name = VALUES(name), route = VALUES(route), icon = VALUES(icon), sort_order = VALUES(sort_order), visible = VALUES(visible), status = VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (id, module_id, code, name, action, description, status) VALUES
  (2401, 24, 'game.room_record.view', '查看房间战绩', 'view', '按房间号只读查询房间总战绩、逐局输赢、牌面及操作牌谱', 'enabled')
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action), description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code = 'game.room_record.view'
