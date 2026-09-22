-- +xuan Statement
INSERT INTO mgr_module (id,parent_id,code,name,route,icon,sort_order,visible,status) VALUES
(37,20,'game.jackpot','奖池业绩','/game/jackpot','agents',39,1,'enabled')
ON DUPLICATE KEY UPDATE name=VALUES(name),route=VALUES(route)

-- +xuan Statement
INSERT INTO mgr_permission (id,module_id,code,name,action,description,status) VALUES
(3701,37,'game.jackpot.view','查询奖池业绩','view','查询业绩开通名单及每日奖池业绩结算报表','enabled'),
(3702,37,'game.jackpot.configure','配置业绩权限','configure','开通或关闭玩家业绩比例入口，建议仅分配给财务负责人','enabled')
ON DUPLICATE KEY UPDATE name=VALUES(name),description=VALUES(description)

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id,permission_id)
SELECT 1,id FROM mgr_permission WHERE code IN ('game.jackpot.view','game.jackpot.configure')
