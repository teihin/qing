package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
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

type dissolveRoomResponse struct {
	Status         string `json:"status"`
	Mode           string `json:"mode"`
	RoomID         int64  `json:"roomId,omitempty"`
	CommandSent    bool   `json:"commandSent"`
	Verified       bool   `json:"verified"`
	RoomExists     bool   `json:"roomExists"`
	RoomStatus     string `json:"roomStatus,omitempty"`
	TargetCount    int    `json:"targetCount,omitempty"`
	AcceptedCount  int    `json:"acceptedCount,omitempty"`
	RemainingCount int    `json:"remainingCount,omitempty"`
	FailedCount    int    `json:"failedCount,omitempty"`
	Message        string `json:"message"`
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
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	if all {
		s.executeAllRoomDissolve(ctx, w, r, p, mode, before)
		return
	}
	s.executeSingleRoomDissolve(ctx, w, r, p, roomID, mode, before)
}

func (s *Server) executeSingleRoomDissolve(ctx context.Context, w http.ResponseWriter, r *http.Request, p principal, roomID int64, mode string, fallbackBefore any) {
	room, found, err := s.findActiveHallRoom(ctx, roomID)
	if err != nil {
		writeError(w, http.StatusBadGateway, "ROOM_STATE_UNAVAILABLE", "执行前无法核对 KB 实时房间状态，请稍后重试")
		return
	}
	if !found {
		writeError(w, http.StatusNotFound, "ROOM_NOT_ACTIVE", "该房间已不在 KB 大厅实时房间列表中")
		return
	}
	before := any(room)
	if room.RoomID == 0 {
		before = fallbackBefore
	}
	operationContext := gameOperationContext(roomDissolveContextAction(mode))
	result, err := s.sendRoomDissolveCommand(ctx, roomID, mode, operationContext)
	requestAudit := map[string]any{"roomId": roomID, "scope": strconv.FormatInt(roomID, 10), "mode": mode, "cmd": roomDissolveCommand(mode), "context": operationContext}
	if err != nil {
		code := result.RetCode
		if code == 0 {
			code = http.StatusBadGateway
		}
		s.audit(ctx, &p, "game.room.dissolve", "game_room", strconv.FormatInt(roomID, 10), requestAudit, before, nil, code, "游戏服务拒绝房间解散命令", clientIP(r))
		writeError(w, http.StatusBadGateway, "ROOM_DISSOLVE_FAILED", "游戏服务未接受房间解散命令")
		return
	}

	remaining, verifyErr := s.verifyRoomsDissolved(ctx, []int64{roomID})
	response := dissolveRoomResponse{Status: "pending", Mode: mode, RoomID: roomID, CommandSent: true, Verified: false, RoomExists: true}
	statusCode := http.StatusAccepted
	if verifyErr != nil {
		response.Status = "verification_unavailable"
		response.Message = "解散命令已发送，但 KB 实时房间列表复查失败，当前不能确认解散成功"
	} else if len(remaining) == 0 {
		response.Status = "dissolved"
		response.Verified = true
		response.RoomExists = false
		response.Message = "已通过 KB 实时房间列表确认房间解散"
		statusCode = http.StatusOK
	} else {
		response.RoomStatus = displayHallRoomStatus(remaining[0])
		response.Message = "解散命令已发送，但复查时房间仍存在，当前不能确认解散成功"
	}
	after := map[string]any{"status": response.Status, "retCode": result.RetCode, "commandSent": true, "verified": response.Verified, "roomExists": response.RoomExists, "roomStatus": response.RoomStatus}
	s.audit(ctx, &p, "game.room.dissolve", "game_room", strconv.FormatInt(roomID, 10), requestAudit, before, after, 0, response.Message, clientIP(r))
	writeData(w, statusCode, response)
}

func (s *Server) executeAllRoomDissolve(ctx context.Context, w http.ResponseWriter, r *http.Request, p principal, mode string, fallbackBefore any) {
	rooms, err := s.fetchAllActiveHallRooms(ctx)
	if err != nil {
		writeError(w, http.StatusBadGateway, "ROOM_STATE_UNAVAILABLE", "执行前无法读取 KB 实时房间列表，未发送任何解散命令")
		return
	}
	if len(rooms) == 0 {
		writeData(w, http.StatusOK, dissolveRoomResponse{Status: "no_active_rooms", Mode: mode, Verified: true, RoomExists: false, Message: "当前没有需要解散的活跃房间"})
		return
	}

	roomIDs := make([]int64, 0, len(rooms))
	acceptedIDs := make([]int64, 0, len(rooms))
	failedIDs := make([]int64, 0)
	retCodes := make(map[string]int, len(rooms))
	for _, room := range rooms {
		roomIDs = append(roomIDs, room.RoomID)
		operationContext := gameOperationContext(roomDissolveContextAction(mode))
		result, sendErr := s.sendRoomDissolveCommand(ctx, room.RoomID, mode, operationContext)
		retCodes[strconv.FormatInt(room.RoomID, 10)] = result.RetCode
		if sendErr != nil {
			failedIDs = append(failedIDs, room.RoomID)
			continue
		}
		acceptedIDs = append(acceptedIDs, room.RoomID)
	}

	requestAudit := map[string]any{"scope": "all", "mode": mode, "cmd": roomDissolveCommand(mode), "roomIds": roomIDs}
	before := any(rooms)
	if len(rooms) == 0 {
		before = fallbackBefore
	}
	if len(acceptedIDs) == 0 {
		message := "游戏服务未接受任何房间解散命令"
		after := map[string]any{"status": "failed", "retCodes": retCodes, "failedRoomIds": failedIDs}
		s.audit(ctx, &p, "game.room.dissolve", "game_room", "all", requestAudit, before, after, http.StatusBadGateway, message, clientIP(r))
		writeError(w, http.StatusBadGateway, "ROOM_DISSOLVE_FAILED", message)
		return
	}

	remaining, verifyErr := s.verifyRoomsDissolved(ctx, acceptedIDs)
	response := dissolveRoomResponse{
		Status: "pending", Mode: mode, CommandSent: true, Verified: false, RoomExists: true,
		TargetCount: len(roomIDs), AcceptedCount: len(acceptedIDs), RemainingCount: len(remaining), FailedCount: len(failedIDs),
	}
	statusCode := http.StatusAccepted
	if verifyErr != nil {
		response.Status = "verification_unavailable"
		response.Message = fmt.Sprintf("已向 %d 个房间发送命令，但实时列表复查失败，当前不能确认全部解散成功", len(acceptedIDs))
	} else if len(remaining) == 0 && len(failedIDs) == 0 {
		response.Status = "dissolved"
		response.Verified = true
		response.RoomExists = false
		response.Message = fmt.Sprintf("已通过 KB 实时房间列表确认 %d 个房间全部解散", len(acceptedIDs))
		statusCode = http.StatusOK
	} else {
		response.RoomExists = len(remaining) > 0 || len(failedIDs) > 0
		response.Message = fmt.Sprintf("命令已发送：目标 %d 个，已接受 %d 个，复查仍存在 %d 个，发送失败 %d 个；当前不能确认全部解散成功", len(roomIDs), len(acceptedIDs), len(remaining), len(failedIDs))
	}
	after := map[string]any{"status": response.Status, "retCodes": retCodes, "acceptedRoomIds": acceptedIDs, "remainingRoomIds": hallRoomIDs(remaining), "failedRoomIds": failedIDs, "verified": response.Verified}
	s.audit(ctx, &p, "game.room.dissolve", "game_room", "all", requestAudit, before, after, 0, response.Message, clientIP(r))
	writeData(w, statusCode, response)
}

func roomDissolveCommand(mode string) string {
	if mode == "friendly" {
		return "申请_解散_事件"
	}
	return "强制_解散_事件"
}

func roomDissolveContextAction(mode string) string {
	if mode == "friendly" {
		return "room-friendly-dissolve"
	}
	return "room-force-dissolve"
}

func (s *Server) sendRoomDissolveCommand(ctx context.Context, roomID int64, mode, operationContext string) (gameCommandResponse, error) {
	result, err := s.callGameCommand(ctx, "异步_执行_房间_命令", map[string]any{
		"room_id": roomID,
		"cmd":     roomDissolveCommand(mode),
		"context": operationContext,
	})
	if err != nil {
		return result, err
	}
	if result.RetCode != 512 && result.RetCode != 1280 {
		return result, fmt.Errorf("room dissolve ret_code %d", result.RetCode)
	}
	return result, nil
}

func (s *Server) findActiveHallRoom(ctx context.Context, roomID int64) (hallRoomItem, bool, error) {
	rooms, err := s.fetchAllActiveHallRooms(ctx)
	if err != nil {
		return hallRoomItem{}, false, err
	}
	for _, room := range rooms {
		if room.RoomID == roomID && !hallRoomClosed(room) {
			return room, true, nil
		}
	}
	return hallRoomItem{}, false, nil
}

func (s *Server) fetchAllActiveHallRooms(ctx context.Context) ([]hallRoomItem, error) {
	const maxPages = 50
	roomsByID := make(map[int64]hallRoomItem)
	total := 0
	for page := 0; page < maxPages; page++ {
		result, err := s.callGameCommand(ctx, "查询_大厅_所有房间", map[string]any{
			"page": page, "count": hallRoomMaxPageSize, "context": gameOperationContext("room-dissolve-verify"),
		})
		if err != nil {
			return nil, err
		}
		if result.RetCode != 512 {
			return nil, fmt.Errorf("hall room list ret_code %d", result.RetCode)
		}
		payload, err := decodeHallRoomListResult(result.RetResult, page)
		if err != nil {
			return nil, err
		}
		if err := validateHallRoomList(payload); err != nil {
			return nil, err
		}
		if page == 0 {
			total = payload.Count
		}
		for _, room := range payload.Result {
			roomsByID[room.RoomID] = room
		}
		if len(payload.Result) == 0 || len(roomsByID) >= total {
			break
		}
	}
	if total > len(roomsByID) {
		return nil, errors.New("大厅实时房间分页读取不完整")
	}
	rooms := make([]hallRoomItem, 0, len(roomsByID))
	for _, room := range roomsByID {
		if !hallRoomClosed(room) {
			rooms = append(rooms, room)
		}
	}
	sort.Slice(rooms, func(i, j int) bool { return rooms[i].RoomID < rooms[j].RoomID })
	return rooms, nil
}

func (s *Server) verifyRoomsDissolved(ctx context.Context, targetIDs []int64) ([]hallRoomItem, error) {
	targets := make(map[int64]struct{}, len(targetIDs))
	for _, roomID := range targetIDs {
		targets[roomID] = struct{}{}
	}
	delays := []time.Duration{0, 400 * time.Millisecond, 800 * time.Millisecond, 1200 * time.Millisecond, 1600 * time.Millisecond}
	var remaining []hallRoomItem
	for _, delay := range delays {
		if delay > 0 {
			timer := time.NewTimer(delay)
			select {
			case <-ctx.Done():
				timer.Stop()
				return remaining, ctx.Err()
			case <-timer.C:
			}
		}
		rooms, err := s.fetchAllActiveHallRooms(ctx)
		if err != nil {
			return remaining, err
		}
		remaining = remaining[:0]
		for _, room := range rooms {
			if _, ok := targets[room.RoomID]; ok && !hallRoomClosed(room) {
				remaining = append(remaining, room)
			}
		}
		if len(remaining) == 0 {
			return nil, nil
		}
	}
	return remaining, nil
}

func hallRoomClosed(room hallRoomItem) bool {
	status := strings.ToLower(strings.TrimSpace(room.RoomStatus + " " + room.GameStatus))
	for _, marker := range []string{"已关闭", "关闭完成", "已解散", "解散完成", "closed", "dismissed", "dissolved"} {
		if strings.Contains(status, marker) {
			return true
		}
	}
	return false
}

func displayHallRoomStatus(room hallRoomItem) string {
	if status := strings.TrimSpace(room.RoomStatus); status != "" {
		return status
	}
	return strings.TrimSpace(room.GameStatus)
}

func hallRoomIDs(rooms []hallRoomItem) []int64 {
	result := make([]int64, 0, len(rooms))
	for _, room := range rooms {
		result = append(result, room.RoomID)
	}
	return result
}
