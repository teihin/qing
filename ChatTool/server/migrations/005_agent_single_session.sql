DELETE old_session
FROM chat_agent_session old_session
JOIN chat_agent_session newer_session
  ON newer_session.agent_id = old_session.agent_id
 AND (
   newer_session.created_at > old_session.created_at
   OR (newer_session.created_at = old_session.created_at AND newer_session.token_hash > old_session.token_hash)
 );

-- +chattool Statement
ALTER TABLE chat_agent_session
  ADD UNIQUE KEY uk_chat_agent_session_agent (agent_id);
