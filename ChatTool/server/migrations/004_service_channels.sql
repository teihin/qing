CREATE TABLE IF NOT EXISTS chat_channel (
  code VARCHAR(32) NOT NULL,
  display_name VARCHAR(64) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (code),
  UNIQUE KEY uk_chat_channel_name (display_name),
  KEY idx_chat_channel_enabled (enabled, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- +chattool Statement
INSERT INTO chat_channel(code,display_name,enabled,sort_order,created_at,updated_at)
VALUES
  ('general','普通聊天客服',1,10,NOW(),NOW()),
  ('vip_recharge','VIP充值客服',1,20,NOW(),NOW())
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),enabled=1,sort_order=VALUES(sort_order),updated_at=NOW();

-- +chattool Statement
ALTER TABLE chat_agent
  ADD COLUMN channel_code VARCHAR(32) NOT NULL DEFAULT 'general' AFTER role,
  ADD KEY idx_chat_agent_channel_presence (channel_code,enabled,presence,last_seen_at);

-- +chattool Statement
ALTER TABLE chat_conversation
  ADD COLUMN channel_code VARCHAR(32) NOT NULL DEFAULT 'general' AFTER player_id,
  ADD KEY idx_chat_conversation_channel_queue (channel_code,status,priority,queue_started_at),
  ADD KEY idx_chat_conversation_channel_agent (channel_code,assigned_agent_id,status,last_message_at);

-- +chattool Statement
UPDATE chat_conversation SET channel_code='general',category='普通聊天客服' WHERE channel_code='general';
