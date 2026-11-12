-- 隐藏高级客服：拥有全部客服功能，但不出现在其他账号（含客服主管）的团队列表、转接候选和在线人数里。
-- is_super 额外允许重置其他主管的二次验证；hidden 控制可见性，账号本人仍能在团队列表看到自己。
-- +chattool Statement
ALTER TABLE chat_agent
  ADD COLUMN is_super TINYINT(1) NOT NULL DEFAULT 0 AFTER role,
  ADD COLUMN hidden TINYINT(1) NOT NULL DEFAULT 0 AFTER enabled
