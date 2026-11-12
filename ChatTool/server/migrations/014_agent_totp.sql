-- 客服账号的谷歌验证（TOTP，RFC 6238）。
-- totp_secret 存 AES-256-GCM 密文（v1: 前缀），不落明文；totp_last_step 用于拒绝同一个动态码重复使用。
-- +chattool Statement
ALTER TABLE chat_agent
  ADD COLUMN totp_secret VARCHAR(255) NULL AFTER password_hash,
  ADD COLUMN totp_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER totp_secret,
  ADD COLUMN totp_confirmed_at DATETIME NULL AFTER totp_enabled,
  ADD COLUMN totp_last_step BIGINT NOT NULL DEFAULT 0 AFTER totp_confirmed_at

-- +chattool Statement
CREATE TABLE IF NOT EXISTS chat_agent_recovery_code (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  agent_id BIGINT UNSIGNED NOT NULL,
  code_hash CHAR(64) NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_chat_recovery_agent (agent_id, used_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

-- +chattool Statement
CREATE TABLE IF NOT EXISTS chat_agent_login_challenge (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  agent_id BIGINT UNSIGNED NOT NULL,
  attempts TINYINT NOT NULL DEFAULT 0,
  ip VARCHAR(64) NOT NULL DEFAULT '',
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_chat_challenge_expire (expires_at),
  KEY idx_chat_challenge_agent (agent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
