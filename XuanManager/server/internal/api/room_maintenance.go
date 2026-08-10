package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

var roomMaintenanceMutationMu sync.Mutex

type dissolveRoomRequest struct {
	Mode         string `json:"mode"`
	Confirm      bool   `json:"confirm"`
	ConfirmScope string `json:"confirmScope"`
}

func (s *Server) handleListCurrentRooms(w http.ResponseWriter, r *http.Request, _ principal) {
	keyword := strings.TrimSpace(r.URL.Query().Get("keyword"))
	if len([]rune(keyword)) > 100 {
		writeError(w, http.StatusBadRequest, "INVALID_FILTER", "查询内容不能超过 100 个字符")
		return
	}
	writeData(w, http.StatusOK, map[string]any{
		"available":   false,
		"items":       []any{},
		"total":       0,
		"playerCount": 0,
		"source":      "unavailable",
		"message":     "游戏服务尚未提供后台专用的实时房间列表接口；已停用不可靠的玩家 sm_roomID 历史记录，避免把已解散房间显示为当前房间。",
		"refreshedAt": time.Now(),
	})
}

func (s *Server) handleDissolveRoom(w http.ResponseWriter, r *http.Request, p principal) {
	roomID, err := strconv.ParseInt(strings.TrimSpace(r.PathValue("roomId")), 10, 64)
	if err != nil || roomID <= 0 {
		writeError(w, http.StatusBadRequest, "INVALID_ROOM_ID", "房间号必须是正整数")
		return
	}
	var input dissolveRoomRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if err := validateDissolveRequest(input, false); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_DISSOLVE_REQUEST", err.Error())
		return
	}
	roomMaintenanceMutationMu.Lock()
	defer roomMaintenanceMutationMu.Unlock()
	before := map[string]any{
		"roomId":    roomID,
		"source":    "operator_input",
		"liveState": "unverified",
	}
	s.executeRoomDissolve(w, r, p, roomID, input.Mode, before, false)
}

func (s *Server) handleDissolveAllRooms(w http.ResponseWriter, r *http.Request, p principal) {
	if !p.IsSuper {
		writeError(w, http.StatusForbidden, "SUPER_ADMIN_REQUIRED", "解散全部房间仅允许超级管理员执行")
		return
	}
	var input dissolveRoomRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if err := validateDissolveRequest(input, true); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_DISSOLVE_REQUEST", err.Error())
		return
	}
	roomMaintenanceMutationMu.Lock()
	defer roomMaintenanceMutationMu.Unlock()
	before := map[string]any{
		"scope":     "all",
		"source":    "game_service_command",
		"liveState": "unverified",
	}
	s.executeRoomDissolve(w, r, p, 0, input.Mode, before, true)
}

func validateDissolveRequest(input dissolveRoomRequest, all bool) error {
	if input.Mode != "force" && input.Mode != "friendly" {
		return errors.New("解散方式必须是强制解散或友好解散")
	}
	if !input.Confirm {
		return errors.New("请先确认本次房间解散操作")
	}
	if all && input.ConfirmScope != "ALL_ROOMS" {
		return errors.New("解散全部房间需要输入 ALL_ROOMS 进行范围确认")
	}
	return nil
}

func (s *Server) executeRoomDissolve(w http.ResponseWriter, r *http.Request, p principal, roomID int64, mode string, before any, all bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	command := map[string]any{}
	if all {
		command["header"] = "强制_解散_全部房间_事件"
	} else {
		command["header"] = "强制_解散_事件"
		command["room_id"] = strconv.FormatInt(roomID, 10)
	}
	if mode == "friendly" {
		command["is_qiangzhi"] = 0
	}
	commandBody, _ := json.Marshal(command)
	operationContext := gameOperationContext("room-dissolve")
	result, err := s.callGameCommand(ctx, "异步_执行_房间_命令", map[string]any{
		"room_id": roomID, "cmd": string(commandBody), "context": operationContext,
	})
	target := strconv.FormatInt(roomID, 10)
	if all {
		target = "all"
	}
	requestAudit := map[string]any{"roomId": roomID, "scope": target, "mode": mode, "context": operationContext}
	if err != nil || (result.RetCode != 512 && result.RetCode != 1280) {
		code := result.RetCode
		if err != nil {
			code = 502
		}
		s.audit(ctx, &p, "game.room.dissolve", "game_room", target, requestAudit, before, nil, code, "游戏服务拒绝房间解散命令", clientIP(r))
		writeError(w, http.StatusBadGateway, "ROOM_DISSOLVE_FAILED", "游戏服务未接受房间解散命令")
		return
	}
	message := "指定房间的解散命令已提交；游戏服务未提供结果回读，请在客户端确认房间已消失"
	if all {
		message = "全部房间的解散命令已提交；游戏服务未提供结果回读，请在客户端确认"
	}
	s.audit(ctx, &p, "game.room.dissolve", "game_room", target, requestAudit, before, map[string]any{"status": "accepted", "retCode": result.RetCode}, 0, message, clientIP(r))
	writeData(w, http.StatusAccepted, map[string]any{"status": "accepted", "mode": mode, "roomId": roomID, "message": message})
}
