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
