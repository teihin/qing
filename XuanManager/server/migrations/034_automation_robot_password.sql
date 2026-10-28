-- 机器人登录密码：只存加密后的密文（AES-256-GCM），接口与日志都不回显明文。
-- 心跳下发给节点后由节点本地登录游戏使用。
-- +xuan Statement
ALTER TABLE mgr_automation_robot ADD COLUMN login_password VARCHAR(512) NOT NULL DEFAULT '' AFTER account

-- +xuan Statement
ALTER TABLE mgr_automation_robot ADD COLUMN password_updated_at DATETIME NULL AFTER login_password
