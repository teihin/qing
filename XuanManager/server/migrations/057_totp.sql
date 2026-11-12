-- 谷歌验证（TOTP）绑定与登录挑战。
-- totp_secret 存 AES-256-GCM 密文（v1: 前缀），不落明文；totp_last_step 用于拒绝同一个动态码重复使用。
-- +xuan Statement
ALTER TABLE mgr_user
  ADD COLUMN totp_secret VARCHAR(255) NULL AFTER password_hash,
  ADD COLUMN totp_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER totp_secret,
  ADD COLUMN totp_confirmed_at DATETIME NULL AFTER totp_enabled,
  ADD COLUMN totp_last_step BIGINT NOT NULL DEFAULT 0 AFTER totp_confirmed_at

-- +xuan Statement
CREATE TABLE IF NOT EXISTS mgr_user_recovery_code (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  code_hash CHAR(64) NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mgr_recovery_user (user_id, used_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

-- +xuan Statement
CREATE TABLE IF NOT EXISTS mgr_login_challenge (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  attempts TINYINT NOT NULL DEFAULT 0,
  ip VARCHAR(64) NOT NULL DEFAULT '',
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mgr_challenge_expire (expires_at),
  INDEX idx_mgr_challenge_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

-- +xuan Statement
INSERT INTO mgr_permission (module_id, code, name, action, description, status)
SELECT 11, 'user.reset_totp', '重置二次验证', 'reset_totp', '清空后台用户的谷歌验证绑定，用户下次登录需重新绑定', 'enabled'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM mgr_permission WHERE code = 'user.reset_totp')

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT rp.role_id, target.id
FROM mgr_role_permission rp
JOIN mgr_permission source ON source.id = rp.permission_id
JOIN mgr_permission target ON target.code = 'user.reset_totp'
WHERE source.code = 'user.reset_password'

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code = 'user.reset_totp'
