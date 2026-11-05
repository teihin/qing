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
	Guuid     string
	GroupType string
	GroupID   string
	GroupName string
	ClubID    string
	Role      string
	EnabledAt time.Time
	UpdatedAt time.Time
}

// HostingStore 是托管状态的持久化接口。单独拆出来，避免影响既有直聊 Store
// 的内存测试实现。
type HostingStore interface {
	GetHosting(ctx context.Context, guuid string) (Hosting, bool, error)
	UpsertHosting(ctx context.Context, item Hosting) error
	DeleteHosting(ctx context.Context, guuid string) error
	ListHostings(ctx context.Context) ([]Hosting, error)
	/** 客服共享的托管会话已读游标。 */
	SetHostingRead(ctx context.Context, conversationID, messageID string) error
	HostingUnreadCounts(ctx context.Context, conversationIDs []string, hostedGuuid string) (map[string]int, error)
}

func (s *SQLStore) GetHosting(ctx context.Context, guuid string) (Hosting, bool, error) {
	guuid = strings.TrimSpace(guuid)
	if guuid == "" {
		return Hosting{}, false, nil
	}
	var item Hosting
	err := s.db.QueryRowContext(ctx, `SELECT guuid, group_type, group_id, group_name, club_id, role, enabled_at, updated_at
FROM chat_direct_hosting WHERE guuid = ? LIMIT 1`, guuid).Scan(
		&item.Guuid, &item.GroupType, &item.GroupID, &item.GroupName, &item.ClubID,
		&item.Role, &item.EnabledAt, &item.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return Hosting{}, false, nil
	}
	if err != nil {
		return Hosting{}, false, err
	}
	return item, true, nil
}

func (s *SQLStore) UpsertHosting(ctx context.Context, item Hosting) error {
	now := time.Now()
	if item.EnabledAt.IsZero() {
		item.EnabledAt = now
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO chat_direct_hosting
(guuid, group_type, group_id, group_name, club_id, role, enabled_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE group_type = VALUES(group_type), group_id = VALUES(group_id),
group_name = VALUES(group_name), club_id = VALUES(club_id), role = VALUES(role),
enabled_at = VALUES(enabled_at), updated_at = VALUES(updated_at)`,
		item.Guuid, item.GroupType, item.GroupID, item.GroupName, item.ClubID,
		item.Role, item.EnabledAt, now)
	return err
}

func (s *SQLStore) DeleteHosting(ctx context.Context, guuid string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM chat_direct_hosting WHERE guuid = ?`, strings.TrimSpace(guuid))
	return err
}

func (s *SQLStore) ListHostings(ctx context.Context) ([]Hosting, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT guuid, group_type, group_id, group_name, club_id, role, enabled_at, updated_at
FROM chat_direct_hosting ORDER BY group_type, group_name, enabled_at, guuid`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]Hosting, 0)
	for rows.Next() {
		var item Hosting
		if err := rows.Scan(&item.Guuid, &item.GroupType, &item.GroupID, &item.GroupName, &item.ClubID,
			&item.Role, &item.EnabledAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
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
