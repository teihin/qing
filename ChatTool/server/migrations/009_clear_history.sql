-- 单方清除聊天记录：只影响本人再次拉取，消息行仍保留，客服/对方可见。
ALTER TABLE chat_direct_participant
  ADD COLUMN cleared_at DATETIME(6) NULL AFTER last_read_message_id;

-- +chattool Statement

ALTER TABLE chat_conversation
  ADD COLUMN player_cleared_at DATETIME(6) NULL AFTER player_last_read_at;
