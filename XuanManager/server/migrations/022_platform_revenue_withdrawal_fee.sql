-- +xuan Statement
UPDATE mgr_module
SET parent_id = 30,
    code = 'configuration.platform_revenue',
    name = '平台收益',
    route = '/configuration/platform-revenue',
    icon = 'platform-revenue',
    sort_order = 60,
    visible = 1,
    status = 'enabled'
WHERE id = 36

-- +xuan Statement
UPDATE mgr_permission
SET name = '查看平台收益',
    description = '超级管理员专属：查看平台抽水、玩家消费、提现手续费、代理红利支出及运营净收益'
WHERE id = 3601

-- +xuan Statement
DELETE FROM mgr_role_permission
WHERE permission_id = 3601 AND role_id <> 1

-- +xuan Statement
ALTER TABLE mgr_platform_revenue_daily
  ADD COLUMN withdrawal_fee DECIMAL(20,2) NOT NULL DEFAULT 0.00 AFTER player_consumption,
  ADD COLUMN withdrawal_fee_count BIGINT NOT NULL DEFAULT 0 AFTER player_consumption_count

-- +xuan Statement
DELETE FROM mgr_platform_revenue_daily

-- +xuan Statement
UPDATE mgr_platform_revenue_cache_state
SET source_start_date = NULL,
    synced_start_date = NULL,
    synced_end_date = NULL
WHERE id = 1
