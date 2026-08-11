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

const (
	hallRoomDefaultPageSize = 50
	hallRoomMaxPageSize     = 200
)

type hallRoomListResult struct {
	Number  int            `json:"number"`
	Count   int            `json:"count"`
	Result  []hallRoomItem `json:"result"`
	Context string         `json:"context"`
	Error   string         `json:"error"`
}

type hallRoomItem struct {
	RoomID                int64    `json:"room_id"`
	RoomType              string   `json:"room_type"`
	RoomName              string   `json:"room_name"`
	RoomStatus            string   `json:"room_status"`
	GameStatus            string   `json:"game_status"`
	PlayMode              string   `json:"play_mode"`
	SpecialRule           []string `json:"special_rule"`
	RoundCount            int      `json:"round_count"`
	GameRound             int      `json:"game_round"`
	PlayerCount           int      `json:"player_count"`
	WatcherCount          int      `json:"watcher_count"`
	PlayerAndWatcherCount int      `json:"player_and_watcher_count"`
	InholdCount           int      `json:"inhold_count"`
	MaxNumber             int      `json:"max_number"`
	ClubID                string   `json:"club_id"`
	ClubName              string   `json:"club_name"`
	CreatorID             string   `json:"creator_guuid"`
	CreatorName           string   `json:"creator_name"`
	CreateDatetime        string   `json:"create_datetime"`
	Remark                string   `json:"remark"`
}

type currentRoomsResponse struct {
	Available    bool           `json:"available"`
	Items        []hallRoomItem `json:"items"`
	Page         int            `json:"page"`
	PageSize     int            `json:"pageSize"`
	Total        int            `json:"total"`
	PlayerCount  int            `json:"playerCount"`
	WatcherCount int            `json:"watcherCount"`
	InholdCount  int            `json:"inholdCount"`
	Source       string         `json:"source"`
	Message      string         `json:"message"`
	RefreshedAt  time.Time      `json:"refreshedAt"`
}

type dissolveRoomRequest struct {
	Mode         string `json:"mode"`
	Confirm      bool   `json:"confirm"`
	ConfirmScope string `json:"confirmScope"`
}

func (s *Server) handleListCurrentRooms(w http.ResponseWriter, r *http.Request, _ principal) {
	page, pageSize := hallRoomPageParams(r)

	requestContext := gameOperationContext("hall-room-list")
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	result, err := s.callGameCommand(ctx, "查询_大厅_所有房间", map[string]any{
		"page": page - 1, "count": pageSize, "context": requestContext,
	})
	if err != nil {
		if s.logger != nil {
			s.logger.Warn("read KB hall room list failed", "error", err, "page", page, "pageSize", pageSize, "context", requestContext)
		}
		writeError(w, http.StatusBadGateway, "ROOM_LIST_UNAVAILABLE", "获取大厅实时房间列表失败，请稍后重试")
		return
	}
	if result.RetCode != 512 {
		message := safeHallRoomListError(result.RetResult)
		if s.logger != nil {
			s.logger.Warn("KB hall room list rejected", "retCode", result.RetCode, "safeError", message, "page", page, "pageSize", pageSize, "context", requestContext)
		}
		writeError(w, http.StatusBadGateway, "ROOM_LIST_REJECTED", message)
		return
	}

	payload, err := decodeHallRoomListResult(result.RetResult, page-1)
	if err != nil {
		if s.logger != nil {
			s.logger.Warn("decode KB hall room list failed", "error", err, "context", requestContext)
		}
		writeError(w, http.StatusBadGateway, "ROOM_LIST_BAD_RESPONSE", "游戏服务返回的房间列表格式不正确")
		return
	}
	if err := validateHallRoomList(payload); err != nil {
		if s.logger != nil {
			s.logger.Warn("validate KB hall room list failed", "error", err, "context", requestContext)
		}
		writeError(w, http.StatusBadGateway, "ROOM_LIST_BAD_RESPONSE", "游戏服务返回的房间列表数据不完整")
		return
	}

	playerCount, watcherCount, inholdCount := 0, 0, 0
	for index := range payload.Result {
		room := &payload.Result[index]
		if room.SpecialRule == nil {
			room.SpecialRule = []string{}
		}
		if room.PlayerAndWatcherCount == 0 && room.PlayerCount+room.WatcherCount > 0 {
			room.PlayerAndWatcherCount = room.PlayerCount + room.WatcherCount
		}
		playerCount += room.PlayerCount
		watcherCount += room.WatcherCount
		inholdCount += room.InholdCount
	}
	writeData(w, http.StatusOK, currentRoomsResponse{
		Available:    true,
		Items:        payload.Result,
		Page:         payload.Number + 1,
		PageSize:     pageSize,
		Total:        payload.Count,
		PlayerCount:  playerCount,
		WatcherCount: watcherCount,
		InholdCount:  inholdCount,
		Source:       "kb_hall_active_rooms",
		Message:      "已从 KB 大厅实时内存读取当前活跃房间",
		RefreshedAt:  time.Now(),
	})
}

func hallRoomPageParams(r *http.Request) (int, int) {
	page, pageSize := 1, hallRoomDefaultPageSize
	if raw := strings.TrimSpace(r.URL.Query().Get("page")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err == nil && value > 0 {
			page = value
		}
	}
	rawSize := strings.TrimSpace(r.URL.Query().Get("page_size"))
	if rawSize == "" {
		rawSize = strings.TrimSpace(r.URL.Query().Get("pageSize"))
	}
	if rawSize != "" {
		value, err := strconv.Atoi(rawSize)
		if err == nil && value > 0 {
			if value > hallRoomMaxPageSize {
				value = hallRoomMaxPageSize
			}
			pageSize = value
		}
	}
	return page, pageSize
}

func decodeHallRoomListResult(raw json.RawMessage, fallbackNumber int) (hallRoomListResult, error) {
	var fields map[string]json.RawMessage
	if len(raw) == 0 || json.Unmarshal(raw, &fields) != nil || fields == nil {
		return hallRoomListResult{}, errors.New("ret_result 不是对象")
	}
	resultRaw, ok := fields["result"]
	if !ok {
		return hallRoomListResult{}, errors.New("ret_result.result 缺失")
	}
	var items []hallRoomItem
	if err := json.Unmarshal(resultRaw, &items); err != nil || items == nil {
		return hallRoomListResult{}, errors.New("ret_result.result 不是数组")
	}
	number, err := legacyJSONInt(fields["number"], fallbackNumber)
	if err != nil {
		return hallRoomListResult{}, errors.New("ret_result.number 不正确")
	}
	count, err := legacyJSONInt(fields["count"], 0)
	if err != nil {
		return hallRoomListResult{}, errors.New("ret_result.count 不正确")
	}
	payload := hallRoomListResult{Number: number, Count: count, Result: items}
	_ = json.Unmarshal(fields["context"], &payload.Context)
	_ = json.Unmarshal(fields["error"], &payload.Error)
	return payload, nil
}

func legacyJSONInt(raw json.RawMessage, fallback int) (int, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return fallback, nil
	}
	var value int
	if err := json.Unmarshal(raw, &value); err == nil {
		return value, nil
	}
	var text string
	if err := json.Unmarshal(raw, &text); err == nil {
		parsed, err := strconv.Atoi(strings.TrimSpace(text))
		if err == nil {
			return parsed, nil
		}
	}
	return 0, errors.New("不是整数")
}

func safeHallRoomListError(raw json.RawMessage) string {
	const fallback = "获取大厅房间列表失败"
	var result struct {
		Error string `json:"error"`
	}
	if json.Unmarshal(raw, &result) != nil {
		return fallback
	}
	switch strings.TrimSpace(result.Error) {
	case "BOSS未初始化", "权限不足", "参数错误":
		return strings.TrimSpace(result.Error)
	default:
		return fallback
	}
}

func validateHallRoomList(payload hallRoomListResult) error {
	if payload.Number < 0 || payload.Count < 0 || payload.Count < len(payload.Result) {
		return errors.New("房间分页数据不正确")
	}
	for _, room := range payload.Result {
		if room.RoomID <= 0 {
			return errors.New("房间号不正确")
		}
		if room.RoomType != "Custom" {
			return errors.New("包含非大厅业务房间")
		}
		if room.RoundCount < 0 || room.GameRound < 0 || room.PlayerCount < 0 || room.WatcherCount < 0 ||
			room.PlayerAndWatcherCount < 0 || room.InholdCount < 0 || room.MaxNumber < 0 {
			return errors.New("房间人数或局数不正确")
		}
	}
	return nil
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
