package api

import (
	"net/http"
	"strconv"
	"strings"

	"chattool/internal/directchat"
)

// 聊天托管：客服工作台查看托管账号的私聊并代发回复。
// 权限来自游戏内大群主/盟主的开启状态（chat_direct_hosting），客服侧只负责
// 分组展示与代发；会话本身仍按托管账号的身份校验。

func (s *Server) handleHostedGroups(w http.ResponseWriter, r *http.Request, _ agentPrincipal) {
	ctx := directchat.WithRequestCache(r.Context())
	groups, err := s.direct.HostedGroups(ctx)
	if err != nil {
		writeDirectBizError(w, err)
		return
	}
	for i := range groups {
		for j := range groups[i].Items {
			groups[i].Items[j].Avatar = s.avatarURLFromIndex(groups[i].Items[j].Avatar)
		}
	}
	writeData(w, http.StatusOK, map[string]any{"items": groups})
}

func (s *Server) handleHostedConversations(w http.ResponseWriter, r *http.Request, _ agentPrincipal) {
	guuid := strings.TrimSpace(r.URL.Query().Get("guuid"))
	if guuid == "" {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "缺少托管账号")
		return
	}
	ctx := directchat.WithRequestCache(r.Context())
	items, err := s.direct.HostedConversations(ctx, guuid)
	if err != nil {
		writeDirectBizError(w, err)
		return
	}
	for i := range items {
		items[i].Peer.Avatar = s.avatarURLFromIndex(items[i].Peer.Avatar)
	}
	writeData(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleHostedBalance(w http.ResponseWriter, r *http.Request, _ agentPrincipal) {
	guuid := strings.TrimSpace(r.URL.Query().Get("guuid"))
	if guuid == "" {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "缺少托管账号")
		return
	}
	ctx := directchat.WithRequestCache(r.Context())
	view, err := s.direct.HostedBalance(ctx, guuid, r.PathValue("id"))
	if err != nil {
		writeDirectBizError(w, err)
		return
	}
	writeData(w, http.StatusOK, view)
}

func (s *Server) handleHostedDeleteOwner(w http.ResponseWriter, r *http.Request, p agentPrincipal) {
	guuid := strings.TrimSpace(r.PathValue("guuid"))
	if guuid == "" {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "缺少托管账号")
		return
	}
	if err := s.direct.DeleteHostedOwner(r.Context(), guuid); err != nil {
		writeDirectBizError(w, err)
		return
	}
	s.audit(r.Context(), "agent", strconv.FormatInt(p.ID, 10), "direct.hosted.delete_owner",
		"hosted", guuid, map[string]any{"hostedGuuid": guuid}, clientIP(r))
	s.hub.publish("hosted", liveEvent{Type: "hosted.deleted", Payload: map[string]any{"hostedGuuid": guuid}})
	writeData(w, http.StatusOK, map[string]any{"deleted": true})
}

// handleHostedRemark 给托管会话的玩家设置备注名称（全团队共享，传空串即清除）。
func (s *Server) handleHostedRemark(w http.ResponseWriter, r *http.Request, p agentPrincipal) {
	var body struct {
		Guuid  string `json:"guuid"`
		Remark string `json:"remark"`
	}
	if !decodeJSON(w, r, &body, 8<<10) {
		return
	}
	hostedGuuid := strings.TrimSpace(body.Guuid)
	if hostedGuuid == "" {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "缺少托管账号")
		return
	}
	ctx := directchat.WithRequestCache(r.Context())
	conversationID := r.PathValue("id")
	remark, peerGuuid, err := s.direct.SetHostedRemark(ctx, hostedGuuid, conversationID, body.Remark, p.ID, p.DisplayName)
	if err != nil {
		writeDirectBizError(w, err)
		return
	}
	s.hub.publish("hosted", liveEvent{Type: "hosted.preference", ConversationID: conversationID, Payload: map[string]any{
		"hostedGuuid": hostedGuuid, "peerGuuid": peerGuuid, "remark": remark,
	}})
	s.audit(r.Context(), "agent", strconv.FormatInt(p.ID, 10), "direct.hosted.remark",
		"conversation", conversationID, map[string]any{
			"hostedGuuid": hostedGuuid, "peerGuuid": peerGuuid, "remarkLength": len([]rune(remark)),
			"cleared": remark == "",
		}, clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"remark": remark, "peerGuuid": peerGuuid})
}

// handleHostedPin 置顶/取消置顶一条托管会话。
func (s *Server) handleHostedPin(w http.ResponseWriter, r *http.Request, p agentPrincipal) {
	var body struct {
		Guuid  string `json:"guuid"`
		Pinned *bool  `json:"pinned"`
	}
	if !decodeJSON(w, r, &body, 8<<10) {
		return
	}
	hostedGuuid := strings.TrimSpace(body.Guuid)
	if hostedGuuid == "" {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "缺少托管账号")
		return
	}
	if body.Pinned == nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "缺少置顶状态")
		return
	}
	ctx := directchat.WithRequestCache(r.Context())
	conversationID := r.PathValue("id")
	peerGuuid, err := s.direct.SetHostedPin(ctx, hostedGuuid, conversationID, *body.Pinned, p.ID, p.DisplayName)
	if err != nil {
		writeDirectBizError(w, err)
		return
	}
	s.hub.publish("hosted", liveEvent{Type: "hosted.preference", ConversationID: conversationID, Payload: map[string]any{
		"hostedGuuid": hostedGuuid, "peerGuuid": peerGuuid, "pinned": *body.Pinned,
	}})
	s.audit(r.Context(), "agent", strconv.FormatInt(p.ID, 10), "direct.hosted.pin",
		"conversation", conversationID, map[string]any{
			"hostedGuuid": hostedGuuid, "peerGuuid": peerGuuid, "pinned": *body.Pinned,
		}, clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"pinned": *body.Pinned, "peerGuuid": peerGuuid})
}

// handleHostedTargetPin 统一置顶入口，支持三级：分组（联盟/俱乐部）、托管账号（盟主/群主）、会话。
func (s *Server) handleHostedTargetPin(w http.ResponseWriter, r *http.Request, p agentPrincipal) {
	var body struct {
		Type   string `json:"type"`
		ID     string `json:"id"`
		Guuid  string `json:"guuid"`
		Pinned *bool  `json:"pinned"`
	}
	if !decodeJSON(w, r, &body, 8<<10) {
		return
	}
	if body.Pinned == nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "缺少置顶状态")
		return
	}
	targetType := strings.TrimSpace(body.Type)
	targetID := strings.TrimSpace(body.ID)
	if targetID == "" {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "缺少置顶对象")
		return
	}
	ctx := directchat.WithRequestCache(r.Context())
	hostedGuuid, peerGuuid, err := s.direct.SetHostedTargetPin(ctx, targetType, targetID, body.Guuid, *body.Pinned, p.ID, p.DisplayName)
	if err != nil {
		writeDirectBizError(w, err)
		return
	}
	s.hub.publish("hosted", liveEvent{Type: "hosted.preference", Payload: map[string]any{
		"targetType": targetType, "targetId": targetID, "hostedGuuid": hostedGuuid,
		"peerGuuid": peerGuuid, "pinned": *body.Pinned,
	}})
	s.audit(r.Context(), "agent", strconv.FormatInt(p.ID, 10), "direct.hosted.pin",
		targetType, targetID, map[string]any{
			"hostedGuuid": hostedGuuid, "peerGuuid": peerGuuid, "pinned": *body.Pinned,
		}, clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"pinned": *body.Pinned, "peerGuuid": peerGuuid})
}

// handleHostedDeleteConversation 永久删除一条托管会话（消息与媒体一并清理）。
func (s *Server) handleHostedDeleteConversation(w http.ResponseWriter, r *http.Request, p agentPrincipal) {
	hostedGuuid := strings.TrimSpace(r.URL.Query().Get("guuid"))
	if hostedGuuid == "" {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "缺少托管账号")
		return
	}
	ctx := directchat.WithRequestCache(r.Context())
	conversationID := r.PathValue("id")
	peerGuuid, err := s.direct.DeleteHostedConversation(ctx, hostedGuuid, conversationID)
	if err != nil {
		writeDirectBizError(w, err)
		return
	}
	s.hub.publish("hosted", liveEvent{Type: "hosted.conversation.deleted", ConversationID: conversationID, Payload: map[string]any{
		"hostedGuuid": hostedGuuid, "peerGuuid": peerGuuid,
	}})
	s.audit(r.Context(), "agent", strconv.FormatInt(p.ID, 10), "direct.hosted.delete_conversation",
		"conversation", conversationID, map[string]any{"hostedGuuid": hostedGuuid, "peerGuuid": peerGuuid}, clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"deleted": true})
}

func (s *Server) handleHostedMessages(w http.ResponseWriter, r *http.Request, _ agentPrincipal) {
	query := r.URL.Query()
	guuid := strings.TrimSpace(query.Get("guuid"))
	if guuid == "" {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "缺少托管账号")
		return
	}
	limit, _ := strconv.Atoi(query.Get("limit"))
	ctx := directchat.WithRequestCache(r.Context())
	page, err := s.direct.HostedMessages(ctx, guuid, r.PathValue("id"),
		query.Get("before"), query.Get("after"), limit)
	if err != nil {
		writeDirectBizError(w, err)
		return
	}
	// 任一客服打开最新一页即推进共享已读游标，通知其他客服同步清除红点。
	if strings.TrimSpace(query.Get("before")) == "" && strings.TrimSpace(query.Get("after")) == "" {
		s.hub.publish("hosted", liveEvent{Type: "hosted.read", ConversationID: r.PathValue("id"),
			Payload: map[string]any{"hostedGuuid": guuid}})
	}
	writeData(w, http.StatusOK, page)
}

func (s *Server) handleHostedSendMessage(w http.ResponseWriter, r *http.Request, principal agentPrincipal) {
	var body struct {
		Guuid           string `json:"guuid"`
		Text            string `json:"text"`
		ClientMessageID string `json:"clientMessageId"`
	}
	if !decodeJSON(w, r, &body, 16<<10) {
		return
	}
	hostedGuuid := strings.TrimSpace(body.Guuid)
	if hostedGuuid == "" {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "缺少托管账号")
		return
	}
	ctx := directchat.WithRequestCache(r.Context())
	conversationID := r.PathValue("id")
	view, duplicate, recipient, clubID, err := s.direct.SendHostedMessage(ctx, hostedGuuid, conversationID,
		directchat.SendRequest{
			MessageType:     directchat.MessageText,
			Text:            body.Text,
			ClientMessageID: body.ClientMessageID,
		})
	if err != nil {
		writeDirectBizError(w, err)
		return
	}
	if !duplicate && s.directHandler != nil {
		// 对方和托管账号本人都会收到 message.new，游戏客户端可立即刷新。
		s.directHandler.PublishMessageNew([]string{recipient, hostedGuuid}, conversationID, view.ID, clubID)
	}
	if !duplicate {
		// 客服代发对其他在线客服也是实时可见；不是客户来消息，不触发声音。
		s.hub.publish("hosted", liveEvent{Type: "hosted.message", ConversationID: conversationID, Payload: map[string]any{
			"hostedGuuid": hostedGuuid, "messageId": view.ID, "clubId": clubID,
			"senderName": view.SenderName, "messageType": view.MessageType, "preview": view.Text,
			"incoming": false,
		}})
	}
	s.audit(r.Context(), "agent", strconv.FormatInt(principal.ID, 10), "direct.hosted.reply",
		"conversation", conversationID, map[string]any{
			"hostedGuuid": hostedGuuid, "messageId": view.ID, "duplicate": duplicate,
		}, clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"message": view, "duplicate": duplicate})
}

// writeDirectBizError 把直聊业务错误原样映射到 HTTP 状态和错误码。
func writeDirectBizError(w http.ResponseWriter, err error) {
	biz := directchat.AsError(err)
	status := biz.Status
	if status == 0 {
		status = http.StatusInternalServerError
	}
	writeError(w, status, biz.Code, biz.Message)
}
