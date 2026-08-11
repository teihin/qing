package migrations

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"sort"
	"strings"
	"time"

	"chattool/internal/security"
)

//go:embed *.sql
var files embed.FS

const marker = "-- +chattool Statement"

func Apply(ctx context.Context, db *sql.DB) error {
	if _, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS chat_schema_migration (
version VARCHAR(128) NOT NULL PRIMARY KEY,
applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`); err != nil {
		return fmt.Errorf("创建客服迁移记录表失败: %w", err)
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
		if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM chat_schema_migration WHERE version = ?", name).Scan(&applied); err != nil {
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
				return fmt.Errorf("执行客服迁移 %s 失败: %w", name, err)
			}
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO chat_schema_migration(version, applied_at) VALUES (?, ?)", name, time.Now()); err != nil {
			return err
		}
	}
	return nil
}

func BootstrapSupervisor(ctx context.Context, db *sql.DB, username, password, displayName string) error {
	var count int
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM chat_agent").Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	if strings.TrimSpace(username) == "" || password == "" {
		return fmt.Errorf("尚无客服账号，首次启动必须设置 CHAT_BOOTSTRAP_USERNAME 和 CHAT_BOOTSTRAP_PASSWORD")
	}
	if err := security.ValidateUsername(username); err != nil {
		return err
	}
	hash, err := security.HashPassword(password)
	if err != nil {
		return err
	}
	_, err = db.ExecContext(ctx, `INSERT INTO chat_agent
(username, password_hash, display_name, role, enabled, presence, max_conversations, created_at, updated_at)
VALUES (?, ?, ?, 'supervisor', 1, 'offline', 8, NOW(), NOW())`, username, hash, displayName)
	return err
}
