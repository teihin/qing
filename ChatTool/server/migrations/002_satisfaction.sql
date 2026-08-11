CREATE TABLE IF NOT EXISTS chat_satisfaction (
  conversation_id CHAR(32) NOT NULL,
  player_id VARCHAR(64) NOT NULL,
  score TINYINT UNSIGNED NOT NULL,
  tags VARCHAR(255) NOT NULL DEFAULT '',
  comment VARCHAR(500) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (conversation_id),
  KEY idx_chat_satisfaction_player (player_id, created_at),
  KEY idx_chat_satisfaction_score (score, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
