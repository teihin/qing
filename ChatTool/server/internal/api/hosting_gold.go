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
	"chattool/internal/security"
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

// readBalanceAfterHostedGold 解决游戏库写入延迟：操作前读一次，成功后短轮询直到余额变化或等于预期值。
func (s *Server) readBalanceAfterHostedGold(ctx context.Context, hostedGuuid, conversationID string,
	before *int64, delta int64) *int64 {
	hasExpected := before != nil
	var expected int64
	if hasExpected {
		expected = *before + delta
	}
	var last *int64
	for attempt := 0; attempt < 5; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return last
			case <-time.After(250 * time.Millisecond):
			}
		}
		view, err := s.direct.HostedBalance(ctx, hostedGuuid, conversationID)
		if err != nil || view.ClubGold == nil {
			continue
		}
		value := *view.ClubGold
		last = &value
		if !hasExpected || value == expected || (before != nil && value != *before) {
			return last
		}
	}
	if hasExpected && (last == nil || (before != nil && *last == *before)) {
		value := expected
		return &value
	}
	return last
}

func (s *Server) handleHostedGold(w http.ResponseWriter, r *http.Request, principal agentPrincipal) {
	var body struct {
		Guuid           string `json:"guuid"`
		Action          string `json:"action"`
		Amount          int    `json:"amount"`
		ClientRequestID string `json:"clientRequestId"`
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
	requestID := strings.TrimSpace(body.ClientRequestID)
	if requestID == "" {
		generated, idErr := security.RandomID()
		if idErr != nil {
			writeError(w, http.StatusInternalServerError, "REQUEST_ID_FAILED", "无法生成操作编号")
			return
		}
		requestID = generated
	}
	if len(requestID) > 64 {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "请求编号过长")
		return
	}
	target, err := s.direct.HostedGoldTarget(r.Context(), hostedGuuid, conversationID)
	if err != nil {
		writeDirectBizError(w, err)
		return
	}
	ledgerID, existing, ledgerErr := s.startHostingGoldLedger(r.Context(), requestID, action, target,
		hostedGuuid, int64(body.Amount), principal)
	if ledgerErr != nil {
		if s.logger != nil {
			s.logger.Error("写入托管上下分账本失败", "error", ledgerErr, "request_id", requestID)
		}
		writeError(w, http.StatusInternalServerError, "LEDGER_FAILED", "账本写入失败，请稍后重试")
		return
	}
	if existing != nil {
		if existing.OperationType != action || existing.Amount != int64(body.Amount) {
			writeError(w, http.StatusConflict, "REQUEST_CONFLICT", "请求编号已被其他操作使用")
			return
		}
		switch existing.Status {
		case "success":
			writeData(w, http.StatusOK, map[string]any{
				"action": existing.OperationType, "amount": existing.Amount, "balance": existing.Balance,
				"duplicate": true, "ledgerId": existing.ID,
				"message": "该操作已成功，未重复执行",
			})
			return
		case "pending":
			writeError(w, http.StatusConflict, "HOSTED_GOLD_PENDING", "操作处理中，请勿重复提交")
			return
		default:
			writeError(w, http.StatusConflict, "HOSTED_GOLD_RETRY", "上次操作未成功，请重新发起")
			return
		}
	}
	delta := body.Amount
	if action == "down" {
		delta = -body.Amount
	}
	operationContext := "cs-hosted-gold-" + requestID
	actor := fmt.Sprintf("chattool:agent:%d", principal.ID)
	var beforeBalance *int64
	if view, balanceErr := s.direct.HostedBalance(r.Context(), hostedGuuid, conversationID); balanceErr == nil {
		beforeBalance = view.ClubGold
	}
	if callErr := s.callXuanMemberGold(r.Context(), target.ClubID, target.PeerGuuid, delta, actor, operationContext); callErr != nil {
		_ = s.finishHostingGoldLedger(r.Context(), ledgerID, "failed", nil, callErr.Error())
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
				"amount": body.Amount, "action": action, "context": operationContext,
				"requestId": requestID, "ledgerId": ledgerID, "error": callErr.Error(),
			}, clientIP(r))
		writeError(w, status, code, message)
		return
	}

	balance := s.readBalanceAfterHostedGold(r.Context(), hostedGuuid, conversationID, beforeBalance, int64(delta))
	if finishErr := s.finishHostingGoldLedger(r.Context(), ledgerID, "success", balance, ""); finishErr != nil && s.logger != nil {
		s.logger.Error("更新托管上下分账本失败", "error", finishErr, "ledger_id", ledgerID, "request_id", requestID)
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
			"requestId": requestID, "ledgerId": ledgerID, "balance": balance,
			"noticeMessageId": notice.ID, "noticeError": noticeError,
		}, clientIP(r))
	writeData(w, http.StatusOK, map[string]any{
		"action": action, "amount": body.Amount, "message": notice, "balance": balance,
		"duplicate": false, "ledgerId": ledgerID,
		"noticeError": noticeError, "peerName": target.PeerName,
	})
}
