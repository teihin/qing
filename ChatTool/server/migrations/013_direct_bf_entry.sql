-- 官方客服（BF）入口的创建者级显示开关。
-- 一个俱乐部创建者关闭后，其俱乐部内所有层级的代理和玩家在消息列表里都看不到 BF 聊天。
-- 没有记录视为开启，保持历史行为；创建者自己同样遵循这里的开关。
CREATE TABLE IF NOT EXISTS chat_direct_bf_entry (
  guuid VARCHAR(64) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (guuid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
