-- 业绩核心共享：把当前参与名单保存成可复用的命名方案，下次一键加载。
-- 保存时记录成员快照，之后代理进出俱乐部不影响已存名单。
-- +xuan Statement
CREATE TABLE IF NOT EXISTS mgr_agent_reward_list (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(64) NOT NULL,
  note VARCHAR(200) NOT NULL DEFAULT '',
  member_count INT NOT NULL DEFAULT 0,
  created_by VARCHAR(64) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

-- +xuan Statement
CREATE TABLE IF NOT EXISTS mgr_agent_reward_list_member (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  list_id BIGINT UNSIGNED NOT NULL,
  agent_id VARCHAR(64) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_list_agent (list_id, agent_id),
  KEY idx_list (list_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
