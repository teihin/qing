-- 托管置顶从「只能置顶会话」扩展到三级：分组（联盟/俱乐部）、托管账号（盟主/群主）、会话。
-- 用统一的 (target_type, target_id) 主键存一份表；旧的 chat_direct_hosted_pin 保留作历史，
-- 已有的会话置顶在下面一次性搬过来。

CREATE TABLE IF NOT EXISTS chat_direct_hosted_pin_target (
  target_type VARCHAR(16) NOT NULL,
  target_id VARCHAR(64) NOT NULL,
  pinned_by BIGINT UNSIGNED NULL,
  pinned_by_name VARCHAR(64) NOT NULL DEFAULT '',
  pinned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (target_type, target_id),
  KEY idx_direct_hosted_pin_target_time (pinned_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- +chattool Statement
INSERT IGNORE INTO chat_direct_hosted_pin_target (target_type, target_id, pinned_by, pinned_by_name, pinned_at)
SELECT 'conversation', conversation_id, pinned_by, pinned_by_name, pinned_at FROM chat_direct_hosted_pin;
