package migrations

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"sort"
	"strings"
	"time"

	"xuanmanager/internal/config"
	"xuanmanager/internal/security"
)

//go:embed *.sql
var files embed.FS

const marker = "-- +xuan Statement"

func Apply(ctx context.Context, db *sql.DB) error {
	if _, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS mgr_schema_migration (
version VARCHAR(128) NOT NULL PRIMARY KEY,
applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`); err != nil {
		return fmt.Errorf("创建迁移记录表失败: %w", err)
	}

	entries, err := files.ReadDir(".")
	if err != nil {
		return err
	}
	var names []string
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".sql") {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)

	for _, name := range names {
		var applied int
		if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM mgr_schema_migration WHERE version = ?", name).Scan(&applied); err != nil {
			return err
		}
		if applied > 0 {
			continue
		}
		body, err := files.ReadFile(name)
		if err != nil {
			return err
		}
		for _, statement := range strings.Split(string(body), marker) {
			statement = strings.TrimSpace(statement)
			if statement == "" {
				continue
			}
			if _, err := db.ExecContext(ctx, statement); err != nil {
				return fmt.Errorf("执行迁移 %s 失败: %w", name, err)
			}
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO mgr_schema_migration(version, applied_at) VALUES (?, ?)", name, time.Now()); err != nil {
			return fmt.Errorf("记录迁移 %s 失败: %w", name, err)
		}
	}
	return nil
}

func BootstrapAdmin(ctx context.Context, db *sql.DB, cfg config.Config) error {
	var count int
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM mgr_user").Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	if cfg.BootstrapAdminUser == "" || cfg.BootstrapAdminPass == "" {
		return fmt.Errorf("尚无后台用户，首次启动必须设置 XUAN_BOOTSTRAP_ADMIN_USERNAME 和 XUAN_BOOTSTRAP_ADMIN_PASSWORD")
	}
	if err := security.ValidateUsername(cfg.BootstrapAdminUser); err != nil {
		return fmt.Errorf("初始超级管理员账号不合法: %w", err)
	}
	// 用户指定的首个管理员密码可保留原样初始化；后续创建和重置执行统一强密码策略。
	hash, err := security.HashBootstrapPassword(cfg.BootstrapAdminPass)
	if err != nil {
		return err
	}
	_, err = db.ExecContext(ctx, `INSERT INTO mgr_user
(username, password_hash, display_name, role_id, is_super, status)
VALUES (?, ?, ?, 1, 1, 'enabled')`, cfg.BootstrapAdminUser, hash, cfg.BootstrapAdminName)
	if err != nil {
		return fmt.Errorf("创建初始超级管理员失败: %w", err)
	}
	return nil
}
