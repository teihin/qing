-- Worker 通道：节点租约、命令队列、事件流、接入令牌
CREATE TABLE IF NOT EXISTS mgr_automation_setting (
  setting_key VARCHAR(64) NOT NULL PRIMARY KEY,
  setting_value TEXT NULL,
  updated_by VARCHAR(64) NOT NULL DEFAULT '',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

-- +xuan Statement
ALTER TABLE mgr_automation_worker ADD COLUMN platform VARCHAR(32) NOT NULL DEFAULT '' AFTER os

-- +xuan Statement
ALTER TABLE mgr_automation_worker ADD COLUMN arch VARCHAR(32) NOT NULL DEFAULT '' AFTER platform

-- +xuan Statement
ALTER TABLE mgr_automation_worker ADD COLUMN labels VARCHAR(255) NOT NULL DEFAULT '' AFTER egress_cidr

-- +xuan Statement
ALTER TABLE mgr_automation_worker ADD COLUMN lease_token_hash CHAR(64) NOT NULL DEFAULT '' AFTER labels

-- +xuan Statement
ALTER TABLE mgr_automation_worker ADD COLUMN lease_expires_at DATETIME NULL AFTER lease_token_hash

-- +xuan Statement
ALTER TABLE mgr_automation_worker ADD COLUMN enrolled_at DATETIME NULL AFTER lease_expires_at

-- +xuan Statement
ALTER TABLE mgr_automation_worker ADD COLUMN last_event_seq BIGINT NOT NULL DEFAULT 0 AFTER enrolled_at

-- +xuan Statement
ALTER TABLE mgr_automation_worker ADD COLUMN last_event_at DATETIME NULL AFTER last_event_seq

-- +xuan Statement
ALTER TABLE mgr_automation_worker ADD COLUMN notes VARCHAR(255) NOT NULL DEFAULT '' AFTER last_event_at

-- +xuan Statement
ALTER TABLE mgr_automation_worker ADD KEY idx_automation_worker_status (status, last_heartbeat)

-- +xuan Statement
CREATE TABLE IF NOT EXISTS mgr_automation_worker_command (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  command_no VARCHAR(40) NOT NULL,
  worker_id BIGINT UNSIGNED NOT NULL,
  robot_id BIGINT UNSIGNED NULL,
  command_type VARCHAR(32) NOT NULL,
  params_json LONGTEXT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  idem_key VARCHAR(64) NULL,
  expires_at DATETIME NULL,
  delivered_at DATETIME NULL,
  ack_at DATETIME NULL,
  finished_at DATETIME NULL,
  result_json LONGTEXT NULL,
  error_code VARCHAR(64) NOT NULL DEFAULT '',
  error_message VARCHAR(255) NOT NULL DEFAULT '',
  attempts INT NOT NULL DEFAULT 0,
  created_by VARCHAR(64) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_worker_command_no (command_no),
  UNIQUE KEY uk_worker_command_idem (idem_key),
  KEY idx_worker_command_pull (worker_id, status, id),
  KEY idx_worker_command_robot (robot_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

-- +xuan Statement
CREATE TABLE IF NOT EXISTS mgr_automation_worker_event (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  worker_id BIGINT UNSIGNED NOT NULL,
  event_id VARCHAR(64) NOT NULL,
  robot_id BIGINT UNSIGNED NULL,
  terminal_no VARCHAR(32) NOT NULL DEFAULT '',
  event_type VARCHAR(32) NOT NULL,
  sequence BIGINT NOT NULL DEFAULT 0,
  room_id BIGINT NULL,
  round_id VARCHAR(64) NOT NULL DEFAULT '',
  strategy_version INT NOT NULL DEFAULT 0,
  command_no VARCHAR(40) NOT NULL DEFAULT '',
  payload_json LONGTEXT NULL,
  occurred_at DATETIME(3) NULL,
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_worker_event (worker_id, event_id),
  KEY idx_worker_event_worker (worker_id, id),
  KEY idx_worker_event_robot (robot_id, id),
  KEY idx_worker_event_type (event_type, received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
