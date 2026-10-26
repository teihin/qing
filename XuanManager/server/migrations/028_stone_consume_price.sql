-- +xuan Statement
INSERT INTO mgr_module (id,parent_id,code,name,route,icon,sort_order,visible,status) VALUES
(38,30,'configuration.stone_consume','钻石消费价格','/configuration/stone-consume','payments',55,1,'enabled')
ON DUPLICATE KEY UPDATE parent_id=VALUES(parent_id),name=VALUES(name),route=VALUES(route),icon=VALUES(icon),sort_order=VALUES(sort_order),visible=VALUES(visible),status=VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (id,module_id,code,name,action,description,status) VALUES
(3801,38,'configuration.stone_consume.view','查看钻石消费价格','view','查看各消费功能当前扣除的钻石数量','enabled'),
(3802,38,'configuration.stone_consume.update','修改钻石消费价格','update','修改各消费功能扣除的钻石数量，保存后客户端重新进大厅生效','enabled')
ON DUPLICATE KEY UPDATE module_id=VALUES(module_id),name=VALUES(name),action=VALUES(action),description=VALUES(description),status=VALUES(status)

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id,permission_id)
SELECT 1,id FROM mgr_permission WHERE code IN ('configuration.stone_consume.view','configuration.stone_consume.update')
