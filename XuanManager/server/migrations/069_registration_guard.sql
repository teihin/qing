-- +xuan Statement
-- 注册防护：把「一个 IP 能注册多少个号」从进程内的一次性计数，改成落库的配额事件表。
-- 目的有三个：
--   1. 进程重启不清零（原来的 registrationRateLimiter 是内存 map，重启即重置）；
--   2. 支持多维配额：单 IP 小时/日、单设备、全局日上限；
--   3. 留痕，事后能查「哪批 IP 在批量注册」。
-- 只记 IP 哈希，不记明文 IP；表由 janitor 按天清理，事件保留 7 天。
CREATE TABLE IF NOT EXISTS mgr_registration_event (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ip_hash CHAR(16) NOT NULL DEFAULT '',
  device_key VARCHAR(64) NOT NULL DEFAULT '',
  login_name VARCHAR(32) NOT NULL DEFAULT '',
  result VARCHAR(24) NOT NULL DEFAULT '',
  risk_score TINYINT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ip_time (ip_hash, created_at),
  KEY idx_device_time (device_key, created_at),
  KEY idx_result_time (result, created_at),
  KEY idx_time (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

-- +xuan Statement
-- 蜜罐命中后封禁该 IP，避免同一个脚本换个账号继续刷。
CREATE TABLE IF NOT EXISTS mgr_registration_ip_ban (
  ip_hash CHAR(16) NOT NULL,
  reason VARCHAR(64) NOT NULL DEFAULT '',
  banned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expire_at DATETIME NOT NULL,
  PRIMARY KEY (ip_hash),
  KEY idx_expire (expire_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
