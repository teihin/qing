package directchat

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

// BFEntry 是一个俱乐部创建者的官方客服入口开关。
// 没有记录时按开启处理，兼容升级前所有账号默认能看到 BF 聊天。
type BFEntry struct {
	Guuid   string
	Enabled bool
}

// BFEntryStore 是 BF 入口开关的持久化接口。
// 单独拆出来，避免给既有 Store 增加方法而影响内存测试实现。
type BFEntryStore interface {
	GetBFEntry(ctx context.Context, guuid string) (BFEntry, bool, error)
	SaveBFEntry(ctx context.Context, guuid string, enabled bool) error
}

func (s *SQLStore) GetBFEntry(ctx context.Context, guuid string) (BFEntry, bool, error) {
	guuid = strings.TrimSpace(guuid)
	if guuid == "" {
		return BFEntry{}, false, nil
	}
	var item BFEntry
	err := s.db.QueryRowContext(ctx, `SELECT guuid, enabled FROM chat_direct_bf_entry WHERE guuid = ? LIMIT 1`,
		guuid).Scan(&item.Guuid, &item.Enabled)
	if errors.Is(err, sql.ErrNoRows) {
		return BFEntry{}, false, nil
	}
	if err != nil {
		return BFEntry{}, false, err
	}
	return item, true, nil
}

func (s *SQLStore) SaveBFEntry(ctx context.Context, guuid string, enabled bool) error {
	guuid = strings.TrimSpace(guuid)
	if guuid == "" {
		return nil
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO chat_direct_bf_entry (guuid, enabled, updated_at)
VALUES (?, ?, NOW())
ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), updated_at = NOW()`, guuid, enabled)
	return err
}
