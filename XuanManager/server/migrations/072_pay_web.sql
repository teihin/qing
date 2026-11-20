-- 网页支付：客服把付款链接发给玩家，玩家自己在网页选金额付款，钱经第三方
-- 聚合代收通道（当前仅雷马 sdmpay）进商户钱包，付款结果由异步回调落库。
-- 与「配置中心 → 支付配置」是两回事：那套是游戏客户端内的充值通道展示与提现，
-- 这套是后台自己发单、自己记账，互不影响。
-- +xuan Statement
CREATE TABLE IF NOT EXISTS mgr_pay_provider (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(64) NOT NULL COMMENT '后台内部唯一标识',
  name VARCHAR(64) NOT NULL COMMENT '展示名称',
  kind VARCHAR(32) NOT NULL DEFAULT 'sdmpay' COMMENT '支付商类型，决定建单与验签实现',
  gateway_base VARCHAR(200) NOT NULL DEFAULT '' COMMENT '网关根地址，如 https://payment.sdmpay.xyz',
  request_prefix VARCHAR(64) NOT NULL DEFAULT '' COMMENT '商户请求位址，拼在网关根地址后',
  merchant_code VARCHAR(100) NOT NULL DEFAULT '',
  secure_key VARCHAR(500) NOT NULL DEFAULT '' COMMENT 'AES-GCM 密文，空表示未配置',
  callback_ip VARCHAR(64) NOT NULL DEFAULT '' COMMENT '服务商固定回调源 IP，仅作展示与核对',
  min_amount DECIMAL(12,2) NOT NULL DEFAULT 1.00,
  max_amount DECIMAL(12,2) NOT NULL DEFAULT 50000.00,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  remark VARCHAR(255) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_pay_provider_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='网页支付-支付商'

-- +xuan Statement
CREATE TABLE IF NOT EXISTS mgr_pay_channel (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  provider_id BIGINT NOT NULL,
  code VARCHAR(32) NOT NULL COMMENT '通道代码，如 ALIPAYH5',
  name VARCHAR(64) NOT NULL COMMENT '付款页 Tab 上的名称',
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  preset_amounts VARCHAR(255) NOT NULL DEFAULT '500,1000,2000,5000,10000,20000' COMMENT '逗号分隔的金额档位',
  require_payer TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1=付款页必须填写付款人姓名（网关实名制/小额/包司抗投通道）',
  min_amount DECIMAL(12,2) NOT NULL DEFAULT 1.00,
  max_amount DECIMAL(12,2) NOT NULL DEFAULT 50000.00,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_pay_channel (provider_id, code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='网页支付-支付商下启用的通道'

-- +xuan Statement
CREATE TABLE IF NOT EXISTS mgr_pay_order (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_no VARCHAR(64) NOT NULL COMMENT '我方订单号，回传服务商',
  provider_id BIGINT NOT NULL,
  provider_code VARCHAR(64) NOT NULL DEFAULT '',
  channel_code VARCHAR(32) NOT NULL DEFAULT '',
  channel_name VARCHAR(64) NOT NULL DEFAULT '',
  amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  currency VARCHAR(8) NOT NULL DEFAULT 'CNY',
  status VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'pending/paid/failed/closed',
  gamer_order_id VARCHAR(64) NOT NULL DEFAULT '' COMMENT '服务商订单号',
  pay_url VARCHAR(500) NOT NULL DEFAULT '' COMMENT '收银台地址',
  notify_url VARCHAR(300) NOT NULL DEFAULT '',
  player_id VARCHAR(64) NOT NULL DEFAULT '',
  player_name VARCHAR(64) NOT NULL DEFAULT '',
  operator_id BIGINT NULL,
  operator_name VARCHAR(64) NOT NULL DEFAULT '' COMMENT '生成链接的客服',
  payer_ip VARCHAR(64) NOT NULL DEFAULT '',
  remark VARCHAR(255) NOT NULL DEFAULT '',
  notify_raw TEXT NULL,
  paid_at DATETIME NULL,
  last_sync_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_pay_order_no (order_no),
  KEY idx_pay_order_created (created_at),
  KEY idx_pay_order_status (status),
  KEY idx_pay_order_provider (provider_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='网页支付-订单'

-- +xuan Statement
INSERT INTO mgr_module (parent_id, code, name, route, icon, sort_order, visible, status) VALUES
  (20, 'game.pay_web', '网页支付', '/game/pay', 'pay-web', 47, 1, 'enabled')
ON DUPLICATE KEY UPDATE parent_id = VALUES(parent_id), name = VALUES(name), route = VALUES(route),
  icon = VALUES(icon), sort_order = VALUES(sort_order), visible = VALUES(visible), status = VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (module_id, code, name, action, description, status)
SELECT id, 'game.pay_web.view', '查看网页支付', 'view', '查看付款订单、订单统计与支付商列表', 'enabled'
FROM mgr_module WHERE code = 'game.pay_web'
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action),
  description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (module_id, code, name, action, description, status)
SELECT id, 'game.pay_web.link', '生成付款链接', 'link', '为玩家生成付款链接并复制发给玩家', 'enabled'
FROM mgr_module WHERE code = 'game.pay_web'
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action),
  description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT INTO mgr_permission (module_id, code, name, action, description, status)
SELECT id, 'game.pay_web.config', '配置支付商与通道', 'config', '维护支付商密钥、网关地址，以及每个支付商开放的付款通道和金额档位', 'enabled'
FROM mgr_module WHERE code = 'game.pay_web'
ON DUPLICATE KEY UPDATE module_id = VALUES(module_id), name = VALUES(name), action = VALUES(action),
  description = VALUES(description), status = VALUES(status)

-- +xuan Statement
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT 1, id FROM mgr_permission WHERE code IN ('game.pay_web.view', 'game.pay_web.link', 'game.pay_web.config')

-- +xuan Statement
-- 已经能看支付配置的角色（客服、运营）默认也能看订单并生成链接；配置权单独给，
-- 免得所有客服都能改密钥和通道。
INSERT IGNORE INTO mgr_role_permission (role_id, permission_id)
SELECT DISTINCT rp.role_id, target.id
FROM mgr_role_permission rp
JOIN mgr_permission source ON source.id = rp.permission_id
JOIN mgr_permission target ON target.code IN ('game.pay_web.view', 'game.pay_web.link')
WHERE source.code IN ('configuration.payment.view', 'game.player.view')

-- +xuan Statement
INSERT INTO mgr_pay_provider (code, name, kind, gateway_base, request_prefix, merchant_code, callback_ip, remark, enabled, sort_order) VALUES
  ('sdmpay_bf', '雷马支付（BF）', 'sdmpay', 'https://payment.sdmpay.xyz', 'BF', 'MPVUY4S0JY', '34.146.6.47', '商户名 BF；正式环境后台 https://mt89.sdmpay.xyz', 1, 10)
ON DUPLICATE KEY UPDATE name = VALUES(name), kind = VALUES(kind), gateway_base = VALUES(gateway_base),
  request_prefix = VALUES(request_prefix), merchant_code = VALUES(merchant_code)

-- +xuan Statement
INSERT INTO mgr_pay_channel (provider_id, code, name, enabled, preset_amounts, min_amount, max_amount, sort_order)
SELECT p.id, c.code, c.name, c.enabled, '500,1000,2000,5000,10000,20000', c.min_amount, c.max_amount, c.sort_order
FROM mgr_pay_provider p
JOIN (
  SELECT 'ALIPAY' AS code, '支付宝扫码' AS name, 1 AS enabled, 1.00 AS min_amount, 50000.00 AS max_amount, 10 AS sort_order
  UNION ALL SELECT 'ALIPAYH5', '支付宝 UID 小额', 1, 1.00, 5000.00, 20
  UNION ALL SELECT 'ALIPAYTOALIPAY', '支付宝 UID 中额', 1, 100.00, 20000.00, 30
  UNION ALL SELECT 'ALIPAYTOBANK', '支付宝 UID 大额', 1, 500.00, 50000.00, 40
  UNION ALL SELECT 'MICROBANK', '银联扫码', 1, 100.00, 50000.00, 50
  UNION ALL SELECT 'WECHAT', '微信扫码', 0, 1.00, 50000.00, 60
) c
WHERE p.code = 'sdmpay_bf'
ON DUPLICATE KEY UPDATE name = VALUES(name), min_amount = VALUES(min_amount), max_amount = VALUES(max_amount),
  sort_order = VALUES(sort_order)
