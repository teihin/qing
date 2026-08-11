CREATE TABLE IF NOT EXISTS chat_agent (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(32) NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  display_name VARCHAR(64) NOT NULL,
  role ENUM('supervisor','agent') NOT NULL DEFAULT 'agent',
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  presence ENUM('offline','online','away') NOT NULL DEFAULT 'offline',
  max_conversations INT NOT NULL DEFAULT 8,
  last_seen_at DATETIME NULL,
  last_assigned_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_chat_agent_username (username),
  KEY idx_chat_agent_presence (enabled, presence, last_seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- +chattool Statement
CREATE TABLE IF NOT EXISTS chat_agent_session (
  token_hash CHAR(64) NOT NULL,
  agent_id BIGINT UNSIGNED NOT NULL,
  csrf_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  last_seen_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (token_hash),
  KEY idx_chat_agent_session_agent (agent_id),
  KEY idx_chat_agent_session_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- +chattool Statement
CREATE TABLE IF NOT EXISTS chat_player (
  player_id VARCHAR(64) NOT NULL,
  nickname VARCHAR(64) NOT NULL,
  login_name VARCHAR(64) NOT NULL DEFAULT '',
  avatar_url VARCHAR(512) NOT NULL DEFAULT '',
  level_label VARCHAR(64) NOT NULL DEFAULT '',
  vip_label VARCHAR(64) NOT NULL DEFAULT '',
  platform VARCHAR(32) NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL,
  last_seen_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (player_id),
  KEY idx_chat_player_nickname (nickname)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- +chattool Statement
CREATE TABLE IF NOT EXISTS chat_conversation (
  id CHAR(32) NOT NULL,
  player_id VARCHAR(64) NOT NULL,
  assigned_agent_id BIGINT UNSIGNED NULL,
  status ENUM('queued','active','closed') NOT NULL DEFAULT 'queued',
  priority ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
  category VARCHAR(64) NOT NULL DEFAULT '游戏咨询',
  queue_started_at DATETIME NOT NULL,
  assigned_at DATETIME NULL,
  first_response_at DATETIME NULL,
  last_message_at DATETIME NOT NULL,
  player_last_read_at DATETIME NULL,
  agent_last_read_at DATETIME NULL,
  closed_at DATETIME NULL,
  close_reason VARCHAR(255) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_chat_conversation_player (player_id, status),
  KEY idx_chat_conversation_agent (assigned_agent_id, status, last_message_at),
  KEY idx_chat_conversation_queue (status, priority, queue_started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- +chattool Statement
CREATE TABLE IF NOT EXISTS chat_player_session (
  token_hash CHAR(64) NOT NULL,
  player_id VARCHAR(64) NOT NULL,
  conversation_id CHAR(32) NOT NULL,
  csrf_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  last_seen_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (token_hash),
  KEY idx_chat_player_session_player (player_id),
  KEY idx_chat_player_session_conversation (conversation_id),
  KEY idx_chat_player_session_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- +chattool Statement
CREATE TABLE IF NOT EXISTS chat_media (
  id CHAR(32) NOT NULL,
  conversation_id CHAR(32) NOT NULL,
  uploader_type ENUM('player','agent') NOT NULL,
  uploader_id VARCHAR(64) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  storage_key VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  size_bytes BIGINT UNSIGNED NOT NULL,
  sha256 CHAR(64) NOT NULL,
  media_kind ENUM('image','video','file') NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_chat_media_storage (storage_key),
  KEY idx_chat_media_conversation (conversation_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- +chattool Statement
CREATE TABLE IF NOT EXISTS chat_message (
  id CHAR(32) NOT NULL,
  conversation_id CHAR(32) NOT NULL,
  sender_type ENUM('player','agent','system','note') NOT NULL,
  sender_id VARCHAR(64) NOT NULL,
  sender_name VARCHAR(64) NOT NULL,
  message_type ENUM('text','image','video','file','system','note') NOT NULL,
  text_content TEXT NOT NULL,
  media_id CHAR(32) NULL,
  client_message_id VARCHAR(64) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  recalled_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_chat_message_client (conversation_id, sender_type, client_message_id),
  KEY idx_chat_message_conversation (conversation_id, created_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- +chattool Statement
CREATE TABLE IF NOT EXISTS chat_assignment_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id CHAR(32) NOT NULL,
  from_agent_id BIGINT UNSIGNED NULL,
  to_agent_id BIGINT UNSIGNED NULL,
  action ENUM('auto_assign','claim','transfer','requeue','close','reopen') NOT NULL,
  operator_type ENUM('system','agent') NOT NULL,
  operator_id BIGINT UNSIGNED NULL,
  reason VARCHAR(255) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_chat_assignment_conversation (conversation_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- +chattool Statement
CREATE TABLE IF NOT EXISTS chat_quick_reply (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(80) NOT NULL,
  content VARCHAR(1000) NOT NULL,
  category VARCHAR(64) NOT NULL DEFAULT '常用回复',
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_chat_quick_reply_active (enabled, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- +chattool Statement
CREATE TABLE IF NOT EXISTS chat_audit_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_type ENUM('agent','player','system','internal') NOT NULL,
  actor_id VARCHAR(64) NOT NULL,
  action VARCHAR(80) NOT NULL,
  target_type VARCHAR(40) NOT NULL,
  target_id VARCHAR(64) NOT NULL,
  detail_json TEXT NOT NULL,
  ip_address VARCHAR(64) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_chat_audit_actor (actor_type, actor_id, created_at),
  KEY idx_chat_audit_target (target_type, target_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- +chattool Statement
INSERT INTO chat_quick_reply(title, content, category, enabled, sort_order)
SELECT '欢迎语', '您好，我是在线客服，很高兴为您服务。请问有什么可以帮您？', '常用回复', 1, 10
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM chat_quick_reply LIMIT 1);
