package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"chattool/internal/directchat"
)

// 客服托管上下分：ChatTool 只调用后台服务（XuanManager），由后台执行游戏命令，
// 不直接访问游戏服 8890 管理通道，保持两套系统分离。

type xuanServiceError struct {
	Status  int
	Message string
}

func (e *xuanServiceError) Error() string { return e.Message }

var xuanServiceHTTPClient = &http.Client{Timeout: 10 * time.Second}

func (s *Server) callXuanMemberGold(ctx context.Context, clubID, userID string, delta int, actor, operationContext string) error {
	if s.cfg.XuanServiceToken == "" {
		return &xuanServiceError{Status: http.StatusServiceUnavailable, Message: "客服上下分尚未配置后台服务令牌"}
	}
	payload, err := json.Marshal(map[string]any{
		"delta": delta, "actor": actor, "context": operationContext,
	})
	if err != nil {
		return &xuanServiceError{Status: http.StatusInternalServerError, Message: "上下分请求编码失败"}
	}
	endpoint := strings.TrimRight(s.cfg.XuanManagerURL, "/") + "/api/service/clubs/" +
		url.PathEscape(clubID) + "/members/" + url.PathEscape(userID) + "/gold"
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return &xuanServiceError{Status: http.StatusInternalServerError, Message: "上下分请求创建失败"}
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+s.cfg.XuanServiceToken)
	response, err := xuanServiceHTTPClient.Do(request)
	if err != nil {
		return &xuanServiceError{Status: http.StatusBadGateway, Message: "后台服务暂不可用，请稍后重试"}
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return &xuanServiceError{Status: http.StatusBadGateway, Message: "后台服务返回内容读取失败"}
	}
	var envelope struct {
		OK   bool `json:"ok"`
		Data struct {
			RetCode int    `json:"retCode"`
			Message string `json:"message"`
		} `json:"data"`
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(data, &envelope); err != nil {
		return &xuanServiceError{Status: http.StatusBadGateway, Message: "后台服务返回内容无法识别"}
	}
	if response.StatusCode != http.StatusOK || !envelope.OK {
		message := strings.TrimSpace(envelope.Error.Message)
		if message == "" {
			message = "后台服务拒绝上下分"
		}
		status := response.StatusCode
		if status < 400 || status > 599 {
			status = http.StatusBadGateway
		}
		return &xuanServiceError{Status: status, Message: message}
	}
	return nil
}

func (s *Server) handleHostedGold(w http.ResponseWriter, r *http.Request, principal agentPrincipal) {
	var body struct {
		Guuid  string `json:"guuid"`
		Action string `json:"action"`
		Amount int    `json:"amount"`
	}
	if !decodeJSON(w, r, &body, 8<<10) {
		return
	}
	hostedGuuid := strings.TrimSpace(body.Guuid)
	action := strings.ToLower(strings.TrimSpace(body.Action))
	if hostedGuuid == "" {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "缺少托管账号")
		return
	}
	if action != "up" && action != "down" {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "操作类型不正确")
		return
	}
	if body.Amount <= 0 || body.Amount > 1_000_000_000 {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "积分必须是 1 到 1000000000 的整数")
		return
	}
	conversationID := r.PathValue("id")
	target, err := s.direct.HostedGoldTarget(r.Context(), hostedGuuid, conversationID)
	if err != nil {
		writeDirectBizError(w, err)
		return
	}
	delta := body.Amount
	if action == "down" {
		delta = -body.Amount
	}
	operationContext := "cs-hosted-gold-" + strconv.FormatInt(time.Now().UnixNano(), 36)
	actor := fmt.Sprintf("chattool:agent:%d", principal.ID)
	if callErr := s.callXuanMemberGold(r.Context(), target.ClubID, target.PeerGuuid, delta, actor, operationContext); callErr != nil {
		status := http.StatusBadGateway
		code := "HOSTED_GOLD_FAILED"
		message := "后台服务未确认上下分成功，请稍后重试"
		var serviceErr *xuanServiceError
		if errors.As(callErr, &serviceErr) {
			status = serviceErr.Status
			code = "HOSTED_GOLD_REJECTED"
			message = serviceErr.Message
		}
		if s.logger != nil {
			s.logger.Error("客服托管上下分失败", "error", callErr, "hosted_guuid", hostedGuuid,
				"club_id", target.ClubID, "peer_guuid", target.PeerGuuid, "agent_id", principal.ID)
		}
		s.audit(r.Context(), "agent", strconv.FormatInt(principal.ID, 10), "direct.hosted.gold",
			"conversation", conversationID, map[string]any{
				"hostedGuuid": hostedGuuid, "clubId": target.ClubID, "peerGuuid": target.PeerGuuid,
				"amount": body.Amount, "action": action, "context": operationContext, "error": callErr.Error(),
			}, clientIP(r))
		writeError(w, status, code, message)
		return
	}

	verb := "上分"
	if action == "down" {
		verb = "下分"
	}
	noticeText := fmt.Sprintf("玩家 %s %s %d 成功（客服托管）", target.PeerName, verb, body.Amount)
	notice, duplicate, recipient, clubID, noticeErr := s.direct.SendHostedMessage(r.Context(), hostedGuuid, conversationID,
		directchat.SendRequest{
			MessageType:     directchat.MessageTypeSystem,
			Text:            noticeText,
			ClientMessageID: "hosted-gold-" + strconv.FormatInt(time.Now().UnixNano(), 36),
		})
	noticeError := ""
	if noticeErr != nil {
		noticeError = directchat.AsError(noticeErr).Message
		if s.logger != nil {
			s.logger.Warn("客服托管上下分成功但系统消息发送失败", "error", noticeErr,
				"hosted_guuid", hostedGuuid, "conversation_id", conversationID)
		}
	} else if !duplicate && s.directHandler != nil {
		s.directHandler.PublishMessageNew([]string{recipient, hostedGuuid}, conversationID, notice.ID, clubID)
		s.hub.publish("hosted", liveEvent{Type: "hosted.message", ConversationID: conversationID, Payload: map[string]any{
			"hostedGuuid": hostedGuuid, "messageId": notice.ID, "clubId": clubID,
			"senderName": notice.SenderName, "messageType": notice.MessageType, "preview": notice.Text,
			"incoming": false,
		}})
	}
	s.audit(r.Context(), "agent", strconv.FormatInt(principal.ID, 10), "direct.hosted.gold",
		"conversation", conversationID, map[string]any{
			"hostedGuuid": hostedGuuid, "clubId": target.ClubID, "peerGuuid": target.PeerGuuid,
			"amount": body.Amount, "action": action, "context": operationContext,
			"noticeMessageId": notice.ID, "noticeError": noticeError,
		}, clientIP(r))
	writeData(w, http.StatusOK, map[string]any{
		"action": action, "amount": body.Amount, "message": notice,
		"noticeError": noticeError, "peerName": target.PeerName,
	})
}
