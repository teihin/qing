-- +xuan Statement
INSERT INTO mgr_module (id, parent_id, code, name, route, icon, sort_order, visible, status) VALUES
  (29, 20, 'game.transaction_blacklist', '交易黑名单', '/game/transaction-blacklist', 'transaction-blacklist', 35, 1, 'enabled')
ON DUPLICATE KEY UPDATE parent_id = VALUES(parent_id), name = VALUES(name), route = VALUES(route), icon = VALUES(icon), sort_order = VALUES(sort_order), visible = VALUES(visible), status = VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (id, module_id, code, name, action, description, status) VALUES
  (2901, 29, 'game.transaction_blacklist.view', '查看交易黑名单', 'view', '查看禁止赠送金币的游戏玩家和黑名单总开关', 'enabled'),
  (2902, 29, 'game.transaction_blacklist.create', '新增交易黑名单', 'create', '将指定游戏玩家加入禁止赠送金币名单', 'enabled'),
  (2903, 29, 'game.transaction_blacklist.update', '修改交易黑名单', 'update', '替换黑名单玩家或修改黑名单总开关', 'enabled'),
  (2904, 29, 'game.transaction_blacklist.delete', '删除交易黑名单', 'delete', '从禁止赠送金币名单中移除指定玩家', 'enabled')
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action), description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code IN (
  'game.transaction_blacklist.view',
  'game.transaction_blacklist.create',
  'game.transaction_blacklist.update',
  'game.transaction_blacklist.delete'
)
