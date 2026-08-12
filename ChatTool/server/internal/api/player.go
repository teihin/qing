package api

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/sha1"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"chattool/internal/security"
)

type directPlayerSessionRequest struct {
	EncryptedData string `json:"encryptedData"`
}

type directPlayerPayload struct {
	PlayerID  string          `json:"playerId"`
	VIPID     string          `json:"vipid"`
	Phone     string          `json:"phone"`
	Nickname  string          `json:"nickname"`
	Name      string          `json:"name"`
	LoginName string          `json:"loginName"`
	AvatarURL string          `json:"avatarUrl"`
	Level     playerTextValue `json:"level"`
	VIP       playerTextValue `json:"vip"`
	Platform  string          `json:"platform"`
	Channel   string          `json:"channel"`
	Metadata  map[string]any  `json:"metadata"`
	IssuedAt  int64           `json:"ts"`
}

type playerTextValue string

func (value *playerTextValue) UnmarshalJSON(data []byte) error {
	if bytes.Equal(data, []byte("null")) {
		*value = ""
		return nil
	}
	var text string
	if len(data) > 0 && data[0] == '"' {
		if err := json.Unmarshal(data, &text); err != nil {
			return err
		}
		*value = playerTextValue(text)
		return nil
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var raw any
	if err := decoder.Decode(&raw); err != nil {
		return err
	}
	number, ok := raw.(json.Number)
	if !ok {
		return errors.New("player text value must be a string or number")
	}
	*value = playerTextValue(number.String())
	return nil
}

func (s *Server) handleCreateDirectPlayerSession(w http.ResponseWriter, r *http.Request) {
	var req directPlayerSessionRequest
	if !decodeJSON(w, r, &req, 40<<10) {
		return
	}
	payload, err := decryptPlayerLink(req.EncryptedData, s.cfg.PlayerLinkKey)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "INVALID_PLAYER_DATA", "客服入口信息无效，请返回游戏重新进入")
		return
	}
	now := time.Now()
	legacyPayload := payload.IssuedAt == 0
	if !playerLinkTimestampValid(payload.IssuedAt, now, s.cfg.PlayerLinkTTL) {
		writeError(w, http.StatusUnauthorized, "PLAYER_DATA_EXPIRED", "客服入口信息已过期，请返回游戏重新进入")
		return
	}
	playerID := firstNonEmpty(payload.PlayerID, payload.VIPID, payload.Phone)
	nickname := firstNonEmpty(payload.Nickname, payload.Name)
	loginName := strings.TrimSpace(payload.LoginName)
	payload.AvatarURL = strings.TrimSpace(payload.AvatarURL)
	level := strings.TrimSpace(string(payload.Level))
	vip := strings.TrimSpace(string(payload.VIP))
	payload.Platform = strings.TrimSpace(payload.Platform)
	channelCode, ok := normalizeChannelCode(payload.Channel)
	if !ok {
		writeError(w, http.StatusBadRequest, "INVALID_CHANNEL", "客服通道格式不正确")
		return
	}
	channel, err := s.loadEnabledChannel(r.Context(), channelCode)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusBadRequest, "INVALID_CHANNEL", "客服通道不存在或已停用")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "客服暂时不可用")
		return
	}
	if len(playerID) < 1 || len(playerID) > 64 || len([]rune(nickname)) < 1 || len([]rune(nickname)) > 64 ||
		len(loginName) > 64 || len([]rune(level)) > 64 || len([]rune(vip)) > 64 || len(payload.Platform) > 32 {
		writeError(w, http.StatusBadRequest, "INVALID_PLAYER", "玩家ID或昵称格式不正确")
		return
	}
	if payload.AvatarURL != "" {
		parsed, parseErr := url.Parse(payload.AvatarURL)
		if parseErr != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || len(payload.AvatarURL) > 512 {
			writeError(w, http.StatusBadRequest, "INVALID_AVATAR_URL", "头像地址格式不正确")
			return
		}
	}
	if payload.Metadata == nil {
		payload.Metadata = map[string]any{}
	}
	payload.Metadata["资料来源"] = "游戏客户端（轻量加密，未服务端认证）"
	if legacyPayload {
		payload.Metadata["入口版本"] = "旧客户端（无时间戳）"
	}
	metadata, err := json.Marshal(payload.Metadata)
	if err != nil || len(metadata) > 16<<10 {
		writeError(w, http.StatusBadRequest, "INVALID_METADATA", "玩家扩展信息过大或格式不正确")
		return
	}
	sessionToken, err := security.RandomToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "TOKEN_FAILED", "无法创建玩家会话")
		return
	}
	csrfToken, err := security.RandomToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "TOKEN_FAILED", "无法创建安全令牌")
		return
	}
	sessionRef, err := security.RandomID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "TOKEN_FAILED", "无法创建玩家会话")
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "客服暂时不可用")
		return
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(r.Context(), `INSERT INTO chat_player
(player_id, nickname, login_name, avatar_url, level_label, vip_label, platform, metadata_json, last_seen_at, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW())
ON DUPLICATE KEY UPDATE nickname=VALUES(nickname), login_name=VALUES(login_name), avatar_url=VALUES(avatar_url),
level_label=VALUES(level_label), vip_label=VALUES(vip_label), platform=VALUES(platform), metadata_json=VALUES(metadata_json),
	last_seen_at=NOW(), updated_at=NOW()`, playerID, nickname, loginName, payload.AvatarURL, level, vip, payload.Platform, string(metadata))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "无法保存玩家客服资料")
		return
	}
	conversationID := ""
	err = tx.QueryRowContext(r.Context(), `SELECT id FROM chat_conversation
WHERE player_id=? AND channel_code=? AND status IN ('queued','active') ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, playerID, channel.Code).Scan(&conversationID)
	if errors.Is(err, sql.ErrNoRows) {
		conversationID, err = security.RandomID()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "TOKEN_FAILED", "无法创建咨询会话")
			return
		}
		_, err = tx.ExecContext(r.Context(), `INSERT INTO chat_conversation
(id,player_id,channel_code,status,priority,category,queue_started_at,last_message_at,created_at,updated_at)
VALUES (?, ?, ?, 'queued', 'normal', ?, NOW(), NOW(), NOW(), NOW())`, conversationID, playerID, channel.Code, channel.DisplayName)
		if err == nil {
			err = insertSystemMessage(r.Context(), tx, conversationID, "您好，正在为您接入在线客服。")
		}
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "无法创建咨询会话")
		return
	}
	_, err = tx.ExecContext(r.Context(), `INSERT INTO chat_player_session
(token_hash, player_id, conversation_id, csrf_hash, expires_at, last_seen_at, created_at)
VALUES (?, ?, ?, ?, ?, NOW(), NOW())`, security.HashToken(sessionToken), playerID, conversationID,
		security.HashToken(csrfToken), time.Now().Add(s.cfg.PlayerSessionTTL))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "无法创建玩家会话")
		return
	}
	if err = tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "客服暂时不可用")
		return
	}
	setCookie(w, playerSessionCookie, sessionToken, s.cfg.CookiePath, true, s.cfg.CookieSecure, s.cfg.PlayerSessionTTL)
	setCookie(w, playerCSRFCookie, csrfToken, s.cfg.CookiePath, false, s.cfg.CookieSecure, s.cfg.PlayerSessionTTL)
	setCookie(w, playerSessionCookieName(sessionRef), sessionToken, s.cfg.CookiePath, true, s.cfg.CookieSecure, s.cfg.PlayerSessionTTL)
	setCookie(w, playerCSRFCookieName(sessionRef), csrfToken, s.cfg.CookiePath, false, s.cfg.CookieSecure, s.cfg.PlayerSessionTTL)
	s.tryAssignQueued(r.Context(), "player_session_created")
	state, err := s.loadPlayerState(r.Context(), playerID, conversationID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "无法读取咨询状态")
		return
	}
	state["csrfToken"] = csrfToken
	state["sessionRef"] = sessionRef
	s.audit(r.Context(), "player", playerID, "player.direct_session", "player", playerID, map[string]any{"source": "encrypted_client_payload", "channel": channel.Code}, clientIP(r))
	s.publishConversationEvent(r.Context(), conversationID, liveEvent{Type: "conversation.changed", ConversationID: conversationID})
	writeData(w, http.StatusOK, state)
}

func playerLinkTimestampValid(issuedAt int64, now time.Time, ttl time.Duration) bool {
	// 已发布客户端只发送 vipid/phone/name 三个加密字段，没有时间戳。
	// 保留 issuedAt == 0 的兼容路径，使线上切换客服地址后无需强制热更新；
	// 新客户端仍严格执行有效期校验，负数时间戳一律拒绝。
	if issuedAt == 0 {
		return true
	}
	if issuedAt < 0 {
		return false
	}
	issuedTime := time.Unix(issuedAt, 0)
	return !issuedTime.Before(now.Add(-ttl)) && !issuedTime.After(now.Add(2*time.Minute))
}

func decryptPlayerLink(value, passphrase string) (directPlayerPayload, error) {
	var payload directPlayerPayload
	value = strings.TrimSpace(value)
	if len(value) < aes.BlockSize*2 || len(value) > 64<<10 || len(value)%2 != 0 {
		return payload, errors.New("invalid encrypted player data length")
	}
	ciphertext, err := hex.DecodeString(value)
	if err != nil || len(ciphertext)%aes.BlockSize != 0 {
		return payload, errors.New("invalid encrypted player data")
	}
	digest := sha1.Sum([]byte(passphrase))
	keyHex := hex.EncodeToString(digest[:])
	block, err := aes.NewCipher([]byte(keyHex[:16]))
	if err != nil {
		return payload, err
	}
	plaintext := make([]byte, len(ciphertext))
	for offset := 0; offset < len(ciphertext); offset += aes.BlockSize {
		block.Decrypt(plaintext[offset:offset+aes.BlockSize], ciphertext[offset:offset+aes.BlockSize])
	}
	padding := int(plaintext[len(plaintext)-1])
	if padding < 1 || padding > aes.BlockSize || padding > len(plaintext) {
		return payload, errors.New("invalid encrypted player data padding")
	}
	for _, value := range plaintext[len(plaintext)-padding:] {
		if int(value) != padding {
			return payload, errors.New("invalid encrypted player data padding")
		}
	}
	decoder := json.NewDecoder(bytes.NewReader(plaintext[:len(plaintext)-padding]))
	if err := decoder.Decode(&payload); err != nil {
		return payload, err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return payload, errors.New("invalid encrypted player data json")
	}
	return payload, nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}

func (s *Server) handlePlayerMe(w http.ResponseWriter, r *http.Request, p playerPrincipal) {
	state, err := s.loadPlayerState(r.Context(), p.PlayerID, p.ConversationID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "无法读取咨询状态")
		return
	}
	if cookie, err := r.Cookie(playerCSRFCookieName(p.SessionRef)); err == nil {
		state["csrfToken"] = cookie.Value
	}
	state["sessionRef"] = p.SessionRef
	writeData(w, http.StatusOK, state)
}

func (s *Server) loadPlayerState(ctx context.Context, playerID, conversationID string) (map[string]any, error) {
	var nickname, loginName, avatarURL, level, vip, platform, metadata string
	if err := s.db.QueryRowContext(ctx, `SELECT nickname, login_name, avatar_url, level_label, vip_label, platform, metadata_json
FROM chat_player WHERE player_id = ?`, playerID).Scan(&nickname, &loginName, &avatarURL, &level, &vip, &platform, &metadata); err != nil {
		return nil, err
	}
	var status, category, priority, channelCode string
	var assignedID sql.NullInt64
	var agentName sql.NullString
	if err := s.db.QueryRowContext(ctx, `SELECT c.status,c.category,c.priority,c.channel_code,c.assigned_agent_id,a.display_name
FROM chat_conversation c LEFT JOIN chat_agent a ON a.id = c.assigned_agent_id WHERE c.id = ?`, conversationID).Scan(
		&status, &category, &priority, &channelCode, &assignedID, &agentName,
	); err != nil {
		return nil, err
	}
	var online int
	cutoff := time.Now().Add(-s.cfg.AgentOfflineAfter)
	_ = s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM chat_agent
WHERE channel_code=? AND enabled=1 AND presence='online' AND last_seen_at>=?
AND EXISTS (SELECT 1 FROM chat_agent_session sess WHERE sess.agent_id=chat_agent.id AND sess.expires_at>NOW())`, channelCode, cutoff).Scan(&online)
	var metadataValue any = map[string]any{}
	_ = json.Unmarshal([]byte(metadata), &metadataValue)
	return map[string]any{
		"player": map[string]any{"playerId": playerID, "nickname": nickname, "loginName": loginName, "avatarUrl": avatarURL,
			"level": level, "vip": vip, "platform": platform, "metadata": metadataValue},
		"conversation": map[string]any{"id": conversationID, "status": status, "category": category, "channelCode": channelCode, "priority": priority,
			"assignedAgentId": nullableInt64(assignedID), "agentName": agentName.String},
		"onlineAgents": online,
	}, nil
}

func (s *Server) handlePlayerEvents(w http.ResponseWriter, r *http.Request, p playerPrincipal) {
	conversation, cancelConversation := s.hub.subscribe("player-conversation:" + p.ConversationID)
	defer cancelConversation()
	team, cancelTeam := s.hub.subscribe("team")
	defer cancelTeam()
	merged := make(chan liveEvent, 32)
	go func() {
		for {
			select {
			case event := <-conversation:
				select {
				case merged <- event:
				case <-r.Context().Done():
					return
				}
			case event := <-team:
				select {
				case merged <- event:
				case <-r.Context().Done():
					return
				}
			case <-r.Context().Done():
				return
			}
		}
	}()
	streamEvents(w, r, merged, s.hub.done)
}

func (s *Server) handlePlayerTyping(w http.ResponseWriter, r *http.Request, p playerPrincipal) {
	var req struct {
		Typing bool `json:"typing"`
	}
	if !decodeJSON(w, r, &req, 4<<10) {
		return
	}
	var agentID sql.NullInt64
	_ = s.db.QueryRowContext(r.Context(), `SELECT assigned_agent_id FROM chat_conversation WHERE id = ?`, p.ConversationID).Scan(&agentID)
	if agentID.Valid {
		s.hub.publish("agent:"+strconv.FormatInt(agentID.Int64, 10), liveEvent{Type: "typing", ConversationID: p.ConversationID, Payload: map[string]any{"actor": "player", "typing": req.Typing}})
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handlePlayerRead(w http.ResponseWriter, r *http.Request, p playerPrincipal) {
	_, err := s.db.ExecContext(r.Context(), `UPDATE chat_conversation SET player_last_read_at = NOW() WHERE id = ? AND player_id = ?`, p.ConversationID, p.PlayerID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "无法更新已读状态")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handlePlayerEnd(w http.ResponseWriter, r *http.Request, p playerPrincipal) {
	result, err := s.db.ExecContext(r.Context(), `UPDATE chat_conversation SET status='closed', closed_at=NOW(), close_reason='玩家结束咨询', updated_at=NOW()
WHERE id=? AND player_id=? AND status <> 'closed'`, p.ConversationID, p.PlayerID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "无法结束咨询")
		return
	}
	changed, _ := result.RowsAffected()
	if changed > 0 {
		_, _ = s.db.ExecContext(r.Context(), `INSERT INTO chat_assignment_log
(conversation_id, action, operator_type, reason, created_at) VALUES (?, 'close', 'system', '玩家结束咨询', NOW())`, p.ConversationID)
		s.publishConversationEvent(r.Context(), p.ConversationID, liveEvent{Type: "conversation.changed", ConversationID: p.ConversationID})
	}
	writeData(w, http.StatusOK, map[string]any{"status": "closed"})
}

func (s *Server) handlePlayerSatisfaction(w http.ResponseWriter, r *http.Request, p playerPrincipal) {
	var req struct {
		Score   int      `json:"score"`
		Tags    []string `json:"tags"`
		Comment string   `json:"comment"`
	}
	if !decodeJSON(w, r, &req, 16<<10) {
		return
	}
	if req.Score < 1 || req.Score > 5 || len(req.Tags) > 5 || len([]rune(req.Comment)) > 500 {
		writeError(w, http.StatusBadRequest, "INVALID_SATISFACTION", "评价内容格式不正确")
		return
	}
	cleanTags := make([]string, 0, len(req.Tags))
	for _, tag := range req.Tags {
		tag = strings.TrimSpace(tag)
		if tag == "" || len([]rune(tag)) > 20 {
			writeError(w, http.StatusBadRequest, "INVALID_SATISFACTION", "评价标签格式不正确")
			return
		}
		cleanTags = append(cleanTags, tag)
	}
	var status string
	if err := s.db.QueryRowContext(r.Context(), `SELECT status FROM chat_conversation WHERE id=? AND player_id=?`, p.ConversationID, p.PlayerID).Scan(&status); err != nil || status != "closed" {
		writeError(w, http.StatusConflict, "CONVERSATION_NOT_CLOSED", "会话结束后才能提交评价")
		return
	}
	_, err := s.db.ExecContext(r.Context(), `INSERT INTO chat_satisfaction(conversation_id,player_id,score,tags,comment,created_at,updated_at)
VALUES(?,?,?,?,?,NOW(),NOW()) ON DUPLICATE KEY UPDATE score=VALUES(score),tags=VALUES(tags),comment=VALUES(comment),updated_at=NOW()`,
		p.ConversationID, p.PlayerID, req.Score, strings.Join(cleanTags, ","), strings.TrimSpace(req.Comment))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "评价提交失败")
		return
	}
	s.audit(r.Context(), "player", p.PlayerID, "conversation.satisfaction", "conversation", p.ConversationID, map[string]any{"score": req.Score, "tags": cleanTags}, clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"score": req.Score})
}

func (s *Server) assignQueued(ctx context.Context) (int, error) {
	assignedCount := 0
	for assignedCount < 50 {
		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return assignedCount, err
		}
		var conversationID, channelCode string
		cutoff := time.Now().Add(-s.cfg.AgentOfflineAfter)
		err = tx.QueryRowContext(ctx, `SELECT c.id,c.channel_code FROM chat_conversation c
WHERE c.status='queued' AND EXISTS (
  SELECT 1 FROM chat_agent available
  WHERE available.channel_code=c.channel_code AND available.enabled=1 AND available.presence='online' AND available.last_seen_at>=?
  AND EXISTS (SELECT 1 FROM chat_agent_session sess WHERE sess.agent_id=available.id AND sess.expires_at>NOW())
  AND (SELECT COUNT(*) FROM chat_conversation active WHERE active.assigned_agent_id=available.id AND active.status='active') < available.max_conversations
)
ORDER BY FIELD(c.priority,'urgent','high','normal','low'),c.queue_started_at ASC LIMIT 1 FOR UPDATE`, cutoff).Scan(&conversationID, &channelCode)
		if errors.Is(err, sql.ErrNoRows) {
			tx.Rollback()
			break
		}
		if err != nil {
			tx.Rollback()
			return assignedCount, err
		}
		var agentID int64
		var agentName string
		err = tx.QueryRowContext(ctx, `SELECT a.id, a.display_name
FROM chat_agent a
LEFT JOIN (SELECT assigned_agent_id, COUNT(*) active_count FROM chat_conversation WHERE status='active' GROUP BY assigned_agent_id) c
ON c.assigned_agent_id = a.id
WHERE a.channel_code=? AND a.enabled=1 AND a.presence='online' AND a.last_seen_at >= ?
AND EXISTS (SELECT 1 FROM chat_agent_session sess WHERE sess.agent_id=a.id AND sess.expires_at>NOW())
AND COALESCE(c.active_count,0) < a.max_conversations
ORDER BY COALESCE(c.active_count,0) ASC, COALESCE(a.last_assigned_at,'1970-01-01') ASC, a.id ASC
LIMIT 1 FOR UPDATE`, channelCode, cutoff).Scan(&agentID, &agentName)
		if errors.Is(err, sql.ErrNoRows) {
			tx.Rollback()
			break
		}
		if err != nil {
			tx.Rollback()
			return assignedCount, err
		}
		_, err = tx.ExecContext(ctx, `UPDATE chat_conversation SET status='active', assigned_agent_id=?, assigned_at=NOW(), updated_at=NOW() WHERE id=? AND status='queued'`, agentID, conversationID)
		if err == nil {
			_, err = tx.ExecContext(ctx, `UPDATE chat_agent SET last_assigned_at=NOW() WHERE id=?`, agentID)
		}
		if err == nil {
			_, err = tx.ExecContext(ctx, `INSERT INTO chat_assignment_log
(conversation_id, to_agent_id, action, operator_type, reason, created_at) VALUES (?, ?, 'auto_assign', 'system', '系统自动分配', NOW())`, conversationID, agentID)
		}
		if err == nil {
			err = insertSystemMessage(ctx, tx, conversationID, "客服 "+agentName+" 已接入，为您服务。")
		}
		if err != nil {
			tx.Rollback()
			return assignedCount, err
		}
		if err = tx.Commit(); err != nil {
			return assignedCount, err
		}
		assignedCount++
		s.hub.publish("agent:"+strconv.FormatInt(agentID, 10), liveEvent{Type: "conversation.assigned", ConversationID: conversationID})
		s.hub.publish("player-conversation:"+conversationID, liveEvent{Type: "conversation.assigned", ConversationID: conversationID, Payload: map[string]any{"agentName": agentName}})
		s.publishConversationEvent(ctx, conversationID, liveEvent{Type: "conversation.changed", ConversationID: conversationID})
	}
	return assignedCount, nil
}

type sqlExecer interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func insertSystemMessage(ctx context.Context, exec sqlExecer, conversationID, text string) error {
	messageID, err := security.RandomID()
	if err != nil {
		return err
	}
	_, err = exec.ExecContext(ctx, `INSERT INTO chat_message
(id, conversation_id, sender_type, sender_id, sender_name, message_type, text_content, client_message_id, created_at)
VALUES (?, ?, 'system', 'system', '系统消息', 'system', ?, ?, NOW())`, messageID, conversationID, text, messageID)
	return err
}

func (s *Server) tryAssignQueued(ctx context.Context, trigger string) int {
	assigned, err := s.assignQueued(ctx)
	if err != nil {
		s.logger.Error("automatic conversation assignment failed", "trigger", trigger, "assigned", assigned, "error", err)
	}
	return assigned
}

func (s *Server) requeueAgentConversations(ctx context.Context, agentID int64, reason string) error {
	rows, err := s.db.QueryContext(ctx, `SELECT id FROM chat_conversation WHERE assigned_agent_id=? AND status='active'`, agentID)
	if err != nil {
		return err
	}
	defer rows.Close()
	type item struct{ id string }
	var items []item
	for rows.Next() {
		var value item
		if err := rows.Scan(&value.id); err != nil {
			return err
		}
		items = append(items, value)
	}
	for _, value := range items {
		_, err = s.db.ExecContext(ctx, `UPDATE chat_conversation SET status='queued', assigned_agent_id=NULL, assigned_at=NULL, queue_started_at=NOW(), updated_at=NOW()
WHERE id=? AND assigned_agent_id=? AND status='active'`, value.id, agentID)
		if err != nil {
			return err
		}
		_, _ = s.db.ExecContext(ctx, `INSERT INTO chat_assignment_log
(conversation_id, from_agent_id, action, operator_type, reason, created_at) VALUES (?, ?, 'requeue', 'system', ?, NOW())`, value.id, agentID, reason)
		if messageErr := insertSystemMessage(ctx, s.db, value.id, "当前客服已离线，正在为您重新分配客服。"); messageErr != nil {
			s.logger.Warn("requeue system message failed", "conversation_id", value.id, "error", messageErr)
		}
		s.hub.publish("player-conversation:"+value.id, liveEvent{Type: "conversation.requeued", ConversationID: value.id})
		s.publishConversationEvent(ctx, value.id, liveEvent{Type: "conversation.changed", ConversationID: value.id})
	}
	_, err = s.assignQueued(ctx)
	return err
}

func nullableInt64(value sql.NullInt64) any {
	if value.Valid {
		return value.Int64
	}
	return nil
}

func (s *Server) runMaintenance(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	var lastContentPurge time.Time
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.cleanupExpired(ctx)
			if lastContentPurge.IsZero() || time.Since(lastContentPurge) >= 5*time.Minute {
				lastContentPurge = time.Now()
				result, affected, err := s.purgeExpiredContent(ctx, time.Now().Add(-s.cfg.MessageRetention))
				if err != nil {
					s.logger.Error("expired conversation content purge failed", "error", err)
				} else if result.MessagesDeleted > 0 || result.MediaDeleted > 0 {
					s.logger.Info("expired conversation content purged", "messages", result.MessagesDeleted, "media", result.MediaDeleted, "files", result.FilesDeleted)
					for _, conversationID := range affected {
						s.publishConversationCleared(ctx, conversationID)
					}
				}
			}
			cutoff := time.Now().Add(-s.cfg.AgentOfflineAfter)
			rows, err := s.db.QueryContext(ctx, `SELECT id FROM chat_agent WHERE presence <> 'offline' AND (last_seen_at IS NULL OR last_seen_at < ?)`, cutoff)
			if err == nil {
				var ids []int64
				for rows.Next() {
					var id int64
					if rows.Scan(&id) == nil {
						ids = append(ids, id)
					}
				}
				rows.Close()
				for _, id := range ids {
					_, _ = s.db.ExecContext(ctx, `UPDATE chat_agent SET presence='offline' WHERE id=?`, id)
					_ = s.requeueAgentConversations(ctx, id, "客服心跳超时")
				}
				if len(ids) > 0 {
					s.hub.publish("team", liveEvent{Type: "team.changed"})
				}
			}
			_, _ = s.db.ExecContext(ctx, `UPDATE chat_conversation SET status='closed', closed_at=NOW(), close_reason='会话长时间无消息自动关闭', updated_at=NOW()
WHERE status IN ('queued','active') AND last_message_at < ?`, time.Now().Add(-s.cfg.ConversationIdle))
			s.tryAssignQueued(ctx, "maintenance")
		}
	}
}
