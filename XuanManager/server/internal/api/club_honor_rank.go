package api

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// 俱乐部荣耀榜的后台配置：按联盟 / 独立俱乐部，逐榜逐档位配置
// 「开关 + 起止时间 + 名次奖励」。
//
// 契约见 服务器文档整理/俱乐部荣耀榜-客户端接口文档.md v2.6 §5：
//   - 一行 = (scope, rank_type, dipi)，共 7 行（play×1皮~20皮 + score + bonus）；
//   - 奖励命令被扩展了 activity_on / start_date / start_time / end_date / end_time，
//     整行覆盖，每次保存必须完整提交该行；
//   - 服务端没有「一个 scope 一条配置」，所以后台把「总开关 + 三榜开关 + 共用时间」
//     展开成 7 行逐条写，读完再聚合成界面用的汇总状态。
const (
	honorRankQueryCommand = "异步_查询_俱乐部_活动_奖励"
	honorRankSetCommand   = "异步_设置_俱乐部_活动_奖励"

	honorRankClubAudit  = "game.club.honor_rank.update"
	honorRankUnionAudit = "game.union.honor_rank.update"
	honorRankMaxNote    = 120
	honorRankMaxRewards = 100
	honorRankMaxReward  = 1000000

	// 游戏服成功码 0x200；失败一般是 0x301。
	gameCommandOK = 512

	honorRankBoardPlay  = "play"
	honorRankBoardScore = "score"
	honorRankBoardBonus = "bonus"
)

var honorRankPlayDipis = []string{"1皮", "2皮", "5皮", "10皮", "20皮"}

// 写库顺序与界面页签顺序一致：手数 5 档 → 赢分 → 红利。
var honorRankTypes = []string{honorRankBoardPlay, honorRankBoardScore, honorRankBoardBonus}

var honorRankMutationMu sync.Mutex

// 一行配置（= 一个榜的一个档位）。
type honorRankRowState struct {
	RankType   string   `json:"rankType"`
	Dipi       string   `json:"dipi"`
	Rewards    []string `json:"rewards"`
	ActivityOn bool     `json:"activityOn"`
	StartDate  string   `json:"startDate"`
	StartTime  string   `json:"startTime"`
	EndDate    string   `json:"endDate"`
	EndTime    string   `json:"endTime"`
	UpdateDate string   `json:"updateDate"`
	UpdateTime string   `json:"updateTime"`
	OpterGuuid string   `json:"opterGuuid"`
}

// 界面用的榜级汇总：5 个档位一致就是开/关，不一致给 mixed 让前端提示。
type honorRankBoardState struct {
	RankType string `json:"rankType"`
	On       bool   `json:"on"`
	Mixed    bool   `json:"mixed"`
}

type honorRankState struct {
	Scope         string                `json:"scope"`
	TargetID      string                `json:"targetId"`
	ClubID        string                `json:"clubId"`
	ActivityOn    bool                  `json:"activityOn"`
	MixedOn       bool                  `json:"mixedOn"`
	StartDate     string                `json:"startDate"`
	StartTime     string                `json:"startTime"`
	EndDate       string                `json:"endDate"`
	EndTime       string                `json:"endTime"`
	MixedSchedule bool                  `json:"mixedSchedule"`
	Boards        []honorRankBoardState `json:"boards"`
	Rows          []honorRankRowState   `json:"rows"`
	Message       string                `json:"message"`
}

// 游戏服回包（查询：list 数组；设置：单行，字段与 list 元素同构）。
type honorRankGameRow struct {
	RankType   string   `json:"rank_type"`
	Dipi       string   `json:"dipi"`
	RewardList []string `json:"reward_list"`
	ActivityOn string   `json:"activity_on"`
	StartDate  string   `json:"start_date"`
	StartTime  string   `json:"start_time"`
	EndDate    string   `json:"end_date"`
	EndTime    string   `json:"end_time"`
	UpdateDate string   `json:"update_date"`
	UpdateTime string   `json:"update_time"`
	OpterGuuid string   `json:"opter_guuid"`
}

type honorRankGameReply struct {
	ScopeType string             `json:"scope_type"`
	ScopeID   string             `json:"scope_id"`
	ClubID    string             `json:"club_id"`
	List      []honorRankGameRow `json:"list"`
}

type updateHonorRankReward struct {
	Dipi string `json:"dipi"`
	List string `json:"list"`
}

type updateHonorRankBoard struct {
	RankType string                  `json:"rankType"`
	On       bool                    `json:"on"`
	Rewards  []updateHonorRankReward `json:"rewards"`
}

type updateHonorRankRequest struct {
	ActivityOn bool                   `json:"activityOn"`
	StartDate  string                 `json:"startDate"`
	StartTime  string                 `json:"startTime"`
	EndDate    string                 `json:"endDate"`
	EndTime    string                 `json:"endTime"`
	Boards     []updateHonorRankBoard `json:"boards"`
	Note       string                 `json:"note"`
	Confirm    bool                   `json:"confirm"`
}

func honorRankDipis(rankType string) []string {
	if rankType == honorRankBoardPlay {
		return honorRankPlayDipis
	}
	return []string{""}
}

func honorRankTypeName(rankType string) string {
	switch rankType {
	case honorRankBoardPlay:
		return "玩家手数榜"
	case honorRankBoardScore:
		return "玩家赢分榜"
	case honorRankBoardBonus:
		return "代理红利榜"
	}
	return rankType
}

// 游戏服 activity_on 可能回 "1"/"0"，也可能回 "True"/"False"。
func parseHonorRankOn(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "on", "yes", "开":
		return true
	}
	return false
}

// 游戏服可能回 "00:00:00" 也可能回 "00:00"，统一成带秒；空值保持空。
func normalizeHonorRankClock(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	for _, layout := range []string{"15:04:05", "15:04"} {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed.Format("15:04:05")
		}
	}
	return value
}

func cleanHonorRankRewards(values []string) []string {
	result := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		result = append(result, value)
	}
	return result
}

func decodeHonorRankReply(raw json.RawMessage) (honorRankGameReply, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return honorRankGameReply{}, errors.New("游戏服未返回荣耀榜配置")
	}
	// 兼容 ret_result 被包成字符串的旧格式（与奖池报表回包一致）。
	if trimmed[0] == '"' {
		var inner string
		if err := json.Unmarshal(trimmed, &inner); err != nil {
			return honorRankGameReply{}, fmt.Errorf("解析荣耀榜配置失败: %w", err)
		}
		return decodeHonorRankReply(json.RawMessage(inner))
	}
	var reply honorRankGameReply
	if err := json.Unmarshal(trimmed, &reply); err != nil {
		return honorRankGameReply{}, fmt.Errorf("解析荣耀榜配置失败: %w", err)
	}
	return reply, nil
}

// normalizeHonorRankRows 把回包规整成固定 7 行（顺序固定、缺行补空），
// 界面表单和保存逻辑都按这 7 行走，不会因为服务端少给一行而错位。
func normalizeHonorRankRows(rows []honorRankGameRow) []honorRankRowState {
	byKey := map[string]honorRankGameRow{}
	for _, row := range rows {
		key := strings.TrimSpace(row.RankType) + "|" + strings.TrimSpace(row.Dipi)
		byKey[key] = row
	}
	result := make([]honorRankRowState, 0, 7)
	for _, rankType := range honorRankTypes {
		for _, dipi := range honorRankDipis(rankType) {
			row := byKey[rankType+"|"+dipi]
			result = append(result, honorRankRowState{
				RankType:   rankType,
				Dipi:       dipi,
				Rewards:    cleanHonorRankRewards(row.RewardList),
				ActivityOn: parseHonorRankOn(row.ActivityOn),
				StartDate:  strings.TrimSpace(row.StartDate),
				StartTime:  normalizeHonorRankClock(row.StartTime),
				EndDate:    strings.TrimSpace(row.EndDate),
				EndTime:    normalizeHonorRankClock(row.EndTime),
				UpdateDate: strings.TrimSpace(row.UpdateDate),
				UpdateTime: strings.TrimSpace(row.UpdateTime),
				OpterGuuid: strings.TrimSpace(row.OpterGuuid),
			})
		}
	}
	return result
}

// summarizeHonorRank 把 7 行聚合成界面要的「总开关 / 榜开关 / 共用时间」。
func summarizeHonorRank(state *honorRankState) {
	if len(state.Rows) == 0 {
		return
	}
	onCount := 0
	for _, row := range state.Rows {
		if row.ActivityOn {
			onCount++
		}
	}
	state.ActivityOn = onCount > 0
	state.MixedOn = onCount > 0 && onCount < len(state.Rows)

	// 时间取第一条填了时间的行；各行不一致时打上 mixed 标记。
	schedule := ""
	mixed := false
	for _, row := range state.Rows {
		if row.StartDate == "" && row.EndDate == "" && row.StartTime == "" && row.EndTime == "" {
			continue
		}
		key := row.StartDate + " " + row.StartTime + "~" + row.EndDate + " " + row.EndTime
		if schedule == "" {
			schedule = key
			state.StartDate, state.StartTime = row.StartDate, row.StartTime
			state.EndDate, state.EndTime = row.EndDate, row.EndTime
			continue
		}
		if key != schedule {
			mixed = true
		}
	}
	state.MixedSchedule = mixed

	state.Boards = make([]honorRankBoardState, 0, len(honorRankTypes))
	for _, rankType := range honorRankTypes {
		on, off := 0, 0
		for _, row := range state.Rows {
			if row.RankType != rankType {
				continue
			}
			if row.ActivityOn {
				on++
			} else {
				off++
			}
		}
		state.Boards = append(state.Boards, honorRankBoardState{
			RankType: rankType,
			On:       on > 0,
			Mixed:    on > 0 && off > 0,
		})
	}
}

func (s *Server) queryHonorRankConfig(ctx context.Context, scopeType, targetID string) (honorRankState, error) {
	params := map[string]any{"context": gameOperationContext("honor-rank")}
	if scopeType == "union" {
		params["union_id"] = targetID
	} else {
		params["club_id"] = targetID
	}
	result, err := s.callGameCommand(ctx, honorRankQueryCommand, params)
	if err != nil {
		return honorRankState{}, err
	}
	if result.RetCode != gameCommandOK {
		return honorRankState{}, errors.New(describeGameFailure(honorRankQueryCommand, result.RetCode, result.RetResult))
	}
	reply, err := decodeHonorRankReply(result.RetResult)
	if err != nil {
		return honorRankState{}, err
	}
	state := honorRankState{
		Scope:    scopeType,
		TargetID: targetID,
		ClubID:   strings.TrimSpace(reply.ClubID),
		Rows:     normalizeHonorRankRows(reply.List),
	}
	summarizeHonorRank(&state)
	return state, nil
}

func normalizeHonorRankNote(note string) (string, error) {
	note = strings.TrimSpace(note)
	if utf8.RuneCountInString(note) < 2 {
		return "", errors.New("原因至少 2 个字")
	}
	if utf8.RuneCountInString(note) > honorRankMaxNote {
		return "", fmt.Errorf("原因最多 %d 个字", honorRankMaxNote)
	}
	return note, nil
}

// normalizeRewardList 把后台输入的 "100,50,20" 规整成命令要的字符串。
func normalizeRewardList(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	parts := strings.Split(value, ",")
	if len(parts) > honorRankMaxRewards {
		return "", fmt.Errorf("名次奖励最多 %d 项", honorRankMaxRewards)
	}
	cleaned := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			return "", errors.New("名次奖励里有空项，请检查逗号")
		}
		amount, err := strconv.ParseInt(part, 10, 64)
		if err != nil {
			return "", fmt.Errorf("「%s」不是整数金额", part)
		}
		if amount < 0 || amount > honorRankMaxReward {
			return "", fmt.Errorf("奖励金额必须在 0 到 %d 之间", honorRankMaxReward)
		}
		cleaned = append(cleaned, strconv.FormatInt(amount, 10))
	}
	return strings.Join(cleaned, ","), nil
}

// honorRankWriteRow 是展开后要写的一行（一个 rank_type + 一个档位）。
type honorRankWriteRow struct {
	RankType   string
	Dipi       string
	RewardList string
	ActivityOn bool
	StartDate  string
	StartTime  string
	EndDate    string
	EndTime    string
}

// buildHonorRankWrites 把界面提交的「总开关 + 三榜开关 + 共用时间」展开成 7 行。
// 关总开关时 7 行全部 activity_on=0，但时间照样下发（服务端允许关闭时保留时间）。
func buildHonorRankWrites(input *updateHonorRankRequest) ([]honorRankWriteRow, error) {
	if !input.Confirm {
		return nil, errors.New("请确认本次操作会改变该联盟/俱乐部的排行榜")
	}
	input.StartDate = strings.TrimSpace(input.StartDate)
	input.StartTime = strings.TrimSpace(input.StartTime)
	input.EndDate = strings.TrimSpace(input.EndDate)
	input.EndTime = strings.TrimSpace(input.EndTime)

	boards := map[string]updateHonorRankBoard{}
	for _, board := range input.Boards {
		rankType := strings.TrimSpace(board.RankType)
		switch rankType {
		case honorRankBoardPlay, honorRankBoardScore, honorRankBoardBonus:
		default:
			return nil, errors.New("榜单配置不完整")
		}
		if _, exists := boards[rankType]; exists {
			return nil, errors.New("榜单配置不完整")
		}
		boards[rankType] = board
	}
	if len(boards) != len(honorRankTypes) {
		return nil, errors.New("榜单配置不完整")
	}

	anyBoardOn := false
	for _, board := range boards {
		if board.On {
			anyBoardOn = true
		}
	}
	if input.ActivityOn && !anyBoardOn {
		return nil, errors.New("开启排行榜时至少选择一个榜")
	}
	if input.ActivityOn && anyBoardOn {
		start, err := parseActivityDateTime(input.StartDate, input.StartTime)
		if err != nil {
			return nil, errors.New("开启排行榜时必须填写完整的开始和结束时间")
		}
		end, err := parseActivityDateTime(input.EndDate, input.EndTime)
		if err != nil {
			return nil, errors.New("开启排行榜时必须填写完整的开始和结束时间")
		}
		if end.Before(start) {
			return nil, errors.New("结束时间不能早于开始时间")
		}
	}

	writes := make([]honorRankWriteRow, 0, 7)
	for _, rankType := range honorRankTypes {
		board := boards[rankType]
		rewards := map[string]string{}
		for _, item := range board.Rewards {
			rewards[strings.TrimSpace(item.Dipi)] = item.List
		}
		for _, dipi := range honorRankDipis(rankType) {
			list, err := normalizeRewardList(rewards[dipi])
			if err != nil {
				return nil, fmt.Errorf("%s%s：%w", honorRankTypeName(rankType), dipi, err)
			}
			writes = append(writes, honorRankWriteRow{
				RankType:   rankType,
				Dipi:       dipi,
				RewardList: list,
				ActivityOn: input.ActivityOn && board.On,
				StartDate:  input.StartDate,
				StartTime:  input.StartTime,
				EndDate:    input.EndDate,
				EndTime:    input.EndTime,
			})
		}
	}
	return writes, nil
}

// readHonorRankScope 确认目标存在；已入盟俱乐部不允许按 club 维度配置。
func (s *Server) readHonorRankScope(ctx context.Context, scopeType, targetID string) (string, error) {
	if scopeType == "union" {
		var ownerClubID string
		err := s.db.QueryRowContext(ctx,
			`SELECT COALESCE(club_guuid, '') FROM kbedm.club_union_info
WHERE union_id = ? AND status <> 'init' LIMIT 1`, targetID).Scan(&ownerClubID)
		if errors.Is(err, sql.ErrNoRows) {
			return "", errHonorRankNotFound
		}
		if err != nil {
			return "", err
		}
		return strings.TrimSpace(ownerClubID), nil
	}
	var clubID, unionID string
	err := s.db.QueryRowContext(ctx,
		`SELECT club_guuid, COALESCE(union_id, '') FROM kbedm.club_guuid_info WHERE club_guuid = ? LIMIT 1`,
		targetID).Scan(&clubID, &unionID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", errHonorRankNotFound
	}
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(unionID) != "" {
		return "", errHonorRankClubInUnion
	}
	return targetID, nil
}

var (
	errHonorRankNotFound    = errors.New("目标不存在")
	errHonorRankClubInUnion = errors.New("该俱乐部已入盟，请在联盟管理里配置荣耀榜")
)

func (s *Server) writeHonorRankScopeError(w http.ResponseWriter, err error, scopeType, targetID string) {
	switch {
	case errors.Is(err, errHonorRankNotFound):
		writeError(w, http.StatusNotFound, "HONOR_RANK_NOT_FOUND", "没有找到这个俱乐部或联盟")
	case errors.Is(err, errHonorRankClubInUnion):
		writeError(w, http.StatusBadRequest, "HONOR_RANK_CLUB_IN_UNION", err.Error())
	default:
		s.logger.Error("read honor rank scope", "error", err, "scope", scopeType, "targetId", targetID)
		writeError(w, http.StatusInternalServerError, "HONOR_RANK_QUERY_FAILED", "读取俱乐部/联盟失败")
	}
}

func (s *Server) serveGetHonorRank(w http.ResponseWriter, r *http.Request, scopeType, targetID string) {
	ctx := r.Context()
	ownerClubID, err := s.readHonorRankScope(ctx, scopeType, targetID)
	if err != nil {
		s.writeHonorRankScopeError(w, err, scopeType, targetID)
		return
	}
	state, err := s.queryHonorRankConfig(ctx, scopeType, targetID)
	if err != nil {
		s.logger.Error("query honor rank config", "error", err, "scope", scopeType, "targetId", targetID)
		writeError(w, http.StatusBadGateway, "HONOR_RANK_QUERY_FAILED", "读取荣耀榜配置失败："+err.Error())
		return
	}
	if state.ClubID == "" {
		state.ClubID = ownerClubID
	}
	writeData(w, http.StatusOK, state)
}

func (s *Server) serveSetHonorRank(w http.ResponseWriter, r *http.Request, p principal, scopeType, targetID string) {
	var input updateHonorRankRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	writes, err := buildHonorRankWrites(&input)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_HONOR_RANK", err.Error())
		return
	}
	note, err := normalizeHonorRankNote(input.Note)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_HONOR_RANK", err.Error())
		return
	}

	honorRankMutationMu.Lock()
	defer honorRankMutationMu.Unlock()

	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()

	if _, err := s.readHonorRankScope(ctx, scopeType, targetID); err != nil {
		s.writeHonorRankScopeError(w, err, scopeType, targetID)
		return
	}

	auditAction, targetType := honorRankClubAudit, "game_club"
	if scopeType == "union" {
		auditAction, targetType = honorRankUnionAudit, "game_union"
	}
	before, beforeErr := s.queryHonorRankConfig(ctx, scopeType, targetID)
	if beforeErr != nil {
		s.logger.Warn("read honor rank before update", "error", beforeErr, "scope", scopeType, "targetId", targetID)
	}
	requestAudit := map[string]any{
		"activityOn": input.ActivityOn,
		"startDate":  input.StartDate,
		"startTime":  input.StartTime,
		"endDate":    input.EndDate,
		"endTime":    input.EndTime,
		"boards":     honorRankAuditBoards(writes),
		"note":       note,
	}

	// 服务端按行落库，没有批量命令：7 行顺序写，任意一行失败就停并如实报告。
	for _, row := range writes {
		if err := s.writeHonorRankRow(ctx, scopeType, targetID, row); err != nil {
			label := honorRankTypeName(row.RankType) + row.Dipi
			message := fmt.Sprintf("%s保存失败：%s（该行之前的配置可能已写入，请重开本页核对）", label, err.Error())
			s.audit(ctx, &p, auditAction, targetType, targetID, requestAudit,
				honorRankAuditSnapshot(before, beforeErr), nil, http.StatusBadGateway, message, clientIP(r))
			writeError(w, http.StatusBadGateway, "HONOR_RANK_UPDATE_FAILED", message)
			return
		}
	}

	// 独立「排行榜」模块的活动列表：旧入口的保存也留档，开启新增一条、关闭标记上一条。
	s.recordHonorRankActivityFromScopeEdit(ctx, &p, scopeType, targetID, input)

	after, err := s.queryHonorRankConfig(ctx, scopeType, targetID)
	if err != nil {
		// 已写成功但回读失败：不谎报失败，提示刷新核对。
		s.logger.Warn("read honor rank after update", "error", err, "scope", scopeType, "targetId", targetID)
		after = honorRankState{Scope: scopeType, TargetID: targetID, Rows: []honorRankRowState{}}
		after.Message = "配置已提交，但回读失败，请刷新核对"
		s.audit(ctx, &p, auditAction, targetType, targetID, requestAudit,
			honorRankAuditSnapshot(before, beforeErr), map[string]any{"readbackFailed": true}, 0, after.Message, clientIP(r))
		writeData(w, http.StatusOK, after)
		return
	}
	after.Message = honorRankSummary(input, scopeType)
	s.audit(ctx, &p, auditAction, targetType, targetID, requestAudit,
		honorRankAuditSnapshot(before, beforeErr), honorRankAuditSnapshot(after, nil), 0, after.Message, clientIP(r))
	writeData(w, http.StatusOK, after)
}

func (s *Server) writeHonorRankRow(ctx context.Context, scopeType, targetID string, row honorRankWriteRow) error {
	params := map[string]any{
		"rank_type":   row.RankType,
		"reward_list": row.RewardList,
		"activity_on": honorRankOnText(row.ActivityOn),
		"start_date":  row.StartDate,
		"start_time":  row.StartTime,
		"end_date":    row.EndDate,
		"end_time":    row.EndTime,
		"context":     gameOperationContext("honor-rank-set"),
	}
	if scopeType == "union" {
		params["union_id"] = targetID
	} else {
		params["club_id"] = targetID
	}
	if row.RankType == honorRankBoardPlay {
		params["play_type"] = row.Dipi
	}
	result, err := s.callGameCommand(ctx, honorRankSetCommand, params)
	if err != nil {
		return err
	}
	if result.RetCode != gameCommandOK {
		return errors.New(describeGameFailure(honorRankSetCommand, result.RetCode, result.RetResult))
	}
	return nil
}

func honorRankOnText(on bool) string {
	if on {
		return "1"
	}
	return "0"
}

func honorRankAuditBoards(writes []honorRankWriteRow) []map[string]any {
	result := make([]map[string]any, 0, len(writes))
	for _, row := range writes {
		result = append(result, map[string]any{
			"rankType": row.RankType, "dipi": row.Dipi,
			"activityOn": row.ActivityOn, "rewardList": row.RewardList,
		})
	}
	return result
}

func honorRankAuditSnapshot(state honorRankState, err error) map[string]any {
	if err != nil {
		return nil
	}
	rows := make([]map[string]any, 0, len(state.Rows))
	for _, row := range state.Rows {
		rows = append(rows, map[string]any{
			"rankType": row.RankType, "dipi": row.Dipi,
			"activityOn": row.ActivityOn, "rewards": row.Rewards,
			"startDate": row.StartDate, "startTime": row.StartTime,
			"endDate": row.EndDate, "endTime": row.EndTime,
		})
	}
	return map[string]any{"activityOn": state.ActivityOn, "rows": rows}
}

func honorRankSummary(input updateHonorRankRequest, scopeType string) string {
	scopeName := "该俱乐部"
	if scopeType == "union" {
		scopeName = "该联盟"
	}
	if !input.ActivityOn {
		return "已关闭" + scopeName + "的荣耀榜（时间与奖励已保留）"
	}
	opened := []string{}
	for _, board := range input.Boards {
		if board.On {
			opened = append(opened, honorRankTypeName(board.RankType))
		}
	}
	sort.Strings(opened)
	return fmt.Sprintf("已开启%s的荣耀榜：%s %s 至 %s",
		scopeName, strings.Join(opened, "、"), input.StartDate+" "+input.StartTime, input.EndDate+" "+input.EndTime)
}

func (s *Server) handleGetClubHonorRank(w http.ResponseWriter, r *http.Request, p principal) {
	clubID, err := normalizeClubID(r.PathValue("clubId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_CLUB_ID", err.Error())
		return
	}
	s.serveGetHonorRank(w, r, "club", clubID)
}

func (s *Server) handleSetClubHonorRank(w http.ResponseWriter, r *http.Request, p principal) {
	clubID, err := normalizeClubID(r.PathValue("clubId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_CLUB_ID", err.Error())
		return
	}
	s.serveSetHonorRank(w, r, p, "club", clubID)
}

func (s *Server) handleGetUnionHonorRank(w http.ResponseWriter, r *http.Request, p principal) {
	unionID, err := normalizeUnionID(r.PathValue("unionId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_UNION_ID", err.Error())
		return
	}
	s.serveGetHonorRank(w, r, "union", unionID)
}

func (s *Server) handleSetUnionHonorRank(w http.ResponseWriter, r *http.Request, p principal) {
	unionID, err := normalizeUnionID(r.PathValue("unionId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_UNION_ID", err.Error())
		return
	}
	s.serveSetHonorRank(w, r, p, "union", unionID)
}
