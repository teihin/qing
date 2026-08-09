-- +xuan Statement
INSERT INTO mgr_role (id, code, name, description, status, is_system)
VALUES (1, 'super_admin', '超级管理员', '系统最高权限角色，权限不可被普通管理操作移除', 'enabled', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), status = 'enabled', is_system = 1

-- +xuan Statement
INSERT INTO mgr_module (id, parent_id, code, name, route, icon, sort_order, visible, status) VALUES
  (1, NULL, 'dashboard', '工作台', '/dashboard', 'dashboard', 10, 1, 'enabled'),
  (10, NULL, 'system', '系统管理', '', 'system', 90, 1, 'enabled'),
  (11, 10, 'system.users', '用户管理', '/users', 'users', 10, 1, 'enabled'),
  (12, 10, 'system.roles', '角色与权限', '/roles', 'roles', 20, 1, 'enabled'),
  (13, 10, 'system.modules', '模块管理', '/modules', 'modules', 30, 1, 'enabled'),
  (14, 10, 'system.audit', '操作审计', '/audit', 'audit', 40, 1, 'enabled')
ON DUPLICATE KEY UPDATE name = VALUES(name), route = VALUES(route), icon = VALUES(icon), sort_order = VALUES(sort_order), visible = VALUES(visible), status = VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (id, module_id, code, name, action, description, status) VALUES
  (1, 1, 'dashboard.view', '查看工作台', 'view', '查看后台总览数据', 'enabled'),
  (1101, 11, 'user.view', '查看用户', 'view', '查看后台管理系统用户', 'enabled'),
  (1102, 11, 'user.create', '创建用户', 'create', '创建后台管理系统用户', 'enabled'),
  (1103, 11, 'user.update', '编辑用户', 'update', '编辑后台用户资料和角色', 'enabled'),
  (1104, 11, 'user.status', '启停用户', 'status', '启用或停用后台用户', 'enabled'),
  (1105, 11, 'user.reset_password', '重置密码', 'reset_password', '重置其他后台用户密码', 'enabled'),
  (1201, 12, 'role.view', '查看角色', 'view', '查看角色和权限矩阵', 'enabled'),
  (1202, 12, 'role.create', '创建角色', 'create', '创建后台角色', 'enabled'),
  (1203, 12, 'role.update', '编辑角色', 'update', '编辑角色资料和状态', 'enabled'),
  (1204, 12, 'role.assign_permissions', '分配权限', 'assign', '配置角色拥有的权限', 'enabled'),
  (1301, 13, 'module.view', '查看模块', 'view', '查看模块和操作权限', 'enabled'),
  (1302, 13, 'module.create', '创建模块', 'create', '创建后台功能模块', 'enabled'),
  (1303, 13, 'module.update', '编辑模块', 'update', '编辑模块资料和状态', 'enabled'),
  (1304, 13, 'permission.create', '创建操作权限', 'create_permission', '为模块创建操作权限', 'enabled'),
  (1305, 13, 'permission.update', '编辑操作权限', 'update_permission', '编辑操作权限资料和状态', 'enabled'),
  (1401, 14, 'audit.view', '查看审计', 'view', '查看后台管理操作记录', 'enabled')
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action), description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission
