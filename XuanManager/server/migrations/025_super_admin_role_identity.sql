-- +xuan Statement
UPDATE mgr_user
SET is_super = 1
WHERE username = 'admin999'
  AND is_super <> 1
