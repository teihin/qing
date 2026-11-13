-- 后台按俱乐部控制的 BF 聊天（官方客服）入口开关。
-- 一个俱乐部关闭后，该俱乐部内所有层级的代理和玩家在消息列表里都看不到 BF 聊天。
-- 没有俱乐部记录时回落到旧版按创建者账号的 chat_direct_bf_entry，再没有则默认开启。
CREATE TABLE IF NOT EXISTS chat_direct_bf_club (
  club_id VARCHAR(64) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (club_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
