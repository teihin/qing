package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

const roomCreationAllowedConfigKey = "can_all_create_room"

var roomCreationControlMutationMu sync.Mutex

type roomCreationControlState struct {
	Allowed       bool       `json:"allowed"`
	Status        string     `json:"status"`
	LastUpdatedBy string     `json:"lastUpdatedBy"`
	LastUpdatedAt *time.Time `json:"lastUpdatedAt"`
}

type updateRoomCreationControlRequest struct {
	Allowed         *bool `json:"allowed"`
	ExpectedAllowed *bool `json:"expectedAllowed"`
	Confirm         bool  `json:"confirm"`
}

func (s *Server) handleGetRoomCreationControl(w http.ResponseWriter, r *http.Request, p principal) {
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	allowed, err := s.fetchRoomCreationAllowed(ctx, gameOperationContext("room-create-control-read"))
	if err != nil {
		if s.logger != nil {
			s.logger.Error("read room creation control", "error", err)
		}
		writeError(w, http.StatusBadGateway, "ROOM_CREATION_CONTROL_QUERY_FAILED", "读取服务器创建房间开关失败")
		return
	}
	state := newRoomCreationControlState(allowed)
	updatedBy, updatedAt, err := s.latestAuditAttribution(ctx, "game.room.creation_control.update", p)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "ROOM_CREATION_CONTROL_QUERY_FAILED", "读取房间创建开关修改记录失败")
		return
	}
	state.LastUpdatedBy = updatedBy
	state.LastUpdatedAt = updatedAt
	writeData(w, http.StatusOK, state)
}

func (s *Server) handleUpdateRoomCreationControl(w http.ResponseWriter, r *http.Request, p principal) {
	var input updateRoomCreationControlRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if input.Allowed == nil || input.ExpectedAllowed == nil {
		writeError(w, http.StatusBadRequest, "INVALID_ROOM_CREATION_CONTROL", "请提交目标状态和页面当前状态")
		return
	}
	if !input.Confirm {
		writeError(w, http.StatusBadRequest, "ROOM_CREATION_CONTROL_CONFIRM_REQUIRED", "请确认本次操作将影响玩家、BOSS 和系统自动创建房间")
		return
	}

	roomCreationControlMutationMu.Lock()
	defer roomCreationControlMutationMu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	operationContext := gameOperationContext("room-create-control-update")
	before, err := s.fetchRoomCreationAllowed(ctx, operationContext+"-before")
	if err != nil {
		s.audit(ctx, &p, "game.room.creation_control.update", "hall_configuration", roomCreationAllowedConfigKey, roomCreationControlAudit(*input.Allowed, operationContext), nil, nil, http.StatusBadGateway, "读取修改前房间创建开关失败", clientIP(r))
		writeError(w, http.StatusBadGateway, "ROOM_CREATION_CONTROL_QUERY_FAILED", "读取修改前房间创建开关失败")
		return
	}
	if before != *input.ExpectedAllowed {
		writeError(w, http.StatusConflict, "ROOM_CREATION_CONTROL_CONFLICT", "服务器创建房间开关已被其他操作修改，请刷新后重新确认")
		return
	}
	if before == *input.Allowed {
		writeError(w, http.StatusBadRequest, "ROOM_CREATION_CONTROL_UNCHANGED", "服务器创建房间开关没有变化")
		return
	}

	requestAudit := roomCreationControlAudit(*input.Allowed, operationContext)
	if err := s.setRoomCreationAllowed(ctx, *input.Allowed, operationContext+"-write"); err != nil {
		restoreErr := s.restoreRoomCreationAllowed(ctx, before, operationContext+"-write-failed-restore")
		message := "服务器创建房间开关写入失败，已恢复修改前状态"
		if restoreErr != nil {
			message = "服务器创建房间开关写入失败，恢复原状态也失败，请立即人工检查"
		}
		if s.logger != nil {
			s.logger.Error("set room creation control", "error", err, "restoreError", restoreErr, "context", operationContext)
		}
		s.audit(ctx, &p, "game.room.creation_control.update", "hall_configuration", roomCreationAllowedConfigKey, requestAudit, roomCreationControlAudit(before, ""), nil, http.StatusBadGateway, message, clientIP(r))
		writeError(w, http.StatusBadGateway, "ROOM_CREATION_CONTROL_UPDATE_FAILED", message)
		return
	}

	after, err := s.waitForRoomCreationAllowed(ctx, *input.Allowed, operationContext+"-verify")
	if err != nil {
		restoreErr := s.restoreRoomCreationAllowed(ctx, before, operationContext+"-verify-failed-restore")
		message := "服务器创建房间开关回读校验失败，已恢复修改前状态"
		if restoreErr != nil {
			message = "服务器创建房间开关回读校验失败，恢复原状态也失败，请立即人工检查"
		}
		if s.logger != nil {
			s.logger.Error("verify room creation control", "error", err, "restoreError", restoreErr, "context", operationContext)
		}
		s.audit(ctx, &p, "game.room.creation_control.update", "hall_configuration", roomCreationAllowedConfigKey, requestAudit, roomCreationControlAudit(before, ""), nil, http.StatusInternalServerError, message, clientIP(r))
		writeError(w, http.StatusInternalServerError, "ROOM_CREATION_CONTROL_VERIFY_FAILED", message)
		return
	}

	now := time.Now()
	state := newRoomCreationControlState(after)
	state.LastUpdatedBy = p.Username
	state.LastUpdatedAt = &now
	message := "已允许玩家、BOSS 和系统自动创建新房间"
	if !after {
		message = "已禁止玩家、BOSS 和系统自动创建新房间；现有房间不会被自动解散"
	}
	s.audit(ctx, &p, "game.room.creation_control.update", "hall_configuration", roomCreationAllowedConfigKey, requestAudit, roomCreationControlAudit(before, ""), roomCreationControlAudit(after, ""), 0, message, clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"state": state, "message": message})
}

func (s *Server) fetchRoomCreationAllowed(ctx context.Context, operationContext string) (bool, error) {
	raw, err := s.fetchHallConfigurationValue(ctx, roomCreationAllowedConfigKey, operationContext)
	if err != nil {
		return false, err
	}
	return parseRoomCreationAllowed(raw)
}

func parseRoomCreationAllowed(raw string) (bool, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "true":
		return true, nil
	case "false":
		return false, nil
	default:
		return false, fmt.Errorf("%s 必须是 true 或 false", roomCreationAllowedConfigKey)
	}
}

func (s *Server) setRoomCreationAllowed(ctx context.Context, allowed bool, operationContext string) error {
	result, err := s.callGameCommand(ctx, "设置_大厅_配置数据", map[string]any{
		"param_name":  roomCreationAllowedConfigKey,
		"param_value": allowed,
		"context":     operationContext,
	})
	if err != nil {
		return err
	}
	if result.RetCode != 512 {
		return fmt.Errorf("set %s ret_code %d", roomCreationAllowedConfigKey, result.RetCode)
	}
	return nil
}

func (s *Server) waitForRoomCreationAllowed(ctx context.Context, expected bool, operationContext string) (bool, error) {
	var last bool
	var lastErr error
	for attempt := 0; attempt < 8; attempt++ {
		last, lastErr = s.fetchRoomCreationAllowed(ctx, fmt.Sprintf("%s-%d", operationContext, attempt+1))
		if lastErr == nil && last == expected {
			return last, nil
		}
		if attempt < 7 {
			timer := time.NewTimer(250 * time.Millisecond)
			select {
			case <-ctx.Done():
				timer.Stop()
				return last, ctx.Err()
			case <-timer.C:
			}
		}
	}
	if lastErr != nil {
		return last, lastErr
	}
	return last, errors.New("room creation control did not match expected value")
}

func (s *Server) restoreRoomCreationAllowed(ctx context.Context, allowed bool, operationContext string) error {
	if err := s.setRoomCreationAllowed(ctx, allowed, operationContext+"-write"); err != nil {
		return err
	}
	_, err := s.waitForRoomCreationAllowed(ctx, allowed, operationContext+"-verify")
	return err
}

func newRoomCreationControlState(allowed bool) roomCreationControlState {
	status := "禁止创建"
	if allowed {
		status = "允许创建"
	}
	return roomCreationControlState{Allowed: allowed, Status: status}
}

func roomCreationControlAudit(allowed bool, operationContext string) map[string]any {
	result := map[string]any{"allowed": allowed, "configValue": allowed}
	if operationContext != "" {
		result["context"] = operationContext
	}
	return result
}
