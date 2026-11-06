-- 客服工作台「聊天托管」的展示偏好：
-- 1) 玩家备注名称：全团队共享，改的是玩家（peer）而不是单条会话，换会话也生效；
-- 2) 托管会话置顶：重要玩家排在列表最前，全团队共享，和托管已读游标一致。

CREATE TABLE IF NOT EXISTS chat_direct_player_remark (
  player_id VARCHAR(64) NOT NULL,
  remark VARCHAR(32) NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  updated_by_name VARCHAR(64) NOT NULL DEFAULT '',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (player_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- +chattool Statement
CREATE TABLE IF NOT EXISTS chat_direct_hosted_pin (
  conversation_id VARCHAR(64) NOT NULL,
  pinned_by BIGINT UNSIGNED NULL,
  pinned_by_name VARCHAR(64) NOT NULL DEFAULT '',
  pinned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (conversation_id),
  KEY idx_direct_hosted_pin_time (pinned_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
