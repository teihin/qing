package api

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"chattool/internal/security"
)

type messageItem struct {
	ID             string     `json:"id"`
	ConversationID string     `json:"conversationId"`
	SenderType     string     `json:"senderType"`
	SenderID       string     `json:"senderId"`
	SenderName     string     `json:"senderName"`
	MessageType    string     `json:"messageType"`
	Text           string     `json:"text"`
	MediaID        *string    `json:"mediaId"`
	MediaName      *string    `json:"mediaName"`
	MediaMIME      *string    `json:"mediaMime"`
	MediaSize      *int64     `json:"mediaSize"`
	CreatedAt      time.Time  `json:"createdAt"`
	RecalledAt     *time.Time `json:"recalledAt"`
}

func (s *Server) handlePlayerMessages(w http.ResponseWriter, r *http.Request, p playerPrincipal) {
	messages, err := s.listMessages(r, p.ConversationID, false)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "无法读取聊天记录")
		return
	}
	writeData(w, http.StatusOK, map[string]any{"items": messages})
}

func (s *Server) handleAgentMessages(w http.ResponseWriter, r *http.Request, p agentPrincipal) {
	conversationID := r.PathValue("id")
	if err := s.ensureAgentCanAccess(r, p, conversationID); err != nil {
		writeError(w, http.StatusNotFound, "CONVERSATION_NOT_FOUND", "会话不存在或不属于当前客服")
		return
	}
	messages, err := s.listMessages(r, conversationID, true)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "无法读取聊天记录")
		return
	}
	writeData(w, http.StatusOK, map[string]any{"items": messages})
}

func (s *Server) listMessages(r *http.Request, conversationID string, includeNotes bool) ([]messageItem, error) {
	query := `SELECT m.id, m.conversation_id, m.sender_type, m.sender_id, m.sender_name, m.message_type,
m.text_content, m.media_id, media.original_name, media.mime_type, media.size_bytes, m.created_at, m.recalled_at
FROM chat_message m LEFT JOIN chat_media media ON media.id = m.media_id
WHERE m.conversation_id = ?`
	if !includeNotes {
		query += " AND m.sender_type <> 'note'"
	}
	query += " ORDER BY m.created_at ASC, m.id ASC LIMIT 500"
	rows, err := s.db.QueryContext(r.Context(), query, conversationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]messageItem, 0)
	for rows.Next() {
		var item messageItem
		var mediaID, mediaName, mediaMIME sql.NullString
		var mediaSize sql.NullInt64
		var recalled sql.NullTime
		if err := rows.Scan(&item.ID, &item.ConversationID, &item.SenderType, &item.SenderID, &item.SenderName,
			&item.MessageType, &item.Text, &mediaID, &mediaName, &mediaMIME, &mediaSize, &item.CreatedAt, &recalled); err != nil {
			return nil, err
		}
		if mediaID.Valid {
			item.MediaID = &mediaID.String
		}
		if mediaName.Valid {
			item.MediaName = &mediaName.String
		}
		if mediaMIME.Valid {
			item.MediaMIME = &mediaMIME.String
		}
		if mediaSize.Valid {
			item.MediaSize = &mediaSize.Int64
		}
		if recalled.Valid {
			item.RecalledAt = &recalled.Time
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

type sendMessageRequest struct {
	Text            string `json:"text"`
	ClientMessageID string `json:"clientMessageId"`
	InternalNote    bool   `json:"internalNote,omitempty"`
}

func (s *Server) handlePlayerSendMessage(w http.ResponseWriter, r *http.Request, p playerPrincipal) {
	if !s.messageLimiter.Allow("player:" + p.PlayerID) {
		writeError(w, http.StatusTooManyRequests, "MESSAGE_RATE_LIMITED", "发送过于频繁，请稍后再试")
		return
	}
	var req sendMessageRequest
	if !decodeJSON(w, r, &req, 32<<10) {
		return
	}
	text, err := requireText(req.Text, 2000)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_MESSAGE", err.Error())
		return
	}
	item, err := s.insertMessage(r, p.ConversationID, "player", p.PlayerID, p.Nickname, "text", text, "", req.ClientMessageID)
	if errors.Is(err, errNoOnlineAgent) {
		writeError(w, http.StatusConflict, "NO_AGENT_ONLINE", "当前没有客服在线，暂时无法发送消息")
		return
	}
	if errors.Is(err, errConversationClosed) {
		writeError(w, http.StatusConflict, "CONVERSATION_CLOSED", "本次咨询已经结束，请返回游戏重新进入客服")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "消息发送失败")
		return
	}
	s.notifyConversation(r, p.ConversationID, item)
	writeData(w, http.StatusCreated, item)
}

func (s *Server) handleAgentSendMessage(w http.ResponseWriter, r *http.Request, p agentPrincipal) {
	conversationID := r.PathValue("id")
	if err := s.ensureAgentCanAccess(r, p, conversationID); err != nil {
		writeError(w, http.StatusNotFound, "CONVERSATION_NOT_FOUND", "会话不存在或不属于当前客服")
		return
	}
	var req sendMessageRequest
	if !decodeJSON(w, r, &req, 32<<10) {
		return
	}
	text, err := requireText(req.Text, 2000)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_MESSAGE", err.Error())
		return
	}
	senderType, messageType := "agent", "text"
	if req.InternalNote {
		senderType, messageType = "note", "note"
	}
	item, err := s.insertMessage(r, conversationID, senderType, strconv.FormatInt(p.ID, 10), p.DisplayName, messageType, text, "", req.ClientMessageID)
	if errors.Is(err, errConversationClosed) {
		writeError(w, http.StatusConflict, "CONVERSATION_CLOSED", "会话已经结束")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "消息发送失败")
		return
	}
	if !req.InternalNote {
		s.hub.publish("player-conversation:"+conversationID, liveEvent{Type: "message.created", ConversationID: conversationID, Payload: item})
	}
	s.publishConversationEvent(r.Context(), conversationID, liveEvent{Type: "conversation.changed", ConversationID: conversationID})
	writeData(w, http.StatusCreated, item)
}

var (
	errConversationClosed = errors.New("conversation closed")
	errNoOnlineAgent      = errors.New("no agent online")
)

func (s *Server) insertMessage(r *http.Request, conversationID, senderType, senderID, senderName, messageType, text, mediaID, clientMessageID string) (messageItem, error) {
	deduplicateByClientID := clientMessageID != "" && len(clientMessageID) <= 64
	if !deduplicateByClientID {
		clientMessageID = ""
	}
	messageID, err := security.RandomID()
	if err != nil {
		return messageItem{}, err
	}
	if clientMessageID == "" {
		clientMessageID = messageID
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		return messageItem{}, err
	}
	defer tx.Rollback()
	var status, channelCode string
	if err = tx.QueryRowContext(r.Context(), `SELECT status,channel_code FROM chat_conversation WHERE id=? FOR UPDATE`, conversationID).Scan(&status, &channelCode); err != nil {
		return messageItem{}, err
	}
	if status == "closed" {
		return messageItem{}, errConversationClosed
	}
	if senderType == "player" {
		if err = s.lockOnlineAgent(r.Context(), tx, channelCode); err != nil {
			return messageItem{}, err
		}
	}
	var media any
	if mediaID != "" {
		media = mediaID
	}
	_, err = tx.ExecContext(r.Context(), `INSERT INTO chat_message
(id, conversation_id, sender_type, sender_id, sender_name, message_type, text_content, media_id, client_message_id, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`, messageID, conversationID, senderType, senderID, senderName, messageType, text, media, clientMessageID)
	if err != nil {
		if deduplicateByClientID && strings.Contains(strings.ToLower(err.Error()), "duplicate") {
			var existing messageItem
			err = tx.QueryRowContext(r.Context(), `SELECT id, conversation_id, sender_type, sender_id, sender_name, message_type, text_content, created_at
FROM chat_message WHERE conversation_id=? AND sender_type=? AND client_message_id=?`, conversationID, senderType, clientMessageID).Scan(
				&existing.ID, &existing.ConversationID, &existing.SenderType, &existing.SenderID, &existing.SenderName, &existing.MessageType, &existing.Text, &existing.CreatedAt)
			return existing, err
		}
		return messageItem{}, err
	}
	if senderType == "agent" {
		_, err = tx.ExecContext(r.Context(), `UPDATE chat_conversation SET last_message_at=NOW(), first_response_at=COALESCE(first_response_at,NOW()), updated_at=NOW() WHERE id=?`, conversationID)
	} else {
		_, err = tx.ExecContext(r.Context(), `UPDATE chat_conversation SET last_message_at=NOW(), updated_at=NOW() WHERE id=?`, conversationID)
	}
	if err != nil {
		return messageItem{}, err
	}
	if err = tx.Commit(); err != nil {
		return messageItem{}, err
	}
	return messageItem{ID: messageID, ConversationID: conversationID, SenderType: senderType, SenderID: senderID,
		SenderName: senderName, MessageType: messageType, Text: text, CreatedAt: time.Now()}, nil
}

func (s *Server) notifyConversation(r *http.Request, conversationID string, item messageItem) {
	var agentID sql.NullInt64
	_ = s.db.QueryRowContext(r.Context(), `SELECT assigned_agent_id FROM chat_conversation WHERE id=?`, conversationID).Scan(&agentID)
	if agentID.Valid {
		s.hub.publish("agent:"+strconv.FormatInt(agentID.Int64, 10), liveEvent{Type: "message.created", ConversationID: conversationID, Payload: item})
	} else {
		// 尚未分配客服时，只提醒同通道在线工作台；分配后只提醒当前接待客服。
		s.publishConversationEvent(r.Context(), conversationID, liveEvent{Type: "message.created", ConversationID: conversationID, Payload: item})
	}
	s.publishConversationEvent(r.Context(), conversationID, liveEvent{Type: "conversation.changed", ConversationID: conversationID})
}

func (s *Server) handlePlayerUpload(w http.ResponseWriter, r *http.Request, p playerPrincipal) {
	if !s.messageLimiter.Allow("upload:" + p.PlayerID) {
		writeError(w, http.StatusTooManyRequests, "UPLOAD_RATE_LIMITED", "上传过于频繁，请稍后再试")
		return
	}
	item, err := s.saveUpload(w, r, p.ConversationID, "player", p.PlayerID, p.Nickname)
	if err != nil {
		s.writeUploadError(w, err)
		return
	}
	s.notifyConversation(r, p.ConversationID, item)
	writeData(w, http.StatusCreated, item)
}

func (s *Server) handleAgentUpload(w http.ResponseWriter, r *http.Request, p agentPrincipal) {
	conversationID := r.PathValue("id")
	if err := s.ensureAgentCanAccess(r, p, conversationID); err != nil {
		writeError(w, http.StatusNotFound, "CONVERSATION_NOT_FOUND", "会话不存在或不属于当前客服")
		return
	}
	item, err := s.saveUpload(w, r, conversationID, "agent", strconv.FormatInt(p.ID, 10), p.DisplayName)
	if err != nil {
		s.writeUploadError(w, err)
		return
	}
	s.hub.publish("player-conversation:"+conversationID, liveEvent{Type: "message.created", ConversationID: conversationID, Payload: item})
	s.publishConversationEvent(r.Context(), conversationID, liveEvent{Type: "conversation.changed", ConversationID: conversationID})
	writeData(w, http.StatusCreated, item)
}

type uploadError struct {
	status        int
	code, message string
}

func (e uploadError) Error() string { return e.message }

func (s *Server) writeUploadError(w http.ResponseWriter, err error) {
	var typed uploadError
	if errors.As(err, &typed) {
		writeError(w, typed.status, typed.code, typed.message)
		return
	}
	s.logger.Error("upload failed", "error", err)
	writeError(w, http.StatusInternalServerError, "UPLOAD_FAILED", "文件上传失败")
}

func (s *Server) saveUpload(w http.ResponseWriter, r *http.Request, conversationID, uploaderType, uploaderID, uploaderName string) (messageItem, error) {
	var status, channelCode string
	if err := s.db.QueryRowContext(r.Context(), `SELECT status,channel_code FROM chat_conversation WHERE id=?`, conversationID).Scan(&status, &channelCode); err != nil {
		return messageItem{}, err
	}
	if status == "closed" {
		return messageItem{}, uploadError{http.StatusConflict, "CONVERSATION_CLOSED", "会话已经结束"}
	}
	if uploaderType == "player" {
		var online int
		cutoff := time.Now().Add(-s.cfg.AgentOfflineAfter)
		if err := s.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM chat_agent
WHERE channel_code=? AND enabled=1 AND presence='online' AND last_seen_at>=?
AND EXISTS (SELECT 1 FROM chat_agent_session sess WHERE sess.agent_id=chat_agent.id AND sess.expires_at>NOW())`, channelCode, cutoff).Scan(&online); err != nil {
			return messageItem{}, err
		}
		if online == 0 {
			return messageItem{}, uploadError{http.StatusConflict, "NO_AGENT_ONLINE", "当前没有客服在线，暂时无法发送文件"}
		}
	}
	maxRequest := s.cfg.MaxVideoBytes
	if s.cfg.MaxImageBytes > maxRequest {
		maxRequest = s.cfg.MaxImageBytes
	}
	if s.cfg.MaxFileBytes > maxRequest {
		maxRequest = s.cfg.MaxFileBytes
	}
	maxRequest += 1 << 20
	r.Body = http.MaxBytesReader(w, r.Body, maxRequest)
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		return messageItem{}, uploadError{http.StatusRequestEntityTooLarge, "FILE_TOO_LARGE", "文件超过允许的大小"}
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		return messageItem{}, uploadError{http.StatusBadRequest, "FILE_REQUIRED", "请选择要发送的文件"}
	}
	defer file.Close()
	first := make([]byte, 512)
	n, readErr := io.ReadFull(file, first)
	if readErr != nil && readErr != io.ErrUnexpectedEOF {
		return messageItem{}, readErr
	}
	first = first[:n]
	mimeType := http.DetectContentType(first)
	kind, maxBytes, extension, ok := classifyUpload(mimeType)
	if !ok {
		return messageItem{}, uploadError{http.StatusUnsupportedMediaType, "UNSUPPORTED_FILE", "暂不支持此文件格式"}
	}
	switch kind {
	case "image":
		if s.cfg.MaxImageBytes < maxBytes {
			maxBytes = s.cfg.MaxImageBytes
		}
	case "video":
		if s.cfg.MaxVideoBytes < maxBytes {
			maxBytes = s.cfg.MaxVideoBytes
		}
	case "file":
		if s.cfg.MaxFileBytes < maxBytes {
			maxBytes = s.cfg.MaxFileBytes
		}
	}
	if header.Size > maxBytes {
		return messageItem{}, uploadError{http.StatusRequestEntityTooLarge, "FILE_TOO_LARGE", fmt.Sprintf("文件不能超过 %d MB", maxBytes>>20)}
	}
	mediaID, err := security.RandomID()
	if err != nil {
		return messageItem{}, err
	}
	messageID, err := security.RandomID()
	if err != nil {
		return messageItem{}, err
	}
	dateDir := time.Now().Format("2006/01/02")
	storageKey := filepath.ToSlash(filepath.Join(dateDir, mediaID+extension))
	targetDir := filepath.Join(s.cfg.UploadDir, filepath.FromSlash(dateDir))
	if err := os.MkdirAll(targetDir, 0o700); err != nil {
		return messageItem{}, err
	}
	tempPath := filepath.Join(targetDir, "."+mediaID+".part")
	targetPath := filepath.Join(s.cfg.UploadDir, filepath.FromSlash(storageKey))
	out, err := os.OpenFile(tempPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return messageItem{}, err
	}
	defer func() { out.Close(); os.Remove(tempPath) }()
	hash := sha256.New()
	reader := io.MultiReader(strings.NewReader(string(first)), file)
	written, err := io.Copy(io.MultiWriter(out, hash), io.LimitReader(reader, maxBytes+1))
	if err != nil {
		return messageItem{}, err
	}
	if written > maxBytes {
		return messageItem{}, uploadError{http.StatusRequestEntityTooLarge, "FILE_TOO_LARGE", "文件超过允许的大小"}
	}
	if err := out.Sync(); err != nil {
		return messageItem{}, err
	}
	if err := out.Close(); err != nil {
		return messageItem{}, err
	}
	originalName := sanitizeFilename(header.Filename)
	if originalName == "" {
		originalName = "文件" + extension
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		return messageItem{}, err
	}
	defer tx.Rollback()
	if err = tx.QueryRowContext(r.Context(), `SELECT status,channel_code FROM chat_conversation WHERE id=? FOR UPDATE`, conversationID).Scan(&status, &channelCode); err != nil {
		return messageItem{}, err
	}
	if status == "closed" {
		return messageItem{}, uploadError{http.StatusConflict, "CONVERSATION_CLOSED", "会话已经结束"}
	}
	if uploaderType == "player" {
		if err = s.lockOnlineAgent(r.Context(), tx, channelCode); errors.Is(err, errNoOnlineAgent) {
			return messageItem{}, uploadError{http.StatusConflict, "NO_AGENT_ONLINE", "当前没有客服在线，暂时无法发送文件"}
		} else if err != nil {
			return messageItem{}, err
		}
	}
	_, err = tx.ExecContext(r.Context(), `INSERT INTO chat_media
(id, conversation_id, uploader_type, uploader_id, original_name, storage_key, mime_type, size_bytes, sha256, media_kind, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`, mediaID, conversationID, uploaderType, uploaderID, originalName, storageKey,
		mimeType, written, hex.EncodeToString(hash.Sum(nil)), kind)
	if err == nil {
		_, err = tx.ExecContext(r.Context(), `INSERT INTO chat_message
(id, conversation_id, sender_type, sender_id, sender_name, message_type, text_content, media_id, client_message_id, created_at)
VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, NOW())`, messageID, conversationID, uploaderType, uploaderID, uploaderName, kind, mediaID, messageID)
	}
	if err == nil {
		if uploaderType == "agent" {
			_, err = tx.ExecContext(r.Context(), `UPDATE chat_conversation SET last_message_at=NOW(), first_response_at=COALESCE(first_response_at,NOW()), updated_at=NOW() WHERE id=?`, conversationID)
		} else {
			_, err = tx.ExecContext(r.Context(), `UPDATE chat_conversation SET last_message_at=NOW(), updated_at=NOW() WHERE id=?`, conversationID)
		}
	}
	if err != nil {
		return messageItem{}, err
	}
	if err = os.Rename(tempPath, targetPath); err != nil {
		return messageItem{}, err
	}
	if err = tx.Commit(); err != nil {
		os.Remove(targetPath)
		return messageItem{}, err
	}
	return messageItem{ID: messageID, ConversationID: conversationID, SenderType: uploaderType, SenderID: uploaderID,
		SenderName: uploaderName, MessageType: kind, MediaID: &mediaID, MediaName: &originalName, MediaMIME: &mimeType,
		MediaSize: &written, CreatedAt: time.Now()}, nil
}

func (s *Server) lockOnlineAgent(ctx context.Context, tx *sql.Tx, channelCode string) error {
	var agentID int64
	cutoff := time.Now().Add(-s.cfg.AgentOfflineAfter)
	err := tx.QueryRowContext(ctx, `SELECT a.id FROM chat_agent a
JOIN chat_agent_session sess ON sess.agent_id=a.id AND sess.expires_at>NOW()
WHERE a.channel_code=? AND a.enabled=1 AND a.presence='online' AND a.last_seen_at>=?
ORDER BY a.id LIMIT 1 FOR UPDATE`, channelCode, cutoff).Scan(&agentID)
	if errors.Is(err, sql.ErrNoRows) {
		return errNoOnlineAgent
	}
	return err
}

func classifyUpload(mimeType string) (kind string, maxBytes int64, extension string, ok bool) {
	switch mimeType {
	case "image/jpeg":
		return "image", 10 << 20, ".jpg", true
	case "image/png":
		return "image", 10 << 20, ".png", true
	case "image/gif":
		return "image", 10 << 20, ".gif", true
	case "image/webp":
		return "image", 10 << 20, ".webp", true
	case "video/mp4":
		return "video", 100 << 20, ".mp4", true
	case "video/webm":
		return "video", 100 << 20, ".webm", true
	case "video/quicktime":
		return "video", 100 << 20, ".mov", true
	case "application/pdf":
		return "file", 25 << 20, ".pdf", true
	case "text/plain; charset=utf-8", "text/plain; charset=us-ascii":
		return "file", 25 << 20, ".txt", true
	case "application/zip":
		return "file", 25 << 20, ".zip", true
	default:
		return "", 0, "", false
	}
}

func sanitizeFilename(value string) string {
	value = filepath.Base(strings.ReplaceAll(value, "\\", "/"))
	value = strings.Map(func(r rune) rune {
		if r < 32 || r == 127 || r == '/' || r == '\\' {
			return -1
		}
		return r
	}, value)
	if len([]rune(value)) > 120 {
		value = string([]rune(value)[:120])
	}
	return strings.TrimSpace(value)
}

func (s *Server) handleMedia(w http.ResponseWriter, r *http.Request) {
	mediaID := r.PathValue("id")
	if len(mediaID) != 32 {
		writeError(w, http.StatusNotFound, "MEDIA_NOT_FOUND", "文件不存在")
		return
	}
	var conversationID, originalName, storageKey, mimeType, kind string
	var size int64
	err := s.db.QueryRowContext(r.Context(), `SELECT conversation_id, original_name, storage_key, mime_type, size_bytes, media_kind FROM chat_media WHERE id=?`, mediaID).Scan(
		&conversationID, &originalName, &storageKey, &mimeType, &size, &kind)
	if err != nil {
		writeError(w, http.StatusNotFound, "MEDIA_NOT_FOUND", "文件不存在")
		return
	}
	authorized := false
	if player, authErr := s.authenticatePlayer(r); authErr == nil && player.ConversationID == conversationID {
		authorized = true
	}
	if !authorized {
		if agent, authErr := s.authenticateAgent(r); authErr == nil && s.ensureAgentCanAccess(r, agent, conversationID) == nil {
			authorized = true
		}
	}
	if !authorized && s.validMediaTicket(strings.TrimSpace(r.URL.Query().Get("ticket")), mediaID, conversationID) {
		authorized = true
	}
	if !authorized {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "无权访问此文件")
		return
	}
	path := filepath.Join(s.cfg.UploadDir, filepath.FromSlash(storageKey))
	cleanStorageKey := filepath.Clean(filepath.FromSlash(storageKey))
	if cleanStorageKey == ".." || strings.HasPrefix(cleanStorageKey, ".."+string(filepath.Separator)) || filepath.IsAbs(cleanStorageKey) {
		writeError(w, http.StatusInternalServerError, "MEDIA_CORRUPT", "文件暂时不可用")
		return
	}
	path = filepath.Join(s.cfg.UploadDir, cleanStorageKey)
	file, err := os.Open(path)
	if err != nil {
		writeError(w, http.StatusNotFound, "MEDIA_NOT_FOUND", "文件不存在")
		return
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil || stat.Size() != size {
		writeError(w, http.StatusInternalServerError, "MEDIA_CORRUPT", "文件暂时不可用")
		return
	}
	disposition := "attachment"
	if kind == "image" || kind == "video" {
		disposition = "inline"
	}
	w.Header().Set("Content-Type", mimeType)
	w.Header().Set("Content-Disposition", disposition+`; filename*=UTF-8''`+urlEncodeFilename(originalName))
	w.Header().Set("Cache-Control", "private, max-age=3600")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, originalName, stat.ModTime(), file)
}

func (s *Server) handlePlayerMediaTicket(w http.ResponseWriter, r *http.Request, p playerPrincipal) {
	mediaID := strings.TrimSpace(r.PathValue("id"))
	if len(mediaID) != 32 {
		writeError(w, http.StatusNotFound, "MEDIA_NOT_FOUND", "文件不存在")
		return
	}
	var conversationID string
	if err := s.db.QueryRowContext(r.Context(), `SELECT conversation_id FROM chat_media WHERE id=?`, mediaID).Scan(&conversationID); err != nil || conversationID != p.ConversationID {
		writeError(w, http.StatusNotFound, "MEDIA_NOT_FOUND", "文件不存在")
		return
	}
	ticket, err := security.RandomID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "TOKEN_ERROR", "暂时无法读取文件")
		return
	}
	expiresAt := time.Now().Add(30 * time.Minute)
	s.mediaTicketMu.Lock()
	if s.mediaTickets == nil {
		s.mediaTickets = make(map[string]mediaAccessTicket)
	}
	for key, item := range s.mediaTickets {
		if time.Now().After(item.ExpiresAt) {
			delete(s.mediaTickets, key)
		}
	}
	s.mediaTickets[ticket] = mediaAccessTicket{MediaID: mediaID, ConversationID: conversationID, ExpiresAt: expiresAt}
	s.mediaTicketMu.Unlock()
	writeData(w, http.StatusOK, map[string]any{
		"path":      "/api/media/" + mediaID + "?ticket=" + url.QueryEscape(ticket),
		"expiresAt": expiresAt,
	})
}

func (s *Server) validMediaTicket(ticket, mediaID, conversationID string) bool {
	if len(ticket) != 32 {
		return false
	}
	now := time.Now()
	s.mediaTicketMu.Lock()
	defer s.mediaTicketMu.Unlock()
	item, ok := s.mediaTickets[ticket]
	if !ok || now.After(item.ExpiresAt) {
		delete(s.mediaTickets, ticket)
		return false
	}
	return item.MediaID == mediaID && item.ConversationID == conversationID
}

func urlEncodeFilename(value string) string {
	return url.PathEscape(value)
}

func (s *Server) handleAgentTyping(w http.ResponseWriter, r *http.Request, p agentPrincipal) {
	conversationID := r.PathValue("id")
	if err := s.ensureAgentCanAccess(r, p, conversationID); err != nil {
		writeError(w, http.StatusNotFound, "CONVERSATION_NOT_FOUND", "会话不存在")
		return
	}
	var req struct {
		Typing bool `json:"typing"`
	}
	if !decodeJSON(w, r, &req, 4<<10) {
		return
	}
	s.hub.publish("player-conversation:"+conversationID, liveEvent{Type: "typing", ConversationID: conversationID, Payload: map[string]any{"actor": "agent", "typing": req.Typing}})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleAgentRead(w http.ResponseWriter, r *http.Request, p agentPrincipal) {
	conversationID := r.PathValue("id")
	if err := s.ensureAgentCanAccess(r, p, conversationID); err != nil {
		writeError(w, http.StatusNotFound, "CONVERSATION_NOT_FOUND", "会话不存在")
		return
	}
	_, err := s.db.ExecContext(r.Context(), `UPDATE chat_conversation SET agent_last_read_at=NOW() WHERE id=?`, conversationID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "无法更新已读状态")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
