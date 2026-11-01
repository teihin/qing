package directchat

import (
	"context"
	"database/sql"
	"time"
)

// CleanupOnce 按保留期清理直聊消息与附件，并回收孤儿媒体。
//
// 清理顺序固定为「先确认消息与媒体的绑定、删文件、再删记录」，避免只删数据库
// 记录而在磁盘上留下无法追踪的文件。语音由 AudioServer 自己的保留期负责，
// 这里只删除 ChatTool 侧的附件记录。
func (s *SQLStore) CleanupOnce(ctx context.Context, media *MediaStorage, retention time.Duration) error {
	if retention <= 0 {
		return nil
	}
	cutoff := time.Now().Add(-retention)
	for {
		messages, err := s.expiredMessages(ctx, cutoff, 200)
		if err != nil {
			return err
		}
		if len(messages) == 0 {
			break
		}
		ids := make([]string, 0, len(messages))
		for _, m := range messages {
			ids = append(ids, m.ID)
		}
		attachments, err := s.attachmentsOfMessages(ctx, ids)
		if err != nil {
			return err
		}
		for _, a := range attachments {
			if a.Provider == ProviderChatStorage && media != nil {
				media.Remove(a.StorageKey, a.ThumbnailKey)
			}
			if _, err := s.db.ExecContext(ctx, `DELETE FROM chat_direct_attachment WHERE id = ?`, a.ID); err != nil {
				return err
			}
		}
		if _, err := s.db.ExecContext(ctx, `DELETE FROM chat_direct_message WHERE id IN (`+placeholders(len(ids))+`)`,
			toArgs(ids)...); err != nil {
			return err
		}
		// 会话的 last_message 指向已删除消息时清空，避免列表显示不存在的预览。
		if _, err := s.db.ExecContext(ctx, `UPDATE chat_direct_conversation c
LEFT JOIN chat_direct_message m ON m.id = c.last_message_id
SET c.last_message_id = NULL, c.last_message_at = NULL
WHERE c.last_message_id IS NOT NULL AND m.id IS NULL`); err != nil {
			return err
		}
		if len(messages) < 200 {
			break
		}
	}
	return s.cleanupOrphanAttachments(ctx, media)
}

// cleanupOrphanAttachments 回收创建后一小时仍未绑定消息的附件（上传失败、用户中途取消）。
func (s *SQLStore) cleanupOrphanAttachments(ctx context.Context, media *MediaStorage) error {
	items, err := s.OrphanAttachments(ctx, time.Now().Add(-time.Hour), 200)
	if err != nil {
		return err
	}
	for _, item := range items {
		if item.Provider == ProviderChatStorage && media != nil {
			media.Remove(item.StorageKey, item.ThumbnailKey)
		}
		if err := s.DeleteAttachment(ctx, item.ID); err != nil {
			return err
		}
	}
	return nil
}

type expiredMessage struct{ ID, ConversationID string }

func (s *SQLStore) expiredMessages(ctx context.Context, before time.Time, limit int) ([]expiredMessage, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, conversation_id FROM chat_direct_message
WHERE created_at < ? ORDER BY created_at LIMIT ?`, before, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []expiredMessage
	for rows.Next() {
		var item expiredMessage
		if err := rows.Scan(&item.ID, &item.ConversationID); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *SQLStore) attachmentsOfMessages(ctx context.Context, ids []string) ([]Attachment, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, provider, COALESCE(storage_key,''), COALESCE(thumbnail_key,'')
FROM chat_direct_attachment WHERE message_id IN (`+placeholders(len(ids))+`)`, toArgs(ids)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []Attachment
	for rows.Next() {
		var a Attachment
		var storageKey, thumb sql.NullString
		if err := rows.Scan(&a.ID, &a.Provider, &storageKey, &thumb); err != nil {
			return nil, err
		}
		a.StorageKey = storageKey.String
		a.ThumbnailKey = thumb.String
		items = append(items, a)
	}
	return items, rows.Err()
}
