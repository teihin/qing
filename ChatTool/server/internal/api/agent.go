package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"chattool/internal/security"
)

type conversationSummary struct {
	ID              string     `json:"id"`
	PlayerID        string     `json:"playerId"`
	Nickname        string     `json:"nickname"`
	AvatarURL       string     `json:"avatarUrl"`
	VIP             string     `json:"vip"`
	Status          string     `json:"status"`
	Priority        string     `json:"priority"`
	Category        string     `json:"category"`
	ChannelCode     string     `json:"channelCode"`
	AssignedAgentID *int64     `json:"assignedAgentId"`
	AssignedAgent   string     `json:"assignedAgent"`
	LastMessage     string     `json:"lastMessage"`
	LastMessageType string     `json:"lastMessageType"`
	LastMessageAt   time.Time  `json:"lastMessageAt"`
	Unread          int        `json:"unread"`
	QueueStartedAt  time.Time  `json:"queueStartedAt"`
	FirstResponseAt *time.Time `json:"firstResponseAt"`
}

func (s *Server) handleAgentDashboard(w http.ResponseWriter, r *http.Request, p agentPrincipal) {
	var queued, active, myActive, myUnread, allUnread, onlineAgents, todayClosed int
	cutoff := time.Now().Add(-s.cfg.AgentOfflineAfter)
	if err := s.db.QueryRowContext(r.Context(), `SELECT
COALESCE(SUM(status='queued'),0), COALESCE(SUM(status='active'),0), COALESCE(SUM(status='active' AND assigned_agent_id=?),0),
	COALESCE(SUM(status='closed' AND closed_at >= CURDATE()),0) FROM chat_conversation WHERE channel_code=?`, p.ID, p.ChannelCode).Scan(&queued, &active, &myActive, &todayClosed); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "无法读取工作台数据")
		return
	}
	if err := s.db.QueryRowContext(r.Context(), `SELECT
COALESCE(SUM(c.status='active' AND c.assigned_agent_id=? AND EXISTS (
  SELECT 1 FROM chat_message unread WHERE unread.conversation_id=c.id AND unread.sender_type='player'
  AND unread.created_at > COALESCE(c.agent_last_read_at,'1970-01-01')
)),0),
COALESCE(SUM(c.status='active' AND EXISTS (
  SELECT 1 FROM chat_message unread WHERE unread.conversation_id=c.id AND unread.sender_type='player'
  AND unread.created_at > COALESCE(c.agent_last_read_at,'1970-01-01')
)),0)
	FROM chat_conversation c WHERE c.channel_code=?`, p.ID, p.ChannelCode).Scan(&myUnread, &allUnread); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "无法读取未读会话数量")
		return
	}
	_ = s.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM chat_agent WHERE channel_code=? AND enabled=1 AND presence='online' AND last_seen_at>=?`, p.ChannelCode, cutoff).Scan(&onlineAgents)
	writeData(w, http.StatusOK, map[string]any{"queued": queued, "active": active, "myActive": myActive, "myUnread": myUnread, "allUnread": allUnread, "onlineAgents": onlineAgents, "todayClosed": todayClosed})
}

func (s *Server) handleAgentConversations(w http.ResponseWriter, r *http.Request, p agentPrincipal) {
	scope := strings.TrimSpace(r.URL.Query().Get("scope"))
	if scope == "" {
		scope = "mine"
	}
	search := strings.TrimSpace(r.URL.Query().Get("search"))
	where := "c.channel_code=?"
	args := []any{p.ChannelCode}
	switch scope {
	case "mine":
		where += " AND c.status='active' AND c.assigned_agent_id=?"
		args = append(args, p.ID)
	case "queue":
		where += " AND c.status='queued'"
	case "closed":
		if p.IsSupervisor() {
			where += " AND c.status='closed'"
		} else {
			where += " AND c.status='closed' AND c.assigned_agent_id=?"
			args = append(args, p.ID)
		}
	case "all":
		if !p.IsSupervisor() {
			where += " AND c.assigned_agent_id=?"
			args = append(args, p.ID)
		}
	default:
		writeError(w, http.StatusBadRequest, "INVALID_SCOPE", "会话筛选条件不正确")
		return
	}
	if search != "" {
		where += " AND (p.player_id LIKE ? OR p.nickname LIKE ? OR p.login_name LIKE ?)"
		pattern := "%" + search + "%"
		args = append(args, pattern, pattern, pattern)
	}
	query := `SELECT c.id, c.player_id, p.nickname, p.avatar_url, p.vip_label, c.status, c.priority, c.category,c.channel_code,
c.assigned_agent_id, COALESCE(a.display_name,''),
COALESCE((SELECT CASE WHEN m.message_type='text' THEN LEFT(m.text_content,100) WHEN m.message_type='image' THEN '[图片]'
WHEN m.message_type='video' THEN '[视频]' WHEN m.message_type='file' THEN '[文件]' WHEN m.message_type='note' THEN '[内部备注]' ELSE m.text_content END
FROM chat_message m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1),''),
COALESCE((SELECT m.message_type FROM chat_message m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1),'system'),
c.last_message_at,
(SELECT COUNT(*) FROM chat_message unread WHERE unread.conversation_id=c.id AND unread.sender_type='player'
AND unread.created_at > COALESCE(c.agent_last_read_at,'1970-01-01')),
c.queue_started_at, c.first_response_at
FROM chat_conversation c JOIN chat_player p ON p.player_id=c.player_id
LEFT JOIN chat_agent a ON a.id=c.assigned_agent_id
WHERE ` + where + ` ORDER BY FIELD(c.status,'queued','active','closed'), c.last_message_at DESC LIMIT 200`
	rows, err := s.db.QueryContext(r.Context(), query, args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "无法读取会话列表")
		return
	}
	defer rows.Close()
	items := make([]conversationSummary, 0)
	for rows.Next() {
		var item conversationSummary
		var assigned sql.NullInt64
		var firstResponse sql.NullTime
		if err := rows.Scan(&item.ID, &item.PlayerID, &item.Nickname, &item.AvatarURL, &item.VIP, &item.Status,
			&item.Priority, &item.Category, &item.ChannelCode, &assigned, &item.AssignedAgent, &item.LastMessage, &item.LastMessageType,
			&item.LastMessageAt, &item.Unread, &item.QueueStartedAt, &firstResponse); err != nil {
			writeError(w, http.StatusInternalServerError, "DB_ERROR", "无法读取会话列表")
			return
		}
		if assigned.Valid {
			item.AssignedAgentID = &assigned.Int64
		}
		if firstResponse.Valid {
			item.FirstResponseAt = &firstResponse.Time
		}
		items = append(items, item)
	}
	writeData(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleAgentConversation(w http.ResponseWriter, r *http.Request, p agentPrincipal) {
	conversationID := r.PathValue("id")
	if err := s.ensureAgentCanAccessOrQueued(r, p, conversationID); err != nil {
		writeError(w, http.StatusNotFound, "CONVERSATION_NOT_FOUND", "会话不存在或无权查看")
		return
	}
	var result struct {
		ID                  string    `json:"id"`
		Status              string    `json:"status"`
		Priority            string    `json:"priority"`
		Category            string    `json:"category"`
		ChannelCode         string    `json:"channelCode"`
		PlayerID            string    `json:"playerId"`
		Nickname            string    `json:"nickname"`
		LoginName           string    `json:"loginName"`
		AvatarURL           string    `json:"avatarUrl"`
		Level               string    `json:"level"`
		VIP                 string    `json:"vip"`
		Platform            string    `json:"platform"`
		Metadata            any       `json:"metadata"`
		AssignedAgentID     *int64    `json:"assignedAgentId"`
		AssignedAgent       string    `json:"assignedAgent"`
		CreatedAt           time.Time `json:"createdAt"`
		LastMessageAt       time.Time `json:"lastMessageAt"`
		SatisfactionScore   *int      `json:"satisfactionScore"`
		SatisfactionTags    string    `json:"satisfactionTags"`
		SatisfactionComment string    `json:"satisfactionComment"`
	}
	var assigned sql.NullInt64
	var metadata string
	var satisfactionScore sql.NullInt64
	if err := s.db.QueryRowContext(r.Context(), `SELECT c.id,c.status,c.priority,c.category,c.channel_code,p.player_id,p.nickname,p.login_name,
p.avatar_url, p.level_label, p.vip_label, p.platform, p.metadata_json, c.assigned_agent_id, COALESCE(a.display_name,''), c.created_at, c.last_message_at,
satisfaction.score,COALESCE(satisfaction.tags,''),COALESCE(satisfaction.comment,'')
FROM chat_conversation c JOIN chat_player p ON p.player_id=c.player_id LEFT JOIN chat_agent a ON a.id=c.assigned_agent_id
LEFT JOIN chat_satisfaction satisfaction ON satisfaction.conversation_id=c.id WHERE c.id=?`, conversationID).Scan(
		&result.ID, &result.Status, &result.Priority, &result.Category, &result.ChannelCode, &result.PlayerID, &result.Nickname, &result.LoginName,
		&result.AvatarURL, &result.Level, &result.VIP, &result.Platform, &metadata, &assigned, &result.AssignedAgent, &result.CreatedAt, &result.LastMessageAt,
		&satisfactionScore, &result.SatisfactionTags, &result.SatisfactionComment); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "无法读取会话详情")
		return
	}
	if assigned.Valid {
		result.AssignedAgentID = &assigned.Int64
	}
	if satisfactionScore.Valid {
		score := int(satisfactionScore.Int64)
		result.SatisfactionScore = &score
	}
	var metadataValue any = map[string]any{}
	_ = json.Unmarshal([]byte(metadata), &metadataValue)
	result.Metadata = metadataValue
	writeData(w, http.StatusOK, result)
}

func (s *Server) ensureAgentCanAccessOrQueued(r *http.Request, p agentPrincipal, conversationID string) error {
	var assigned sql.NullInt64
	var status, channelCode string
	if err := s.db.QueryRowContext(r.Context(), `SELECT assigned_agent_id,status,channel_code FROM chat_conversation WHERE id=?`, conversationID).Scan(&assigned, &status, &channelCode); err != nil {
		return err
	}
	if channelCode == p.ChannelCode && (p.IsSupervisor() || (status == "queued" && !assigned.Valid) || (assigned.Valid && assigned.Int64 == p.ID)) {
		return nil
	}
	return sql.ErrNoRows
}

func (s *Server) handleAgentClaim(w http.ResponseWriter, r *http.Request, p agentPrincipal) {
	conversationID := r.PathValue("id")
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, 500, "DB_ERROR", "无法接入会话")
		return
	}
	defer tx.Rollback()
	var status, channelCode string
	var assigned sql.NullInt64
	if err = tx.QueryRowContext(r.Context(), `SELECT status,assigned_agent_id,channel_code FROM chat_conversation WHERE id=? FOR UPDATE`, conversationID).Scan(&status, &assigned, &channelCode); err != nil {
		writeError(w, http.StatusNotFound, "CONVERSATION_NOT_FOUND", "会话不存在")
		return
	}
	if channelCode != p.ChannelCode {
		writeError(w, http.StatusNotFound, "CONVERSATION_NOT_FOUND", "会话不存在")
		return
	}
	if status != "queued" || assigned.Valid {
		writeError(w, http.StatusConflict, "ALREADY_ASSIGNED", "会话已经被其他客服接入")
		return
	}
	var active, max int
	if err = tx.QueryRowContext(r.Context(), `SELECT (SELECT COUNT(*) FROM chat_conversation WHERE assigned_agent_id=? AND status='active'), max_conversations
FROM chat_agent WHERE id=? AND enabled=1 AND presence='online'`, p.ID, p.ID).Scan(&active, &max); err != nil || active >= max {
		writeError(w, http.StatusConflict, "AGENT_CAPACITY", "当前接待量已达上限或客服不在线")
		return
	}
	_, err = tx.ExecContext(r.Context(), `UPDATE chat_conversation SET status='active', assigned_agent_id=?, assigned_at=NOW(), updated_at=NOW() WHERE id=?`, p.ID, conversationID)
	if err == nil {
		_, err = tx.ExecContext(r.Context(), `UPDATE chat_agent SET last_assigned_at=NOW() WHERE id=?`, p.ID)
	}
	if err == nil {
		_, err = tx.ExecContext(r.Context(), `INSERT INTO chat_assignment_log
(conversation_id,to_agent_id,action,operator_type,operator_id,reason,created_at) VALUES (?,?,'claim','agent',?,'客服主动接入',NOW())`, conversationID, p.ID, p.ID)
	}
	if err == nil {
		err = insertSystemMessage(r.Context(), tx, conversationID, "客服 "+p.DisplayName+" 已接入，为您服务。")
	}
	if err != nil || tx.Commit() != nil {
		writeError(w, 500, "DB_ERROR", "无法接入会话")
		return
	}
	s.hub.publish("player-conversation:"+conversationID, liveEvent{Type: "conversation.assigned", ConversationID: conversationID, Payload: map[string]any{"agentName": p.DisplayName}})
	s.publishConversationEvent(r.Context(), conversationID, liveEvent{Type: "conversation.changed", ConversationID: conversationID})
	writeData(w, http.StatusOK, map[string]any{"status": "active", "assignedAgentId": p.ID, "assignedAgent": p.DisplayName})
}

type transferRequest struct {
	AgentID int64  `json:"agentId"`
	Reason  string `json:"reason"`
}

func (s *Server) handleAgentTransfer(w http.ResponseWriter, r *http.Request, p agentPrincipal) {
	conversationID := r.PathValue("id")
	if err := s.ensureAgentCanAccess(r, p, conversationID); err != nil {
		writeError(w, 404, "CONVERSATION_NOT_FOUND", "会话不存在或无权转接")
		return
	}
	var req transferRequest
	if !decodeJSON(w, r, &req, 8<<10) {
		return
	}
	reason := strings.TrimSpace(req.Reason)
	if req.AgentID <= 0 || len([]rune(reason)) < 2 || len([]rune(reason)) > 120 {
		writeError(w, 400, "INVALID_TRANSFER", "请选择目标客服并填写2到120字转接原因")
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, 500, "DB_ERROR", "转接失败")
		return
	}
	defer tx.Rollback()
	var fromAgentID int64
	var channelCode string
	if err := tx.QueryRowContext(r.Context(), `SELECT assigned_agent_id,channel_code FROM chat_conversation WHERE id=? AND status='active' FOR UPDATE`, conversationID).Scan(&fromAgentID, &channelCode); err != nil {
		writeError(w, 409, "CONVERSATION_CHANGED", "会话状态已经变化")
		return
	}
	if channelCode != p.ChannelCode {
		writeError(w, 404, "CONVERSATION_NOT_FOUND", "会话不存在或无权转接")
		return
	}
	if !p.IsSupervisor() && fromAgentID != p.ID {
		writeError(w, 404, "CONVERSATION_NOT_FOUND", "会话不存在或无权转接")
		return
	}
	if req.AgentID == fromAgentID {
		writeError(w, 400, "SAME_AGENT", "目标客服不能是当前接待客服")
		return
	}
	var targetName string
	var targetCapacity int
	if err := tx.QueryRowContext(r.Context(), `SELECT display_name,max_conversations FROM chat_agent
WHERE id=? AND channel_code=? AND enabled=1 AND presence='online' AND last_seen_at>=? FOR UPDATE`, req.AgentID, channelCode, time.Now().Add(-s.cfg.AgentOfflineAfter)).Scan(&targetName, &targetCapacity); err != nil {
		writeError(w, 400, "INVALID_AGENT", "目标客服不在线或接待量已满")
		return
	}
	var targetActive int
	if err := tx.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM chat_conversation WHERE assigned_agent_id=? AND status='active'`, req.AgentID).Scan(&targetActive); err != nil {
		writeError(w, 500, "DB_ERROR", "转接失败")
		return
	}
	if targetActive >= targetCapacity {
		writeError(w, 400, "AGENT_CAPACITY", "目标客服接待量已满")
		return
	}
	if _, err = tx.ExecContext(r.Context(), `UPDATE chat_conversation SET assigned_agent_id=?, assigned_at=NOW(), status='active', updated_at=NOW() WHERE id=?`, req.AgentID, conversationID); err == nil {
		_, err = tx.ExecContext(r.Context(), `INSERT INTO chat_assignment_log
(conversation_id,from_agent_id,to_agent_id,action,operator_type,operator_id,reason,created_at) VALUES (?,?,?,'transfer','agent',?,?,NOW())`, conversationID, fromAgentID, req.AgentID, p.ID, reason)
	}
	if err != nil || tx.Commit() != nil {
		writeError(w, 500, "DB_ERROR", "转接失败")
		return
	}
	s.hub.publish("agent:"+strconv.FormatInt(req.AgentID, 10), liveEvent{Type: "conversation.assigned", ConversationID: conversationID})
	s.hub.publish("player-conversation:"+conversationID, liveEvent{Type: "conversation.transferred", ConversationID: conversationID, Payload: map[string]any{"agentName": targetName}})
	s.publishConversationEvent(r.Context(), conversationID, liveEvent{Type: "conversation.changed", ConversationID: conversationID})
	s.audit(r.Context(), "agent", strconv.FormatInt(p.ID, 10), "conversation.transfer", "conversation", conversationID, map[string]any{"toAgentId": req.AgentID, "reason": reason}, clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"assignedAgentId": req.AgentID, "assignedAgent": targetName})
}

func (s *Server) handleAgentClose(w http.ResponseWriter, r *http.Request, p agentPrincipal) {
	conversationID := r.PathValue("id")
	if err := s.ensureAgentCanAccess(r, p, conversationID); err != nil {
		writeError(w, 404, "CONVERSATION_NOT_FOUND", "会话不存在或无权结束")
		return
	}
	var req struct {
		Reason string `json:"reason"`
	}
	if !decodeJSON(w, r, &req, 8<<10) {
		return
	}
	reason := strings.TrimSpace(req.Reason)
	if reason == "" {
		reason = "问题已处理"
	}
	if len([]rune(reason)) > 120 {
		writeError(w, 400, "INVALID_REASON", "结束原因不能超过120字")
		return
	}
	result, err := s.db.ExecContext(r.Context(), `UPDATE chat_conversation SET status='closed', closed_at=NOW(), close_reason=?, updated_at=NOW() WHERE id=? AND status <> 'closed'`, reason, conversationID)
	if err != nil {
		writeError(w, 500, "DB_ERROR", "无法结束会话")
		return
	}
	changed, _ := result.RowsAffected()
	if changed == 0 {
		writeError(w, 409, "ALREADY_CLOSED", "会话已经结束")
		return
	}
	_, _ = s.db.ExecContext(r.Context(), `INSERT INTO chat_assignment_log
(conversation_id,from_agent_id,action,operator_type,operator_id,reason,created_at) VALUES (?,?,'close','agent',?,?,NOW())`, conversationID, p.ID, p.ID, reason)
	s.hub.publish("player-conversation:"+conversationID, liveEvent{Type: "conversation.closed", ConversationID: conversationID, Payload: map[string]any{"reason": reason}})
	s.publishConversationEvent(r.Context(), conversationID, liveEvent{Type: "conversation.changed", ConversationID: conversationID})
	writeData(w, http.StatusOK, map[string]any{"status": "closed", "reason": reason})
}

func (s *Server) handleQuickReplies(w http.ResponseWriter, r *http.Request, p agentPrincipal) {
	rows, err := s.db.QueryContext(r.Context(), `SELECT id,title,content,category FROM chat_quick_reply WHERE enabled=1 ORDER BY category,sort_order,id`)
	if err != nil {
		writeError(w, 500, "DB_ERROR", "无法读取快捷回复")
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id int64
		var title, content, category string
		if rows.Scan(&id, &title, &content, &category) == nil {
			items = append(items, map[string]any{"id": id, "title": title, "content": content, "category": category})
		}
	}
	writeData(w, 200, map[string]any{"items": items})
}

func (s *Server) handleTeamOptions(w http.ResponseWriter, r *http.Request, p agentPrincipal) {
	rows, err := s.db.QueryContext(r.Context(), `SELECT a.id,a.display_name,a.role,a.channel_code,channel.display_name,a.presence,a.max_conversations,a.last_seen_at,
(SELECT COUNT(*) FROM chat_conversation c WHERE c.assigned_agent_id=a.id AND c.status='active') active_count
FROM chat_agent a JOIN chat_channel channel ON channel.code=a.channel_code
WHERE a.enabled=1 AND a.channel_code=? ORDER BY FIELD(a.presence,'online','away','offline'),a.display_name`, p.ChannelCode)
	if err != nil {
		writeError(w, 500, "DB_ERROR", "无法读取可转接客服")
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id int64
		var name, role, channelCode, channelName, presence string
		var max, active int
		var last sql.NullTime
		if rows.Scan(&id, &name, &role, &channelCode, &channelName, &presence, &max, &last, &active) == nil {
			items = append(items, map[string]any{"id": id, "username": "", "displayName": name, "role": role, "enabled": true,
				"channelCode": channelCode, "channelName": channelName, "presence": presence, "maxConversations": max, "activeConversations": active, "lastSeenAt": nullableTime(last)})
		}
	}
	writeData(w, 200, map[string]any{"items": items})
}

func (s *Server) handleTeamList(w http.ResponseWriter, r *http.Request, p agentPrincipal) {
	rows, err := s.db.QueryContext(r.Context(), `SELECT a.id,a.username,a.display_name,a.role,a.channel_code,channel.display_name,a.enabled,a.presence,a.max_conversations,a.last_seen_at,
(SELECT COUNT(*) FROM chat_conversation c WHERE c.assigned_agent_id=a.id AND c.status='active') active_count
FROM chat_agent a JOIN chat_channel channel ON channel.code=a.channel_code ORDER BY a.enabled DESC,channel.sort_order,a.role,a.display_name`)
	if err != nil {
		writeError(w, 500, "DB_ERROR", "无法读取客服团队")
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id int64
		var username, name, role, channelCode, channelName, presence string
		var enabled bool
		var max, active int
		var last sql.NullTime
		if rows.Scan(&id, &username, &name, &role, &channelCode, &channelName, &enabled, &presence, &max, &last, &active) == nil {
			items = append(items, map[string]any{"id": id, "username": username, "displayName": name, "role": role, "channelCode": channelCode, "channelName": channelName, "enabled": enabled, "presence": presence, "maxConversations": max, "activeConversations": active, "lastSeenAt": nullableTime(last)})
		}
	}
	channels, err := s.listEnabledChannels(r.Context())
	if err != nil {
		writeError(w, 500, "DB_ERROR", "无法读取客服通道")
		return
	}
	writeData(w, 200, map[string]any{"items": items, "channels": channels})
}

type teamCreateRequest struct {
	Username         string `json:"username"`
	Password         string `json:"password"`
	DisplayName      string `json:"displayName"`
	Role             string `json:"role"`
	ChannelCode      string `json:"channelCode"`
	MaxConversations int    `json:"maxConversations"`
}

func (s *Server) handleTeamCreate(w http.ResponseWriter, r *http.Request, p agentPrincipal) {
	var req teamCreateRequest
	if !decodeJSON(w, r, &req, 16<<10) {
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	req.DisplayName = strings.TrimSpace(req.DisplayName)
	req.ChannelCode, _ = normalizeChannelCode(req.ChannelCode)
	if err := security.ValidateUsername(req.Username); err != nil {
		writeError(w, 400, "INVALID_USERNAME", err.Error())
		return
	}
	if len([]rune(req.DisplayName)) < 1 || len([]rune(req.DisplayName)) > 64 {
		writeError(w, 400, "INVALID_DISPLAY_NAME", "客服名称必须为1到64个字符")
		return
	}
	if req.Role != "agent" && req.Role != "supervisor" {
		writeError(w, 400, "INVALID_ROLE", "客服角色不正确")
		return
	}
	channel, err := s.loadEnabledChannel(r.Context(), req.ChannelCode)
	if err != nil {
		writeError(w, 400, "INVALID_CHANNEL", "客服通道不存在或已停用")
		return
	}
	if req.MaxConversations < 1 || req.MaxConversations > 50 {
		writeError(w, 400, "INVALID_CAPACITY", "最大接待量必须为1到50")
		return
	}
	hash, err := security.HashPassword(req.Password)
	if err != nil {
		writeError(w, 400, "INVALID_PASSWORD", err.Error())
		return
	}
	result, err := s.db.ExecContext(r.Context(), `INSERT INTO chat_agent(username,password_hash,display_name,role,channel_code,enabled,presence,max_conversations,created_at,updated_at)
	VALUES(?,?,?,?,?,1,'offline',?,NOW(),NOW())`, req.Username, hash, req.DisplayName, req.Role, channel.Code, req.MaxConversations)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "duplicate") {
			writeError(w, 409, "USERNAME_EXISTS", "客服账号已存在")
		} else {
			writeError(w, 500, "DB_ERROR", "无法创建客服账号")
		}
		return
	}
	id, _ := result.LastInsertId()
	s.audit(r.Context(), "agent", strconv.FormatInt(p.ID, 10), "team.create", "agent", strconv.FormatInt(id, 10), map[string]any{"username": req.Username, "role": req.Role, "channel": channel.Code}, clientIP(r))
	writeData(w, 201, map[string]any{"id": id})
}

type teamUpdateRequest struct {
	DisplayName      string `json:"displayName"`
	Role             string `json:"role"`
	ChannelCode      string `json:"channelCode"`
	Enabled          bool   `json:"enabled"`
	MaxConversations int    `json:"maxConversations"`
	NewPassword      string `json:"newPassword,omitempty"`
}

func (s *Server) handleTeamUpdate(w http.ResponseWriter, r *http.Request, p agentPrincipal) {
	id, ok := parseInt64Path(w, r.PathValue("id"))
	if !ok {
		return
	}
	var req teamUpdateRequest
	if !decodeJSON(w, r, &req, 16<<10) {
		return
	}
	req.DisplayName = strings.TrimSpace(req.DisplayName)
	if len([]rune(req.DisplayName)) < 1 || len([]rune(req.DisplayName)) > 64 || (req.Role != "agent" && req.Role != "supervisor") || req.MaxConversations < 1 || req.MaxConversations > 50 {
		writeError(w, 400, "INVALID_AGENT", "客服资料格式不正确")
		return
	}
	if id == p.ID && !req.Enabled {
		writeError(w, 400, "CANNOT_DISABLE_SELF", "不能停用当前登录账号")
		return
	}
	var existingRole, existingChannel string
	var existingEnabled bool
	var activeConversations int
	if err := s.db.QueryRowContext(r.Context(), `SELECT role,channel_code,enabled,
(SELECT COUNT(*) FROM chat_conversation WHERE assigned_agent_id=chat_agent.id AND status='active')
FROM chat_agent WHERE id=?`, id).Scan(&existingRole, &existingChannel, &existingEnabled, &activeConversations); err != nil {
		writeError(w, 404, "AGENT_NOT_FOUND", "客服账号不存在")
		return
	}
	if strings.TrimSpace(req.ChannelCode) == "" {
		req.ChannelCode = existingChannel
	} else if normalized, ok := normalizeChannelCode(req.ChannelCode); ok {
		req.ChannelCode = normalized
	} else {
		writeError(w, 400, "INVALID_CHANNEL", "客服通道格式不正确")
		return
	}
	channel, err := s.loadEnabledChannel(r.Context(), req.ChannelCode)
	if err != nil {
		writeError(w, 400, "INVALID_CHANNEL", "客服通道不存在或已停用")
		return
	}
	if existingChannel != channel.Code && activeConversations > 0 {
		writeError(w, http.StatusConflict, "AGENT_HAS_ACTIVE_CONVERSATIONS", "客服仍有接待中的会话，请先设为离线或完成转接后再更换通道")
		return
	}
	if existingRole == "supervisor" && existingEnabled && (req.Role != "supervisor" || !req.Enabled) {
		var otherSupervisors int
		if err := s.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM chat_agent WHERE role='supervisor' AND enabled=1 AND id<>?`, id).Scan(&otherSupervisors); err != nil {
			writeError(w, 500, "DB_ERROR", "无法校验主管账号")
			return
		}
		if otherSupervisors == 0 {
			writeError(w, 400, "LAST_SUPERVISOR", "必须至少保留一名启用的客服主管")
			return
		}
	}
	keepPresence := req.Enabled && existingChannel == channel.Code
	if req.NewPassword != "" {
		hash, err := security.HashPassword(req.NewPassword)
		if err != nil {
			writeError(w, 400, "INVALID_PASSWORD", err.Error())
			return
		}
		_, err = s.db.ExecContext(r.Context(), `UPDATE chat_agent SET display_name=?,role=?,channel_code=?,enabled=?,max_conversations=?,password_hash=?,presence=IF(?=1,presence,'offline'),updated_at=NOW() WHERE id=?`, req.DisplayName, req.Role, channel.Code, sqlBool(req.Enabled), req.MaxConversations, hash, sqlBool(keepPresence), id)
		if err != nil {
			writeError(w, 500, "DB_ERROR", "无法更新客服账号")
			return
		}
		_, _ = s.db.ExecContext(r.Context(), `DELETE FROM chat_agent_session WHERE agent_id=?`, id)
	} else {
		result, err := s.db.ExecContext(r.Context(), `UPDATE chat_agent SET display_name=?,role=?,channel_code=?,enabled=?,max_conversations=?,presence=IF(?=1,presence,'offline'),updated_at=NOW() WHERE id=?`, req.DisplayName, req.Role, channel.Code, sqlBool(req.Enabled), req.MaxConversations, sqlBool(keepPresence), id)
		if err != nil {
			writeError(w, 500, "DB_ERROR", "无法更新客服账号")
			return
		}
		changed, _ := result.RowsAffected()
		if changed == 0 {
			writeError(w, 404, "AGENT_NOT_FOUND", "客服账号不存在")
			return
		}
	}
	if !req.Enabled {
		_ = s.requeueAgentConversations(r.Context(), id, "客服账号被停用")
	}
	if existingChannel != channel.Code {
		_, _ = s.db.ExecContext(r.Context(), `DELETE FROM chat_agent_session WHERE agent_id=?`, id)
	}
	s.audit(r.Context(), "agent", strconv.FormatInt(p.ID, 10), "team.update", "agent", strconv.FormatInt(id, 10), map[string]any{"role": req.Role, "channel": channel.Code, "enabled": req.Enabled, "maxConversations": req.MaxConversations, "passwordReset": req.NewPassword != ""}, clientIP(r))
	s.hub.publish("team", liveEvent{Type: "team.changed"})
	writeData(w, 200, map[string]any{"id": id})
}

func nullableTime(value sql.NullTime) any {
	if value.Valid {
		return value.Time
	}
	return nil
}
