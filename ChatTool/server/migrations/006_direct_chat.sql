-- 俱乐部 1 对 1 私聊（direct chat）。
-- 与客服模块完全分离：不改动 chat_conversation / chat_message 等客服表，
-- 客服 SQL 仍只处理客服业务。直聊只使用下面的 chat_direct_* 表。
--
-- 说明：消息与会话的时间列使用 DATETIME(3)（毫秒精度）。游标分页依赖
-- (created_at, id) 的稳定顺序，秒级精度会让同秒消息的翻页出现重复/漏项。
-- 字段语义与设计文档一致，仅为排序精度做的类型细化。

CREATE TABLE IF NOT EXISTS chat_direct_club (
  club_id VARCHAR(32) NOT NULL,
  club_name VARCHAR(128) NOT NULL,
  owner_guuid VARCHAR(64) NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (club_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- +chattool Statement
CREATE TABLE IF NOT EXISTS chat_direct_club_member (
  club_id VARCHAR(32) NOT NULL,
  guuid VARCHAR(64) NOT NULL,
  name VARCHAR(64) NOT NULL,
  avatar VARCHAR(255) NOT NULL DEFAULT '',
  role ENUM('owner','leader','agent','manager','member') NOT NULL DEFAULT 'member',
  superior_agent_guuid VARCHAR(64) NULL,
  superior_leader_guuid VARCHAR(64) NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (club_id, guuid),
  KEY idx_direct_member_guuid (guuid, club_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- +chattool Statement
CREATE TABLE IF NOT EXISTS chat_direct_session (
  token_hash CHAR(64) NOT NULL,
  guuid VARCHAR(64) NOT NULL,
  name VARCHAR(64) NOT NULL,
  avatar VARCHAR(255) NOT NULL DEFAULT '',
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL,
  last_seen_at DATETIME NOT NULL,
  PRIMARY KEY (token_hash),
  KEY idx_direct_session_guuid (guuid),
  KEY idx_direct_session_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- +chattool Statement
CREATE TABLE IF NOT EXISTS chat_direct_conversation (
  id CHAR(32) NOT NULL,
  club_id VARCHAR(32) NOT NULL,
  pair_key VARCHAR(160) NOT NULL,
  low_guuid VARCHAR(64) NOT NULL,
  high_guuid VARCHAR(64) NOT NULL,
  status ENUM('active','archived') NOT NULL DEFAULT 'active',
  last_message_id CHAR(32) NULL,
  last_message_at DATETIME(3) NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_direct_club_pair (club_id, pair_key),
  KEY idx_direct_club_last (club_id, last_message_at, id),
  KEY idx_direct_low (low_guuid, club_id, last_message_at),
  KEY idx_direct_high (high_guuid, club_id, last_message_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- +chattool Statement
CREATE TABLE IF NOT EXISTS chat_direct_participant (
  conversation_id CHAR(32) NOT NULL,
  guuid VARCHAR(64) NOT NULL,
  first_joined_at DATETIME NOT NULL,
  last_read_message_id CHAR(32) NULL,
  hidden_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (conversation_id, guuid),
  KEY idx_direct_participant_guuid (guuid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- +chattool Statement
CREATE TABLE IF NOT EXISTS chat_direct_message (
  id CHAR(32) NOT NULL,
  conversation_id CHAR(32) NOT NULL,
  sender_guuid VARCHAR(64) NOT NULL,
  sender_name_snapshot VARCHAR(64) NOT NULL,
  sender_role_snapshot VARCHAR(32) NOT NULL,
  message_type ENUM('text','image','voice','system') NOT NULL DEFAULT 'text',
  text_content TEXT NULL,
  attachment_id CHAR(32) NULL,
  client_message_id VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_direct_client_message (conversation_id, sender_guuid, client_message_id),
  KEY idx_direct_message_page (conversation_id, created_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- +chattool Statement
CREATE TABLE IF NOT EXISTS chat_direct_attachment (
  id CHAR(32) NOT NULL,
  conversation_id CHAR(32) NOT NULL,
  message_id CHAR(32) NULL,
  media_type ENUM('image','voice') NOT NULL,
  provider ENUM('chat_storage','audio_server') NOT NULL,
  external_media_id VARCHAR(128) NULL,
  storage_key VARCHAR(512) NULL,
  thumbnail_key VARCHAR(512) NULL,
  mime_type VARCHAR(128) NOT NULL,
  byte_size INT NOT NULL,
  duration_ms INT NULL,
  width INT NULL,
  height INT NULL,
  status ENUM('uploaded','bound','deleted') NOT NULL DEFAULT 'uploaded',
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_direct_attachment_message (message_id),
  UNIQUE KEY uk_direct_attachment_external (provider, external_media_id),
  KEY idx_direct_attachment_conversation (conversation_id, created_at, id),
  KEY idx_direct_attachment_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
