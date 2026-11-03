package api

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

// 群主钻石池 = club_agent_info 中该俱乐部创建者那一行的 stone。
//
// 增加和扣减都走游戏服「增加_俱乐部_钻石」，扣减按负数 stone_number 传入；
// 成功后回读 club_agent_info.stone，只有与目标一致才算成功。写操作统一串行化，
// 避免并发叠加让基准值校验失效。所有操作写 mgr_audit_log。

var clubStonePoolMutationMu sync.Mutex

type adjustClubStonePoolRequest struct {
	Action        string `json:"action"`
	Amount        int64  `json:"amount"`
	Reason        string `json:"reason"`
	ExpectedStone int64  `json:"expectedStone"`
	Confirm       bool   `json:"confirm"`
}

type clubOwnerStoneState struct {
	OwnerID   string
	OwnerName string
	Stone     int64
	RoomID    int64
}

type clubStonePoolAdjustmentResponse struct {
	ClubID    string `json:"clubId"`
	OwnerID   string `json:"ownerId"`
	OwnerName string `json:"ownerName"`
	Action    string `json:"action"`
	StonePool int64  `json:"stonePool"`
	Delta     int64  `json:"delta"`
	Verified  bool   `json:"verified"`
	Message   string `json:"message"`
}

func (s *Server) handleAdjustClubStonePool(w http.ResponseWriter, r *http.Request, p principal) {
	clubID, err := normalizeClubID(r.PathValue("clubId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_CLUB_ID", err.Error())
		return
	}
	var input adjustClubStonePoolRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Action, err = normalizeClubStonePoolAction(input.Action)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_ADJUSTMENT_ACTION", err.Error())
		return
	}
	if input.Amount < 1 || input.Amount > 1000000 {
		writeError(w, http.StatusBadRequest, "INVALID_ADJUSTMENT_AMOUNT", "单次加减钻石必须是 1 到 1,000,000 的整数")
		return
	}
	input.Reason, err = normalizeUnionQuotaReason(input.Reason)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_ADJUSTMENT_REASON", err.Error())
		return
	}
	if !input.Confirm {
		writeError(w, http.StatusBadRequest, "ADJUSTMENT_CONFIRM_REQUIRED", "请确认本次操作会直接改变群主钻石池")
		return
	}

	clubStonePoolMutationMu.Lock()
	defer clubStonePoolMutationMu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 18*time.Second)
	defer cancel()

	owner, err := s.readClubOwnerStoneState(ctx, clubID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "CLUB_OWNER_NOT_FOUND", "没有找到这个俱乐部或它的群主")
		return
	}
	if err != nil {
		s.logger.Error("read club owner stone pool", "error", err, "clubId", clubID)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取群主钻石池失败")
		return
	}
	if owner.Stone != input.ExpectedStone {
		writeError(w, http.StatusConflict, "STONE_CHANGED", "群主钻石池已变化，请刷新俱乐部列表后重新操作")
		return
	}

	delta := input.Amount
	if input.Action == "subtract" {
		if input.Amount > owner.Stone {
			writeError(w, http.StatusConflict, "INSUFFICIENT_STONE", "扣减钻石不能超过群主当前钻石池")
			return
		}
		delta = -input.Amount
	}
	target := owner.Stone + delta
	operationContext := gameOperationContext("club-stone")
	requestAudit := map[string]any{
		"clubId": clubID, "ownerId": owner.OwnerID, "action": input.Action,
		"amount": input.Amount, "reason": input.Reason, "context": operationContext,
	}
	beforeAudit := map[string]any{"ownerId": owner.OwnerID, "stonePool": owner.Stone}

	result, callErr := s.callGameCommand(ctx, "增加_俱乐部_钻石", map[string]any{
		"club_id": clubID, "stone_number": delta, "context": operationContext,
	})
	if callErr != nil {
		s.logger.Error("adjust club stone pool", "error", callErr, "clubId", clubID, "ownerId", owner.OwnerID)
		s.audit(ctx, &p, "game.club.stone_pool_adjust", "game_club", clubID, requestAudit, beforeAudit, nil,
			502, "游戏服务未确认钻石池变更成功", clientIP(r))
		writeError(w, http.StatusBadGateway, "STONE_POOL_ADJUSTMENT_FAILED", "游戏服务未确认钻石池变更成功，已停止操作")
		return
	}
	if result.RetCode != 512 && result.RetCode != 1280 {
		message := gameCommandErrorMessage(result, "群主钻石池调整被拒绝")
		s.audit(ctx, &p, "game.club.stone_pool_adjust", "game_club", clubID, requestAudit, beforeAudit, nil,
			400, message, clientIP(r))
		writeError(w, http.StatusBadRequest, "STONE_POOL_ADJUSTMENT_REJECTED", message)
		return
	}

	after, verifyErr := s.waitForClubStonePool(ctx, clubID, owner.OwnerID, target)
	verified := verifyErr == nil
	afterStone := target
	if !verified {
		afterStone = after
		s.logger.Error("verify club stone pool", "error", verifyErr, "clubId", clubID, "ownerId", owner.OwnerID)
	}

	actionLabel := "增加"
	if input.Action == "subtract" {
		actionLabel = "扣减"
	}
	message := fmt.Sprintf("群主钻石池已%s %d 钻，游戏服已回读校验", actionLabel, input.Amount)
	if !verified {
		message = "钻石池变更已提交，但未能回读校验；请刷新俱乐部列表确认，不要重复提交"
	}
	resultCode := 0
	if !verified {
		resultCode = 202
	}
	s.audit(ctx, &p, "game.club.stone_pool_adjust", "game_club", clubID, requestAudit, beforeAudit,
		map[string]any{"ownerId": owner.OwnerID, "stonePool": afterStone, "verified": verified}, resultCode, message, clientIP(r))
	writeData(w, http.StatusOK, clubStonePoolAdjustmentResponse{
		ClubID: clubID, OwnerID: owner.OwnerID, OwnerName: owner.OwnerName, Action: input.Action,
		StonePool: afterStone, Delta: delta, Verified: verified, Message: message,
	})
}

func (s *Server) readClubOwnerStoneState(ctx context.Context, clubID string) (clubOwnerStoneState, error) {
	var status string
	if err := s.db.QueryRowContext(ctx, `SELECT COALESCE(club_status, '')
FROM kbedm.club_guuid_info WHERE club_guuid = ? LIMIT 1`, clubID).Scan(&status); err != nil {
		return clubOwnerStoneState{}, err
	}
	if status == "init" || status == "del" {
		return clubOwnerStoneState{}, sql.ErrNoRows
	}
	owners, _, err := s.clubOwnersAndAgentCounts(ctx, []string{clubID})
	if err != nil {
		return clubOwnerStoneState{}, err
	}
	ownerID := strings.TrimSpace(owners[clubID])
	if ownerID == "" {
		return clubOwnerStoneState{}, sql.ErrNoRows
	}

	var state clubOwnerStoneState
	err = s.db.QueryRowContext(ctx, `SELECT sm_guuid, COALESCE(sm_name, ''), COALESCE(sm_roomID, 0)
FROM kbedm.tbl_Account WHERE sm_guuid = ? LIMIT 1`, ownerID).
		Scan(&state.OwnerID, &state.OwnerName, &state.RoomID)
	if err != nil {
		return clubOwnerStoneState{}, err
	}
	state.Stone, err = s.readClubStonePool(ctx, clubID, ownerID)
	if err != nil {
		return clubOwnerStoneState{}, err
	}
	return state, nil
}

func (s *Server) waitForClubStonePool(ctx context.Context, clubID, ownerID string, expected int64) (int64, error) {
	var last int64
	var lastErr error
	for attempt := 0; attempt < 16; attempt++ {
		last, lastErr = s.readClubStonePool(ctx, clubID, ownerID)
		if lastErr == nil && last == expected {
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
	return last, fmt.Errorf("club stone pool %d does not match expected %d", last, expected)
}

func normalizeClubStonePoolAction(value string) (string, error) {
	value = strings.TrimSpace(strings.ToLower(value))
	if value != "add" && value != "subtract" {
		return "", errors.New("请选择增加或扣减钻石池")
	}
	return value, nil
}
