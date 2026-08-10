CREATE TABLE IF NOT EXISTS mgr_game_online_hourly (
  stat_date DATE NOT NULL,
  stat_hour TINYINT UNSIGNED NOT NULL,
  peak_online INT UNSIGNED NOT NULL DEFAULT 0,
  latest_online INT UNSIGNED NOT NULL DEFAULT 0,
  sample_count INT UNSIGNED NOT NULL DEFAULT 0,
  first_sample_at DATETIME NOT NULL,
  last_sample_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (stat_date, stat_hour),
  KEY idx_mgr_game_online_hourly_last_sample (last_sample_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
