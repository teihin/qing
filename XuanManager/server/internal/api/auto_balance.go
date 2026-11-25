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
	"unicode/utf8"
)

// 后台「自动输赢平衡」全部通过游戏服 8890 /hall/command 的 8 条命令完成，
// 后台不直连 kbedm 写库。契约见 服务器文档整理/自动输赢平衡-后台接口文档.md。
const (
	autoBalanceConfigQueryCommand = "查询_自动平衡_配置"
	autoBalanceConfigSetCommand   = "设置_自动平衡_配置"
	autoBalanceCandidateCommand   = "查询_自动平衡_候选"
	autoBalanceExecuteCommand     = "执行_自动平衡"
	autoBalanceTeamQueryCommand   = "异步_查询_伙牌名单"
	autoBalanceTeamSetCommand     = "异步_设置_伙牌成员"
	autoBalanceTeamRemoveCommand  = "异步_移除_伙牌成员"
	autoBalanceTeamImportCommand  = "异步_导入_伙牌名单"
)

const (
	autoBalanceModeObserve = "observe"
	autoBalanceModeAdvice  = "advice"
	autoBalanceModeAuto    = "auto"

	autoBalanceMaxGuuidsBatch = 2000
	autoBalanceMaxTeamName    = 60
	autoBalanceMaxRemark      = 250
)

var (
	// 部分游戏服命令走客户端推送回包，HTTP 通道可能一直挂住，统一用短超时兜底。
	autoBalanceReadTimeout  = 15 * time.Second
	autoBalanceWriteTimeout = 15 * time.Second
	autoBalanceWriteMu      sync.Mutex
)

type autoBalanceGameError struct {
	status  int
	code    string
	message string
}

func (e *autoBalanceGameError) Error() string { return e.message }

func writeAutoBalanceError(w http.ResponseWriter, err error) {
	status := http.StatusBadGateway
	code := "AUTO_BALANCE_FAILED"
	message := "游戏服未返回自动平衡数据，请稍后重试"
	var gameErr *autoBalanceGameError
	if errors.As(err, &gameErr) {
		status = gameErr.status
		code = gameErr.code
		message = gameErr.message
	}
	writeError(w, status, code, message)
}

func (s *Server) callAutoBalance(ctx context.Context, header string, params map[string]any) (map[string]any, error) {
	result, err := s.callGameCommand(ctx, header, params)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, &autoBalanceGameError{
				status:  http.StatusGatewayTimeout,
				code:    "AUTO_BALANCE_TIMEOUT",
				message: "游戏服未在时限内返回，操作可能已经生效，请刷新后确认",
			}
		}
		return nil, &autoBalanceGameError{
			status:  http.StatusBadGateway,
			code:    "AUTO_BALANCE_UNREACHABLE",
			message: "游戏服未响应，请稍后重试",
		}
	}
	if result.RetCode != 512 {
		return nil, &autoBalanceGameError{
			status:  http.StatusBadGateway,
			code:    "AUTO_BALANCE_GAME_FAILED",
			message: describeGameFailure(header, result.RetCode, result.RetResult),
		}
	}
	payload := decodeGameObject(result.RetResult)
	if message := gameValueString(payload, "error"); message != "" {
		return nil, &autoBalanceGameError{status: http.StatusBadRequest, code: "AUTO_BALANCE_REJECTED", message: message}
	}
	return payload, nil
}

func rawJSONOrEmpty(value any) json.RawMessage {
	if value == nil {
		return json.RawMessage("{}")
	}
	body, err := json.Marshal(value)
	if err != nil {
		return json.RawMessage("{}")
	}
	return body
}

// optionalInt 区分「未开启」（null）与真实的 0：文档要求 today_net 为 null 时页面显示「未开启」。
func optionalGameInt(value any) *int64 {
	if value == nil {
		return nil
	}
	if text, ok := value.(string); ok && strings.TrimSpace(text) == "" {
		return nil
	}
	parsed := anyInt(value)
	return &parsed
}

// normalizedEntries 把 ok / failed / stopped 三种返回形状归一化成 [{guuid, name, error}]，
// 让前端只处理一种结构（stop_all 与导入返回的是字符串数组）。
func normalizedEntries(value any) []map[string]any {
	result := []map[string]any{}
	items, _ := value.([]any)
	for _, raw := range items {
		switch typed := raw.(type) {
		case string:
			result = append(result, map[string]any{"guuid": typed})
		case map[string]any:
			entry := map[string]any{"guuid": gameValueString(typed, "guuid")}
			if name := gameValueString(typed, "name"); name != "" {
				entry["name"] = name
			}
			if message := gameValueString(typed, "error"); message != "" {
				entry["error"] = message
			}
			for _, key := range []string{"action", "target_value", "chance", "team_name", "status"} {
				if _, exists := typed[key]; exists {
					entry[key] = typed[key]
				}
			}
			result = append(result, entry)
		}
	}
	return result
}

type autoBalanceOverview struct {
	Config      json.RawMessage         `json:"config"`
	Today       autoBalanceCount        `json:"today"`
	Team        autoBalanceTeamCount    `json:"team"`
	LastTick    string                  `json:"lastTick"`
	DipiOptions []autoBalanceDipiOption `json:"dipiOptions"`
}

// 底皮档位复用奖池配置里的 9 个标准档位（rewardPoolDefinitions），
// 界面上只让选不让填，避免手输「底皮5/10」写成「底皮5:10」这种对不上游戏服的值。
type autoBalanceDipiOption struct {
	Key   string `json:"key"`
	Label string `json:"label"`
}

func autoBalanceDipiOptions() []autoBalanceDipiOption {
	options := make([]autoBalanceDipiOption, 0, len(rewardPoolDefinitions))
	for _, definition := range rewardPoolDefinitions {
		options = append(options, autoBalanceDipiOption{Key: definition.Key, Label: definition.Label})
	}
	return options
}

type autoBalanceCount struct {
	SetCount int64 `json:"setCount"`
	Active   int64 `json:"active"`
}

type autoBalanceTeamCount struct {
	Teams   int64 `json:"teams"`
	Members int64 `json:"members"`
}

func (s *Server) handleGetAutoBalanceOverview(w http.ResponseWriter, r *http.Request, p principal) {
	ctx, cancel := context.WithTimeout(r.Context(), autoBalanceReadTimeout)
	defer cancel()
	payload, err := s.callAutoBalance(ctx, autoBalanceConfigQueryCommand, map[string]any{
		"context": gameOperationContext("ab-config"),
	})
	if err != nil {
		s.logger.Error("query auto balance config", "error", err)
		writeAutoBalanceError(w, err)
		return
	}
	today, _ := payload["today"].(map[string]any)
	team, _ := payload["team"].(map[string]any)
	writeData(w, http.StatusOK, autoBalanceOverview{
		Config: rawJSONOrEmpty(payload["cfg"]),
		Today: autoBalanceCount{
			SetCount: anyInt(today["set_count"]),
			Active:   anyInt(today["active"]),
		},
		Team: autoBalanceTeamCount{
			Teams:   anyInt(team["teams"]),
			Members: anyInt(team["members"]),
		},
		LastTick:    gameValueString(payload, "last_tick"),
		DipiOptions: autoBalanceDipiOptions(),
	})
}

type setAutoBalanceConfigRequest struct {
	Cfg     map[string]any `json:"cfg"`
	Patch   map[string]any `json:"patch"`
	Reason  string         `json:"reason"`
	Confirm bool           `json:"confirm"`
}

func (s *Server) handleSetAutoBalanceConfig(w http.ResponseWriter, r *http.Request, p principal) {
	var request setAutoBalanceConfigRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	if (request.Cfg == nil) == (request.Patch == nil) {
		writeError(w, http.StatusBadRequest, "INVALID_CONFIG", "cfg 与 patch 必须二选一")
		return
	}
	if utf8.RuneCountInString(request.Reason) > 200 {
		writeError(w, http.StatusBadRequest, "INVALID_REASON", "修改说明不能超过 200 字")
		return
	}
	mode := strings.TrimSpace(stringValue(request.Patch["mode"]))
	if mode == "" {
		mode = strings.TrimSpace(stringValue(request.Cfg["mode"]))
	}
	if mode != "" && mode != autoBalanceModeObserve && mode != autoBalanceModeAdvice && mode != autoBalanceModeAuto {
		writeError(w, http.StatusBadRequest, "INVALID_MODE", "运行模式只能是 observe、advice 或 auto")
		return
	}
	// 自动下发是真正会干预发牌的开关，后端也要求显式确认，避免误点或脚本直调。
	if mode == autoBalanceModeAuto && !request.Confirm {
		writeError(w, http.StatusBadRequest, "CONFIRM_REQUIRED", "切换到 auto 模式需要二次确认")
		return
	}

	autoBalanceWriteMu.Lock()
	defer autoBalanceWriteMu.Unlock()

	operationContext := gameOperationContext("ab-config-set")
	params := map[string]any{"context": operationContext}
	if request.Patch != nil {
		params["patch"] = request.Patch
	} else {
		params["cfg"] = request.Cfg
	}
	ctx, cancel := context.WithTimeout(r.Context(), autoBalanceWriteTimeout)
	defer cancel()
	payload, err := s.callAutoBalance(ctx, autoBalanceConfigSetCommand, params)
	if err != nil {
		s.logger.Error("set auto balance config", "error", err)
		s.audit(r.Context(), &p, "game.auto_balance.config.update", "game_auto_balance", "config",
			map[string]any{"cfg": request.Cfg, "patch": request.Patch, "reason": request.Reason, "context": operationContext},
			nil, nil, http.StatusBadGateway, err.Error(), clientIP(r))
		writeAutoBalanceError(w, err)
		return
	}
	after := rawJSONOrEmpty(payload["cfg"])
	s.audit(r.Context(), &p, "game.auto_balance.config.update", "game_auto_balance", "config",
		map[string]any{"cfg": request.Cfg, "patch": request.Patch, "reason": request.Reason, "context": operationContext},
		nil, json.RawMessage(after), 0, "已更新自动输赢平衡配置", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"config": after})
}

type autoBalanceCandidate struct {
	Guuid        string `json:"guuid"`
	Nick         string `json:"nick"`
	RoomID       int64  `json:"roomId"`
	Init         int64  `json:"init"`
	PeriodNet    int64  `json:"periodNet"`
	Rounds       int64  `json:"rounds"`
	Seconds      int64  `json:"seconds"`
	TodayNet     *int64 `json:"todayNet"`
	TeamName     string `json:"teamName"`
	Hit          bool   `json:"hit"`
	Action       string `json:"action"`
	TargetValue  int64  `json:"targetValue"`
	Chance       int64  `json:"chance"`
	HasTarget    bool   `json:"hasTarget"`
	CooldownLeft int64  `json:"cooldownLeft"`
}

func (s *Server) handleListAutoBalanceCandidates(w http.ResponseWriter, r *http.Request, p principal) {
	roomID, _ := strconv.ParseInt(strings.TrimSpace(r.URL.Query().Get("roomId")), 10, 64)
	limit, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("limit")))
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	params := map[string]any{
		"room_id": roomID,
		"limit":   limit,
		"context": gameOperationContext("ab-candidates"),
	}
	ctx, cancel := context.WithTimeout(r.Context(), autoBalanceReadTimeout)
	defer cancel()
	payload, err := s.callAutoBalance(ctx, autoBalanceCandidateCommand, params)
	if err != nil {
		s.logger.Error("query auto balance candidates", "error", err)
		writeAutoBalanceError(w, err)
		return
	}
	rawList, _ := payload["list"].([]any)
	items := make([]autoBalanceCandidate, 0, len(rawList))
	for _, raw := range rawList {
		object, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		items = append(items, autoBalanceCandidate{
			Guuid:        gameValueString(object, "guuid"),
			Nick:         gameValueString(object, "nick"),
			RoomID:       anyInt(object["room_id"]),
			Init:         anyInt(object["init"]),
			PeriodNet:    anyInt(object["period_net"]),
			Rounds:       anyInt(object["rounds"]),
			Seconds:      anyInt(object["seconds"]),
			TodayNet:     optionalGameInt(object["today_net"]),
			TeamName:     gameValueString(object, "team_name"),
			Hit:          anyInt(object["hit"]) == 1,
			Action:       gameValueString(object, "action"),
			TargetValue:  anyInt(object["target_value"]),
			Chance:       anyInt(object["chance"]),
			HasTarget:    anyInt(object["has_target"]) == 1,
			CooldownLeft: anyInt(object["cooldown_left"]),
		})
	}
	writeData(w, http.StatusOK, map[string]any{"items": items, "total": len(items), "roomId": roomID, "limit": limit})
}

type executeAutoBalanceRequest struct {
	Action string `json:"action"`
	Guuids string `json:"guuids"`
	Remark string `json:"remark"`
	Reason string `json:"reason"`
}

func (s *Server) handleExecuteAutoBalance(w http.ResponseWriter, r *http.Request, p principal) {
	var request executeAutoBalanceRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	action := strings.TrimSpace(request.Action)
	if action != "run" && action != "run_guuids" && action != "stop_all" {
		writeError(w, http.StatusBadRequest, "INVALID_ACTION", "action 只能是 run、run_guuids 或 stop_all")
		return
	}
	guuids := strings.TrimSpace(request.Guuids)
	if action == "run_guuids" && guuids == "" {
		writeError(w, http.StatusBadRequest, "GUUIDS_REQUIRED", "请选择要执行的玩家")
		return
	}
	remark := strings.TrimSpace(request.Remark)
	if action == "stop_all" && remark == "" {
		remark = fmt.Sprintf("后台一键全停（%s）", p.Username)
	}
	if utf8.RuneCountInString(guuids) > 20000 || utf8.RuneCountInString(remark) > autoBalanceMaxRemark {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMETER", "参数超出长度限制")
		return
	}

	autoBalanceWriteMu.Lock()
	defer autoBalanceWriteMu.Unlock()

	operationContext := gameOperationContext("ab-" + action)
	params := map[string]any{"action": action, "context": operationContext}
	if action == "run_guuids" {
		params["guuids"] = guuids
	}
	if action == "stop_all" {
		params["remark"] = remark
	}
	ctx, cancel := context.WithTimeout(r.Context(), autoBalanceWriteTimeout)
	defer cancel()
	payload, err := s.callAutoBalance(ctx, autoBalanceExecuteCommand, params)
	requestAudit := map[string]any{
		"action": action, "guuids": guuids, "remark": remark,
		"reason": strings.TrimSpace(request.Reason), "context": operationContext,
	}
	if err != nil {
		s.logger.Error("execute auto balance", "action", action, "error", err)
		s.audit(r.Context(), &p, "game.auto_balance.execute", "game_auto_balance", action,
			requestAudit, nil, nil, http.StatusBadGateway, err.Error(), clientIP(r))
		writeAutoBalanceError(w, err)
		return
	}
	response := map[string]any{
		"action":  action,
		"ok":      normalizedEntries(payload["ok"]),
		"failed":  normalizedEntries(payload["failed"]),
		"stopped": normalizedEntries(payload["stopped"]),
	}
	s.audit(r.Context(), &p, "game.auto_balance.execute", "game_auto_balance", action,
		requestAudit, nil, response, 0, describeAutoBalanceExecute(action, response), clientIP(r))
	writeData(w, http.StatusOK, response)
}

func describeAutoBalanceExecute(action string, response map[string]any) string {
	okList, _ := response["ok"].([]map[string]any)
	failedList, _ := response["failed"].([]map[string]any)
	switch action {
	case "stop_all":
		return fmt.Sprintf("一键全停：停止 %d 个目标", len(okList))
	case "run_guuids":
		return fmt.Sprintf("指定执行：成功 %d 个，失败 %d 个", len(okList), len(failedList))
	default:
		return fmt.Sprintf("手动执行一次：下发 %d 个，失败 %d 个", len(okList), len(failedList))
	}
}

// 排除名单、名单加人前先核对玩家是否真实存在，避免把打错的 ID 直接写进游戏服。
func (s *Server) handleCheckAutoBalancePlayer(w http.ResponseWriter, r *http.Request, p principal) {
	guuid := strings.TrimSpace(r.URL.Query().Get("guuid"))
	if len(guuid) < 4 || len(guuid) > 12 || !isNumericPlayerID(guuid) {
		writeError(w, http.StatusBadRequest, "INVALID_GUUID", "玩家 ID 必须是 4-12 位数字")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	loginName, name, found, err := s.readGamePlayerIdentity(ctx, guuid)
	if err != nil {
		s.logger.Error("check auto balance player", "error", err, "guuid", guuid)
		writeError(w, http.StatusBadGateway, "PLAYER_LOOKUP_FAILED", "玩家查询失败，请稍后重试")
		return
	}
	if !found {
		writeError(w, http.StatusNotFound, "PLAYER_NOT_FOUND", "玩家不存在，请核对 ID")
		return
	}
	writeData(w, http.StatusOK, map[string]any{"guuid": guuid, "name": name, "loginName": loginName})
}

type autoBalanceTeamItem struct {
	TeamName    string `json:"teamName"`
	MemberCount int64  `json:"memberCount"`
	UpdateDate  string `json:"updateDate"`
}

type autoBalanceMemberItem struct {
	TeamName    string `json:"teamName"`
	Guuid       string `json:"guuid"`
	Name        string `json:"name"`
	ClubID      string `json:"clubId"`
	TodayNet    *int64 `json:"todayNet"`
	TodayRounds int64  `json:"todayRounds"`
	Status      string `json:"status"`
	Remark      string `json:"remark"`
	Operator    string `json:"operator"`
	UpdateDate  string `json:"updateDate"`
}

func (s *Server) handleListAutoBalanceTeams(w http.ResponseWriter, r *http.Request, p principal) {
	teamName := strings.TrimSpace(r.URL.Query().Get("teamName"))
	guuid := strings.TrimSpace(r.URL.Query().Get("guuid"))
	if utf8.RuneCountInString(teamName) > autoBalanceMaxTeamName || utf8.RuneCountInString(guuid) > 32 {
		writeError(w, http.StatusBadRequest, "INVALID_FILTER", "查询条件过长")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), autoBalanceReadTimeout)
	defer cancel()
	payload, err := s.callAutoBalance(ctx, autoBalanceTeamQueryCommand, map[string]any{
		"team_name": teamName, "guuid": guuid, "context": gameOperationContext("ab-team-query"),
	})
	if err != nil {
		s.logger.Error("query auto balance teams", "error", err)
		writeAutoBalanceError(w, err)
		return
	}
	rawTeams, _ := payload["teams"].([]any)
	teams := make([]autoBalanceTeamItem, 0, len(rawTeams))
	for _, raw := range rawTeams {
		object, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		teams = append(teams, autoBalanceTeamItem{
			TeamName:    gameValueString(object, "team_name"),
			MemberCount: anyInt(object["member_count"]),
			UpdateDate:  gameValueString(object, "update_date"),
		})
	}
	rawMembers, _ := payload["members"].([]any)
	members := make([]autoBalanceMemberItem, 0, len(rawMembers))
	for _, raw := range rawMembers {
		object, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		members = append(members, autoBalanceMemberItem{
			TeamName:    gameValueString(object, "team_name"),
			Guuid:       gameValueString(object, "guuid"),
			Name:        gameValueString(object, "name"),
			ClubID:      gameValueString(object, "club_id"),
			TodayNet:    optionalGameInt(object["today_net"]),
			TodayRounds: anyInt(object["today_rounds"]),
			Status:      gameValueString(object, "status"),
			Remark:      gameValueString(object, "remark"),
			Operator:    gameValueString(object, "operator"),
			UpdateDate:  gameValueString(object, "update_date"),
		})
	}
	writeData(w, http.StatusOK, map[string]any{"teams": teams, "members": members})
}

type setAutoBalanceMembersRequest struct {
	TeamName string `json:"teamName"`
	Guuids   string `json:"guuids"`
	Remark   string `json:"remark"`
	Reason   string `json:"reason"`
}

func (s *Server) handleSetAutoBalanceMembers(w http.ResponseWriter, r *http.Request, p principal) {
	var request setAutoBalanceMembersRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	teamName := strings.TrimSpace(request.TeamName)
	guuids := strings.TrimSpace(request.Guuids)
	remark := strings.TrimSpace(request.Remark)
	if teamName == "" {
		writeError(w, http.StatusBadRequest, "TEAM_REQUIRED", "团队名不能为空")
		return
	}
	if utf8.RuneCountInString(teamName) > autoBalanceMaxTeamName {
		writeError(w, http.StatusBadRequest, "TEAM_TOO_LONG", "团队名超过 60 字")
		return
	}
	if guuids == "" {
		writeError(w, http.StatusBadRequest, "GUUIDS_REQUIRED", "请填写要加入的玩家 ID")
		return
	}
	if utf8.RuneCountInString(remark) > autoBalanceMaxRemark {
		writeError(w, http.StatusBadRequest, "REMARK_TOO_LONG", "备注不能超过 250 字")
		return
	}
	// 单次 200 个的上限由游戏服判定，这里只做请求体长度兜底。
	if utf8.RuneCountInString(guuids) > autoBalanceMaxGuuidsBatch {
		writeError(w, http.StatusBadRequest, "GUUIDS_TOO_MANY", "单次提交的玩家 ID 过多")
		return
	}

	autoBalanceWriteMu.Lock()
	defer autoBalanceWriteMu.Unlock()

	operationContext := gameOperationContext("ab-team-set")
	ctx, cancel := context.WithTimeout(r.Context(), autoBalanceWriteTimeout)
	defer cancel()
	payload, err := s.callAutoBalance(ctx, autoBalanceTeamSetCommand, map[string]any{
		"team_name": teamName, "guuids": guuids, "remark": remark, "context": operationContext,
	})
	requestAudit := map[string]any{
		"teamName": teamName, "guuids": guuids, "remark": remark,
		"reason": strings.TrimSpace(request.Reason), "context": operationContext,
	}
	if err != nil {
		s.logger.Error("set auto balance members", "error", err)
		s.audit(r.Context(), &p, "game.auto_balance.team.add", "game_auto_balance", teamName,
			requestAudit, nil, nil, http.StatusBadGateway, err.Error(), clientIP(r))
		writeAutoBalanceError(w, err)
		return
	}
	response := map[string]any{
		"ok":      normalizedEntries(payload["ok"]),
		"failed":  normalizedEntries(payload["failed"]),
		"stopped": normalizedEntries(payload["stopped"]),
	}
	s.audit(r.Context(), &p, "game.auto_balance.team.add", "game_auto_balance", teamName,
		requestAudit, nil, response, 0, fmt.Sprintf("名单加人 %s", teamName), clientIP(r))
	writeData(w, http.StatusOK, response)
}

type removeAutoBalanceMembersRequest struct {
	TeamName string `json:"teamName"`
	Guuids   string `json:"guuids"`
	Reason   string `json:"reason"`
}

func (s *Server) handleRemoveAutoBalanceMembers(w http.ResponseWriter, r *http.Request, p principal) {
	var request removeAutoBalanceMembersRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	teamName := strings.TrimSpace(request.TeamName)
	guuids := strings.TrimSpace(request.Guuids)
	if teamName == "" {
		writeError(w, http.StatusBadRequest, "TEAM_REQUIRED", "团队名不能为空")
		return
	}
	if utf8.RuneCountInString(teamName) > autoBalanceMaxTeamName {
		writeError(w, http.StatusBadRequest, "TEAM_TOO_LONG", "团队名超过 60 字")
		return
	}
	if utf8.RuneCountInString(guuids) > autoBalanceMaxGuuidsBatch {
		writeError(w, http.StatusBadRequest, "GUUIDS_TOO_MANY", "单次提交的玩家 ID 过多")
		return
	}

	autoBalanceWriteMu.Lock()
	defer autoBalanceWriteMu.Unlock()

	operationContext := gameOperationContext("ab-team-del")
	params := map[string]any{"team_name": teamName, "context": operationContext}
	if guuids != "" {
		params["guuids"] = guuids
	}
	ctx, cancel := context.WithTimeout(r.Context(), autoBalanceWriteTimeout)
	defer cancel()
	payload, err := s.callAutoBalance(ctx, autoBalanceTeamRemoveCommand, params)
	requestAudit := map[string]any{
		"teamName": teamName, "guuids": guuids,
		"reason": strings.TrimSpace(request.Reason), "context": operationContext,
	}
	if err != nil {
		s.logger.Error("remove auto balance members", "error", err)
		s.audit(r.Context(), &p, "game.auto_balance.team.remove", "game_auto_balance", teamName,
			requestAudit, nil, nil, http.StatusBadGateway, err.Error(), clientIP(r))
		writeAutoBalanceError(w, err)
		return
	}
	response := map[string]any{
		"ok":      normalizedEntries(payload["ok"]),
		"failed":  normalizedEntries(payload["failed"]),
		"stopped": normalizedEntries(payload["stopped"]),
	}
	s.audit(r.Context(), &p, "game.auto_balance.team.remove", "game_auto_balance", teamName,
		requestAudit, nil, response, 0, fmt.Sprintf("名单移除 %s", teamName), clientIP(r))
	writeData(w, http.StatusOK, response)
}

type importAutoBalanceTeamsRequest struct {
	GroupIDs   []int64 `json:"groupIds"`
	TeamPrefix string  `json:"teamPrefix"`
	DryRun     bool    `json:"dryRun"`
	Reason     string  `json:"reason"`
}

func (s *Server) handleImportAutoBalanceTeams(w http.ResponseWriter, r *http.Request, p principal) {
	var request importAutoBalanceTeamsRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	if len(request.GroupIDs) == 0 {
		writeError(w, http.StatusBadRequest, "GROUPS_REQUIRED", "请选择要导入的玩家分组")
		return
	}
	if len(request.GroupIDs) > 200 {
		writeError(w, http.StatusBadRequest, "GROUPS_TOO_MANY", "单次最多导入 200 个分组")
		return
	}
	prefix := strings.TrimSpace(request.TeamPrefix)
	if prefix == "" {
		prefix = "导入-"
	}
	if utf8.RuneCountInString(prefix) > 40 {
		writeError(w, http.StatusBadRequest, "INVALID_PREFIX", "团队名前缀不能超过 40 字")
		return
	}

	autoBalanceWriteMu.Lock()
	defer autoBalanceWriteMu.Unlock()

	operationContext := gameOperationContext("ab-team-import")
	ctx, cancel := context.WithTimeout(r.Context(), autoBalanceWriteTimeout)
	defer cancel()
	payload, err := s.callAutoBalance(ctx, autoBalanceTeamImportCommand, map[string]any{
		"group_ids":   request.GroupIDs,
		"team_prefix": prefix,
		"dry_run":     boolToInt(request.DryRun),
		"context":     operationContext,
	})
	requestAudit := map[string]any{
		"groupIds": request.GroupIDs, "teamPrefix": prefix, "dryRun": request.DryRun,
		"reason": strings.TrimSpace(request.Reason), "context": operationContext,
	}
	if err != nil {
		s.logger.Error("import auto balance teams", "error", err)
		s.audit(r.Context(), &p, "game.auto_balance.team.import", "game_auto_balance", "import",
			requestAudit, nil, nil, http.StatusBadGateway, err.Error(), clientIP(r))
		writeAutoBalanceError(w, err)
		return
	}
	response := map[string]any{
		"dryRun":   request.DryRun,
		"teams":    anyInt(payload["teams"]),
		"members":  anyInt(payload["members"]),
		"affected": anyInt(payload["affected"]),
		"stopped":  normalizedEntries(payload["stopped"]),
	}
	if !request.DryRun {
		s.audit(r.Context(), &p, "game.auto_balance.team.import", "game_auto_balance", "import",
			requestAudit, nil, response, 0,
			fmt.Sprintf("导入伙牌名单：%d 个团队 %d 人", anyInt(payload["teams"]), anyInt(payload["members"])), clientIP(r))
	}
	writeData(w, http.StatusOK, response)
}

type autoBalanceGroupItem struct {
	ID          int64  `json:"id"`
	GroupName   string `json:"groupName"`
	ScopeType   string `json:"scopeType"`
	ScopeID     string `json:"scopeId"`
	MemberCount int64  `json:"memberCount"`
	UpdateDate  string `json:"updateDate"`
}

// 导入源：直接只读游戏库的分组表。游戏服 异步_查询_俱乐部_分组 需要逐个 club_id 调用，
// 无法一次列出全部分组，所以这里只读 club_player_group_info（后台对 kbedm 只读）。
func (s *Server) handleListAutoBalanceGroups(w http.ResponseWriter, r *http.Request, p principal) {
	if s.gameDB == nil {
		writeData(w, http.StatusOK, map[string]any{"items": []autoBalanceGroupItem{}, "warning": "游戏库未配置"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	rows, err := s.gameDB.QueryContext(ctx, `SELECT g.id, g.group_name, g.scope_type, g.scope_id, g.update_date,
(SELECT COUNT(*) FROM club_player_group_member_info m WHERE m.group_id = g.id AND m.status = 'used')
FROM club_player_group_info g
WHERE g.status = 'used'
ORDER BY g.update_date DESC, g.id DESC
LIMIT 300`)
	if err != nil {
		s.logger.Error("query player groups for auto balance", "error", err)
		writeData(w, http.StatusOK, map[string]any{
			"items":   []autoBalanceGroupItem{},
			"warning": "分组数据读取失败，可改用手工填写玩家 ID",
		})
		return
	}
	defer rows.Close()
	items := []autoBalanceGroupItem{}
	for rows.Next() {
		var item autoBalanceGroupItem
		if err := rows.Scan(&item.ID, &item.GroupName, &item.ScopeType, &item.ScopeID, &item.UpdateDate, &item.MemberCount); err != nil {
			s.logger.Error("scan player group", "error", err)
			continue
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		s.logger.Error("iterate player groups", "error", err)
	}
	writeData(w, http.StatusOK, map[string]any{"items": items})
}

func stringValue(value any) string {
	text, _ := value.(string)
	return text
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

// countGuuids 统计逗号/空白分隔的玩家 ID 个数，用于前端提示与后端兜底。
func countGuuids(raw string) int {
	fields := strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == '，' || r == '\n' || r == '\r' || r == ' ' || r == '\t' || r == ';' || r == '；'
	})
	return len(fields)
}
