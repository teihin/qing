-- 客服侧托管会话已读游标（多个客服共享）。
-- 与直聊参与者自己的已读状态分开：客服查看不改变托管账号在游戏内的未读数。
CREATE TABLE IF NOT EXISTS chat_direct_hosting_read (
  conversation_id CHAR(32) NOT NULL,
  last_message_id CHAR(32) NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (conversation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
