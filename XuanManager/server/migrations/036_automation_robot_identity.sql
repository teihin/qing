-- 机器人身份信息：GPS 与服务器观察到的公网 IP。
-- gps 与真机一致存「纬度,经度」，由节点透传 XUAN_GPS，客户端登录后用 reqSetProperty 上报并每分钟续报；
-- public_ip 是节点通道观察到的出口 IP（心跳写入），用来核对代理/出口是否按预期生效。
-- +xuan Statement
ALTER TABLE mgr_automation_robot ADD COLUMN gps VARCHAR(32) NOT NULL DEFAULT '' AFTER room_pi
-- +xuan Statement
ALTER TABLE mgr_automation_robot ADD COLUMN public_ip VARCHAR(64) NOT NULL DEFAULT '' AFTER gps
-- +xuan Statement
ALTER TABLE mgr_automation_robot ADD COLUMN ip_seen_at DATETIME NULL AFTER public_ip
