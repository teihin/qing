-- 俱乐部 1 对 1 私聊托管（聊天托管）。
-- 大群主/盟主在游戏内开启后，客服工作台可以查看其私聊并以其身份回复。
-- 一行代表一个处于开启状态的托管账号；关闭时删除该行。
CREATE TABLE IF NOT EXISTS chat_direct_hosting (
  guuid VARCHAR(64) NOT NULL,
  group_type ENUM('union','club') NOT NULL,
  group_id VARCHAR(64) NOT NULL,
  group_name VARCHAR(128) NOT NULL,
  club_id VARCHAR(32) NOT NULL,
  role VARCHAR(16) NOT NULL,
  enabled_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (guuid),
  KEY idx_direct_hosting_group (group_type, group_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
