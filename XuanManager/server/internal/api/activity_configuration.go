package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
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

var activityConfigurationMutationMu sync.Mutex

type activityDefinition struct {
	Code, Name, StartDateKey, StartTimeKey, EndDateKey, EndTimeKey, RewardKey, ClaimKey, LimitKey, TextKey string
}

var activityDefinitions = []activityDefinition{
	{Code: "hand-rank", Name: "玩家手数榜", StartDateKey: "activity3_start_date", StartTimeKey: "activity3_start_time", EndDateKey: "activity3_end_date", EndTimeKey: "activity3_end_time", RewardKey: "activity3_reward_list_xiao", ClaimKey: "activity3_lingqu_on", LimitKey: "activity3_max_page", TextKey: "活动文本_玩家手数榜"},
	{Code: "score-rank", Name: "玩家赢分榜", StartDateKey: "activity2_start_date", StartTimeKey: "activity2_start_time", EndDateKey: "activity2_end_date", EndTimeKey: "activity2_end_time", RewardKey: "activity2_reward_list", ClaimKey: "activity2_lingqu_on", LimitKey: "activity2_max_page", TextKey: "活动文本_玩家赢分榜"},
	{Code: "agent-bonus-rank", Name: "代理红利榜", StartDateKey: "activity_start_date", StartTimeKey: "activity_start_time", EndDateKey: "activity_end_date", EndTimeKey: "activity_end_time", RewardKey: "activity_reward_list", ClaimKey: "activity_lingqu_on", LimitKey: "activity_max_count", TextKey: "活动文本_代理红利榜"},
}

type activityItemState struct {
	Code       string `json:"code"`
	Name       string `json:"name"`
	Enabled    bool   `json:"enabled"`
	StartDate  string `json:"startDate"`
	StartTime  string `json:"startTime"`
	EndDate    string `json:"endDate"`
	EndTime    string `json:"endTime"`
	RewardRule string `json:"rewardRule"`
	AllowClaim bool   `json:"allowClaim"`
	RankLimit  int    `json:"rankLimit"`
	PlayerText string `json:"playerText"`
}

type activityPowerState struct {
	One    string `json:"one"`
	Two    string `json:"two"`
	Five   string `json:"five"`
	Ten    string `json:"ten"`
	Twenty string `json:"twenty"`
}

type activityConfigurationState struct {
	Enabled       bool                `json:"enabled"`
	Activities    []activityItemState `json:"activities"`
	HandRankPower activityPowerState  `json:"handRankPower"`
	Revision      string              `json:"revision"`
	LastUpdatedBy string              `json:"lastUpdatedBy"`
	LastUpdatedAt *time.Time          `json:"lastUpdatedAt"`
}

type updateActivityConfigurationRequest struct {
	Enabled       bool                `json:"enabled"`
	Activities    []activityItemState `json:"activities"`
	HandRankPower activityPowerState  `json:"handRankPower"`
	Revision      string              `json:"revision"`
	Confirm       bool                `json:"confirm"`
}

func (s *Server) handleGetActivityConfiguration(w http.ResponseWriter, r *http.Request, p principal) {
	state, err := s.queryActivityConfiguration(r.Context(), p)
	if err != nil {
		s.logger.Error("read activity configuration", "error", err)
		writeError(w, http.StatusBadGateway, "ACTIVITY_CONFIGURATION_QUERY_FAILED", "读取游戏活动配置失败")
		return
	}
	writeData(w, http.StatusOK, state)
}

func (s *Server) handleUpdateActivityConfiguration(w http.ResponseWriter, r *http.Request, p principal) {
	var input updateActivityConfigurationRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if !input.Confirm {
		writeError(w, http.StatusBadRequest, "ACTIVITY_CONFIRM_REQUIRED", "请确认活动开关与规则会直接影响游戏客户端")
		return
	}
	if err := normalizeAndValidateActivityRequest(&input); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_ACTIVITY_CONFIGURATION", err.Error())
		return
	}
	activityConfigurationMutationMu.Lock()
	defer activityConfigurationMutationMu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 35*time.Second)
	defer cancel()
	before, err := s.queryActivityConfiguration(ctx, p)
	if err != nil {
		writeError(w, http.StatusBadGateway, "ACTIVITY_CONFIGURATION_QUERY_FAILED", "读取当前游戏活动配置失败")
		return
	}
	if input.Revision == "" || input.Revision != before.Revision {
		writeError(w, http.StatusConflict, "ACTIVITY_CONFIGURATION_CHANGED", "活动配置已被其他管理员修改，请刷新后再保存")
		return
	}
	desiredConfig, desiredTexts := activityWrites(input)
	beforeConfig, _ := activityWrites(updateActivityConfigurationRequest{Enabled: before.Enabled, Activities: before.Activities, HandRankPower: before.HandRankPower})
	textKeys := make([]string, 0, len(desiredTexts))
	for key := range desiredTexts {
		textKeys = append(textKeys, key)
	}
	sort.Strings(textKeys)
	beforeRows, err := s.loadStoredHashRows(ctx, textKeys)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "ACTIVITY_CONFIGURATION_UPDATE_FAILED", "保存前快照失败")
		return
	}
	changedConfig := []string{}
	for _, key := range sortedStringKeys(desiredConfig) {
		if desiredConfig[key] == beforeConfig[key] {
			continue
		}
		if err := s.setAndVerifyBossConfiguration(ctx, key, desiredConfig[key], gameOperationContext("activity")); err != nil {
			s.restoreBossConfigurations(ctx, beforeConfig, changedConfig)
			s.audit(ctx, &p, "configuration.activity.update", "game_configuration", "activities", activityAuditSummary(input), before, nil, 502, "活动参数保存失败，已尝试恢复", clientIP(r))
			writeError(w, http.StatusBadGateway, "ACTIVITY_CONFIGURATION_UPDATE_FAILED", "游戏服务未接受活动配置，已尝试恢复原值")
			return
		}
		changedConfig = append(changedConfig, key)
	}
	insertedIDs := []int64{}
	if err := s.writeHashValues(ctx, desiredTexts, &insertedIDs); err != nil {
		s.restoreBossConfigurations(ctx, beforeConfig, changedConfig)
		_ = s.restoreStoredHashRows(ctx, beforeRows, insertedIDs, textKeys)
		writeError(w, http.StatusInternalServerError, "ACTIVITY_CONFIGURATION_UPDATE_FAILED", "活动展示文字保存失败，已尝试恢复原值")
		return
	}
	after, verifyErr := s.queryActivityConfiguration(ctx, p)
	expected := activityConfigurationState{Enabled: input.Enabled, Activities: input.Activities, HandRankPower: input.HandRankPower}
	if verifyErr != nil || activityStateRevision(after) != activityStateRevision(expected) {
		s.restoreBossConfigurations(ctx, beforeConfig, changedConfig)
		_ = s.restoreStoredHashRows(ctx, beforeRows, insertedIDs, textKeys)
		writeError(w, http.StatusInternalServerError, "ACTIVITY_CONFIGURATION_VERIFY_FAILED", "活动配置回读校验失败，已尝试恢复原值")
		return
	}
	s.audit(ctx, &p, "configuration.activity.update", "game_configuration", "activities", activityAuditSummary(input), before, after, 0, "活动配置已保存并完成回读校验", clientIP(r))
	writeData(w, http.StatusOK, after)
}

func (s *Server) queryActivityConfiguration(ctx context.Context, p principal) (activityConfigurationState, error) {
	keys := []string{"activity_on", "activity3_list_power"}
	for _, definition := range activityDefinitions {
		keys = append(keys, definition.StartDateKey, definition.StartTimeKey, definition.EndDateKey, definition.EndTimeKey, definition.RewardKey, definition.ClaimKey, definition.LimitKey)
	}
	values := map[string]string{}
	for _, key := range keys {
		value, err := s.getBossConfiguration(ctx, key, gameOperationContext("activity-read"))
		if err != nil {
			return activityConfigurationState{}, fmt.Errorf("read %s: %w", key, err)
		}
		values[key] = value
	}
	textKeys := make([]string, len(activityDefinitions))
	for index, definition := range activityDefinitions {
		textKeys[index] = definition.TextKey
	}
	textRows, err := s.loadStoredHashRows(ctx, textKeys)
	if err != nil {
		return activityConfigurationState{}, err
	}
	texts := map[string]string{}
	for _, row := range textRows {
		if _, exists := texts[row.Key]; !exists {
			texts[row.Key] = row.Content
		}
	}
	state := activityConfigurationState{Enabled: parseGameBool(values["activity_on"]), Activities: []activityItemState{}}
	for _, definition := range activityDefinitions {
		limit, _ := strconv.Atoi(strings.TrimSpace(values[definition.LimitKey]))
		state.Activities = append(state.Activities, activityItemState{
			Code: definition.Code, Name: definition.Name, Enabled: hasActivitySchedule(values[definition.StartDateKey], values[definition.EndDateKey]),
			StartDate: values[definition.StartDateKey], StartTime: values[definition.StartTimeKey], EndDate: values[definition.EndDateKey], EndTime: values[definition.EndTimeKey],
			RewardRule: values[definition.RewardKey], AllowClaim: parseGameBool(values[definition.ClaimKey]), RankLimit: limit, PlayerText: texts[definition.TextKey],
		})
	}
	state.HandRankPower = parseActivityPowers(values["activity3_list_power"])
	state.Revision = activityStateRevision(state)
	updatedBy, updatedAt, err := s.latestAuditAttribution(ctx, "configuration.activity.update", p)
	if err != nil {
		return state, err
	}
	state.LastUpdatedBy, state.LastUpdatedAt = updatedBy, updatedAt
	return state, nil
}

func (s *Server) getBossConfiguration(ctx context.Context, key, operationContext string) (string, error) {
	result, err := s.callGameCommand(ctx, "获取_老板_配置数据", map[string]any{"param_name": key, "param_value": "", "context": operationContext})
	if err != nil {
		return "", err
	}
	// The legacy service uses 769 for an unset configuration key. The client
	// treats that state as an empty value, so the admin UI does the same.
	if result.RetCode == 769 {
		return "", nil
	}
	if result.RetCode != 512 {
		return "", fmt.Errorf("ret_code %d", result.RetCode)
	}
	var response struct {
		ParamValue any `json:"param_value"`
	}
	if err := json.Unmarshal(result.RetResult, &response); err != nil {
		return "", err
	}
	if response.ParamValue == nil {
		return "", nil
	}
	return fmt.Sprint(response.ParamValue), nil
}

func (s *Server) setBossConfiguration(ctx context.Context, key, value, operationContext string) error {
	result, err := s.callGameCommand(ctx, "设置_老板_配置数据", map[string]any{"param_name": key, "param_value": value, "context": operationContext})
	if err != nil {
		return err
	}
	if result.RetCode != 512 && result.RetCode != 1280 {
		return fmt.Errorf("ret_code %d", result.RetCode)
	}
	return nil
}

func (s *Server) setAndVerifyBossConfiguration(ctx context.Context, key, value, operationContext string) error {
	if err := s.setBossConfiguration(ctx, key, value, operationContext); err != nil {
		return err
	}
	var last string
	var lastErr error
	for attempt := 0; attempt < 8; attempt++ {
		last, lastErr = s.getBossConfiguration(ctx, key, operationContext+"-verify")
		if lastErr == nil && last == value {
			return nil
		}
		if attempt < 7 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(250 * time.Millisecond):
			}
		}
	}
	if lastErr != nil {
		return lastErr
	}
	return fmt.Errorf("configuration %s read back as %q", key, last)
}

func (s *Server) restoreBossConfigurations(ctx context.Context, before map[string]string, changed []string) {
	for index := len(changed) - 1; index >= 0; index-- {
		key := changed[index]
		if err := s.setBossConfiguration(ctx, key, before[key], gameOperationContext("activity-restore")); err != nil {
			s.logger.Error("restore activity configuration", "key", key, "error", err)
		}
	}
}

func normalizeAndValidateActivityRequest(input *updateActivityConfigurationRequest) error {
	if len(input.Activities) != len(activityDefinitions) {
		return errors.New("必须提交全部三种活动配置")
	}
	definitions := map[string]activityDefinition{}
	for _, definition := range activityDefinitions {
		definitions[definition.Code] = definition
	}
	seen := map[string]bool{}
	for index := range input.Activities {
		activity := &input.Activities[index]
		definition, ok := definitions[activity.Code]
		if !ok || seen[activity.Code] {
			return errors.New("活动类型不正确或重复")
		}
		seen[activity.Code] = true
		activity.Name = definition.Name
		activity.StartDate, activity.StartTime = strings.TrimSpace(activity.StartDate), strings.TrimSpace(activity.StartTime)
		activity.EndDate, activity.EndTime = strings.TrimSpace(activity.EndDate), strings.TrimSpace(activity.EndTime)
		activity.RewardRule, activity.PlayerText = strings.TrimSpace(activity.RewardRule), strings.TrimSpace(activity.PlayerText)
		if activity.Enabled {
			if err := validateActivityDateTime(*activity); err != nil {
				return fmt.Errorf("%s：%w", activity.Name, err)
			}
		}
		if activity.RankLimit < 0 || activity.RankLimit > 10000 || (activity.Enabled && activity.RankLimit < 1) {
			return fmt.Errorf("%s 启用时展示名次必须在 1 到 10000 之间", activity.Name)
		}
		if err := validateConfigurationText(activity.RewardRule, 0, 2000, true, activity.Name+"奖励规则"); err != nil {
			return err
		}
		if err := validateConfigurationText(activity.PlayerText, 0, 4000, true, activity.Name+"活动说明"); err != nil {
			return err
		}
	}
	for label, value := range map[string]*string{"1P": &input.HandRankPower.One, "2P": &input.HandRankPower.Two, "5P": &input.HandRankPower.Five, "10P": &input.HandRankPower.Ten, "20P": &input.HandRankPower.Twenty} {
		*value = strings.TrimSpace(*value)
		parsed, err := strconv.ParseFloat(*value, 64)
		if err != nil || parsed < 0 || parsed > 10000 {
			return fmt.Errorf("玩家手数榜 %s 倍率必须是 0 到 10000 的数字", label)
		}
	}
	return nil
}

func validateActivityDateTime(activity activityItemState) error {
	if activity.StartDate == "" || activity.EndDate == "" || activity.StartTime == "" || activity.EndTime == "" {
		return errors.New("启用活动时必须填写完整的开始和结束时间")
	}
	start, err := parseActivityDateTime(activity.StartDate, activity.StartTime)
	if err != nil {
		return errors.New("开始日期或时间格式不正确")
	}
	end, err := parseActivityDateTime(activity.EndDate, activity.EndTime)
	if err != nil {
		return errors.New("结束日期或时间格式不正确")
	}
	if !end.After(start) {
		return errors.New("结束时间必须晚于开始时间")
	}
	return nil
}

func parseActivityDateTime(date, clock string) (time.Time, error) {
	for _, layout := range []string{"2006-01-02 15:04:05", "2006-01-02 15:04"} {
		if value, err := time.ParseInLocation(layout, date+" "+clock, time.Local); err == nil {
			return value, nil
		}
	}
	return time.Time{}, errors.New("invalid activity datetime")
}

func activityWrites(input updateActivityConfigurationRequest) (map[string]string, map[string]string) {
	configs := map[string]string{"activity_on": gameBool(input.Enabled), "activity3_list_power": serializeActivityPowers(input.HandRankPower)}
	texts := map[string]string{}
	byCode := map[string]activityItemState{}
	for _, activity := range input.Activities {
		byCode[activity.Code] = activity
	}
	for _, definition := range activityDefinitions {
		activity := byCode[definition.Code]
		configs[definition.StartDateKey], configs[definition.StartTimeKey] = activity.StartDate, activity.StartTime
		configs[definition.EndDateKey], configs[definition.EndTimeKey] = activity.EndDate, activity.EndTime
		configs[definition.RewardKey], configs[definition.ClaimKey] = activity.RewardRule, gameBool(activity.AllowClaim)
		configs[definition.LimitKey] = strconv.Itoa(activity.RankLimit)
		if !activity.Enabled {
			configs[definition.StartDateKey], configs[definition.StartTimeKey] = "", ""
			configs[definition.EndDateKey], configs[definition.EndTimeKey] = "", ""
		}
		texts[definition.TextKey] = activity.PlayerText
	}
	return configs, texts
}

func parseActivityPowers(value string) activityPowerState {
	parts := strings.Split(value, ",")
	result := activityPowerState{One: "1", Two: "1", Five: "1", Ten: "1", Twenty: "1"}
	if len(parts) >= 7 {
		result.One, result.Two, result.Five, result.Ten, result.Twenty = strings.TrimSpace(parts[2]), strings.TrimSpace(parts[3]), strings.TrimSpace(parts[4]), strings.TrimSpace(parts[5]), strings.TrimSpace(parts[6])
	}
	return result
}

func serializeActivityPowers(value activityPowerState) string {
	return strings.Join([]string{"1", "1", value.One, value.Two, value.Five, value.Ten, value.Twenty, "1", "1"}, ",")
}

func activityStateRevision(state activityConfigurationState) string {
	state.Revision, state.LastUpdatedBy, state.LastUpdatedAt = "", "", nil
	body, _ := json.Marshal(state)
	digest := sha256.Sum256(body)
	return hex.EncodeToString(digest[:])
}

func parseGameBool(value string) bool { return strings.EqualFold(strings.TrimSpace(value), "true") }
func gameBool(value bool) string {
	if value {
		return "True"
	}
	return "False"
}
func hasActivitySchedule(startDate, endDate string) bool {
	return strings.TrimSpace(startDate) != "" || strings.TrimSpace(endDate) != ""
}

func sortedStringKeys(values map[string]string) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func activityAuditSummary(input updateActivityConfigurationRequest) map[string]any {
	enabled := []string{}
	for _, activity := range input.Activities {
		if activity.Enabled {
			enabled = append(enabled, activity.Name)
		}
	}
	return map[string]any{"globalEnabled": input.Enabled, "enabledActivities": enabled, "handRankPower": input.HandRankPower}
}
