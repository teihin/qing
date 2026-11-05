package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"
)

// 代理贡献管理：
//
// 客户端和后台调用同一个成员数据接口（查询_俱乐部_成员），由 KBE 按调用者身份
// 决定返回真实值还是展示值。后台以管理员身份调用，拿到的是真实值；展示规则
// 只通过后台规则命令下发，不在后台重算折扣。
const (
	agentContributionMembersCommand = "查询_俱乐部_成员"
	agentContributionRuleGetCommand = "查询_代理_展示规则"
	agentContributionRuleSetCommand = "设置_代理_展示规则"
	agentContributionRuleDelCommand = "取消_代理_展示规则"
)

type agentDisplayRule struct {
	Mode            string `json:"mode"` // none / percent / fixed / unknown
	Percent         *int64 `json:"percent,omitempty"`
	Delta           *int64 `json:"delta,omitempty"`
	Source          string `json:"source"` // none / self / inherit / global / unknown
	SourceAgentID   string `json:"sourceAgentId,omitempty"`
	SourceAgentName string `json:"sourceAgentName,omitempty"`
	Sim             bool   `json:"sim"`
}

type agentContributionNode struct {
	PlayerID            string           `json:"playerId"`
	Name                string           `json:"name"`
	Role                string           `json:"role"` // owner / agent / member
	IsAgent             bool             `json:"isAgent"`
	Level               int64            `json:"level"`
	UpperID             string           `json:"upperId"`
	UpperName           string           `json:"upperName"`
	TeamCount           string           `json:"teamCount"`
	TodayScore          string           `json:"todayScore"`
	YesterdayScore      string           `json:"yesterdayScore"`
	TotalScore          string           `json:"totalScore"`
	TodayContribFen     string           `json:"todayContribFen"`
	YesterdayContribFen string           `json:"yesterdayContribFen"`
	TotalContribFen     string           `json:"totalContribFen"`
	Percent             string           `json:"percent"`
	ContribRule         agentDisplayRule `json:"contribRule"`
	ScoreRule           agentDisplayRule `json:"scoreRule"`
}

type agentContributionMembersResponse struct {
	ClubID       string                  `json:"clubId"`
	AgentID      string                  `json:"agentId"`
	Items        []agentContributionNode `json:"items"`
	Total        int64                   `json:"total"`
	Page         int                     `json:"page"`
	PageSize     int                     `json:"pageSize"`
	RawAvailable bool                    `json:"rawAvailable"`
	Truncated    bool                    `json:"truncated"`
	Message      string                  `json:"message"`
}

type agentContributionRuleRequest struct {
	Metric  string `json:"metric"`
	Mode    string `json:"mode"`
	Percent *int64 `json:"percent"`
	Delta   *int64 `json:"delta"`
	Note    string `json:"note"`
}

type agentContributionRuleResponse struct {
	ClubID   string           `json:"clubId"`
	AgentID  string           `json:"agentId"`
	Metric   string           `json:"metric"`
	Rule     agentDisplayRule `json:"rule"`
	Verified bool             `json:"verified"`
	Message  string           `json:"message"`
}

type agentContributionRuleQueryResponse struct {
	ClubID    string           `json:"clubId"`
	AgentID   string           `json:"agentId"`
	Metric    string           `json:"metric"`
	Available bool             `json:"available"`
	Rule      agentDisplayRule `json:"rule"`
	Message   string           `json:"message"`
}

func (s *Server) handleAgentContributionMembers(w http.ResponseWriter, r *http.Request, _ principal) {
	clubID, err := normalizeClubID(r.PathValue("clubId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_CLUB_ID", err.Error())
		return
	}
	agentID := strings.TrimSpace(r.URL.Query().Get("agentId"))
	if agentID != "" && !validAgentID(agentID) {
		writeError(w, http.StatusBadRequest, "INVALID_AGENT_ID", "代理 ID 不正确")
		return
	}
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	size, _ := strconv.Atoi(r.URL.Query().Get("pageSize"))
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 200 {
		size = 200
	}

	rootID := agentID
	if rootID == "" {
		rootID, err = s.clubOwnerID(r.Context(), clubID)
		if errors.Is(err, sql.ErrNoRows) || (err == nil && rootID == "") {
			writeError(w, http.StatusNotFound, "CLUB_OWNER_NOT_FOUND", "没有找到这个俱乐部的创建者")
			return
		}
		if err != nil {
			s.logger.Error("resolve club owner", "error", err, "clubId", clubID)
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取俱乐部创建者失败")
			return
		}
	}

	response, gameErr := s.queryAgentContributionMembers(r, clubID, rootID, page, size)
	if gameErr != nil {
		s.logger.Warn("query agent contribution members from game server", "error", gameErr, "clubId", clubID, "agentId", rootID)
	}
	if !response.RawAvailable {
		// 游戏服没有返回数据时，仍然把俱乐部关系树给后台，保证规则设置页面可用；
		// 统计值留空，由前端明确显示“统计暂不可用”，不能伪造成 0。
		fallback, fallbackErr := s.fallbackAgentContributionMembers(r, clubID, rootID)
		if fallbackErr != nil {
			s.logger.Error("fallback agent contribution members", "error", fallbackErr, "clubId", clubID, "agentId", rootID)
			writeError(w, http.StatusBadGateway, "GAME_DATA_UNAVAILABLE", "读取游戏服成员数据失败")
			return
		}
		response.Items = fallback
		response.Total = int64(len(fallback))
		if gameErr != nil {
			response.Message = "游戏服成员数据暂不可用：" + gameErr.Error()
		}
		if response.Message == "" {
			response.Message = "游戏服成员数据暂不可用，仅显示俱乐部关系"
		}
	}
	writeData(w, http.StatusOK, response)
}

func (s *Server) queryAgentContributionMembers(r *http.Request, clubID, agentID string, page, size int) (agentContributionMembersResponse, error) {
	result := agentContributionMembersResponse{
		ClubID: clubID, AgentID: agentID, Page: page, PageSize: size,
		Items: []agentContributionNode{},
	}
	params := map[string]any{
		"club_id":  clubID,
		"agent_id": agentID,
		"user_id":  "ALL",
		"page":     strconv.Itoa(page),
		"count":    strconv.Itoa(size),
		"context":  gameOperationContext("agent-contribution"),
	}
	gameResult, err := s.callGameCommand(r.Context(), agentContributionMembersCommand, params)
	if err != nil {
		return result, err
	}
	if gameResult.RetCode != 512 {
		return result, fmt.Errorf("游戏服返回 %s", gameResult.RetResult)
	}
	rows := extractGameRows(gameResult.RetResult)
	if len(rows) == 0 {
		return result, nil
	}
	items := make([]agentContributionNode, 0, len(rows))
	for _, row := range rows {
		node := mapAgentContributionNode(row)
		if node.PlayerID == "" {
			continue
		}
		items = append(items, node)
	}
	if len(items) == 0 {
		return result, nil
	}
	// 成员接口首行是被查询代理自己；把它放在最前面，前端展开子级时再过滤。
	for index, item := range items {
		if item.PlayerID == agentID && index != 0 {
			items[0], items[index] = items[index], items[0]
			break
		}
	}
	result.Items = items
	result.Total = int64(len(items))
	result.RawAvailable = true
	result.Truncated = len(rows) >= size
	return result, nil
}

func (s *Server) fallbackAgentContributionMembers(r *http.Request, clubID, agentID string) ([]agentContributionNode, error) {
	detail, err := s.readClubDetail(r.Context(), clubID)
	if err != nil {
		return nil, err
	}
	var find func(nodes []*clubMemberTree) *clubMemberTree
	find = func(nodes []*clubMemberTree) *clubMemberTree {
		for _, node := range nodes {
			if node.PlayerID == agentID {
				return node
			}
			if found := find(node.Children); found != nil {
				return found
			}
		}
		return nil
	}
	node := find(detail.Roots)
	if node == nil {
		return nil, sql.ErrNoRows
	}
	result := make([]agentContributionNode, 0, len(node.Children)+1)
	result = append(result, fallbackContributionNode(node.clubMemberNode))
	for _, child := range node.Children {
		result = append(result, fallbackContributionNode(child.clubMemberNode))
	}
	return result, nil
}

func fallbackContributionNode(member clubMemberNode) agentContributionNode {
	return agentContributionNode{
		PlayerID: member.PlayerID, Name: member.Name,
		Role: clubMemberRole(member), IsAgent: member.IsAgent,
		UpperID:     member.UpperID,
		ContribRule: agentDisplayRule{Mode: "none", Source: "none"},
		ScoreRule:   agentDisplayRule{Mode: "none", Source: "none"},
	}
}

func clubMemberRole(member clubMemberNode) string {
	if member.Role == "owner" {
		return "owner"
	}
	if member.IsAgent {
		return "agent"
	}
	return "member"
}

func (s *Server) handleAgentContributionRuleGet(w http.ResponseWriter, r *http.Request, _ principal) {
	clubID, agentID, metric, ok := parseAgentContributionRulePath(w, r)
	if !ok {
		return
	}
	params := map[string]any{
		"club_id": clubID, "agent_id": agentID, "metric": metric,
		"context": gameOperationContext("agent-contribution-rule-get"),
	}
	result, err := s.callGameCommand(r.Context(), agentContributionRuleGetCommand, params)
	if err != nil {
		writeData(w, http.StatusOK, agentContributionRuleQueryResponse{
			ClubID: clubID, AgentID: agentID, Metric: metric, Available: false,
			Rule: agentDisplayRule{Mode: "none", Source: "none"}, Message: "游戏服规则查询暂不可用",
		})
		return
	}
	if result.RetCode != 512 {
		writeData(w, http.StatusOK, agentContributionRuleQueryResponse{
			ClubID: clubID, AgentID: agentID, Metric: metric, Available: false,
			Rule: agentDisplayRule{Mode: "none", Source: "none"}, Message: gameResultMessage(result.RetResult),
		})
		return
	}
	rule := parseRulePayload(result.RetResult, metric)
	writeData(w, http.StatusOK, agentContributionRuleQueryResponse{
		ClubID: clubID, AgentID: agentID, Metric: metric, Available: true, Rule: rule,
	})
}

func (s *Server) handleAgentContributionRuleSet(w http.ResponseWriter, r *http.Request, p principal) {
	clubID, agentID, metric, ok := parseAgentContributionRulePath(w, r)
	if !ok {
		return
	}
	var input agentContributionRuleRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", "请求内容格式不正确")
		return
	}
	input.Mode = strings.ToLower(strings.TrimSpace(input.Mode))
	input.Note = strings.TrimSpace(input.Note)
	if input.Mode != "percent" && input.Mode != "fixed" {
		writeError(w, http.StatusBadRequest, "INVALID_MODE", "展示方式只能是按比例或按固定差额")
		return
	}
	if input.Mode == "percent" {
		if input.Percent == nil || *input.Percent < 0 || *input.Percent > 100 {
			writeError(w, http.StatusBadRequest, "INVALID_PERCENT", "比例必须是 0 到 100 的整数")
			return
		}
		input.Delta = nil
	}
	if input.Mode == "fixed" {
		if input.Delta == nil || *input.Delta == 0 {
			writeError(w, http.StatusBadRequest, "INVALID_DELTA", "固定差额不能为 0")
			return
		}
		if math.Abs(float64(*input.Delta)) > 1_000_000_000 {
			writeError(w, http.StatusBadRequest, "INVALID_DELTA", "固定差额超出允许范围")
			return
		}
		input.Percent = nil
	}
	if count := utf8.RuneCountInString(input.Note); count < 2 || count > 200 {
		writeError(w, http.StatusBadRequest, "INVALID_NOTE", "调整原因需要 2 到 200 个字")
		return
	}

	params := map[string]any{
		"club_id": clubID, "agent_id": agentID, "metric": metric,
		"mode": input.Mode, "note": input.Note,
		"operator": p.Username,
		"context":  gameOperationContext("agent-contribution-rule-set"),
	}
	if input.Percent != nil {
		params["percent"] = *input.Percent
	}
	if input.Delta != nil {
		params["delta"] = *input.Delta
	}
	result, err := s.callGameCommand(r.Context(), agentContributionRuleSetCommand, params)
	if err != nil {
		s.audit(r.Context(), &p, "game.agent_contribution.adjust", "game_agent", agentID,
			map[string]any{"clubId": clubID, "metric": metric, "mode": input.Mode, "percent": input.Percent, "delta": input.Delta, "note": input.Note},
			nil, nil, 502, "游戏服设置失败", clientIP(r))
		writeError(w, http.StatusBadGateway, "GAME_COMMAND_FAILED", "游戏服设置失败："+err.Error())
		return
	}
	if result.RetCode != 512 {
		message := gameResultMessage(result.RetResult)
		s.audit(r.Context(), &p, "game.agent_contribution.adjust", "game_agent", agentID,
			map[string]any{"clubId": clubID, "metric": metric, "mode": input.Mode, "percent": input.Percent, "delta": input.Delta, "note": input.Note},
			nil, result.RetResult, result.RetCode, message, clientIP(r))
		writeError(w, http.StatusBadGateway, "GAME_COMMAND_FAILED", message)
		return
	}
	rule := parseRulePayload(result.RetResult, metric)
	if rule.Mode == "none" || rule.Mode == "unknown" {
		sim := (input.Mode == "percent" && input.Percent != nil && *input.Percent != 100) ||
			(input.Mode == "fixed" && input.Delta != nil && *input.Delta != 0)
		rule = agentDisplayRule{Mode: input.Mode, Percent: input.Percent, Delta: input.Delta, Source: "self", Sim: sim}
	}
	if rule.Source == "" {
		rule.Source = "self"
	}
	s.audit(r.Context(), &p, "game.agent_contribution.adjust", "game_agent", agentID,
		map[string]any{"clubId": clubID, "metric": metric, "mode": input.Mode, "percent": input.Percent, "delta": input.Delta, "note": input.Note},
		nil, map[string]any{"rule": rule}, 0, "设置成功", clientIP(r))
	writeData(w, http.StatusOK, agentContributionRuleResponse{
		ClubID: clubID, AgentID: agentID, Metric: metric, Rule: rule, Verified: true, Message: "设置成功",
	})
}

func (s *Server) handleAgentContributionRuleReset(w http.ResponseWriter, r *http.Request, p principal) {
	clubID, agentID, metric, ok := parseAgentContributionRulePath(w, r)
	if !ok {
		return
	}
	params := map[string]any{
		"club_id": clubID, "agent_id": agentID, "metric": metric,
		"operator": p.Username,
		"context":  gameOperationContext("agent-contribution-rule-reset"),
	}
	result, err := s.callGameCommand(r.Context(), agentContributionRuleDelCommand, params)
	if err != nil {
		s.audit(r.Context(), &p, "game.agent_contribution.adjust", "game_agent", agentID,
			map[string]any{"clubId": clubID, "metric": metric, "action": "reset"},
			nil, nil, 502, "游戏服取消失败", clientIP(r))
		writeError(w, http.StatusBadGateway, "GAME_COMMAND_FAILED", "游戏服取消失败："+err.Error())
		return
	}
	if result.RetCode != 512 {
		message := gameResultMessage(result.RetResult)
		s.audit(r.Context(), &p, "game.agent_contribution.adjust", "game_agent", agentID,
			map[string]any{"clubId": clubID, "metric": metric, "action": "reset"},
			nil, result.RetResult, result.RetCode, message, clientIP(r))
		writeError(w, http.StatusBadGateway, "GAME_COMMAND_FAILED", message)
		return
	}
	s.audit(r.Context(), &p, "game.agent_contribution.adjust", "game_agent", agentID,
		map[string]any{"clubId": clubID, "metric": metric, "action": "reset"},
		nil, map[string]any{"mode": "none", "source": "inherit"}, 0, "已恢复上级规则", clientIP(r))
	writeData(w, http.StatusOK, agentContributionRuleResponse{
		ClubID: clubID, AgentID: agentID, Metric: metric,
		Rule: agentDisplayRule{Mode: "none", Source: "inherit"}, Verified: true, Message: "已恢复上级规则",
	})
}

func parseAgentContributionRulePath(w http.ResponseWriter, r *http.Request) (string, string, string, bool) {
	clubID, err := normalizeClubID(r.PathValue("clubId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_CLUB_ID", err.Error())
		return "", "", "", false
	}
	agentID := strings.TrimSpace(r.PathValue("agentId"))
	if !validAgentID(agentID) {
		writeError(w, http.StatusBadRequest, "INVALID_AGENT_ID", "代理 ID 不正确")
		return "", "", "", false
	}
	metric := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("metric")))
	if metric != "contrib" && metric != "score" {
		writeError(w, http.StatusBadRequest, "INVALID_METRIC", "指标只能是 contrib 或 score")
		return "", "", "", false
	}
	return clubID, agentID, metric, true
}

func (s *Server) clubOwnerID(ctx context.Context, clubID string) (string, error) {
	var owner string
	err := s.db.QueryRowContext(ctx, `SELECT sm_guuid FROM kbedm.tbl_Account
WHERE (FIND_IN_SET(?, REPLACE(COALESCE(sm_club_make, ''), ' ', '')) > 0
    OR FIND_IN_SET(?, REPLACE(COALESCE(sm_club_make2, ''), ' ', '')) > 0)
ORDER BY id LIMIT 1`, clubID, clubID).Scan(&owner)
	return strings.TrimSpace(owner), err
}

func extractGameRows(raw json.RawMessage) []map[string]any {
	if len(raw) == 0 {
		return nil
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil
	}
	rows := findGameRows(value, 0)
	result := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		if object, ok := row.(map[string]any); ok {
			result = append(result, object)
		}
	}
	return result
}

func findGameRows(value any, depth int) []any {
	if depth > 4 || value == nil {
		return nil
	}
	switch typed := value.(type) {
	case []any:
		return typed
	case string:
		var nested any
		if err := json.Unmarshal([]byte(typed), &nested); err == nil {
			return findGameRows(nested, depth+1)
		}
	case map[string]any:
		for _, key := range []string{"NumberList", "numberList", "result", "rows", "list", "items", "data", "members"} {
			if nested, ok := typed[key]; ok {
				if rows := findGameRows(nested, depth+1); len(rows) > 0 {
					return rows
				}
			}
		}
		// 少数接口返回 {"123456": {...}, ...} 的字典，兜底按对象值取行。
		objects := make([]any, 0, len(typed))
		for _, nested := range typed {
			if _, ok := nested.(map[string]any); ok {
				objects = append(objects, nested)
			}
		}
		if len(objects) > 0 {
			return objects
		}
	}
	return nil
}

func mapAgentContributionNode(row map[string]any) agentContributionNode {
	displayRole := strings.ToLower(strings.TrimSpace(textField(row, "role", "club_role", "clubRole")))
	isOwner := boolField(row, "is_owner", "isOwner") ||
		displayRole == "owner" || displayRole == "老板" || displayRole == "创建者" || displayRole == "群主"
	isAgent := boolField(row, "is_agent", "isAgent", "is_leader", "ex_agent") ||
		displayRole == "agent" || displayRole == "代理" || displayRole == "合伙人" || displayRole == "leader"
	role := "member"
	if isOwner {
		role = "owner"
	} else if isAgent {
		role = "agent"
	}
	return agentContributionNode{
		PlayerID:            textField(row, "user_id", "guuid", "playerId", "id"),
		Name:                textField(row, "name", "user_name", "nickname"),
		Role:                role,
		IsAgent:             role == "owner" || role == "agent",
		Level:               intField(row, "level", "sm_level"),
		UpperID:             textField(row, "upper_guuid", "upper_id", "upperId", "parent_id", "parentId", "agent_id"),
		UpperName:           textField(row, "upper_name", "upperName", "parent_name", "parentName"),
		TeamCount:           textField(row, "team_count", "teamCount"),
		TodayScore:          textField(row, "today_score", "todayScore"),
		YesterdayScore:      textField(row, "yesterday_score", "yesterdayScore"),
		TotalScore:          textField(row, "total_score", "totalScore"),
		TodayContribFen:     textField(row, "today_contrib_fen", "todayContribFen"),
		YesterdayContribFen: textField(row, "yesterday_contrib_fen", "yesterdayContribFen"),
		TotalContribFen:     textField(row, "total_contrib_fen", "totalContribFen"),
		Percent:             textField(row, "percent", "agent_percent", "agentPercent"),
		ContribRule:         parseDisplayRuleFromRow(row, "contrib"),
		ScoreRule:           parseDisplayRuleFromRow(row, "score"),
	}
}

func parseDisplayRuleFromRow(row map[string]any, metric string) agentDisplayRule {
	for _, key := range []string{metric + "_display_rule", metric + "_rule", "display_rule_" + metric} {
		if value, ok := row[key]; ok {
			if rule := parseDisplayRuleValue(value); rule.Mode != "" {
				return rule
			}
		}
	}
	if value, ok := row["display_rules"]; ok {
		if mapping, ok := asObject(value); ok {
			if nested, ok := mapping[metric]; ok {
				if rule := parseDisplayRuleValue(nested); rule.Mode != "" {
					return rule
				}
			}
		}
	}
	if value, ok := row["display_rule"]; ok {
		if rule := parseDisplayRuleValue(value); rule.Mode != "" {
			return rule
		}
	}
	rule := agentDisplayRule{Mode: "none", Source: "none"}
	prefixes := []string{metric + "_display_", metric + "_", "display_"}
	for _, prefix := range prefixes {
		mode := textField(row, prefix+"mode", prefix+"rule_mode")
		if mode == "" {
			continue
		}
		rule.Mode = normalizeRuleMode(mode)
		rule.Percent = intPointerField(row, prefix+"percent")
		rule.Delta = intPointerField(row, prefix+"delta", prefix+"fixed_delta")
		rule.Source = textField(row, prefix+"source", prefix+"rule_source")
		rule.SourceAgentID = textField(row, prefix+"source_agent_id", prefix+"sourceAgentId")
		rule.SourceAgentName = textField(row, prefix+"source_agent_name", prefix+"sourceAgentName")
		rule.Sim = boolField(row, prefix+"sim", prefix+"adjusted", prefix+"display_sim")
		if rule.Source == "" {
			rule.Source = "unknown"
		}
		if rule.Mode == "percent" && rule.Percent != nil && *rule.Percent == 100 {
			rule.Sim = false
		}
		if rule.Mode == "fixed" && rule.Delta != nil && *rule.Delta == 0 {
			rule.Sim = false
		}
		if rule.Mode == "percent" || rule.Mode == "fixed" {
			rule.Sim = rule.Sim || (rule.Mode == "percent" && rule.Percent != nil && *rule.Percent != 100) ||
				(rule.Mode == "fixed" && rule.Delta != nil && *rule.Delta != 0)
		}
		return rule
	}
	return rule
}

func asObject(value any) (map[string]any, bool) {
	if mapping, ok := value.(map[string]any); ok {
		return mapping, true
	}
	if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
		var mapping map[string]any
		if json.Unmarshal([]byte(text), &mapping) == nil {
			return mapping, true
		}
	}
	return nil, false
}

func parseDisplayRuleValue(value any) agentDisplayRule {
	mapping, ok := asObject(value)
	if !ok {
		return agentDisplayRule{}
	}
	rule := agentDisplayRule{
		Mode:            normalizeRuleMode(textField(mapping, "mode")),
		Percent:         intPointerField(mapping, "percent"),
		Delta:           intPointerField(mapping, "delta", "fixed_delta"),
		Source:          textField(mapping, "source"),
		SourceAgentID:   textField(mapping, "source_agent_id", "sourceAgentId"),
		SourceAgentName: textField(mapping, "source_agent_name", "sourceAgentName"),
		Sim:             boolField(mapping, "sim", "adjusted"),
	}
	if rule.Source == "" {
		rule.Source = "unknown"
	}
	rule.Sim = rule.Sim || (rule.Mode == "percent" && rule.Percent != nil && *rule.Percent != 100) ||
		(rule.Mode == "fixed" && rule.Delta != nil && *rule.Delta != 0)
	return rule
}

func parseRulePayload(raw json.RawMessage, metric string) agentDisplayRule {
	if len(raw) == 0 {
		return agentDisplayRule{Mode: "none", Source: "none"}
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return agentDisplayRule{Mode: "none", Source: "none"}
	}
	if mapping, ok := value.(map[string]any); ok {
		if nested, ok := mapping["rule"]; ok {
			if rule := parseDisplayRuleValue(nested); rule.Mode != "" {
				return rule
			}
		}
		if nested, ok := mapping[metric]; ok {
			if rule := parseDisplayRuleValue(nested); rule.Mode != "" {
				return rule
			}
		}
		if rows := findGameRows(mapping, 0); len(rows) > 0 {
			if row, ok := rows[0].(map[string]any); ok {
				return parseDisplayRuleFromRow(row, metric)
			}
		}
		if rule := parseDisplayRuleValue(mapping); rule.Mode != "" {
			return rule
		}
	}
	return agentDisplayRule{Mode: "none", Source: "none"}
}

func normalizeRuleMode(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", "none", "inherit", "default", "real":
		return "none"
	case "percent", "ratio", "percentage":
		return "percent"
	case "fixed", "amount", "delta":
		return "fixed"
	default:
		return "unknown"
	}
}

func gameResultMessage(raw json.RawMessage) string {
	if len(raw) == 0 {
		return "游戏服未返回结果"
	}
	var mapping map[string]any
	if err := json.Unmarshal(raw, &mapping); err == nil {
		for _, key := range []string{"error", "msg", "message", "errmsg"} {
			if value := strings.TrimSpace(textField(mapping, key)); value != "" {
				return value
			}
		}
	}
	text := strings.TrimSpace(string(raw))
	if text == "" || text == "{}" {
		return "游戏服未返回结果"
	}
	if len(text) > 200 {
		text = text[:200]
	}
	return text
}

func textField(row map[string]any, names ...string) string {
	for _, name := range names {
		value, ok := row[name]
		if !ok || value == nil {
			continue
		}
		switch typed := value.(type) {
		case string:
			if strings.TrimSpace(typed) != "" {
				return strings.TrimSpace(typed)
			}
		case json.Number:
			return typed.String()
		case float64:
			if typed == math.Trunc(typed) {
				return strconv.FormatInt(int64(typed), 10)
			}
			return strconv.FormatFloat(typed, 'f', -1, 64)
		case int:
			return strconv.Itoa(typed)
		case int64:
			return strconv.FormatInt(typed, 10)
		case bool:
			return strconv.FormatBool(typed)
		}
	}
	return ""
}

func intField(row map[string]any, names ...string) int64 {
	for _, name := range names {
		value, ok := row[name]
		if !ok || value == nil {
			continue
		}
		switch typed := value.(type) {
		case float64:
			return int64(typed)
		case int:
			return int64(typed)
		case int64:
			return typed
		case json.Number:
			number, _ := typed.Int64()
			return number
		case string:
			number, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
			if err == nil {
				return int64(number)
			}
		}
	}
	return 0
}

func intPointerField(row map[string]any, names ...string) *int64 {
	for _, name := range names {
		value, ok := row[name]
		if !ok || value == nil {
			continue
		}
		var number int64
		switch typed := value.(type) {
		case float64:
			number = int64(typed)
		case int:
			number = int64(typed)
		case int64:
			number = typed
		case json.Number:
			number, _ = typed.Int64()
		case string:
			parsed, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
			if err != nil {
				continue
			}
			number = int64(parsed)
		default:
			continue
		}
		return &number
	}
	return nil
}

func boolField(row map[string]any, names ...string) bool {
	for _, name := range names {
		value, ok := row[name]
		if !ok || value == nil {
			continue
		}
		switch typed := value.(type) {
		case bool:
			return typed
		case float64:
			return typed != 0
		case int:
			return typed != 0
		case int64:
			return typed != 0
		case json.Number:
			number, _ := typed.Int64()
			return number != 0
		case string:
			normalized := strings.ToLower(strings.TrimSpace(typed))
			return normalized == "1" || normalized == "true" || normalized == "yes" || normalized == "on" || normalized == "是"
		}
	}
	return false
}
