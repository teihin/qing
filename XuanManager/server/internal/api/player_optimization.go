package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

// 后台「玩家控制」与牌桌内牌局胜率目标使用同一套方案：
// 设置输赢金额（target_value，正=赢、负=输）与触发概率（chance，1~100），
// 由游戏服按局推进进度，达标自动结束或人工停止。
const (
	winTargetListCommand = "异步_查询_胜率目标_列表"
	winTargetSetCommand  = "异步_设置_胜率目标"
	winTargetStopCommand = "异步_停止_胜率目标"
)

const (
	winTargetMaxAmount   = 100000000
	winTargetStateActive = "active"
)

// winTargetWriteTimeout 后台写入命令的短超时。部分游戏服版本的这类命令走客户端推送回包，
// HTTP 通道调用会一直挂住；超时后用查询命令回读确认真实结果，避免后台请求空转。
var winTargetWriteTimeout = 8 * time.Second

// winTargetItem 一条目标：当前目标（state=active/done/stopped）或历史快照。
type winTargetItem struct {
	ID           int64  `json:"id"`
	PlayerID     string `json:"playerId"`
	LoginName    string `json:"loginName"`
	Name         string `json:"name"`
	TargetValue  int64  `json:"targetValue"`
	Chance       int64  `json:"chance"`
	Progress     int64  `json:"progress"`
	Remain       int64  `json:"remain"`
	RoundCount   int64  `json:"roundCount"`
	PeerCount    int64  `json:"peerCount"`
	State        string `json:"state"`
	Active       bool   `json:"active"`
	Online       bool   `json:"online"`
	CurChance    int64  `json:"curChance"`
	CurCount     int64  `json:"curCount"`
	Man          string `json:"man"`
	ManName      string `json:"manName"`
	ScopeType    string `json:"scopeType"`
	ScopeID      string `json:"scopeId"`
	GroupID      int64  `json:"groupId"`
	GroupName    string `json:"groupName"`
	SetAt        string `json:"setAt"`
	FinishAt     string `json:"finishAt"`
	FinishReason string `json:"finishReason"`
}

type winTargetSummary struct {
	ActivePlayers     int64   `json:"activePlayers"`
	TotalTargetAmount int64   `json:"totalTargetAmount"`
	AverageChance     float64 `json:"averageChance"`
}

type setWinTargetRequest struct {
	PlayerID            string `json:"playerId"`
	TargetValue         int64  `json:"targetValue"`
	Chance              int64  `json:"chance"`
	Reason              string `json:"reason"`
	ExpectedTargetValue int64  `json:"expectedTargetValue"`
	ExpectedChance      int64  `json:"expectedChance"`
	Confirm             bool   `json:"confirm"`
}

type stopWinTargetRequest struct {
	Reason              string `json:"reason"`
	ExpectedTargetValue int64  `json:"expectedTargetValue"`
	ExpectedChance      int64  `json:"expectedChance"`
	Confirm             bool   `json:"confirm"`
}

type winTargetCommandError struct {
	status  int
	code    string
	message string
}

func (e *winTargetCommandError) Error() string { return e.message }

var winTargetWriteMu sync.Mutex

func (s *Server) handleListPlayerOptimizations(w http.ResponseWriter, r *http.Request, p principal) {
	page, size := pageParams(r)
	keyword := strings.TrimSpace(r.URL.Query().Get("keyword"))
	if utf8.RuneCountInString(keyword) > 100 {
		writeError(w, http.StatusBadRequest, "INVALID_FILTER", "查询内容不能超过 100 个字符")
		return
	}
	// 列表与历史都按真实 ID 存/比：关键字若是个人ID 靓号，先换回真实 ID。
	keyword = s.resolvePlayerInput(r.Context(), keyword)
	state := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("state")))
	if state == "" {
		state = "all"
	}
	if state != "active" && state != "done" && state != "stopped" && state != "all" {
		writeError(w, http.StatusBadRequest, "INVALID_FILTER", "控制状态只能选择进行中、已达成、已停止或全部")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	activeItems, err := s.queryWinTargets(ctx, "", false, winTargetStateActive)
	if err != nil {
		s.logger.Error("query active win targets", "error", err)
		writeError(w, http.StatusBadGateway, "GAME_COMMAND_FAILED", errorText(err, "读取进行中的玩家控制失败"))
		return
	}
	summary := summarizeWinTargets(activeItems)

	items := activeItems
	if state != "active" {
		queryState := ""
		if state != "all" {
			queryState = state
		}
		items, err = s.queryWinTargets(ctx, "", false, queryState)
		if err != nil {
			s.logger.Error("query win targets", "error", err, "state", state)
			writeError(w, http.StatusBadGateway, "GAME_COMMAND_FAILED", errorText(err, "读取玩家控制列表失败"))
			return
		}
	}

	if keyword != "" {
		items = filterWinTargets(items, keyword)
	}
	s.fillWinTargetLogins(ctx, items)
	if state != "active" {
		s.fillWinTargetLogins(ctx, activeItems)
	}

	total := int64(len(items))
	start := (page - 1) * size
	if start > len(items) {
		start = len(items)
	}
	end := start + size
	if end > len(items) {
		end = len(items)
	}
	writeData(w, http.StatusOK, map[string]any{
		"items": items[start:end], "page": page, "pageSize": size, "total": total, "summary": summary,
	})
}

func (s *Server) handleGetPlayerOptimization(w http.ResponseWriter, r *http.Request, p principal) {
	playerID, err := normalizeGamePlayerID(r.PathValue("playerId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PLAYER_ID", err.Error())
		return
	}
	// 运营直接粘玩家手机上的个人ID 靓号也能核对。
	playerID = s.resolvePlayerInput(r.Context(), playerID)
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	item := winTargetItem{PlayerID: playerID}
	found, err := s.fetchActiveWinTarget(ctx, playerID, &item)
	if err != nil {
		s.logger.Error("read player win target", "error", err, "playerId", playerID)
		writeError(w, http.StatusBadGateway, "GAME_COMMAND_FAILED", errorText(err, "读取玩家控制状态失败"))
		return
	}
	loginName, name, exists, err := s.readGamePlayerIdentity(ctx, playerID)
	if err != nil {
		s.logger.Error("read player identity", "error", err, "playerId", playerID)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取玩家信息失败")
		return
	}
	if !exists {
		writeError(w, http.StatusNotFound, "PLAYER_NOT_FOUND", "没有找到这个游戏玩家 ID")
		return
	}
	item.PlayerID = playerID
	item.LoginName = loginName
	if name != "" {
		item.Name = name
	}
	if !found {
		item.Active = false
		item.State = ""
	}
	writeData(w, http.StatusOK, item)
}

func (s *Server) handleCreatePlayerOptimization(w http.ResponseWriter, r *http.Request, p principal) {
	var input setWinTargetRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	playerID, err := normalizeGamePlayerID(input.PlayerID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PLAYER_ID", err.Error())
		return
	}
	// 「设置胜率目标」只认真实 ID，输入靓号时先反解，再写命令与审计。
	playerID = s.resolvePlayerInput(r.Context(), playerID)
	input.PlayerID = playerID
	if err := normalizeAndValidateWinTargetRequest(&input); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_OPTIMIZATION", err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()

	current := winTargetItem{PlayerID: playerID}
	found, err := s.fetchActiveWinTarget(ctx, playerID, &current)
	if err != nil {
		s.logger.Error("read player win target", "error", err, "playerId", playerID)
		writeError(w, http.StatusBadGateway, "GAME_COMMAND_FAILED", errorText(err, "读取玩家当前控制失败"))
		return
	}
	if found {
		writeError(w, http.StatusConflict, "OPTIMIZATION_ALREADY_EXISTS",
			fmt.Sprintf("该玩家已有进行中的控制（%s，概率 %d%%），请使用调整或停止操作", describeWinTargetValue(current.TargetValue), current.Chance))
		return
	}

	after, err := s.applyWinTarget(ctx, "game.player_optimization.create", p, r, playerID, input.TargetValue, input.Chance, input.Reason, current, false)
	if err != nil {
		s.writeWinTargetFailure(w, p, r, "game.player_optimization.create", playerID, input.TargetValue, input.Chance, input.Reason, current, false, err)
		return
	}
	writeData(w, http.StatusOK, map[string]any{
		"player":  after,
		"message": fmt.Sprintf("已为玩家 %s 设置控制：%s，概率 %d%%", playerID, describeWinTargetValue(after.TargetValue), after.Chance),
	})
}

func (s *Server) handleUpdatePlayerOptimization(w http.ResponseWriter, r *http.Request, p principal) {
	playerID, err := normalizeGamePlayerID(r.PathValue("playerId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PLAYER_ID", err.Error())
		return
	}
	var input setWinTargetRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	input.PlayerID = playerID
	if err := normalizeAndValidateWinTargetRequest(&input); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_OPTIMIZATION", err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()

	current := winTargetItem{PlayerID: playerID}
	found, err := s.fetchActiveWinTarget(ctx, playerID, &current)
	if err != nil {
		s.logger.Error("read player win target", "error", err, "playerId", playerID)
		writeError(w, http.StatusBadGateway, "GAME_COMMAND_FAILED", errorText(err, "读取玩家当前控制失败"))
		return
	}
	if !found {
		writeError(w, http.StatusConflict, "OPTIMIZATION_NOT_FOUND", "该玩家当前没有进行中的控制，请使用新增操作")
		return
	}
	if current.TargetValue != input.ExpectedTargetValue || current.Chance != input.ExpectedChance {
		writeError(w, http.StatusConflict, "OPTIMIZATION_CHANGED", "玩家控制参数已变化，请刷新列表后重新操作")
		return
	}
	if current.TargetValue == input.TargetValue && current.Chance == input.Chance {
		writeError(w, http.StatusBadRequest, "OPTIMIZATION_UNCHANGED", "控制参数没有变化")
		return
	}

	after, err := s.applyWinTarget(ctx, "game.player_optimization.update", p, r, playerID, input.TargetValue, input.Chance, input.Reason, current, true)
	if err != nil {
		s.writeWinTargetFailure(w, p, r, "game.player_optimization.update", playerID, input.TargetValue, input.Chance, input.Reason, current, true, err)
		return
	}
	writeData(w, http.StatusOK, map[string]any{
		"player": after,
		"message": fmt.Sprintf("已调整玩家 %s 的控制：%s，概率 %d%%（进度从 0 重新计算）",
			playerID, describeWinTargetValue(after.TargetValue), after.Chance),
	})
}

func (s *Server) handleDeletePlayerOptimization(w http.ResponseWriter, r *http.Request, p principal) {
	playerID, err := normalizeGamePlayerID(r.PathValue("playerId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PLAYER_ID", err.Error())
		return
	}
	var input stopWinTargetRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.Reason) != "" {
		if err := normalizeOptimizationReason(&input.Reason); err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_OPTIMIZATION", err.Error())
			return
		}
	} else {
		input.Reason = ""
	}
	if !input.Confirm {
		writeError(w, http.StatusBadRequest, "OPTIMIZATION_CONFIRM_REQUIRED", "请确认停止会立即结束该玩家的控制")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()

	current := winTargetItem{PlayerID: playerID}
	found, err := s.fetchActiveWinTarget(ctx, playerID, &current)
	if err != nil {
		s.logger.Error("read player win target", "error", err, "playerId", playerID)
		writeError(w, http.StatusBadGateway, "GAME_COMMAND_FAILED", errorText(err, "读取玩家当前控制失败"))
		return
	}
	if !found {
		writeError(w, http.StatusConflict, "OPTIMIZATION_NOT_FOUND", "该玩家没有进行中的控制")
		return
	}
	if input.ExpectedTargetValue != 0 && (current.TargetValue != input.ExpectedTargetValue || current.Chance != input.ExpectedChance) {
		writeError(w, http.StatusConflict, "OPTIMIZATION_CHANGED", "玩家控制参数已变化，请刷新列表后重新操作")
		return
	}

	winTargetWriteMu.Lock()
	defer winTargetWriteMu.Unlock()
	operationContext := gameOperationContext("player-optimization")
	stopCtx, cancelStop := context.WithTimeout(ctx, winTargetWriteTimeout)
	result, err := s.callGameCommand(stopCtx, winTargetStopCommand, map[string]any{
		"guuids": playerID, "remark": winTargetRemark(input.Reason, "后台停止控制"), "context": operationContext,
	})
	cancelStop()
	if err != nil {
		if stopped, _ := s.confirmWinTargetStopped(ctx, playerID); stopped {
			after := current
			after.State = "stopped"
			after.Active = false
			after.FinishReason = "stop"
			message := fmt.Sprintf("已停止玩家 %s 的控制", playerID)
			requestAudit := map[string]any{"playerId": playerID, "writeMode": "win-target-command", "context": operationContext}
			if input.Reason != "" {
				requestAudit["reason"] = input.Reason
			}
			s.audit(ctx, &p, "game.player_optimization.delete", "game_player", playerID, requestAudit, current, after, 0, message, clientIP(r))
			writeData(w, http.StatusOK, map[string]any{"player": after, "message": message})
			return
		}
		err = &winTargetCommandError{status: http.StatusBadGateway, code: "OPTIMIZATION_GAME_COMMAND_UNREACHABLE",
			message: "游戏服停止接口未响应（该命令当前仅支持牌桌内客户端调用），控制没有停止；请联系游戏服开放后台写入后重试"}
		s.writeWinTargetFailure(w, p, r, "game.player_optimization.delete", playerID, 0, 0, input.Reason, current, true, err)
		return
	}
	if result.RetCode != 512 {
		err = &winTargetCommandError{status: http.StatusBadRequest, code: "OPTIMIZATION_GAME_COMMAND_REJECTED",
			message: describeGameFailure(winTargetStopCommand, result.RetCode, result.RetResult)}
		s.writeWinTargetFailure(w, p, r, "game.player_optimization.delete", playerID, 0, 0, input.Reason, current, true, err)
		return
	}
	if err := parseWinTargetReplyError(result.RetResult); err != nil {
		err = &winTargetCommandError{status: http.StatusBadRequest, code: "OPTIMIZATION_GAME_COMMAND_REJECTED", message: err.Error()}
		s.writeWinTargetFailure(w, p, r, "game.player_optimization.delete", playerID, 0, 0, input.Reason, current, true, err)
		return
	}

	after := current
	after.State = "stopped"
	after.Active = false
	after.FinishReason = "stop"
	after.FinishAt = time.Now().Format("2006-01-02 15:04:05")
	message := fmt.Sprintf("已停止玩家 %s 的控制", playerID)
	requestAudit := map[string]any{
		"playerId": playerID, "writeMode": "win-target-command", "context": operationContext,
		"expectedTargetValue": input.ExpectedTargetValue, "expectedChance": input.ExpectedChance,
	}
	if input.Reason != "" {
		requestAudit["reason"] = input.Reason
	}
	s.audit(ctx, &p, "game.player_optimization.delete", "game_player", playerID, requestAudit, current, after, 0, message, clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"player": after, "message": message})
}

func normalizeAndValidateWinTargetRequest(input *setWinTargetRequest) error {
	if input.TargetValue == 0 {
		return errors.New("输赢金额不能为 0，请选择赢或输并填写金额")
	}
	if input.TargetValue > winTargetMaxAmount || input.TargetValue < -winTargetMaxAmount {
		return fmt.Errorf("输赢金额必须是 1 到 %s 之间的整数", formatThousands(winTargetMaxAmount))
	}
	if input.Chance < 1 || input.Chance > 100 {
		return errors.New("触发概率必须是 1 到 100 的整数")
	}
	if strings.TrimSpace(input.Reason) != "" {
		if err := normalizeOptimizationReason(&input.Reason); err != nil {
			return err
		}
	} else {
		input.Reason = ""
	}
	if !input.Confirm {
		return errors.New("请确认本次操作会改变玩家牌局结果")
	}
	return nil
}

func normalizeOptimizationReason(reason *string) error {
	*reason = strings.Join(strings.Fields(strings.TrimSpace(*reason)), " ")
	if utf8.RuneCountInString(*reason) < 2 || utf8.RuneCountInString(*reason) > 120 {
		return errors.New("操作原因必须填写 2 到 120 个字符")
	}
	for _, char := range *reason {
		if unicode.IsControl(char) {
			return errors.New("操作原因不能包含控制字符")
		}
	}
	return nil
}

// queryWinTargets 走游戏服命令读取目标；history=true 读历史快照表。
func (s *Server) queryWinTargets(ctx context.Context, guuids string, history bool, state string) ([]winTargetItem, error) {
	params := map[string]any{
		"guuids":  guuids,
		"state":   state,
		"context": gameOperationContext("win-target-list"),
	}
	if history {
		params["history"] = 1
	}
	result, err := s.callGameCommand(ctx, winTargetListCommand, params)
	if err != nil {
		return nil, &winTargetCommandError{status: http.StatusBadGateway, code: "GAME_COMMAND_FAILED", message: "游戏服未返回玩家控制数据，请稍后重试"}
	}
	if result.RetCode != 512 {
		return nil, &winTargetCommandError{status: http.StatusBadGateway, code: "GAME_COMMAND_FAILED",
			message: describeGameFailure(winTargetListCommand, result.RetCode, result.RetResult)}
	}
	payload := decodeGameObject(result.RetResult)
	if message := gameValueString(payload, "error"); message != "" {
		return nil, errors.New(message)
	}
	rawList, _ := payload["list"].([]any)
	items := make([]winTargetItem, 0, len(rawList))
	for _, raw := range rawList {
		object, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		items = append(items, winTargetItemFromGame(object))
	}
	return items, nil
}

func (s *Server) fetchActiveWinTarget(ctx context.Context, playerID string, target *winTargetItem) (bool, error) {
	items, err := s.queryWinTargets(ctx, playerID, false, winTargetStateActive)
	if err != nil {
		return false, err
	}
	for _, item := range items {
		if item.PlayerID == playerID && item.Active {
			*target = item
			return true, nil
		}
	}
	return false, nil
}

func (s *Server) applyWinTarget(ctx context.Context, action string, p principal, r *http.Request, playerID string, targetValue, chance int64, reason string, before winTargetItem, hasBefore bool) (winTargetItem, error) {
	winTargetWriteMu.Lock()
	defer winTargetWriteMu.Unlock()
	operationContext := gameOperationContext("player-optimization")
	remark := winTargetRemark(reason, "后台设置控制")
	// 部分游戏服版本的客户端命令在 HTTP 通道不回包（请求会一直挂住），
	// 因此给写入单独一个短超时：超时后回读目标列表确认是否实际生效。
	setCtx, cancelSet := context.WithTimeout(ctx, winTargetWriteTimeout)
	result, err := s.callGameCommand(setCtx, winTargetSetCommand, map[string]any{
		"guuids": playerID, "target_value": targetValue, "chance": chance,
		"remark": remark, "context": operationContext,
	})
	cancelSet()
	if err != nil {
		if confirmed, found := s.confirmWinTargetAfterTimeout(ctx, playerID, targetValue, chance); found {
			return s.recordWinTargetSuccess(ctx, p, r, action, playerID, confirmed, reason, before, hasBefore, operationContext)
		}
		return before, &winTargetCommandError{status: http.StatusBadGateway, code: "OPTIMIZATION_GAME_COMMAND_UNREACHABLE",
			message: "游戏服设置接口未响应（该命令当前仅支持牌桌内客户端调用），参数没有修改；请联系游戏服开放后台写入后重试"}
	}
	if result.RetCode != 512 {
		return before, &winTargetCommandError{status: http.StatusBadRequest, code: "OPTIMIZATION_GAME_COMMAND_REJECTED",
			message: describeGameFailure(winTargetSetCommand, result.RetCode, result.RetResult)}
	}
	if err := parseWinTargetReplyError(result.RetResult); err != nil {
		return before, &winTargetCommandError{status: http.StatusBadRequest, code: "OPTIMIZATION_GAME_COMMAND_REJECTED", message: err.Error()}
	}

	after := winTargetItem{
		PlayerID: playerID, Name: before.Name, LoginName: before.LoginName,
		TargetValue: targetValue, Chance: chance, State: winTargetStateActive, Active: true,
		Progress: 0, Remain: absInt64(targetValue), Man: before.Man, ManName: before.ManName,
		SetAt: time.Now().Format("2006-01-02 15:04:05"),
	}
	confirmed, found, verifyErr := s.waitForWinTarget(ctx, playerID, targetValue, chance)
	if verifyErr == nil && found {
		after = mergeWinTarget(after, confirmed)
	} else if verifyErr != nil {
		s.logger.Warn("verify win target", "error", verifyErr, "playerId", playerID)
	}
	return s.recordWinTargetSuccess(ctx, p, r, action, playerID, after, reason, before, hasBefore, operationContext)
}

func mergeWinTarget(base, confirmed winTargetItem) winTargetItem {
	base.Progress = confirmed.Progress
	base.Remain = confirmed.Remain
	base.SetAt = firstNonEmpty(confirmed.SetAt, base.SetAt)
	base.Man = firstNonEmpty(confirmed.Man, base.Man)
	base.ManName = firstNonEmpty(confirmed.ManName, base.ManName)
	base.RoundCount = confirmed.RoundCount
	base.PeerCount = confirmed.PeerCount
	base.Online = confirmed.Online
	return base
}

// confirmWinTargetAfterTimeout 写入命令超时后，用列表命令确认目标是否已经生效。
func (s *Server) confirmWinTargetAfterTimeout(ctx context.Context, playerID string, targetValue, chance int64) (winTargetItem, bool) {
	checkCtx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	item, found, err := s.waitForWinTarget(checkCtx, playerID, targetValue, chance)
	if err != nil || !found {
		return winTargetItem{}, false
	}
	return item, true
}

func (s *Server) recordWinTargetSuccess(ctx context.Context, p principal, r *http.Request, action, playerID string, after winTargetItem, reason string, before winTargetItem, hasBefore bool, operationContext string) (winTargetItem, error) {
	message := fmt.Sprintf("已设置玩家 %s 的控制：%s，概率 %d%%", playerID, describeWinTargetValue(after.TargetValue), after.Chance)
	requestAudit := map[string]any{
		"playerId": playerID, "targetValue": after.TargetValue, "chance": after.Chance,
		"writeMode": "win-target-command", "context": operationContext,
	}
	if reason != "" {
		requestAudit["reason"] = reason
	}
	var beforeValue any
	if hasBefore {
		beforeValue = before
	}
	s.audit(ctx, &p, action, "game_player", playerID, requestAudit, beforeValue, after, 0, message, clientIP(r))
	return after, nil
}

func (s *Server) writeWinTargetFailure(w http.ResponseWriter, p principal, r *http.Request, action, playerID string, targetValue, chance int64, reason string, before winTargetItem, hasBefore bool, err error) {
	status := http.StatusInternalServerError
	code := "OPTIMIZATION_UPDATE_FAILED"
	message := "游戏服未确认控制写入，参数没有修改"
	var commandErr *winTargetCommandError
	if errors.As(err, &commandErr) {
		status = commandErr.status
		code = commandErr.code
		message = commandErr.message
	}
	s.logger.Error("write win target via game command", "action", action, "error", err, "playerId", playerID)
	requestAudit := map[string]any{"playerId": playerID, "targetValue": targetValue, "chance": chance, "writeMode": "win-target-command"}
	if reason != "" {
		requestAudit["reason"] = reason
	}
	var beforeValue any
	if hasBefore {
		beforeValue = before
	}
	s.audit(r.Context(), &p, action, "game_player", playerID, requestAudit, beforeValue, nil, status, message, clientIP(r))
	writeError(w, status, code, message)
}

func (s *Server) confirmWinTargetStopped(ctx context.Context, playerID string) (bool, bool) {
	checkCtx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	for attempt := 0; attempt < 4; attempt++ {
		item := winTargetItem{PlayerID: playerID}
		found, err := s.fetchActiveWinTarget(checkCtx, playerID, &item)
		if err == nil && !found {
			return true, true
		}
		if attempt < 3 {
			select {
			case <-checkCtx.Done():
				return false, false
			case <-time.After(400 * time.Millisecond):
			}
		}
	}
	return false, false
}

func (s *Server) waitForWinTarget(ctx context.Context, playerID string, targetValue, chance int64) (winTargetItem, bool, error) {
	var lastErr error
	for attempt := 0; attempt < 4; attempt++ {
		item := winTargetItem{PlayerID: playerID}
		found, err := s.fetchActiveWinTarget(ctx, playerID, &item)
		if err == nil && found && item.TargetValue == targetValue && item.Chance == chance {
			return item, true, nil
		}
		if err != nil {
			lastErr = err
		}
		if attempt < 3 {
			select {
			case <-ctx.Done():
				return item, false, ctx.Err()
			case <-time.After(400 * time.Millisecond):
			}
		}
	}
	return winTargetItem{PlayerID: playerID}, false, lastErr
}

func parseWinTargetReplyError(raw json.RawMessage) error {
	payload := decodeGameObject(raw)
	if message := gameValueString(payload, "error"); message != "" {
		return errors.New(message)
	}
	failed, _ := payload["failed"].([]any)
	for _, entry := range failed {
		object, ok := entry.(map[string]any)
		if !ok {
			continue
		}
		if message := gameValueString(object, "error"); message != "" {
			return errors.New(message)
		}
	}
	return nil
}

func winTargetItemFromGame(object map[string]any) winTargetItem {
	item := winTargetItem{
		ID:           anyInt(object["id"]),
		PlayerID:     gameValueString(object, "guuid"),
		Name:         gameValueString(object, "name"),
		TargetValue:  anyInt(object["target_value"]),
		Chance:       anyInt(object["chance"]),
		Progress:     anyInt(object["progress"]),
		Remain:       anyInt(object["remain"]),
		RoundCount:   anyInt(object["round_count"]),
		PeerCount:    anyInt(object["peer_count"]),
		State:        gameValueString(object, "state"),
		Online:       anyInt(object["online"]) == 1,
		CurChance:    anyInt(object["cur_chance"]),
		CurCount:     anyInt(object["cur_count"]),
		Man:          gameValueString(object, "man"),
		ManName:      gameValueString(object, "man_name"),
		ScopeType:    gameValueString(object, "scope_type"),
		ScopeID:      gameValueString(object, "scope_id"),
		GroupID:      anyInt(object["group_id"]),
		GroupName:    gameValueString(object, "group_name"),
		SetAt:        gameValueString(object, "set_time"),
		FinishAt:     gameValueString(object, "finish_time"),
		FinishReason: gameValueString(object, "finish_reason"),
	}
	if item.Chance < 0 {
		item.Chance = -item.Chance
	}
	item.Active = item.State == winTargetStateActive
	if item.Remain == 0 && item.TargetValue != 0 {
		item.Remain = absInt64(item.TargetValue) - absInt64(item.Progress)
	}
	return item
}

func summarizeWinTargets(items []winTargetItem) winTargetSummary {
	var summary winTargetSummary
	var chanceTotal int64
	for _, item := range items {
		if !item.Active {
			continue
		}
		summary.ActivePlayers++
		summary.TotalTargetAmount += absInt64(item.TargetValue)
		chanceTotal += item.Chance
	}
	if summary.ActivePlayers > 0 {
		summary.AverageChance = float64(chanceTotal) / float64(summary.ActivePlayers)
	}
	return summary
}

func filterWinTargets(items []winTargetItem, keyword string) []winTargetItem {
	lower := strings.ToLower(keyword)
	result := make([]winTargetItem, 0, len(items))
	for _, item := range items {
		haystack := strings.ToLower(strings.Join([]string{
			item.PlayerID, item.Name, item.LoginName, item.Man, item.ManName, item.GroupName, item.SetAt,
		}, "\x00"))
		if strings.Contains(haystack, lower) {
			result = append(result, item)
		}
	}
	return result
}

// fillWinTargetLogins 按 guuid 补登录账号，便于后台核对玩家。
func (s *Server) fillWinTargetLogins(ctx context.Context, items []winTargetItem) {
	if s.gameDB == nil || len(items) == 0 {
		return
	}
	ids := make([]string, 0, len(items))
	index := make(map[string][]int, len(items))
	for position := range items {
		id := items[position].PlayerID
		if id == "" {
			continue
		}
		if _, ok := index[id]; !ok {
			ids = append(ids, id)
		}
		index[id] = append(index[id], position)
	}
	if len(ids) == 0 {
		return
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")
	args := make([]any, 0, len(ids))
	for _, id := range ids {
		args = append(args, id)
	}
	rows, err := s.gameDB.QueryContext(ctx, `SELECT a.sm_guuid, COALESCE(k.accountName, a.sm_wxID, ''), COALESCE(a.sm_name, '')
FROM kbedm.tbl_Account a
LEFT JOIN kbedm.kbe_accountinfos k ON k.entityDBID = a.id
WHERE a.sm_guuid IN (`+placeholders+`)`, args...)
	if err != nil {
		s.logger.Warn("load player logins for win targets", "error", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id, loginName, name string
		if err := rows.Scan(&id, &loginName, &name); err != nil {
			continue
		}
		for _, position := range index[id] {
			items[position].LoginName = loginName
			if items[position].Name == "" {
				items[position].Name = name
			}
		}
	}
}

func (s *Server) readGamePlayerIdentity(ctx context.Context, playerID string) (string, string, bool, error) {
	if s.gameDB == nil {
		return "", "", false, nil
	}
	var loginName, name string
	err := s.gameDB.QueryRowContext(ctx, `SELECT COALESCE(k.accountName, a.sm_wxID, ''), COALESCE(a.sm_name, '')
FROM kbedm.tbl_Account a
LEFT JOIN kbedm.kbe_accountinfos k ON k.entityDBID = a.id
WHERE a.sm_guuid = ? LIMIT 1`, playerID).Scan(&loginName, &name)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", false, nil
	}
	if err != nil {
		return "", "", false, err
	}
	return loginName, name, true, nil
}

// handleListPlayerOptimizationHistory 直读游戏库目标历史表：每次设置一条，
// 覆盖、停止、达标都会落库，含游戏内与后台两侧的操作。
func (s *Server) handleListPlayerOptimizationHistory(w http.ResponseWriter, r *http.Request, p principal) {
	page, size := pageParams(r)
	keyword := strings.TrimSpace(r.URL.Query().Get("keyword"))
	if utf8.RuneCountInString(keyword) > 100 {
		writeError(w, http.StatusBadRequest, "INVALID_FILTER", "查询内容不能超过 100 个字符")
		return
	}
	// 列表与历史都按真实 ID 存/比：关键字若是个人ID 靓号，先换回真实 ID。
	keyword = s.resolvePlayerInput(r.Context(), keyword)
	state := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("state")))
	if state != "" && state != "active" && state != "done" && state != "stopped" {
		writeError(w, http.StatusBadRequest, "INVALID_FILTER", "控制状态只能选择进行中、已达成或已停止")
		return
	}

	clauses := []string{"1=1"}
	args := []any{}
	if state != "" {
		clauses = append(clauses, "state = ?")
		args = append(args, state)
	}
	if keyword != "" {
		like := "%" + keyword + "%"
		clauses = append(clauses, "(guuid LIKE ? OR name LIKE ? OR man LIKE ? OR man_name LIKE ? OR group_name LIKE ?)")
		for i := 0; i < 5; i++ {
			args = append(args, like)
		}
	}
	where := strings.Join(clauses, " AND ")

	var total int64
	if err := s.gameDB.QueryRowContext(r.Context(),
		`SELECT COUNT(*) FROM kbedm.usr_opt_target_history WHERE `+where, args...).Scan(&total); err != nil {
		s.logger.Error("count win target history", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取控制历史数量失败")
		return
	}

	queryArgs := append(append([]any{}, args...), size, (page-1)*size)
	rows, err := s.gameDB.QueryContext(r.Context(), `SELECT id, guuid, name, state, target_value, chance, progress,
round_count, peer_count, man, man_name, scope_type, scope_id, group_id, group_name, set_time, finish_time, finish_reason
FROM kbedm.usr_opt_target_history
WHERE `+where+`
ORDER BY id DESC
LIMIT ? OFFSET ?`, queryArgs...)
	if err != nil {
		s.logger.Error("list win target history", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取控制历史失败")
		return
	}
	defer rows.Close()

	items := make([]winTargetItem, 0, size)
	for rows.Next() {
		var item winTargetItem
		if err := rows.Scan(&item.ID, &item.PlayerID, &item.Name, &item.State, &item.TargetValue, &item.Chance,
			&item.Progress, &item.RoundCount, &item.PeerCount, &item.Man, &item.ManName,
			&item.ScopeType, &item.ScopeID, &item.GroupID, &item.GroupName,
			&item.SetAt, &item.FinishAt, &item.FinishReason); err != nil {
			s.logger.Error("scan win target history", "error", err)
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取控制历史数据失败")
			return
		}
		item.Active = item.State == winTargetStateActive
		item.Remain = absInt64(item.TargetValue) - absInt64(item.Progress)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取控制历史数据失败")
		return
	}
	s.fillWinTargetLogins(r.Context(), items)
	writeData(w, http.StatusOK, map[string]any{"items": items, "page": page, "pageSize": size, "total": total})
}

// gameValueString 取游戏服回包里的字符串字段；缺失/null 返回空串，
// 避免 anyString(nil) 退化成 "<nil>" 污染玩家昵称或错误文案。
func gameValueString(object map[string]any, key string) string {
	value, ok := object[key]
	if !ok || value == nil {
		return ""
	}
	text := anyString(value)
	if text == "<nil>" {
		return ""
	}
	return text
}

func winTargetRemark(reason, fallback string) string {	if strings.TrimSpace(reason) != "" {
		return reason
	}
	return fallback
}

func describeWinTargetValue(targetValue int64) string {
	if targetValue >= 0 {
		return "赢 " + formatThousands(targetValue)
	}
	return "输 " + formatThousands(-targetValue)
}

func formatThousands(value int64) string {
	text := strconv.FormatInt(absInt64(value), 10)
	if len(text) <= 3 {
		return text
	}
	var builder strings.Builder
	prefix := len(text) % 3
	if prefix > 0 {
		builder.WriteString(text[:prefix])
	}
	for index := prefix; index < len(text); index += 3 {
		if builder.Len() > 0 {
			builder.WriteString(",")
		}
		builder.WriteString(text[index : index+3])
	}
	return builder.String()
}

func absInt64(value int64) int64 {
	if value < 0 {
		return -value
	}
	return value
}

func errorText(err error, fallback string) string {
	if err == nil {
		return fallback
	}
	text := strings.TrimSpace(err.Error())
	if text == "" {
		return fallback
	}
	return text
}
