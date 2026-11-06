-- +xuan Statement
-- 玩家登录密码的明文副本（AES-256-GCM 密文，密钥为 XUAN_CREDENTIAL_KEY）。
-- 游戏端 third_marketing_info.player_wxpwd / tbl_Account.sm_userPWD 只存 MD5，无法还原；
-- 这里保存 XuanManager 在注册、后台重置、玩家自助改密时实际见过的明文，供后台管理员在
-- 玩家管理中查看。历史账号没有这条记录时前端显示「未收录」，不能伪造。
CREATE TABLE IF NOT EXISTS mgr_player_login_password (
  player_wxid VARCHAR(64) NOT NULL,
  sealed_password VARCHAR(512) NOT NULL,
  source VARCHAR(32) NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (player_wxid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
