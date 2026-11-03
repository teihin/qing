package api

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

var playerStoneMutationMu sync.Mutex

type adjustPlayerStoneRequest struct {
	Action        string `json:"action"`
	Amount        int64  `json:"amount"`
	Reason        string `json:"reason"`
	ExpectedStone int64  `json:"expectedStone"`
	Confirm       bool   `json:"confirm"`
}

type playerStoneState struct {
	PlayerID string `json:"playerId"`
	Name     string `json:"name"`
	Stone    int64  `json:"stone"`
	RoomID   int64  `json:"roomId"`
}

func (s *Server) handleAdjustPlayerStone(w http.ResponseWriter, r *http.Request, p principal) {
	playerID, err := normalizeGamePlayerID(r.PathValue("playerId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PLAYER_ID", err.Error())
		return
	}
	var input adjustPlayerStoneRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Action = strings.TrimSpace(strings.ToLower(input.Action))
	if input.Action != "add" && input.Action != "subtract" {
		writeError(w, http.StatusBadRequest, "INVALID_ADJUSTMENT_ACTION", "请选择加钻石或减钻石")
		return
	}
	if input.Amount < 1 || input.Amount > 1000000 {
		writeError(w, http.StatusBadRequest, "INVALID_ADJUSTMENT_AMOUNT", "单次加减钻石必须是 1 到 1,000,000 的整数")
		return
	}
	input.Reason, err = normalizeAdjustmentReason(input.Reason)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_ADJUSTMENT_REASON", err.Error())
		return
	}
	if !input.Confirm {
		writeError(w, http.StatusBadRequest, "ADJUSTMENT_CONFIRM_REQUIRED", "请确认本次操作会直接改变玩家钻石")
		return
	}

	playerStoneMutationMu.Lock()
	defer playerStoneMutationMu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 18*time.Second)
	defer cancel()
	before, err := s.readPlayerStoneState(ctx, playerID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "PLAYER_NOT_FOUND", "没有找到这个游戏玩家 ID")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取玩家钻石失败")
		return
	}
	if code, message := stoneAdjustmentConflict(input, before); code != "" {
		writeError(w, http.StatusConflict, code, message)
		return
	}

	delta := input.Amount
	if input.Action == "subtract" {
		delta = -input.Amount
	}
	target := before.Stone + delta
	operationContext := gameOperationContext("stone")
	requestAudit := map[string]any{"action": input.Action, "amount": input.Amount, "reason": input.Reason, "context": operationContext}
	if err := s.setPlayerStone(ctx, playerID, target, operationContext); err != nil {
		s.logger.Error("adjust game player stone", "error", err, "playerId", playerID, "context", operationContext)
		s.audit(ctx, &p, "game.player.stone_adjust", "game_player", playerID, requestAudit, before, nil, 502, "游戏钻石服务未确认成功", clientIP(r))
		writeError(w, http.StatusBadGateway, "STONE_ADJUSTMENT_FAILED", "游戏服务未确认加减钻石成功，已停止操作")
		return
	}
	after, err := s.waitForPlayerStone(ctx, playerID, target)
	if err != nil {
		s.audit(ctx, &p, "game.player.stone_adjust", "game_player", playerID, requestAudit, before, nil, 500, "加减钻石已提交但回读校验失败", clientIP(r))
		writeError(w, http.StatusInternalServerError, "STONE_VERIFY_FAILED", "加减钻石已提交，但未能确认最终钻石数量，请立即刷新玩家列表核对，切勿重复提交")
		return
	}
	message := fmt.Sprintf("已为玩家 %s %s %d 钻石", playerID, map[bool]string{true: "增加", false: "扣减"}[input.Action == "add"], input.Amount)
	if before.RoomID > 0 {
		message += "；玩家当前在房间，牌桌已带入的钻石以房间服务为准"
	}
	s.audit(ctx, &p, "game.player.stone_adjust", "game_player", playerID, requestAudit, before, after, 0, message, clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"player": after, "delta": delta, "context": operationContext, "message": message})
}

func stoneAdjustmentConflict(input adjustPlayerStoneRequest, before playerStoneState) (string, string) {
	if before.Stone != input.ExpectedStone {
		return "STONE_CHANGED", "玩家钻石已变化，请刷新玩家列表后重新操作"
	}
	if input.Action == "subtract" && input.Amount > before.Stone {
		return "INSUFFICIENT_STONE", "扣减钻石不能超过玩家当前钻石数量"
	}
	return "", ""
}

func (s *Server) readPlayerStoneState(ctx context.Context, playerID string) (playerStoneState, error) {
	var state playerStoneState
	err := s.db.QueryRowContext(ctx, `SELECT sm_guuid, sm_name, sm_stone, sm_roomID
FROM kbedm.tbl_Account WHERE sm_guuid = ? LIMIT 1`, playerID).
		Scan(&state.PlayerID, &state.Name, &state.Stone, &state.RoomID)
	return state, err
}

func (s *Server) setPlayerStone(ctx context.Context, playerID string, target int64, operationContext string) error {
	result, err := s.callGameCommand(ctx, "异步_设置_玩家_属性", map[string]any{
		"guuid":   playerID,
		"name":    "stone",
		"value":   strconv.FormatInt(target, 10),
		"context": operationContext,
	})
	if err != nil {
		return err
	}
	if result.RetCode != 512 && result.RetCode != 1280 {
		return fmt.Errorf("set player stone ret_code %d", result.RetCode)
	}
	return nil
}

func (s *Server) waitForPlayerStone(ctx context.Context, playerID string, expected int64) (playerStoneState, error) {
	var last playerStoneState
	var lastErr error
	for attempt := 0; attempt < 16; attempt++ {
		last, lastErr = s.readPlayerStoneState(ctx, playerID)
		if lastErr == nil && last.Stone == expected {
			return last, nil
		}
		if attempt < 15 {
			timer := time.NewTimer(300 * time.Millisecond)
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
	return last, fmt.Errorf("stone %d does not match expected %d", last.Stone, expected)
}
