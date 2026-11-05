-- 聊天托管取消后保留记录：只置 enabled=0，不再删除；客服工作台可只读查看并手动删除。
ALTER TABLE chat_direct_hosting
  ADD COLUMN enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER role,
  ADD COLUMN disabled_at DATETIME NULL AFTER enabled_at;

-- +chattool Statement

-- 客服托管上下分账本。每笔成功操作一条，request_id 幂等防重复提交。
-- 赠送/被赠送暂未接入，operation_type 先只包含 up/down。
CREATE TABLE IF NOT EXISTS chat_hosting_gold_ledger (
  id CHAR(32) NOT NULL,
  request_id VARCHAR(64) NOT NULL,
  status ENUM('pending','success','failed') NOT NULL DEFAULT 'pending',
  operation_type ENUM('up','down') NOT NULL,
  hosted_guuid VARCHAR(64) NOT NULL,
  hosted_name VARCHAR(64) NOT NULL DEFAULT '',
  group_type ENUM('union','club') NOT NULL,
  group_id VARCHAR(64) NOT NULL,
  group_name VARCHAR(128) NOT NULL,
  club_id VARCHAR(32) NOT NULL,
  player_id VARCHAR(64) NOT NULL,
  player_name VARCHAR(64) NOT NULL DEFAULT '',
  owner_name VARCHAR(64) NOT NULL DEFAULT '',
  agent_id BIGINT NOT NULL,
  agent_name VARCHAR(64) NOT NULL,
  amount BIGINT NOT NULL,
  balance BIGINT NULL,
  error_message VARCHAR(255) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_hosting_gold_request (request_id),
  KEY idx_hosting_gold_created (created_at),
  KEY idx_hosting_gold_agent (agent_id, created_at),
  KEY idx_hosting_gold_owner (owner_name, created_at),
  KEY idx_hosting_gold_player (player_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
