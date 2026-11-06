package directchat

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

// 客服工作台的托管展示偏好（玩家备注、会话置顶）与单会话删除。
// 单独拆接口，避免给既有的 HostingStore / Store 内存测试实现增加负担。

// 托管置顶的三级目标：一级分组（联盟/俱乐部）、二级托管账号（盟主/群主）、三级会话。
const (
	HostedPinConversation = "conversation"
	HostedPinOwner        = "owner"
	HostedPinGroup        = "group"
)

// HostedPrefsStore 保存全团队共享的备注与置顶。
type HostedPrefsStore interface {
	PlayerRemarks(ctx context.Context, playerIDs []string) (map[string]string, error)
	SetPlayerRemark(ctx context.Context, playerID, remark string, agentID int64, agentName string) error
	HostedPins(ctx context.Context, targetType string, targetIDs []string) (map[string]time.Time, error)
	SetHostedPin(ctx context.Context, targetType, targetID string, pinned bool, agentID int64, agentName string) error
	DeleteHostedConversation(ctx context.Context, hostedGuuid, conversationID string) ([]string, error)
}

func (s *SQLStore) PlayerRemarks(ctx context.Context, playerIDs []string) (map[string]string, error) {
	result := map[string]string{}
	ids := uniqueStrings(playerIDs)
	if len(ids) == 0 {
		return result, nil
	}
	rows, err := s.db.QueryContext(ctx, `SELECT player_id, remark FROM chat_direct_player_remark
WHERE player_id IN (`+placeholders(len(ids))+`)`, toArgs(ids)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var playerID, remark string
		if err := rows.Scan(&playerID, &remark); err != nil {
			return nil, err
		}
		if strings.TrimSpace(remark) != "" {
			result[playerID] = remark
		}
	}
	return result, rows.Err()
}

func (s *SQLStore) SetPlayerRemark(ctx context.Context, playerID, remark string, agentID int64, agentName string) error {
	playerID = strings.TrimSpace(playerID)
	if playerID == "" {
		return newError(400, "INVALID_REQUEST", "缺少玩家ID")
	}
	remark = strings.TrimSpace(remark)
	if remark == "" {
		_, err := s.db.ExecContext(ctx, `DELETE FROM chat_direct_player_remark WHERE player_id = ?`, playerID)
		return err
	}
	var updatedBy any
	if agentID > 0 {
		updatedBy = agentID
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO chat_direct_player_remark
(player_id, remark, updated_by, updated_by_name, updated_at) VALUES (?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE remark = VALUES(remark), updated_by = VALUES(updated_by),
updated_by_name = VALUES(updated_by_name), updated_at = VALUES(updated_at)`,
		playerID, remark, updatedBy, strings.TrimSpace(agentName), time.Now())
	return err
}

func (s *SQLStore) HostedPins(ctx context.Context, targetType string, targetIDs []string) (map[string]time.Time, error) {
	result := map[string]time.Time{}
	ids := uniqueStrings(targetIDs)
	targetType = strings.TrimSpace(targetType)
	if len(ids) == 0 || targetType == "" {
		return result, nil
	}
	args := append([]any{targetType}, toArgs(ids)...)
	rows, err := s.db.QueryContext(ctx, `SELECT target_id, pinned_at FROM chat_direct_hosted_pin_target
WHERE target_type = ? AND target_id IN (`+placeholders(len(ids))+`)`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var targetID string
		var pinnedAt time.Time
		if err := rows.Scan(&targetID, &pinnedAt); err != nil {
			return nil, err
		}
		result[targetID] = pinnedAt
	}
	return result, rows.Err()
}

func (s *SQLStore) SetHostedPin(ctx context.Context, targetType, targetID string, pinned bool, agentID int64, agentName string) error {
	targetType = strings.TrimSpace(targetType)
	targetID = strings.TrimSpace(targetID)
	switch targetType {
	case HostedPinConversation, HostedPinOwner, HostedPinGroup:
	default:
		return newError(400, "INVALID_REQUEST", "置顶类型不正确")
	}
	if targetID == "" {
		return newError(400, "INVALID_REQUEST", "缺少置顶对象")
	}
	if !pinned {
		_, err := s.db.ExecContext(ctx, `DELETE FROM chat_direct_hosted_pin_target
WHERE target_type = ? AND target_id = ?`, targetType, targetID)
		return err
	}
	var pinnedBy any
	if agentID > 0 {
		pinnedBy = agentID
	}
	// 重复置顶不改时间，保证「置顶顺序」稳定。
	_, err := s.db.ExecContext(ctx, `INSERT IGNORE INTO chat_direct_hosted_pin_target
(target_type, target_id, pinned_by, pinned_by_name, pinned_at) VALUES (?, ?, ?, ?, ?)`,
		targetType, targetID, pinnedBy, strings.TrimSpace(agentName), time.Now())
	return err
}

// DeleteHostedConversation 永久删除单条托管会话，返回需要清理的媒体文件 key。
// 只允许删除属于该托管账号的会话，避免拿着别人的会话 ID 越权删除。
func (s *SQLStore) DeleteHostedConversation(ctx context.Context, hostedGuuid, conversationID string) ([]string, error) {
	hostedGuuid = strings.TrimSpace(hostedGuuid)
	conversationID = strings.TrimSpace(conversationID)
	if hostedGuuid == "" || conversationID == "" {
		return nil, newError(400, "INVALID_REQUEST", "缺少会话或托管账号")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var id string
	err = tx.QueryRowContext(ctx, `SELECT id FROM chat_direct_conversation
WHERE id = ? AND (low_guuid = ? OR high_guuid = ?) FOR UPDATE`, conversationID, hostedGuuid, hostedGuuid).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, newError(404, "CONVERSATION_NOT_FOUND", "会话不存在或不属于该托管账号")
	}
	if err != nil {
		return nil, err
	}
	mediaKeys := []string{}
	rows, err := tx.QueryContext(ctx, `SELECT storage_key, thumbnail_key FROM chat_direct_attachment
WHERE conversation_id = ?`, conversationID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var storageKey, thumbnailKey sql.NullString
		if err := rows.Scan(&storageKey, &thumbnailKey); err != nil {
			rows.Close()
			return nil, err
		}
		if storageKey.Valid && storageKey.String != "" {
			mediaKeys = append(mediaKeys, storageKey.String)
		}
		if thumbnailKey.Valid && thumbnailKey.String != "" {
			mediaKeys = append(mediaKeys, thumbnailKey.String)
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	for _, statement := range []string{
		`DELETE FROM chat_direct_message WHERE conversation_id = ?`,
		`DELETE FROM chat_direct_attachment WHERE conversation_id = ?`,
		`DELETE FROM chat_direct_participant WHERE conversation_id = ?`,
		`DELETE FROM chat_direct_hosting_read WHERE conversation_id = ?`,
		`DELETE FROM chat_direct_hosted_pin_target WHERE target_type = 'conversation' AND target_id = ?`,
		`DELETE FROM chat_direct_conversation WHERE id = ?`,
	} {
		if _, err := tx.ExecContext(ctx, statement, conversationID); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return mediaKeys, nil
}

func uniqueStrings(values []string) []string {
	seen := map[string]bool{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}
