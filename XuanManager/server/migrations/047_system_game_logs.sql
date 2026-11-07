-- 游戏接口日志：在后台里直接查看「后端 → 游戏服（8890 /hall/command）」的调用与回包。
-- 日志本身来自后端进程的 slog 输出（logs/xuanmanager.log），本迁移只登记菜单和权限，不建表。
-- +xuan Statement
INSERT INTO mgr_module (id, parent_id, code, name, route, icon, sort_order, visible, status) VALUES
  (57, 10, 'system.game_logs', '游戏接口日志', '/system/game-logs', 'logs', 50, 1, 'enabled')
ON DUPLICATE KEY UPDATE parent_id = VALUES(parent_id), name = VALUES(name), route = VALUES(route),
  icon = VALUES(icon), sort_order = VALUES(sort_order), visible = VALUES(visible), status = VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (id, module_id, code, name, action, description, status) VALUES
  (5801, 57, 'system.game_log.view', '查看游戏接口日志', 'view', '实时查看后台调用游戏服接口的下发命令、返回码和耗时', 'enabled')
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action),
  description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code = 'system.game_log.view'
