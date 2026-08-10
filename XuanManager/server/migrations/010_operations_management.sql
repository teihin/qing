-- +xuan Statement
INSERT INTO mgr_module (id, parent_id, code, name, route, icon, sort_order, visible, status) VALUES
  (26, 20, 'game.room_maintenance', '房间维护', '/game/room-maintenance', 'room-maintenance', 60, 1, 'enabled'),
  (34, 30, 'configuration.payments', '支付通道配置', '/configuration/payments', 'payments', 40, 1, 'enabled'),
  (35, 30, 'configuration.activities', '活动管理', '/configuration/activities', 'activities', 50, 1, 'enabled')
ON DUPLICATE KEY UPDATE parent_id = VALUES(parent_id), name = VALUES(name), route = VALUES(route), icon = VALUES(icon), sort_order = VALUES(sort_order), visible = VALUES(visible), status = VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (id, module_id, code, name, action, description, status) VALUES
  (2102, 21, 'game.player.balance_adjust', '玩家加减分', 'balance_adjust', '客服维护时为指定游戏玩家增加或扣减金币', 'enabled'),
  (2601, 26, 'game.room_maintenance.view', '查看当前房间', 'view', '查看账号状态中仍有玩家的当前房间', 'enabled'),
  (2602, 26, 'game.room_maintenance.dissolve', '解散指定房间', 'dissolve', '强制或友好解散指定当前房间', 'enabled'),
  (2603, 26, 'game.room_maintenance.dissolve_all', '解散全部房间', 'dissolve_all', '强制或友好解散全部当前房间，仅超级管理员可执行', 'enabled'),
  (3401, 34, 'configuration.payment.view', '查看支付配置', 'view', '查看客户端正在使用的支付通道和全局支付配置', 'enabled'),
  (3402, 34, 'configuration.payment.update', '修改支付配置', 'update', '修改支付通道启停、金额、资料、提示和支付域名', 'enabled'),
  (3501, 35, 'configuration.activity.view', '查看活动配置', 'view', '查看游戏活动总开关、活动时间、奖励和倍率', 'enabled'),
  (3502, 35, 'configuration.activity.update', '修改活动配置', 'update', '开启关闭并配置游戏活动', 'enabled')
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action), description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code IN (
  'game.player.balance_adjust',
  'game.room_maintenance.view',
  'game.room_maintenance.dissolve',
  'game.room_maintenance.dissolve_all',
  'configuration.payment.view',
  'configuration.payment.update',
  'configuration.activity.view',
  'configuration.activity.update'
)
