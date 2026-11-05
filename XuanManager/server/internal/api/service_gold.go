package api

import (
	"net/http"
	"strings"
)

// 客服托管上下分：ChatTool 通过本机服务通道调用后台，后台再执行游戏厅命令。
// 两套系统保持分离：ChatTool 不直接访问 8890 游戏管理通道。

type serviceClubMemberGoldRequest struct {
	Delta   int    `json:"delta"`
	Actor   string `json:"actor"`
	Context string `json:"context"`
}

func (s *Server) handleServiceClubMemberGold(w http.ResponseWriter, r *http.Request) {
	var input serviceClubMemberGoldRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	clubID := strings.TrimSpace(r.PathValue("clubId"))
	userID := strings.TrimSpace(r.PathValue("userId"))
	if clubID == "" || userID == "" {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "缺少俱乐部或玩家编号")
		return
	}
	if input.Delta == 0 || input.Delta > 1_000_000_000 || input.Delta < -1_000_000_000 {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "积分变动必须是 -1000000000 到 1000000000 之间的非零整数")
		return
	}
	actor := strings.TrimSpace(input.Actor)
	if len(actor) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "操作人标识过长")
		return
	}
	if actor == "" {
		actor = "chattool"
	}
	operationContext := strings.TrimSpace(input.Context)
	if operationContext == "" || len(operationContext) > 128 {
		operationContext = gameOperationContext("chat-hosted-gold")
	}
	auditRequest := map[string]any{
		"clubId": clubID, "userId": userID, "delta": input.Delta,
		"actor": actor, "context": operationContext,
	}
	result, callErr := s.callGameCommand(r.Context(), "添加_俱乐部_成员_积分", map[string]any{
		"club_id": clubID, "user_id": userID, "user_add_gold": input.Delta,
		"context": operationContext,
	})
	if callErr != nil {
		s.logger.Error("service club member gold command failed", "error", callErr,
			"clubId", clubID, "userId", userID, "actor", actor)
		s.audit(r.Context(), nil, "game.club.member_gold_adjust", "game_club_member", clubID+":"+userID,
			auditRequest, nil, nil, 502, "游戏服务调用失败", clientIP(r))
		writeError(w, http.StatusBadGateway, "GOLD_COMMAND_FAILED", "游戏服务未确认上下分成功")
		return
	}
	if result.RetCode != 512 && result.RetCode != 1280 {
		message := gameCommandErrorMessage(result, "上下分被游戏服务拒绝")
		s.audit(r.Context(), nil, "game.club.member_gold_adjust", "game_club_member", clubID+":"+userID,
			auditRequest, nil, nil, 400, message, clientIP(r))
		writeError(w, http.StatusBadRequest, "GOLD_REJECTED", message)
		return
	}
	s.audit(r.Context(), nil, "game.club.member_gold_adjust", "game_club_member", clubID+":"+userID,
		auditRequest, nil, map[string]any{"retCode": result.RetCode}, 0, "客服托管上下分成功", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"retCode": result.RetCode, "message": "上下分成功"})
}
