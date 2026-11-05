package directchat

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

// Hosting 是一个已开启聊天托管的账号。客服工作台按 group_type/group_id
// 把托管账号归到联盟或俱乐部下展示。
type Hosting struct {
	Guuid      string
	GroupType  string
	GroupID    string
	GroupName  string
	ClubID     string
	Role       string
	Enabled    bool
	EnabledAt  time.Time
	DisabledAt time.Time
	UpdatedAt  time.Time
}

// HostingStore 是托管状态的持久化接口。单独拆出来，避免影响既有直聊 Store
// 的内存测试实现。
type HostingStore interface {
	GetHosting(ctx context.Context, guuid string) (Hosting, bool, error)
	UpsertHosting(ctx context.Context, item Hosting) error
	DisableHosting(ctx context.Context, guuid string) error
	DeleteHosting(ctx context.Context, guuid string) error
	ListHostings(ctx context.Context) ([]Hosting, error)
	/** 客服共享的托管会话已读游标。 */
	SetHostingRead(ctx context.Context, conversationID, messageID string) error
	HostingUnreadCounts(ctx context.Context, conversationIDs []string, hostedGuuid string) (map[string]int, error)
	/** 永久删除托管账号名下的直聊会话、消息、附件记录；返回需要删除的媒体文件 key。 */
	DeleteHostedOwnerData(ctx context.Context, guuid string) ([]string, int, error)
}

func (s *SQLStore) GetHosting(ctx context.Context, guuid string) (Hosting, bool, error) {
	guuid = strings.TrimSpace(guuid)
	if guuid == "" {
		return Hosting{}, false, nil
	}
	var item Hosting
	var disabledAt sql.NullTime
	err := s.db.QueryRowContext(ctx, `SELECT guuid, group_type, group_id, group_name, club_id, role,
enabled, enabled_at, disabled_at, updated_at
FROM chat_direct_hosting WHERE guuid = ? LIMIT 1`, guuid).Scan(
		&item.Guuid, &item.GroupType, &item.GroupID, &item.GroupName, &item.ClubID,
		&item.Role, &item.Enabled, &item.EnabledAt, &disabledAt, &item.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return Hosting{}, false, nil
	}
	if err != nil {
		return Hosting{}, false, err
	}
	if disabledAt.Valid {
		item.DisabledAt = disabledAt.Time
	}
	return item, true, nil
}

func (s *SQLStore) UpsertHosting(ctx context.Context, item Hosting) error {
	now := time.Now()
	if item.EnabledAt.IsZero() {
		item.EnabledAt = now
	}
	var disabledAt any
	if !item.DisabledAt.IsZero() {
		disabledAt = item.DisabledAt
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO chat_direct_hosting
(guuid, group_type, group_id, group_name, club_id, role, enabled, enabled_at, disabled_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE group_type = VALUES(group_type), group_id = VALUES(group_id),
group_name = VALUES(group_name), club_id = VALUES(club_id), role = VALUES(role),
enabled = VALUES(enabled), enabled_at = VALUES(enabled_at), disabled_at = VALUES(disabled_at),
updated_at = VALUES(updated_at)`,
		item.Guuid, item.GroupType, item.GroupID, item.GroupName, item.ClubID,
		item.Role, item.Enabled, item.EnabledAt, disabledAt, now)
	return err
}

func (s *SQLStore) DisableHosting(ctx context.Context, guuid string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE chat_direct_hosting
SET enabled=0, disabled_at=NOW(), updated_at=NOW() WHERE guuid = ?`, strings.TrimSpace(guuid))
	return err
}

func (s *SQLStore) DeleteHosting(ctx context.Context, guuid string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM chat_direct_hosting WHERE guuid = ?`, strings.TrimSpace(guuid))
	return err
}

func (s *SQLStore) ListHostings(ctx context.Context) ([]Hosting, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT guuid, group_type, group_id, group_name, club_id, role,
enabled, enabled_at, disabled_at, updated_at
FROM chat_direct_hosting ORDER BY enabled DESC, group_type, group_name, enabled_at, guuid`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]Hosting, 0)
	for rows.Next() {
		var item Hosting
		var disabledAt sql.NullTime
		if err := rows.Scan(&item.Guuid, &item.GroupType, &item.GroupID, &item.GroupName, &item.ClubID,
			&item.Role, &item.Enabled, &item.EnabledAt, &disabledAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		if disabledAt.Valid {
			item.DisabledAt = disabledAt.Time
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// DeleteHostedOwnerData 永久删除托管账号名下的全部直聊会话、消息和附件记录。
// 返回需要由调用方从磁盘删除的附件 key 及删除的会话数。
func (s *SQLStore) DeleteHostedOwnerData(ctx context.Context, guuid string) ([]string, int, error) {
	guuid = strings.TrimSpace(guuid)
	if guuid == "" {
		return nil, 0, nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, 0, err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `SELECT id FROM chat_direct_conversation
WHERE low_guuid=? OR high_guuid=? FOR UPDATE`, guuid, guuid)
	if err != nil {
		return nil, 0, err
	}
	var conversationIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, 0, err
		}
		conversationIDs = append(conversationIDs, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, 0, err
	}
	rows.Close()
	mediaKeys := []string{}
	if len(conversationIDs) > 0 {
		args := toArgs(conversationIDs)
		mediaRows, err := tx.QueryContext(ctx, `SELECT storage_key, thumbnail_key FROM chat_direct_attachment
WHERE conversation_id IN (`+placeholders(len(conversationIDs))+`)`, args...)
		if err != nil {
			return nil, 0, err
		}
		for mediaRows.Next() {
			var storageKey, thumbnailKey sql.NullString
			if err := mediaRows.Scan(&storageKey, &thumbnailKey); err != nil {
				mediaRows.Close()
				return nil, 0, err
			}
			if storageKey.Valid && storageKey.String != "" {
				mediaKeys = append(mediaKeys, storageKey.String)
			}
			if thumbnailKey.Valid && thumbnailKey.String != "" {
				mediaKeys = append(mediaKeys, thumbnailKey.String)
			}
		}
		if err := mediaRows.Err(); err != nil {
			mediaRows.Close()
			return nil, 0, err
		}
		mediaRows.Close()
		inClause := `(` + placeholders(len(conversationIDs)) + `)`
		for _, statement := range []string{
			`DELETE FROM chat_direct_message WHERE conversation_id IN ` + inClause,
			`DELETE FROM chat_direct_attachment WHERE conversation_id IN ` + inClause,
			`DELETE FROM chat_direct_participant WHERE conversation_id IN ` + inClause,
			`DELETE FROM chat_direct_hosting_read WHERE conversation_id IN ` + inClause,
			`DELETE FROM chat_direct_conversation WHERE id IN ` + inClause,
		} {
			if _, err := tx.ExecContext(ctx, statement, args...); err != nil {
				return nil, 0, err
			}
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM chat_direct_hosting WHERE guuid=?`, guuid); err != nil {
		return nil, 0, err
	}
	if err := tx.Commit(); err != nil {
		return nil, 0, err
	}
	return mediaKeys, len(conversationIDs), nil
}

// SetHostingRead 记录客服共享的托管会话已读游标。
func (s *SQLStore) SetHostingRead(ctx context.Context, conversationID, messageID string) error {
	conversationID = strings.TrimSpace(conversationID)
	messageID = strings.TrimSpace(messageID)
	if conversationID == "" || messageID == "" {
		return nil
	}
	now := time.Now()
	_, err := s.db.ExecContext(ctx, `INSERT INTO chat_direct_hosting_read
(conversation_id, last_message_id, updated_at) VALUES (?, ?, ?)
ON DUPLICATE KEY UPDATE last_message_id = VALUES(last_message_id), updated_at = VALUES(updated_at)`,
		conversationID, messageID, now)
	return err
}

// HostingUnreadCounts 统计每个托管会话在客服已读游标之后、由对方发来的消息数。
func (s *SQLStore) HostingUnreadCounts(ctx context.Context, conversationIDs []string, hostedGuuid string) (map[string]int, error) {
	result := map[string]int{}
	if len(conversationIDs) == 0 {
		return result, nil
	}
	args := append(toArgs(conversationIDs), hostedGuuid)
	rows, err := s.db.QueryContext(ctx, `SELECT m.conversation_id, COUNT(*)
FROM chat_direct_message m
LEFT JOIN chat_direct_hosting_read r ON r.conversation_id = m.conversation_id
LEFT JOIN chat_direct_message c ON c.id = r.last_message_id
WHERE m.conversation_id IN (`+placeholders(len(conversationIDs))+`) AND m.sender_guuid <> ?
AND (c.id IS NULL OR m.created_at > c.created_at OR (m.created_at = c.created_at AND m.id > c.id))
GROUP BY m.conversation_id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var conversationID string
		var count int
		if err := rows.Scan(&conversationID, &count); err != nil {
			return nil, err
		}
		result[conversationID] = count
	}
	return result, rows.Err()
}
