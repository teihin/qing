package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

const maxRewardPlatformRetentionYuan int64 = 1_000_000_000

var rewardPoolControlMutationMu sync.Mutex

type rewardPoolControlSnapshot struct {
	RewardRates           map[string]int   `json:"rewardRates"`
	GlobalNoRewardRate    int              `json:"globalNoRewardRate"`
	TierNoRewardRates     map[string]int   `json:"tierNoRewardRates"`
	PlatformRetentionYuan map[string]int64 `json:"platformRetentionYuan"`
}

type rewardPoolControlItem struct {
	Key                       string   `json:"key"`
	Label                     string   `json:"label"`
	BaseRewardRate            *int     `json:"baseRewardRate"`
	TierNoRewardRate          int      `json:"tierNoRewardRate"`
	EstimatedActualRewardRate *float64 `json:"estimatedActualRewardRate"`
	PlatformRetentionYuan     *int64   `json:"platformRetentionYuan"`
}

type rewardPoolControlState struct {
	Items              []rewardPoolControlItem `json:"items"`
	GlobalNoRewardRate int                     `json:"globalNoRewardRate"`
	LastUpdatedBy      string                  `json:"lastUpdatedBy"`
	LastUpdatedAt      *time.Time              `json:"lastUpdatedAt"`
}

type updateRewardPoolControlsRequest struct {
	Values   rewardPoolControlSnapshot `json:"values"`
	Expected rewardPoolControlSnapshot `json:"expected"`
	Confirm  bool                      `json:"confirm"`
}

func (s *Server) handleGetRewardPoolControls(w http.ResponseWriter, r *http.Request, p principal) {
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	snapshot, err := s.fetchRewardPoolControls(ctx, gameOperationContext("pool-control-read"))
	if err != nil {
		if s.logger != nil {
			s.logger.Error("read reward pool controls", "error", err)
		}
		writeError(w, http.StatusBadGateway, "REWARD_POOL_CONTROL_QUERY_FAILED", "读取奖池概率和平台提留配置失败")
		return
	}
	state := rewardPoolControlStateFromSnapshot(snapshot)
	updatedBy, updatedAt, err := s.latestAuditAttribution(ctx, "game.reward_pool.control.update", p)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "REWARD_POOL_CONTROL_QUERY_FAILED", "读取奖池概率修改记录失败")
		return
	}
	state.LastUpdatedBy = updatedBy
	state.LastUpdatedAt = updatedAt
	writeData(w, http.StatusOK, state)
}

func (s *Server) handleUpdateRewardPoolControls(w http.ResponseWriter, r *http.Request, p principal) {
	var input updateRewardPoolControlsRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if !input.Confirm {
		writeError(w, http.StatusBadRequest, "REWARD_POOL_CONTROL_CONFIRM_REQUIRED", "请确认本次操作将修改奖池放奖概率和平台提留")
		return
	}
	if err := validateRewardPoolControlSnapshot(input.Values); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REWARD_POOL_CONTROLS", err.Error())
		return
	}
	if err := validateRewardPoolControlSnapshot(input.Expected); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REWARD_POOL_CONTROL_BASELINE", "页面基准配置不完整，请刷新后重试")
		return
	}

	rewardPoolControlMutationMu.Lock()
	defer rewardPoolControlMutationMu.Unlock()

	operationContext := gameOperationContext("pool-control-update")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	before, err := s.fetchRewardPoolControls(ctx, operationContext+"-before")
	if err != nil {
		s.audit(ctx, &p, "game.reward_pool.control.update", "game_reward_pool_controls", "all", rewardPoolControlAudit(input.Values, operationContext), nil, nil, 502, "读取修改前奖池概率配置失败", clientIP(r))
		writeError(w, http.StatusBadGateway, "REWARD_POOL_CONTROL_QUERY_FAILED", "读取修改前奖池概率配置失败")
		return
	}
	if !rewardPoolControlSnapshotsEqual(before, input.Expected) {
		writeError(w, http.StatusConflict, "REWARD_POOL_CONTROL_CONFLICT", "奖池概率配置已被其他操作修改，请刷新页面后重新确认")
		return
	}
	if rewardPoolControlSnapshotsEqual(before, input.Values) {
		writeError(w, http.StatusBadRequest, "REWARD_POOL_CONTROL_UNCHANGED", "奖池概率和平台提留没有变化")
		return
	}

	requestAudit := rewardPoolControlAudit(input.Values, operationContext)
	if err := s.writeRewardPoolControls(ctx, before, input.Values, false, operationContext+"-write"); err != nil {
		restoreErr := s.restoreRewardPoolControls(ctx, before, operationContext+"-write-failed-restore")
		message := "奖池概率配置写入失败，已恢复修改前配置"
		if restoreErr != nil {
			message = "奖池概率配置写入失败，恢复原配置也失败，请立即人工检查"
		}
		if s.logger != nil {
			s.logger.Error("set reward pool controls", "error", err, "restoreError", restoreErr, "context", operationContext)
		}
		s.audit(ctx, &p, "game.reward_pool.control.update", "game_reward_pool_controls", "all", requestAudit, rewardPoolControlAudit(before, ""), nil, 502, message, clientIP(r))
		writeError(w, http.StatusBadGateway, "REWARD_POOL_CONTROL_UPDATE_FAILED", message)
		return
	}

	after, err := s.waitForRewardPoolControls(ctx, input.Values, operationContext+"-verify")
	if err != nil {
		restoreErr := s.restoreRewardPoolControls(ctx, before, operationContext+"-verify-failed-restore")
		message := "奖池概率配置回读校验失败，已恢复修改前配置"
		if restoreErr != nil {
			message = "奖池概率配置回读校验失败，恢复原配置也失败，请立即人工检查"
		}
		if s.logger != nil {
			s.logger.Error("verify reward pool controls", "error", err, "restoreError", restoreErr, "context", operationContext)
		}
		s.audit(ctx, &p, "game.reward_pool.control.update", "game_reward_pool_controls", "all", requestAudit, rewardPoolControlAudit(before, ""), nil, 500, message, clientIP(r))
		writeError(w, http.StatusInternalServerError, "REWARD_POOL_CONTROL_VERIFY_FAILED", message)
		return
	}

	now := time.Now()
	state := rewardPoolControlStateFromSnapshot(after)
	state.LastUpdatedBy = p.Username
	state.LastUpdatedAt = &now
	s.audit(ctx, &p, "game.reward_pool.control.update", "game_reward_pool_controls", "all", requestAudit, rewardPoolControlAudit(before, ""), rewardPoolControlAudit(after, ""), 0, "奖池放奖概率和平台提留已保存并完成回读校验", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{
		"state":   state,
		"message": "奖池放奖概率和平台提留已保存并完成回读校验",
	})
}

func (s *Server) fetchRewardPoolControls(ctx context.Context, operationContext string) (rewardPoolControlSnapshot, error) {
	rewardRateRaw, err := s.fetchHallConfigurationValue(ctx, "reward_rate", operationContext+"-reward-rate")
	if err != nil {
		return rewardPoolControlSnapshot{}, err
	}
	globalRaw, err := s.fetchHallConfigurationValue(ctx, "reward_nopai_on", operationContext+"-global-no-reward")
	if err != nil {
		return rewardPoolControlSnapshot{}, err
	}
	tierRaw, err := s.fetchHallConfigurationValue(ctx, "reward_nopai_dipi", operationContext+"-tier-no-reward")
	if err != nil {
		return rewardPoolControlSnapshot{}, err
	}
	retentionRaw, err := s.fetchHallConfigurationValue(ctx, "reward_modify", operationContext+"-platform-retention")
	if err != nil {
		return rewardPoolControlSnapshot{}, err
	}

	rewardRates, err := parseRewardControlCSV(rewardRateRaw, rewardPoolConfiguredTierCount(), 0, 100, "reward_rate")
	if err != nil {
		return rewardPoolControlSnapshot{}, err
	}
	globalValues, err := parseRewardControlCSV(globalRaw, 1, 0, 100, "reward_nopai_on")
	if err != nil {
		return rewardPoolControlSnapshot{}, err
	}
	tierRates, err := parseRewardControlCSV(tierRaw, len(rewardPoolDefinitions), 0, 100, "reward_nopai_dipi")
	if err != nil {
		return rewardPoolControlSnapshot{}, err
	}
	retentions, err := parseRewardControlCSV(retentionRaw, rewardPoolConfiguredTierCount(), 0, maxRewardPlatformRetentionYuan, "reward_modify")
	if err != nil {
		return rewardPoolControlSnapshot{}, err
	}

	snapshot := rewardPoolControlSnapshot{
		RewardRates:           make(map[string]int, len(rewardRates)),
		GlobalNoRewardRate:    int(globalValues[0]),
		TierNoRewardRates:     make(map[string]int, len(tierRates)),
		PlatformRetentionYuan: make(map[string]int64, len(retentions)),
	}
	for index, definition := range rewardPoolDefinitions {
		snapshot.TierNoRewardRates[definition.Key] = int(tierRates[index])
		if index < rewardPoolConfiguredTierCount() {
			snapshot.RewardRates[definition.Key] = int(rewardRates[index])
			snapshot.PlatformRetentionYuan[definition.Key] = retentions[index]
		}
	}
	return snapshot, nil
}

func (s *Server) fetchHallConfigurationValue(ctx context.Context, key, operationContext string) (string, error) {
	result, err := s.callGameCommand(ctx, "获取_大厅_配置数据", map[string]any{
		"param_name": key,
		"context":    operationContext,
	})
	if err != nil {
		return "", err
	}
	if result.RetCode != 512 {
		return "", fmt.Errorf("hall configuration %s query ret_code %d", key, result.RetCode)
	}
	var payload struct {
		ParamName  string          `json:"param_name"`
		ParamValue json.RawMessage `json:"param_value"`
	}
	if err := json.Unmarshal(result.RetResult, &payload); err != nil {
		return "", fmt.Errorf("decode hall configuration %s: %w", key, err)
	}
	if payload.ParamName != key {
		return "", fmt.Errorf("hall configuration response mismatch: expected %s, got %s", key, payload.ParamName)
	}
	return decodeConfigurationText(payload.ParamValue)
}

func decodeConfigurationText(raw json.RawMessage) (string, error) {
	var text string
	if err := json.Unmarshal(raw, &text); err == nil {
		return strings.TrimSpace(text), nil
	}
	var boolean bool
	if err := json.Unmarshal(raw, &boolean); err == nil {
		return strconv.FormatBool(boolean), nil
	}
	var number json.Number
	if err := json.Unmarshal(raw, &number); err == nil {
		return strings.TrimSpace(number.String()), nil
	}
	return "", errors.New("配置值不是文字或数字")
}

func parseRewardControlCSV(raw string, expectedCount int, minimum, maximum int64, key string) ([]int64, error) {
	parts := strings.Split(strings.TrimSpace(raw), ",")
	if len(parts) != expectedCount {
		return nil, fmt.Errorf("%s 应包含 %d 个值，实际为 %d 个", key, expectedCount, len(parts))
	}
	values := make([]int64, expectedCount)
	for index, part := range parts {
		value, err := strconv.ParseInt(strings.TrimSpace(part), 10, 64)
		if err != nil || value < minimum || value > maximum {
			return nil, fmt.Errorf("%s 第 %d 项必须是 %d 到 %d 的整数", key, index+1, minimum, maximum)
		}
		values[index] = value
	}
	return values, nil
}

func validateRewardPoolControlSnapshot(snapshot rewardPoolControlSnapshot) error {
	configuredCount := rewardPoolConfiguredTierCount()
	if len(snapshot.RewardRates) != configuredCount {
		return fmt.Errorf("基础放奖概率必须提交全部 %d 个底皮", configuredCount)
	}
	if len(snapshot.TierNoRewardRates) != len(rewardPoolDefinitions) {
		return fmt.Errorf("按底皮不发奖概率必须提交全部 %d 个底皮", len(rewardPoolDefinitions))
	}
	if len(snapshot.PlatformRetentionYuan) != configuredCount {
		return fmt.Errorf("平台提留必须提交全部 %d 个已配置底皮", configuredCount)
	}
	if snapshot.GlobalNoRewardRate < 0 || snapshot.GlobalNoRewardRate > 100 {
		return errors.New("全局不发奖概率必须是 0 到 100 的整数")
	}
	known := make(map[string]bool, len(rewardPoolDefinitions))
	for index, definition := range rewardPoolDefinitions {
		known[definition.Key] = true
		tierRate, ok := snapshot.TierNoRewardRates[definition.Key]
		if !ok || tierRate < 0 || tierRate > 100 {
			return fmt.Errorf("%s 按底皮不发奖概率必须是 0 到 100 的整数", definition.Key)
		}
		if index < configuredCount {
			baseRate, ok := snapshot.RewardRates[definition.Key]
			if !ok || baseRate < 0 || baseRate > 100 {
				return fmt.Errorf("%s 基础放奖概率必须是 0 到 100 的整数", definition.Key)
			}
			retention, ok := snapshot.PlatformRetentionYuan[definition.Key]
			if !ok || retention < 0 || retention > maxRewardPlatformRetentionYuan {
				return fmt.Errorf("%s 平台提留必须是 0 到 %d 的整数元", definition.Key, maxRewardPlatformRetentionYuan)
			}
		}
	}
	for key := range snapshot.RewardRates {
		if !known[key] || key == rewardPoolDefinitions[len(rewardPoolDefinitions)-1].Key {
			return fmt.Errorf("基础放奖概率不支持底皮：%s", key)
		}
	}
	for key := range snapshot.TierNoRewardRates {
		if !known[key] {
			return fmt.Errorf("按底皮不发奖概率不支持底皮：%s", key)
		}
	}
	for key := range snapshot.PlatformRetentionYuan {
		if !known[key] || key == rewardPoolDefinitions[len(rewardPoolDefinitions)-1].Key {
			return fmt.Errorf("平台提留不支持底皮：%s", key)
		}
	}
	return nil
}

func rewardPoolConfiguredTierCount() int {
	return len(rewardPoolDefinitions) - 1
}

func rewardPoolControlStateFromSnapshot(snapshot rewardPoolControlSnapshot) rewardPoolControlState {
	state := rewardPoolControlState{
		Items:              make([]rewardPoolControlItem, 0, len(rewardPoolDefinitions)),
		GlobalNoRewardRate: snapshot.GlobalNoRewardRate,
	}
	configuredCount := rewardPoolConfiguredTierCount()
	for index, definition := range rewardPoolDefinitions {
		item := rewardPoolControlItem{
			Key:              definition.Key,
			Label:            definition.Label,
			TierNoRewardRate: snapshot.TierNoRewardRates[definition.Key],
		}
		if index < configuredCount {
			baseRate := snapshot.RewardRates[definition.Key]
			retention := snapshot.PlatformRetentionYuan[definition.Key]
			estimated := estimatedActualRewardRate(baseRate, snapshot.GlobalNoRewardRate, item.TierNoRewardRate)
			item.BaseRewardRate = &baseRate
			item.PlatformRetentionYuan = &retention
			item.EstimatedActualRewardRate = &estimated
		}
		state.Items = append(state.Items, item)
	}
	return state
}

func estimatedActualRewardRate(baseRate, globalNoRewardRate, tierNoRewardRate int) float64 {
	value := float64(baseRate*(100-globalNoRewardRate)*(100-tierNoRewardRate)) / 10_000
	return float64(int(value*100+0.5)) / 100
}

func rewardPoolControlSnapshotsEqual(left, right rewardPoolControlSnapshot) bool {
	if left.GlobalNoRewardRate != right.GlobalNoRewardRate || len(left.RewardRates) != len(right.RewardRates) || len(left.TierNoRewardRates) != len(right.TierNoRewardRates) || len(left.PlatformRetentionYuan) != len(right.PlatformRetentionYuan) {
		return false
	}
	for key, value := range left.RewardRates {
		if right.RewardRates[key] != value {
			return false
		}
	}
	for key, value := range left.TierNoRewardRates {
		if right.TierNoRewardRates[key] != value {
			return false
		}
	}
	for key, value := range left.PlatformRetentionYuan {
		if right.PlatformRetentionYuan[key] != value {
			return false
		}
	}
	return true
}

func (s *Server) writeRewardPoolControls(ctx context.Context, current, target rewardPoolControlSnapshot, writeAll bool, operationContext string) error {
	writes := []struct {
		Key     string
		Value   string
		Changed bool
	}{
		{Key: "reward_rate", Value: serializeRewardControlValues(target.RewardRates, rewardPoolConfiguredTierCount()), Changed: !intMapEqual(current.RewardRates, target.RewardRates)},
		{Key: "reward_nopai_on", Value: strconv.Itoa(target.GlobalNoRewardRate), Changed: current.GlobalNoRewardRate != target.GlobalNoRewardRate},
		{Key: "reward_nopai_dipi", Value: serializeRewardControlValues(target.TierNoRewardRates, len(rewardPoolDefinitions)), Changed: !intMapEqual(current.TierNoRewardRates, target.TierNoRewardRates)},
		{Key: "reward_modify", Value: serializeRewardControlValues(target.PlatformRetentionYuan, rewardPoolConfiguredTierCount()), Changed: !int64MapEqual(current.PlatformRetentionYuan, target.PlatformRetentionYuan)},
	}
	for index, write := range writes {
		if !writeAll && !write.Changed {
			continue
		}
		result, err := s.callGameCommand(ctx, "设置_大厅_配置数据", map[string]any{
			"param_name":  write.Key,
			"param_value": write.Value,
			"context":     fmt.Sprintf("%s-%d", operationContext, index+1),
		})
		if err != nil {
			return fmt.Errorf("set %s: %w", write.Key, err)
		}
		if result.RetCode != 512 {
			return fmt.Errorf("set %s ret_code %d", write.Key, result.RetCode)
		}
	}
	return nil
}

func serializeRewardControlValues[T ~int | ~int64](values map[string]T, count int) string {
	parts := make([]string, count)
	for index := 0; index < count; index++ {
		parts[index] = strconv.FormatInt(int64(values[rewardPoolDefinitions[index].Key]), 10)
	}
	return strings.Join(parts, ",")
}

func intMapEqual(left, right map[string]int) bool {
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

func int64MapEqual(left, right map[string]int64) bool {
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

func (s *Server) waitForRewardPoolControls(ctx context.Context, expected rewardPoolControlSnapshot, operationContext string) (rewardPoolControlSnapshot, error) {
	var last rewardPoolControlSnapshot
	var lastErr error
	for attempt := 0; attempt < 8; attempt++ {
		last, lastErr = s.fetchRewardPoolControls(ctx, fmt.Sprintf("%s-%d", operationContext, attempt+1))
		if lastErr == nil && rewardPoolControlSnapshotsEqual(last, expected) {
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
	return last, errors.New("reward pool control values did not match expected values")
}

func (s *Server) restoreRewardPoolControls(ctx context.Context, snapshot rewardPoolControlSnapshot, operationContext string) error {
	if err := s.writeRewardPoolControls(ctx, rewardPoolControlSnapshot{}, snapshot, true, operationContext); err != nil {
		return err
	}
	_, err := s.waitForRewardPoolControls(ctx, snapshot, operationContext+"-verify")
	return err
}

func rewardPoolControlAudit(snapshot rewardPoolControlSnapshot, operationContext string) map[string]any {
	result := map[string]any{
		"rewardRates":           snapshot.RewardRates,
		"globalNoRewardRate":    snapshot.GlobalNoRewardRate,
		"tierNoRewardRates":     snapshot.TierNoRewardRates,
		"platformRetentionYuan": snapshot.PlatformRetentionYuan,
	}
	if operationContext != "" {
		result["context"] = operationContext
	}
	return result
}
