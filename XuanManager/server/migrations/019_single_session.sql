-- +xuan Statement
DELETE stale_session
FROM mgr_session stale_session
JOIN mgr_session current_session
  ON current_session.user_id = stale_session.user_id
 AND (
   current_session.created_at > stale_session.created_at
   OR (current_session.created_at = stale_session.created_at AND current_session.token_hash > stale_session.token_hash)
 )
