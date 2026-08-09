package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

const maxRewardPoolValue int64 = 1_000_000_000_000

var rewardPoolDefinitions = []struct {
	Key   string
	Label string
}{
	{Key: "底皮0.1/0.3", Label: "0.1 / 0.3"},
	{Key: "底皮0.2/0.5", Label: "0.2 / 0.5"},
	{Key: "底皮1/3", Label: "1 / 3"},
	{Key: "底皮2/5", Label: "2 / 5"},
	{Key: "底皮5/10", Label: "5 / 10"},
	{Key: "底皮10/20", Label: "10 / 20"},
	{Key: "底皮20/40", Label: "20 / 40"},
	{Key: "底皮50/100", Label: "50 / 100"},
	{Key: "底皮100/200", Label: "100 / 200"},
}

type rewardPoolItem struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Value int64  `json:"value"`
}

type rewardPoolState struct {
	Items          []rewardPoolItem `json:"items"`
	Total          int64            `json:"total"`
	LastUpdatedBy  string           `json:"lastUpdatedBy"`
	LastUpdatedAt  *time.Time       `json:"lastUpdatedAt"`
	UnexpectedKeys []string         `json:"unexpectedKeys"`
}

type updateRewardPoolsRequest struct {
	Rewards  map[string]int64 `json:"rewards"`
	Expected map[string]int64 `json:"expected"`
	Confirm  bool             `json:"confirm"`
}

type rewardPoolSnapshot struct {
	Values         map[string]int64
	UnexpectedKeys []string
}

func (s *Server) handleGetRewardPools(w http.ResponseWriter, r *http.Request, _ principal) {
	snapshot, err := s.fetchRewardPools(r.Context(), gameOperationContext("pool-read"))
	if err != nil {
		s.logger.Error("read reward pools", "error", err)
		writeError(w, http.StatusBadGateway, "REWARD_POOL_QUERY_FAILED", "读取各皮池奖池失败")
		return
	}
	state, err := s.rewardPoolState(r.Context(), snapshot)
	if err != nil {
		s.logger.Error("read reward pool metadata", "error", err)
		writeError(w, http.StatusInternalServerError, "REWARD_POOL_QUERY_FAILED", "读取奖池修改记录失败")
		return
	}
	writeData(w, http.StatusOK, state)
}

func (s *Server) handleUpdateRewardPools(w http.ResponseWriter, r *http.Request, p principal) {
	var input updateRewardPoolsRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if !input.Confirm {
		writeError(w, http.StatusBadRequest, "REWARD_POOL_CONFIRM_REQUIRED", "请确认本次操作将修改游戏各皮池奖池")
		return
	}
	if err := validateRewardPoolValues(input.Rewards); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REWARD_POOLS", err.Error())
		return
	}
	if err := validateRewardPoolValues(input.Expected); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REWARD_POOL_BASELINE", "页面基准数据不完整，请刷新后重试")
		return
	}

	operationContext := gameOperationContext("pool-update")
	operationCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	before, err := s.fetchRewardPools(operationCtx, operationContext+"-before")
	if err != nil {
		s.audit(operationCtx, &p, "game.reward_pool.update", "game_reward_pools", "all",
			map[string]any{"rewards": input.Rewards, "context": operationContext}, nil, nil, 502, "读取修改前奖池失败", clientIP(r))
		writeError(w, http.StatusBadGateway, "REWARD_POOL_QUERY_FAILED", "读取修改前奖池失败")
		return
	}
	if len(before.UnexpectedKeys) > 0 {
		writeError(w, http.StatusConflict, "REWARD_POOL_SCHEMA_CHANGED", "游戏服务出现后台尚未识别的新皮池，请升级后台后再修改")
		return
	}
	if !rewardPoolValuesEqual(before.Values, input.Expected) {
		writeError(w, http.StatusConflict, "REWARD_POOL_CONFLICT", "奖池已被其他操作修改，请刷新页面后重新确认")
		return
	}
	if rewardPoolValuesEqual(before.Values, input.Rewards) {
		writeError(w, http.StatusBadRequest, "REWARD_POOL_UNCHANGED", "奖池金额没有变化")
		return
	}

	requestAudit := map[string]any{"rewards": input.Rewards, "context": operationContext}
	setResult, err := s.callGameCommand(operationCtx, "异步_设置_奖池_数据", map[string]any{
		"rewards": input.Rewards,
		"context": operationContext,
	})
	if err != nil || setResult.RetCode != 512 {
		verifySnapshot, verifyErr := s.fetchRewardPools(operationCtx, operationContext+"-write-failed-check")
		if verifyErr == nil && !rewardPoolValuesEqual(verifySnapshot.Values, before.Values) {
			_ = s.restoreRewardPools(operationCtx, before.Values, operationContext+"-write-failed-restore")
		}
		s.logger.Error("set reward pools", "error", err, "retCode", setResult.RetCode, "context", operationContext)
		s.audit(operationCtx, &p, "game.reward_pool.update", "game_reward_pools", "all", requestAudit,
			map[string]any{"rewards": before.Values}, nil, 502, "游戏服务未接受奖池修改", clientIP(r))
		writeError(w, http.StatusBadGateway, "REWARD_POOL_UPDATE_FAILED", "游戏服务未接受奖池修改")
		return
	}

	after, err := s.waitForRewardPools(operationCtx, input.Rewards, operationContext+"-verify")
	if err != nil {
		restoreErr := s.restoreRewardPools(operationCtx, before.Values, operationContext+"-restore")
		message := "奖池回读校验失败，修改前金额已恢复"
		if restoreErr != nil {
			message = "奖池回读校验失败，恢复原金额也失败，请立即人工检查"
		}
		s.logger.Error("verify reward pools", "error", err, "restoreError", restoreErr, "context", operationContext)
		s.audit(operationCtx, &p, "game.reward_pool.update", "game_reward_pools", "all", requestAudit,
			map[string]any{"rewards": before.Values}, nil, 500, message, clientIP(r))
		writeError(w, http.StatusInternalServerError, "REWARD_POOL_VERIFY_FAILED", message)
		return
	}

	now := time.Now()
	state := rewardPoolStateFromSnapshot(after)
	state.LastUpdatedBy = p.Username
	state.LastUpdatedAt = &now
	s.audit(operationCtx, &p, "game.reward_pool.update", "game_reward_pools", "all", requestAudit,
		map[string]any{"rewards": before.Values}, map[string]any{"rewards": after.Values}, 0, "各皮池奖池已修改并完成回读校验", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{
		"state":   state,
		"message": "各皮池奖池已保存并完成回读校验",
	})
}

func (s *Server) fetchRewardPools(ctx context.Context, operationContext string) (rewardPoolSnapshot, error) {
	result, err := s.callGameCommand(ctx, "异步_获取_奖池_数据", map[string]any{"context": operationContext})
	if err != nil {
		return rewardPoolSnapshot{}, err
	}
	if result.RetCode != 512 {
		return rewardPoolSnapshot{}, fmt.Errorf("reward pool query ret_code %d", result.RetCode)
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(result.RetResult, &raw); err != nil {
		return rewardPoolSnapshot{}, fmt.Errorf("decode reward pools: %w", err)
	}
	known := make(map[string]bool, len(rewardPoolDefinitions))
	values := make(map[string]int64, len(rewardPoolDefinitions))
	for _, definition := range rewardPoolDefinitions {
		known[definition.Key] = true
		encoded, ok := raw[definition.Key]
		if !ok {
			return rewardPoolSnapshot{}, fmt.Errorf("reward pool key %q is missing", definition.Key)
		}
		value, err := decodeRewardPoolValue(encoded)
		if err != nil || value < 0 || value > maxRewardPoolValue {
			return rewardPoolSnapshot{}, fmt.Errorf("reward pool key %q has invalid value", definition.Key)
		}
		values[definition.Key] = value
	}
	unexpected := []string{}
	for key := range raw {
		if !known[key] {
			unexpected = append(unexpected, key)
		}
	}
	sort.Strings(unexpected)
	return rewardPoolSnapshot{Values: values, UnexpectedKeys: unexpected}, nil
}

func (s *Server) rewardPoolState(ctx context.Context, snapshot rewardPoolSnapshot) (rewardPoolState, error) {
	state := rewardPoolStateFromSnapshot(snapshot)
	var updatedBy string
	var updatedAt time.Time
	err := s.db.QueryRowContext(ctx, `SELECT operator_name, created_at FROM mgr_audit_log
WHERE action = 'game.reward_pool.update' AND result_code = 0 ORDER BY id DESC LIMIT 1`).Scan(&updatedBy, &updatedAt)
	if err == nil {
		state.LastUpdatedBy = updatedBy
		state.LastUpdatedAt = &updatedAt
	} else if !errors.Is(err, sql.ErrNoRows) {
		return state, err
	}
	return state, nil
}

func rewardPoolStateFromSnapshot(snapshot rewardPoolSnapshot) rewardPoolState {
	state := rewardPoolState{Items: make([]rewardPoolItem, 0, len(rewardPoolDefinitions)), UnexpectedKeys: snapshot.UnexpectedKeys}
	for _, definition := range rewardPoolDefinitions {
		value := snapshot.Values[definition.Key]
		state.Items = append(state.Items, rewardPoolItem{Key: definition.Key, Label: definition.Label, Value: value})
		state.Total += value
	}
	return state
}

func validateRewardPoolValues(values map[string]int64) error {
	if len(values) != len(rewardPoolDefinitions) {
		return fmt.Errorf("必须提交全部 %d 个皮池金额", len(rewardPoolDefinitions))
	}
	known := make(map[string]bool, len(rewardPoolDefinitions))
	for _, definition := range rewardPoolDefinitions {
		known[definition.Key] = true
		value, ok := values[definition.Key]
		if !ok {
			return fmt.Errorf("缺少皮池：%s", definition.Key)
		}
		if value < 0 || value > maxRewardPoolValue {
			return fmt.Errorf("%s 奖池必须是 0 到 %d 的整数", definition.Key, maxRewardPoolValue)
		}
	}
	for key := range values {
		if !known[key] {
			return fmt.Errorf("不支持的皮池：%s", key)
		}
	}
	return nil
}

func decodeRewardPoolValue(raw json.RawMessage) (int64, error) {
	var value int64
	if err := json.Unmarshal(raw, &value); err == nil {
		return value, nil
	}
	var text string
	if err := json.Unmarshal(raw, &text); err != nil {
		return 0, err
	}
	return strconv.ParseInt(strings.TrimSpace(text), 10, 64)
}

func rewardPoolValuesEqual(left, right map[string]int64) bool {
	if len(left) != len(right) {
		return false
	}
	for key, value := range left {
		if right[key] != value {
			return false
		}
	}
	return true
}

func (s *Server) waitForRewardPools(ctx context.Context, expected map[string]int64, operationContext string) (rewardPoolSnapshot, error) {
	var last rewardPoolSnapshot
	var lastErr error
	for attempt := 0; attempt < 8; attempt++ {
		last, lastErr = s.fetchRewardPools(ctx, fmt.Sprintf("%s-%d", operationContext, attempt+1))
		if lastErr == nil && len(last.UnexpectedKeys) == 0 && rewardPoolValuesEqual(last.Values, expected) {
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
	return last, errors.New("reward pool values did not match expected values")
}

func (s *Server) restoreRewardPools(ctx context.Context, values map[string]int64, operationContext string) error {
	result, err := s.callGameCommand(ctx, "异步_设置_奖池_数据", map[string]any{
		"rewards": values,
		"context": operationContext,
	})
	if err != nil {
		return err
	}
	if result.RetCode != 512 {
		return fmt.Errorf("reward pool restore ret_code %d", result.RetCode)
	}
	_, err = s.waitForRewardPools(ctx, values, operationContext+"-verify")
	return err
}
