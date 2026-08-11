CREATE TABLE IF NOT EXISTS chat_player_memo (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  player_id VARCHAR(64) NOT NULL,
  content VARCHAR(500) NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_by_name VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_chat_player_memo_player (player_id, created_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
