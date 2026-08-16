-- +xuan Statement
DELETE role_permission
FROM mgr_role_permission role_permission
JOIN mgr_permission permission_row ON permission_row.id = role_permission.permission_id
WHERE permission_row.module_id = 26
  AND role_permission.role_id <> 1

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE module_id = 26

-- +xuan Statement
UPDATE mgr_permission
SET description = CASE code
  WHEN 'game.room_maintenance.view' THEN '超级管理员专属：查看KB大厅实时房间和全局创建房间状态'
  WHEN 'game.room_maintenance.dissolve' THEN '超级管理员专属：强制或友好解散指定当前房间'
  WHEN 'game.room_maintenance.dissolve_all' THEN '超级管理员专属：强制或友好解散全部当前房间'
  WHEN 'game.room_maintenance.creation_control' THEN '超级管理员专属：全局允许或禁止玩家、BOSS和系统自动创建新房间'
  ELSE description
END
WHERE module_id = 26
