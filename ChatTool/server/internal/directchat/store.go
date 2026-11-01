package directchat

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

// SQLStore 是直聊数据的 MySQL 实现。它只访问聊天自有的 chat_direct_* 表，
// 不读写游戏俱乐部目录，也不读写任何 chat_* 客服表。
type SQLStore struct {
	db *sql.DB
}

// NewSQLStore 创建存储层。
func NewSQLStore(db *sql.DB) *SQLStore { return &SQLStore{db: db} }

// ConversationItem 是会话列表的中间结果（含对方、预览与未读）。
type ConversationItem struct {
	Conversation Conversation
	HiddenAt     time.Time
	PeerGuuid    string
	Peer         Member
	LastText     string
	LastType     string
	Unread       int
}

const conversationColumns = `c.id, c.club_id, c.pair_key, c.low_guuid, c.high_guuid, c.status,
c.last_message_id, c.last_message_at, c.created_at, c.updated_at`

func scanConversation(row interface {
	Scan(dest ...any) error
}) (Conversation, error) {
	var c Conversation
	var lastID sql.NullString
	var lastAt sql.NullTime
	err := row.Scan(&c.ID, &c.ClubID, &c.PairKey, &c.LowGuuid, &c.HighGuuid, &c.Status,
		&lastID, &lastAt, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return Conversation{}, err
	}
	if lastID.Valid {
		c.LastMessageID = lastID.String
	}
	if lastAt.Valid {
		c.LastMessageAt = lastAt.Time
	}
	return c, nil
}

// UnreadByClub 汇总当前用户在各俱乐部的未读数。
func (s *SQLStore) UnreadByClub(ctx context.Context, guuid string) (map[string]int, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT c.club_id, COUNT(*) AS unread
FROM chat_direct_message m
JOIN chat_direct_conversation c ON c.id = m.conversation_id AND c.status = 'active'
JOIN chat_direct_participant p ON p.conversation_id = c.id AND p.guuid = ? AND p.hidden_at IS NULL
LEFT JOIN chat_direct_message r ON r.id = p.last_read_message_id
WHERE m.sender_guuid <> ?
  AND (r.id IS NULL OR m.created_at > r.created_at OR (m.created_at = r.created_at AND m.id > r.id))
GROUP BY c.club_id`, guuid, guuid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := map[string]int{}
	for rows.Next() {
		var clubID string
		var count int
		if err := rows.Scan(&clubID, &count); err != nil {
			return nil, err
		}
		result[clubID] = count
	}
	return result, rows.Err()
}

// ---------------- 会话 ----------------

// FindConversation 按 (club_id, pair_key) 查找会话。
func (s *SQLStore) FindConversation(ctx context.Context, clubID, pairKey string) (Conversation, bool, error) {
	row := s.db.QueryRowContext(ctx, `SELECT `+conversationColumns+`
FROM chat_direct_conversation c WHERE c.club_id = ? AND c.pair_key = ?`, clubID, pairKey)
	c, err := scanConversation(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Conversation{}, false, nil
	}
	if err != nil {
		return Conversation{}, false, err
	}
	return c, true, nil
}

// GetConversation 按 ID 读取会话。
func (s *SQLStore) GetConversation(ctx context.Context, id string) (Conversation, bool, error) {
	row := s.db.QueryRowContext(ctx, `SELECT `+conversationColumns+`
FROM chat_direct_conversation c WHERE c.id = ?`, id)
	c, err := scanConversation(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Conversation{}, false, nil
	}
	if err != nil {
		return Conversation{}, false, err
	}
	return c, true, nil
}

// EnsureConversation 幂等创建会话与两个参与者状态行。
// 唯一索引 uk_direct_club_pair 保证重复点击/并发创建只会有一条会话。
func (s *SQLStore) EnsureConversation(ctx context.Context, clubID, lowGuuid, highGuuid string) (Conversation, error) {
	_, _, pairKey := PairKey(lowGuuid, highGuuid)
	now := time.Now()
	id, err := NewID()
	if err != nil {
		return Conversation{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Conversation{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `INSERT INTO chat_direct_conversation
(id, club_id, pair_key, low_guuid, high_guuid, status, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
ON DUPLICATE KEY UPDATE updated_at = updated_at`, id, clubID, pairKey, lowGuuid, highGuuid, now, now); err != nil {
		return Conversation{}, err
	}
	row := tx.QueryRowContext(ctx, `SELECT `+conversationColumns+`
FROM chat_direct_conversation c WHERE c.club_id = ? AND c.pair_key = ?`, clubID, pairKey)
	conv, err := scanConversation(row)
	if err != nil {
		return Conversation{}, err
	}
	for _, guuid := range []string{conv.LowGuuid, conv.HighGuuid} {
		if _, err := tx.ExecContext(ctx, `INSERT INTO chat_direct_participant
(conversation_id, guuid, first_joined_at, created_at, updated_at)
VALUES (?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE updated_at = updated_at`, conv.ID, guuid, now, now, now); err != nil {
			return Conversation{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return Conversation{}, err
	}
	return conv, nil
}

// GetParticipant 读取会话参与者状态。
func (s *SQLStore) GetParticipant(ctx context.Context, conversationID, guuid string) (Participant, bool, error) {
	var p Participant
	var lastRead sql.NullString
	var hidden sql.NullTime
	err := s.db.QueryRowContext(ctx, `SELECT conversation_id, guuid, first_joined_at, last_read_message_id, hidden_at
FROM chat_direct_participant WHERE conversation_id = ? AND guuid = ?`, conversationID, guuid).
		Scan(&p.ConversationID, &p.Guuid, &p.FirstJoinedAt, &lastRead, &hidden)
	if errors.Is(err, sql.ErrNoRows) {
		return Participant{}, false, nil
	}
	if err != nil {
		return Participant{}, false, err
	}
	if lastRead.Valid {
		p.LastReadMessageID = lastRead.String
	}
	if hidden.Valid {
		p.HiddenAt = hidden.Time
	}
	return p, true, nil
}

// RevealConversation 清除当前参与者的隐藏状态（从玩家列表重新打开会话）。
func (s *SQLStore) RevealConversation(ctx context.Context, conversationID, guuid string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE chat_direct_participant SET hidden_at = NULL, updated_at = ?
WHERE conversation_id = ? AND guuid = ?`, time.Now(), conversationID, guuid)
	return err
}

// HideConversation 只隐藏当前用户的会话入口，不删除消息。
func (s *SQLStore) HideConversation(ctx context.Context, conversationID, guuid string) error {
	now := time.Now()
	result, err := s.db.ExecContext(ctx, `UPDATE chat_direct_participant SET hidden_at = ?, updated_at = ?
WHERE conversation_id = ? AND guuid = ?`, now, now, conversationID, guuid)
	if err != nil {
		return err
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		return errConvForbidden
	}
	return nil
}

// SetLastRead 只更新当前用户自己的已读位置。
func (s *SQLStore) SetLastRead(ctx context.Context, conversationID, guuid, messageID string) error {
	// 已读请求可能并发返回，游标只能向前移动，不能因为旧请求晚到而退回。
	_, err := s.db.ExecContext(ctx, `UPDATE chat_direct_participant p
JOIN chat_direct_message newer ON newer.id = ? AND newer.conversation_id = p.conversation_id
LEFT JOIN chat_direct_message older ON older.id = p.last_read_message_id
  AND older.conversation_id = p.conversation_id
SET p.last_read_message_id = ?, p.updated_at = ?
WHERE p.conversation_id = ? AND p.guuid = ?
  AND (older.id IS NULL OR older.created_at < newer.created_at
    OR (older.created_at = newer.created_at AND older.id < newer.id))`,
		messageID, messageID, time.Now(), conversationID, guuid)
	return err
}

// ListConversations 返回当前俱乐部内、当前用户参与且未隐藏的会话。
func (s *SQLStore) ListConversations(ctx context.Context, clubID, guuid string, offset, limit int) ([]ConversationItem, int, error) {
	var total int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM chat_direct_conversation c
JOIN chat_direct_participant p ON p.conversation_id = c.id AND p.guuid = ? AND p.hidden_at IS NULL
WHERE c.club_id = ? AND c.status = 'active'`, guuid, clubID).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT `+conversationColumns+`, p.hidden_at
FROM chat_direct_conversation c
JOIN chat_direct_participant p ON p.conversation_id = c.id AND p.guuid = ? AND p.hidden_at IS NULL
WHERE c.club_id = ? AND c.status = 'active'
ORDER BY c.last_message_at DESC, c.id DESC LIMIT ? OFFSET ?`, guuid, clubID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var items []ConversationItem
	var ids []string
	var lastIDs []string
	for rows.Next() {
		var item ConversationItem
		var lastID sql.NullString
		var lastAt sql.NullTime
		var hidden sql.NullTime
		if err := rows.Scan(&item.Conversation.ID, &item.Conversation.ClubID, &item.Conversation.PairKey,
			&item.Conversation.LowGuuid, &item.Conversation.HighGuuid, &item.Conversation.Status,
			&lastID, &lastAt, &item.Conversation.CreatedAt, &item.Conversation.UpdatedAt, &hidden); err != nil {
			return nil, 0, err
		}
		if lastID.Valid {
			item.Conversation.LastMessageID = lastID.String
			lastIDs = append(lastIDs, lastID.String)
		}
		if lastAt.Valid {
			item.Conversation.LastMessageAt = lastAt.Time
		}
		if hidden.Valid {
			item.HiddenAt = hidden.Time
		}
		item.PeerGuuid = item.Conversation.PeerGuuid(guuid)
		ids = append(ids, item.Conversation.ID)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	if len(items) == 0 {
		return items, total, nil
	}
	preview, err := s.lastMessages(ctx, lastIDs)
	if err != nil {
		return nil, 0, err
	}
	unread, err := s.unreadFor(ctx, ids, guuid)
	if err != nil {
		return nil, 0, err
	}
	for i := range items {
		if msg, ok := preview[items[i].Conversation.LastMessageID]; ok {
			items[i].LastType = msg.MessageType
			items[i].LastText = previewText(msg)
		}
		items[i].Unread = unread[items[i].Conversation.ID]
	}
	return items, total, nil
}

func (s *SQLStore) lastMessages(ctx context.Context, ids []string) (map[string]Message, error) {
	result := map[string]Message{}
	if len(ids) == 0 {
		return result, nil
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, conversation_id, message_type, COALESCE(text_content,''), created_at
FROM chat_direct_message WHERE id IN (`+placeholders(len(ids))+`)`, toArgs(ids)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var m Message
		if err := rows.Scan(&m.ID, &m.ConversationID, &m.MessageType, &m.Text, &m.CreatedAt); err != nil {
			return nil, err
		}
		result[m.ID] = m
	}
	return result, rows.Err()
}

func (s *SQLStore) unreadFor(ctx context.Context, ids []string, guuid string) (map[string]int, error) {
	result := map[string]int{}
	if len(ids) == 0 {
		return result, nil
	}
	args := []any{guuid}
	args = append(args, toArgs(ids)...)
	args = append(args, guuid)
	rows, err := s.db.QueryContext(ctx, `SELECT m.conversation_id, COUNT(*) AS unread
FROM chat_direct_message m
JOIN chat_direct_participant p ON p.conversation_id = m.conversation_id AND p.guuid = ?
LEFT JOIN chat_direct_message r ON r.id = p.last_read_message_id
WHERE m.conversation_id IN (`+placeholders(len(ids))+`) AND m.sender_guuid <> ?
  AND (r.id IS NULL OR m.created_at > r.created_at OR (m.created_at = r.created_at AND m.id > r.id))
GROUP BY m.conversation_id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var count int
		if err := rows.Scan(&id, &count); err != nil {
			return nil, err
		}
		result[id] = count
	}
	return result, rows.Err()
}

// ---------------- 消息 ----------------

// GetMessage 读取单条消息。
func (s *SQLStore) GetMessage(ctx context.Context, conversationID, messageID string) (Message, bool, error) {
	return s.queryMessage(ctx, `SELECT `+messageColumns+` FROM chat_direct_message
WHERE conversation_id = ? AND id = ?`, conversationID, messageID)
}

// FindMessageByClientID 用于发送重试幂等。
func (s *SQLStore) FindMessageByClientID(ctx context.Context, conversationID, senderGuuid, clientID string) (Message, bool, error) {
	return s.queryMessage(ctx, `SELECT `+messageColumns+` FROM chat_direct_message
WHERE conversation_id = ? AND sender_guuid = ? AND client_message_id = ?`, conversationID, senderGuuid, clientID)
}

const messageColumns = `id, conversation_id, sender_guuid, sender_name_snapshot, sender_role_snapshot,
message_type, COALESCE(text_content,''), COALESCE(attachment_id,''), client_message_id, created_at`

func (s *SQLStore) queryMessage(ctx context.Context, query string, args ...any) (Message, bool, error) {
	var m Message
	err := s.db.QueryRowContext(ctx, query, args...).Scan(&m.ID, &m.ConversationID, &m.SenderGuuid,
		&m.SenderNameSnapshot, &m.SenderRoleSnapshot, &m.MessageType, &m.Text, &m.AttachmentID,
		&m.ClientMessageID, &m.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Message{}, false, nil
	}
	if err != nil {
		return Message{}, false, err
	}
	return m, true, nil
}

// InsertMessage 在同一事务里写消息、绑定附件、更新会话最后消息、清除接收方隐藏状态。
// 重试（相同 client_message_id）命唯一索引时返回原消息，不重复插入。
func (s *SQLStore) InsertMessage(ctx context.Context, msg Message, receiverGuuid string) (Message, bool, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Message{}, false, err
	}
	defer func() { _ = tx.Rollback() }()

	result, err := tx.ExecContext(ctx, `INSERT IGNORE INTO chat_direct_message
(id, conversation_id, sender_guuid, sender_name_snapshot, sender_role_snapshot, message_type,
 text_content, attachment_id, client_message_id, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, NULLIF(?,''), ?, ?)`,
		msg.ID, msg.ConversationID, msg.SenderGuuid, msg.SenderNameSnapshot, msg.SenderRoleSnapshot,
		msg.MessageType, nullIfEmpty(msg.Text), msg.AttachmentID, msg.ClientMessageID, msg.CreatedAt)
	if err != nil {
		return Message{}, false, err
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		existing, ok, err := s.queryMessage(ctx, `SELECT `+messageColumns+` FROM chat_direct_message
WHERE conversation_id = ? AND sender_guuid = ? AND client_message_id = ?`,
			msg.ConversationID, msg.SenderGuuid, msg.ClientMessageID)
		if err != nil {
			return Message{}, false, err
		}
		if !ok {
			return Message{}, false, errMessageInvalid
		}
		return existing, true, nil
	}
	if msg.AttachmentID != "" {
		bind, err := tx.ExecContext(ctx, `UPDATE chat_direct_attachment SET message_id = ?, status = 'bound'
WHERE id = ? AND conversation_id = ? AND status = 'uploaded' AND message_id IS NULL`,
			msg.ID, msg.AttachmentID, msg.ConversationID)
		if err != nil {
			return Message{}, false, err
		}
		if affected, _ := bind.RowsAffected(); affected == 0 {
			return Message{}, false, errMediaIncomplete
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE chat_direct_conversation
SET last_message_id = ?, last_message_at = ?, updated_at = ? WHERE id = ?`,
		msg.ID, msg.CreatedAt, time.Now(), msg.ConversationID); err != nil {
		return Message{}, false, err
	}
	if receiverGuuid != "" {
		// 对方收到新消息后重新看到被隐藏的会话；发送方自己的隐藏状态不受影响。
		if _, err := tx.ExecContext(ctx, `UPDATE chat_direct_participant
SET hidden_at = NULL, updated_at = ? WHERE conversation_id = ? AND guuid = ?`,
			time.Now(), msg.ConversationID, receiverGuuid); err != nil {
			return Message{}, false, err
		}
	}
	if err := tx.Commit(); err != nil {
		return Message{}, false, err
	}
	return msg, false, nil
}

// MessagesBefore 返回游标之前的上一页，按时间正序输出。
func (s *SQLStore) MessagesBefore(ctx context.Context, conversationID string, cur *Cursor, limit int) ([]Message, error) {
	var rows *sql.Rows
	var err error
	if cur == nil {
		rows, err = s.db.QueryContext(ctx, `SELECT `+messageColumns+` FROM chat_direct_message
WHERE conversation_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`, conversationID, limit)
	} else {
		rows, err = s.db.QueryContext(ctx, `SELECT `+messageColumns+` FROM chat_direct_message
WHERE conversation_id = ? AND (created_at < ? OR (created_at = ? AND id < ?))
ORDER BY created_at DESC, id DESC LIMIT ?`, conversationID, cur.At, cur.At, cur.ID, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []Message
	for rows.Next() {
		m, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// 查询是倒序取的上一页，输出前翻回正序，客户端可直接插入到现有数组前面。
	for i, j := 0, len(items)-1; i < j; i, j = i+1, j-1 {
		items[i], items[j] = items[j], items[i]
	}
	return items, nil
}

// MessagesAfter 返回游标之后的新消息（长连接事件后的增量补偿），按时间正序输出。
func (s *SQLStore) MessagesAfter(ctx context.Context, conversationID string, cur Cursor, limit int) ([]Message, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+messageColumns+` FROM chat_direct_message
WHERE conversation_id = ? AND (created_at > ? OR (created_at = ? AND id > ?))
ORDER BY created_at ASC, id ASC LIMIT ?`, conversationID, cur.At, cur.At, cur.ID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []Message
	for rows.Next() {
		m, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, m)
	}
	return items, rows.Err()
}

func scanMessage(rows *sql.Rows) (Message, error) {
	var m Message
	err := rows.Scan(&m.ID, &m.ConversationID, &m.SenderGuuid, &m.SenderNameSnapshot, &m.SenderRoleSnapshot,
		&m.MessageType, &m.Text, &m.AttachmentID, &m.ClientMessageID, &m.CreatedAt)
	return m, err
}

// ---------------- 附件 ----------------

// CreateAttachment 写入待上传/待绑定附件。
func (s *SQLStore) CreateAttachment(ctx context.Context, a Attachment) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO chat_direct_attachment
(id, conversation_id, message_id, media_type, provider, external_media_id, storage_key, thumbnail_key,
 mime_type, byte_size, duration_ms, width, height, status, created_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		a.ID, a.ConversationID, nullIfEmpty(a.MessageID), a.MediaType, a.Provider, nullIfEmpty(a.ExternalMediaID),
		nullIfEmpty(a.StorageKey), nullIfEmpty(a.ThumbnailKey), a.MimeType, a.ByteSize, a.DurationMS, a.Width, a.Height,
		a.Status, a.CreatedAt)
	return err
}

// GetAttachment 读取附件。
func (s *SQLStore) GetAttachment(ctx context.Context, id string) (Attachment, bool, error) {
	var a Attachment
	var messageID, external, storageKey, thumb sql.NullString
	var duration, width, height sql.NullInt64
	err := s.db.QueryRowContext(ctx, `SELECT id, conversation_id, message_id, media_type, provider,
external_media_id, storage_key, thumbnail_key, mime_type, byte_size, duration_ms, width, height, status, created_at
FROM chat_direct_attachment WHERE id = ?`, id).Scan(&a.ID, &a.ConversationID, &messageID, &a.MediaType,
		&a.Provider, &external, &storageKey, &thumb, &a.MimeType, &a.ByteSize, &duration, &width, &height,
		&a.Status, &a.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Attachment{}, false, nil
	}
	if err != nil {
		return Attachment{}, false, err
	}
	a.MessageID = messageID.String
	a.ExternalMediaID = external.String
	a.StorageKey = storageKey.String
	a.ThumbnailKey = thumb.String
	a.DurationMS = int(duration.Int64)
	a.Width = int(width.Int64)
	a.Height = int(height.Int64)
	return a, true, nil
}

// CompleteImageAttachment 记录图片实际落盘的元数据（服务端校验后的值）。
func (s *SQLStore) CompleteImageAttachment(ctx context.Context, id, storageKey, thumbKey, mime string, size int64, width, height int) error {
	result, err := s.db.ExecContext(ctx, `UPDATE chat_direct_attachment
SET storage_key = ?, thumbnail_key = NULLIF(?,''), mime_type = ?, byte_size = ?, width = ?, height = ?
WHERE id = ? AND status = 'uploaded' AND storage_key IS NULL`,
		storageKey, thumbKey, mime, size, width, height, id)
	if err != nil {
		return err
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		return errMediaIncomplete
	}
	return nil
}

// AttachmentsByIDs 批量读取附件。
func (s *SQLStore) AttachmentsByIDs(ctx context.Context, ids []string) (map[string]Attachment, error) {
	result := map[string]Attachment{}
	if len(ids) == 0 {
		return result, nil
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, conversation_id, media_type, provider, external_media_id,
storage_key, thumbnail_key, mime_type, byte_size, duration_ms, width, height, status
FROM chat_direct_attachment WHERE id IN (`+placeholders(len(ids))+`)`, toArgs(ids)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var a Attachment
		var external, storageKey, thumb sql.NullString
		var duration, width, height sql.NullInt64
		if err := rows.Scan(&a.ID, &a.ConversationID, &a.MediaType, &a.Provider, &external, &storageKey,
			&thumb, &a.MimeType, &a.ByteSize, &duration, &width, &height, &a.Status); err != nil {
			return nil, err
		}
		a.ExternalMediaID = external.String
		a.StorageKey = storageKey.String
		a.ThumbnailKey = thumb.String
		a.DurationMS = int(duration.Int64)
		a.Width = int(width.Int64)
		a.Height = int(height.Int64)
		result[a.ID] = a
	}
	return result, rows.Err()
}

// OrphanAttachments 返回超过时限仍未绑定消息的附件（供清理任务回收）。
func (s *SQLStore) OrphanAttachments(ctx context.Context, before time.Time, limit int) ([]Attachment, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, conversation_id, provider, storage_key, thumbnail_key
FROM chat_direct_attachment WHERE status = 'uploaded' AND message_id IS NULL AND created_at < ?
ORDER BY created_at LIMIT ?`, before, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []Attachment
	for rows.Next() {
		var a Attachment
		var storageKey, thumb sql.NullString
		if err := rows.Scan(&a.ID, &a.ConversationID, &a.Provider, &storageKey, &thumb); err != nil {
			return nil, err
		}
		a.StorageKey = storageKey.String
		a.ThumbnailKey = thumb.String
		items = append(items, a)
	}
	return items, rows.Err()
}

// DeleteAttachment 物理删除未绑定的孤儿附件记录。
func (s *SQLStore) DeleteAttachment(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM chat_direct_attachment WHERE id = ? AND message_id IS NULL`, id)
	return err
}

// CleanupSessions 删除过期会话。
func (s *SQLStore) CleanupSessions(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM chat_direct_session WHERE expires_at <= ?`, time.Now())
	return err
}

// ---------------- 通用小工具 ----------------

func placeholders(n int) string {
	if n <= 0 {
		return ""
	}
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}

func toArgs(values []string) []any {
	args := make([]any, len(values))
	for i, v := range values {
		args[i] = v
	}
	return args
}

func nullIfEmpty(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func escapeLike(value string) string {
	replacer := strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_")
	return replacer.Replace(value)
}

// previewText 生成会话列表的最后一条消息预览。
func previewText(m Message) string {
	switch m.MessageType {
	case MessageImage:
		return "[图片]"
	case MessageVoice:
		return "[语音]"
	case MessageTypeSystem:
		return m.Text
	default:
		return m.Text
	}
}
