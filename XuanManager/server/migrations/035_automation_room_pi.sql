-- 机器人底皮限制：只进指定底皮档位的房间。
-- 存逗号分隔的底皮档位（如 底皮1/3,底皮2/5），空串表示不限；
-- 由 agent 透传 XUAN_ROOM_PI 给 client.js，按房间列表里的 game_pi 过滤。
-- +xuan Statement
ALTER TABLE mgr_automation_robot ADD COLUMN room_pi VARCHAR(64) NOT NULL DEFAULT '' AFTER buyin_multiple
