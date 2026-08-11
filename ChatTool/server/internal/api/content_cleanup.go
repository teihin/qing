package api

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"chattool/internal/security"
)

type mediaFileTarget struct {
	ID             string
	ConversationID string
	StorageKey     string
}

type stagedMediaFile struct {
	original string
	staged   string
}

type contentPurgeResult struct {
	MessagesDeleted int64 `json:"messagesDeleted"`
	MediaDeleted    int64 `json:"mediaDeleted"`
	FilesDeleted    int   `json:"filesDeleted"`
}

func safeMediaStoragePath(uploadDir, storageKey string) (string, error) {
	clean := filepath.Clean(filepath.FromSlash(storageKey))
	if clean == "." || filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("unsafe media storage key %q", storageKey)
	}
	root := filepath.Clean(uploadDir)
	target := filepath.Join(root, clean)
	relative, err := filepath.Rel(root, target)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("media path escapes upload directory")
	}
	return target, nil
}

func (s *Server) stageMediaFiles(targets []mediaFileTarget) ([]stagedMediaFile, error) {
	suffix, err := security.RandomID()
	if err != nil {
		return nil, err
	}
	staged := make([]stagedMediaFile, 0, len(targets))
	for _, target := range targets {
		path, err := safeMediaStoragePath(s.cfg.UploadDir, target.StorageKey)
		if err != nil {
			restoreStagedMediaFiles(staged)
			return nil, err
		}
		info, err := os.Lstat(path)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			restoreStagedMediaFiles(staged)
			return nil, err
		}
		if !info.Mode().IsRegular() {
			restoreStagedMediaFiles(staged)
			return nil, fmt.Errorf("media target is not a regular file: %s", target.StorageKey)
		}
		stagedPath := path + ".purge-" + suffix
		if err := os.Rename(path, stagedPath); err != nil {
			restoreStagedMediaFiles(staged)
			return nil, err
		}
		staged = append(staged, stagedMediaFile{original: path, staged: stagedPath})
	}
	return staged, nil
}

func restoreStagedMediaFiles(files []stagedMediaFile) {
	for index := len(files) - 1; index >= 0; index-- {
		_ = os.Rename(files[index].staged, files[index].original)
	}
}

func (s *Server) discardStagedMediaFiles(files []stagedMediaFile) {
	for _, file := range files {
		if err := os.Remove(file.staged); err != nil && !errors.Is(err, os.ErrNotExist) {
			s.logger.Error("purged media file removal failed", "path", file.staged, "error", err)
		}
	}
}

func scanMediaTargets(rows *sql.Rows) ([]mediaFileTarget, error) {
	defer rows.Close()
	targets := make([]mediaFileTarget, 0)
	for rows.Next() {
		var target mediaFileTarget
		if err := rows.Scan(&target.ID, &target.ConversationID, &target.StorageKey); err != nil {
			return nil, err
		}
		targets = append(targets, target)
	}
	return targets, rows.Err()
}

func (s *Server) clearConversationContent(ctx context.Context, conversationID string) (contentPurgeResult, error) {
	result := contentPurgeResult{}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	var exists string
	if err := tx.QueryRowContext(ctx, `SELECT id FROM chat_conversation WHERE id=? FOR UPDATE`, conversationID).Scan(&exists); err != nil {
		return result, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT id,conversation_id,storage_key FROM chat_media WHERE conversation_id=? FOR UPDATE`, conversationID)
	if err != nil {
		return result, err
	}
	targets, err := scanMediaTargets(rows)
	if err != nil {
		return result, err
	}
	staged, err := s.stageMediaFiles(targets)
	if err != nil {
		return result, err
	}
	committed := false
	defer func() {
		if !committed {
			restoreStagedMediaFiles(staged)
		}
	}()
	messageResult, err := tx.ExecContext(ctx, `DELETE FROM chat_message WHERE conversation_id=?`, conversationID)
	if err != nil {
		return result, err
	}
	mediaResult, err := tx.ExecContext(ctx, `DELETE FROM chat_media WHERE conversation_id=?`, conversationID)
	if err != nil {
		return result, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE chat_conversation SET last_message_at=NOW(),agent_last_read_at=NOW(),player_last_read_at=NOW(),updated_at=NOW() WHERE id=?`, conversationID); err != nil {
		return result, err
	}
	if err := tx.Commit(); err != nil {
		return result, err
	}
	committed = true
	result.MessagesDeleted, _ = messageResult.RowsAffected()
	result.MediaDeleted, _ = mediaResult.RowsAffected()
	result.FilesDeleted = len(staged)
	s.discardStagedMediaFiles(staged)
	return result, nil
}

func (s *Server) purgeExpiredMediaBatch(ctx context.Context, cutoff time.Time, limit int) (contentPurgeResult, []string, error) {
	result := contentPurgeResult{}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return result, nil, err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `SELECT id,conversation_id,storage_key FROM chat_media WHERE created_at < ? ORDER BY created_at,id LIMIT ? FOR UPDATE`, cutoff, limit)
	if err != nil {
		return result, nil, err
	}
	targets, err := scanMediaTargets(rows)
	if err != nil || len(targets) == 0 {
		return result, nil, err
	}
	staged, err := s.stageMediaFiles(targets)
	if err != nil {
		return result, nil, err
	}
	committed := false
	defer func() {
		if !committed {
			restoreStagedMediaFiles(staged)
		}
	}()
	affectedSet := make(map[string]struct{})
	for _, target := range targets {
		affectedSet[target.ConversationID] = struct{}{}
		messageResult, err := tx.ExecContext(ctx, `DELETE FROM chat_message WHERE media_id=?`, target.ID)
		if err != nil {
			return result, nil, err
		}
		changed, _ := messageResult.RowsAffected()
		result.MessagesDeleted += changed
		mediaResult, err := tx.ExecContext(ctx, `DELETE FROM chat_media WHERE id=?`, target.ID)
		if err != nil {
			return result, nil, err
		}
		changed, _ = mediaResult.RowsAffected()
		result.MediaDeleted += changed
	}
	if err := tx.Commit(); err != nil {
		return result, nil, err
	}
	committed = true
	result.FilesDeleted = len(staged)
	s.discardStagedMediaFiles(staged)
	affected := make([]string, 0, len(affectedSet))
	for conversationID := range affectedSet {
		affected = append(affected, conversationID)
	}
	return result, affected, nil
}

func (s *Server) purgeExpiredContent(ctx context.Context, cutoff time.Time) (contentPurgeResult, []string, error) {
	total := contentPurgeResult{}
	affectedSet := make(map[string]struct{})
	for batch := 0; batch < 20; batch++ {
		result, affected, err := s.purgeExpiredMediaBatch(ctx, cutoff, 500)
		if err != nil {
			return total, nil, err
		}
		total.MessagesDeleted += result.MessagesDeleted
		total.MediaDeleted += result.MediaDeleted
		total.FilesDeleted += result.FilesDeleted
		for _, conversationID := range affected {
			affectedSet[conversationID] = struct{}{}
		}
		if result.MediaDeleted == 0 {
			break
		}
	}
	rows, err := s.db.QueryContext(ctx, `SELECT DISTINCT m.conversation_id FROM chat_message m
LEFT JOIN chat_media media ON media.id=m.media_id
WHERE m.created_at < ? AND (m.media_id IS NULL OR media.id IS NULL)`, cutoff)
	if err != nil {
		return total, nil, err
	}
	for rows.Next() {
		var conversationID string
		if err := rows.Scan(&conversationID); err != nil {
			rows.Close()
			return total, nil, err
		}
		affectedSet[conversationID] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return total, nil, err
	}
	if err := rows.Close(); err != nil {
		return total, nil, err
	}
	messageResult, err := s.db.ExecContext(ctx, `DELETE m FROM chat_message m
LEFT JOIN chat_media media ON media.id=m.media_id
WHERE m.created_at < ? AND (m.media_id IS NULL OR media.id IS NULL)`, cutoff)
	if err != nil {
		return total, nil, err
	}
	changed, _ := messageResult.RowsAffected()
	total.MessagesDeleted += changed
	affected := make([]string, 0, len(affectedSet))
	for conversationID := range affectedSet {
		affected = append(affected, conversationID)
	}
	return total, affected, nil
}

func (s *Server) publishConversationCleared(ctx context.Context, conversationID string) {
	s.hub.publish("player-conversation:"+conversationID, liveEvent{Type: "conversation.cleared", ConversationID: conversationID})
	s.publishConversationEvent(ctx, conversationID, liveEvent{Type: "conversation.cleared", ConversationID: conversationID})
}

func (s *Server) handleAgentClearConversation(w http.ResponseWriter, r *http.Request, p agentPrincipal) {
	conversationID := r.PathValue("id")
	if err := s.ensureAgentCanAccess(r, p, conversationID); err != nil {
		writeError(w, http.StatusNotFound, "CONVERSATION_NOT_FOUND", "会话不存在或无权清空")
		return
	}
	var req struct {
		Confirm bool `json:"confirm"`
	}
	if !decodeJSON(w, r, &req, 4<<10) {
		return
	}
	if !req.Confirm {
		writeError(w, http.StatusBadRequest, "CONFIRM_REQUIRED", "清空聊天记录需要明确确认")
		return
	}
	result, err := s.clearConversationContent(r.Context(), conversationID)
	if err != nil {
		s.logger.Error("conversation content clear failed", "conversation_id", conversationID, "error", err)
		writeError(w, http.StatusInternalServerError, "CLEAR_FAILED", "聊天记录清空失败，请稍后重试")
		return
	}
	s.audit(r.Context(), "agent", strconv.FormatInt(p.ID, 10), "conversation.content_clear", "conversation", conversationID, result, clientIP(r))
	s.publishConversationCleared(r.Context(), conversationID)
	writeData(w, http.StatusOK, result)
}
