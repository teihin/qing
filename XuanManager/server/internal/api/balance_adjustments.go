package api

import (
	"context"
	"crypto/md5"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

var playerBalanceMutationMu sync.Mutex

type adjustPlayerBalanceRequest struct {
	Action          string  `json:"action"`
	Amount          int64   `json:"amount"`
	Reason          string  `json:"reason"`
	ExpectedBalance float64 `json:"expectedBalance"`
	Confirm         bool    `json:"confirm"`
}

type playerBalanceState struct {
	PlayerID string  `json:"playerId"`
	Name     string  `json:"name"`
	Gold     int64   `json:"gold"`
	Gold2    int64   `json:"gold2"`
	Balance  float64 `json:"balance"`
	RoomID   int64   `json:"roomId"`
}

func (s *Server) handleAdjustPlayerBalance(w http.ResponseWriter, r *http.Request, p principal) {
	playerID, err := normalizeGamePlayerID(r.PathValue("playerId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PLAYER_ID", err.Error())
		return
	}
	var input adjustPlayerBalanceRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Action = strings.TrimSpace(strings.ToLower(input.Action))
	if input.Action != "add" && input.Action != "subtract" {
		writeError(w, http.StatusBadRequest, "INVALID_ADJUSTMENT_ACTION", "请选择加分或减分")
		return
	}
	if input.Amount < 1 || input.Amount > 1000000 {
		writeError(w, http.StatusBadRequest, "INVALID_ADJUSTMENT_AMOUNT", "单次加减分必须是 1 到 1,000,000 的整数金币")
		return
	}
	input.Reason, err = normalizeAdjustmentReason(input.Reason)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_ADJUSTMENT_REASON", err.Error())
		return
	}
	if !input.Confirm {
		writeError(w, http.StatusBadRequest, "ADJUSTMENT_CONFIRM_REQUIRED", "请确认本次操作会直接改变玩家金币")
		return
	}
	if s.cfg.GameExchangeSign == "" {
		writeError(w, http.StatusServiceUnavailable, "BALANCE_SERVICE_NOT_CONFIGURED", "玩家加减分服务尚未配置")
		return
	}

	playerBalanceMutationMu.Lock()
	defer playerBalanceMutationMu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 18*time.Second)
	defer cancel()
	before, err := s.readPlayerBalanceState(ctx, playerID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "PLAYER_NOT_FOUND", "没有找到这个游戏玩家 ID")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取玩家金币失败")
		return
	}
	if before.RoomID > 0 {
		writeError(w, http.StatusConflict, "PLAYER_IN_ROOM", "玩家正在房间中，请离开房间后再加减分，避免桌上金币与账号金币不同步")
		return
	}
	if math.Abs(before.Balance-input.ExpectedBalance) > 0.005 {
		writeError(w, http.StatusConflict, "BALANCE_CHANGED", "玩家余额已变化，请刷新玩家列表后重新操作")
		return
	}
	if input.Action == "subtract" && float64(input.Amount) > before.Balance {
		writeError(w, http.StatusConflict, "INSUFFICIENT_BALANCE", "减分金额不能超过玩家当前金币")
		return
	}

	delta := input.Amount
	prefix := "BF"
	if input.Action == "subtract" {
		delta = -input.Amount
		prefix = "TK"
	}
	workOrder := fmt.Sprintf("%sXM%s%s", prefix, time.Now().Format("20060102150405"), gameOperationContext("score")[11:17])
	requestAudit := map[string]any{"action": input.Action, "amount": input.Amount, "reason": input.Reason, "workOrder": workOrder}
	if err := s.callBalanceExchange(ctx, playerID, delta, workOrder); err != nil {
		s.logger.Error("adjust game player balance", "error", err, "playerId", playerID, "workOrder", workOrder)
		s.audit(ctx, &p, "game.player.balance_adjust", "game_player", playerID, requestAudit, before, nil, 502, "游戏加减分服务未确认成功", clientIP(r))
		writeError(w, http.StatusBadGateway, "BALANCE_ADJUSTMENT_FAILED", "游戏服务未确认加减分成功，已停止操作")
		return
	}
	expected := before.Balance + float64(delta)
	after, err := s.waitForPlayerBalance(ctx, playerID, expected)
	if err != nil {
		s.audit(ctx, &p, "game.player.balance_adjust", "game_player", playerID, requestAudit, before, nil, 500, "加减分已提交但余额回读校验失败", clientIP(r))
		writeError(w, http.StatusInternalServerError, "BALANCE_VERIFY_FAILED", "加减分已提交，但未能确认最终余额，请立即刷新玩家流水核对，切勿重复提交")
		return
	}
	message := fmt.Sprintf("已为玩家 %s %s %d 金币", playerID, map[bool]string{true: "增加", false: "扣减"}[input.Action == "add"], input.Amount)
	s.audit(ctx, &p, "game.player.balance_adjust", "game_player", playerID, requestAudit, before, after, 0, message, clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"player": after, "delta": delta, "workOrder": workOrder, "message": message})
}

func normalizeAdjustmentReason(value string) (string, error) {
	value = strings.TrimSpace(value)
	if utf8.RuneCountInString(value) < 2 || utf8.RuneCountInString(value) > 120 {
		return "", errors.New("客服维护原因必须填写 2 到 120 个字符")
	}
	for _, char := range value {
		if unicode.IsControl(char) {
			return "", errors.New("客服维护原因不能包含换行或控制字符")
		}
	}
	return strings.Join(strings.Fields(value), " "), nil
}

func (s *Server) readPlayerBalanceState(ctx context.Context, playerID string) (playerBalanceState, error) {
	var state playerBalanceState
	err := s.db.QueryRowContext(ctx, `SELECT sm_guuid, sm_name, sm_gold, sm_gold2,
(sm_gold + sm_gold2 / 100.0), sm_roomID FROM kbedm.tbl_Account WHERE sm_guuid = ? LIMIT 1`, playerID).
		Scan(&state.PlayerID, &state.Name, &state.Gold, &state.Gold2, &state.Balance, &state.RoomID)
	return state, err
}

func (s *Server) callBalanceExchange(ctx context.Context, playerID string, delta int64, workOrder string) error {
	coin := strconv.FormatInt(delta, 10)
	digest := md5.Sum([]byte(s.cfg.GameExchangeSign + coin + playerID)) // Legacy game protocol requires MD5.
	param, err := json.Marshal(map[string]string{
		"coin": coin, "coin2": "0", "num": coin, "guuid": playerID,
		"work_order": workOrder, "sgin": hex.EncodeToString(digest[:]),
	})
	if err != nil {
		return err
	}
	query := url.Values{}
	query.Set("param", string(param))
	endpoint := strings.TrimRight(s.cfg.GameAdminURL, "/") + "/newmeng793afw/exchange?" + query.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	response, err := s.gameHTTPClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return err
	}
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("exchange HTTP status %d", response.StatusCode)
	}
	var result gameCommandResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return err
	}
	if result.RetCode != 512 {
		return fmt.Errorf("exchange ret_code %d", result.RetCode)
	}
	return nil
}

func (s *Server) waitForPlayerBalance(ctx context.Context, playerID string, expected float64) (playerBalanceState, error) {
	var last playerBalanceState
	var lastErr error
	for attempt := 0; attempt < 16; attempt++ {
		last, lastErr = s.readPlayerBalanceState(ctx, playerID)
		if lastErr == nil && math.Abs(last.Balance-expected) <= 0.005 {
			return last, nil
		}
		if attempt < 15 {
			select {
			case <-ctx.Done():
				return last, ctx.Err()
			case <-time.After(300 * time.Millisecond):
			}
		}
	}
	if lastErr != nil {
		return last, lastErr
	}
	return last, fmt.Errorf("balance %.2f does not match expected %.2f", last.Balance, expected)
}
