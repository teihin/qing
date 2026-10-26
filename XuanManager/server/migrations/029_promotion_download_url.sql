-- +xuan Statement
INSERT INTO mgr_module (id,parent_id,code,name,route,icon,sort_order,visible,status) VALUES
(39,30,'configuration.promotion_download','游戏推广下载地址','/configuration/promotion-download','downloads',60,1,'enabled')
ON DUPLICATE KEY UPDATE parent_id=VALUES(parent_id),name=VALUES(name),route=VALUES(route),icon=VALUES(icon),sort_order=VALUES(sort_order),visible=VALUES(visible),status=VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (id,module_id,code,name,action,description,status) VALUES
(3901,39,'configuration.promotion_download.view','查看推广下载地址','view','查看游戏内「游戏推广」页展示的下载地址（哈希键：下载url）','enabled'),
(3902,39,'configuration.promotion_download.update','修改推广下载地址','update','修改哈希配置「下载url」，玩家重新登录进大厅后生效','enabled')
ON DUPLICATE KEY UPDATE module_id=VALUES(module_id),name=VALUES(name),action=VALUES(action),description=VALUES(description),status=VALUES(status)

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id,permission_id)
SELECT 1,id FROM mgr_permission WHERE code IN ('configuration.promotion_download.view','configuration.promotion_download.update')
