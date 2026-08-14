package api

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"
)

const (
	agentCandidateSQL = `(a.sm_level > 0 OR COALESCE(m.level, 0) > 0 OR
a.sm_bigAgentID = a.sm_guuid OR a.sm_supperAgentID = a.sm_guuid OR a.sm_chiefAgentID = a.sm_guuid OR
a.sm_role LIKE '%盟主%' OR a.sm_role LIKE '%合伙人%' OR a.sm_role LIKE '%总裁%' OR a.sm_role LIKE '%老板%')`
	agentCoreJoins = `
FROM kbedm.tbl_Account a
LEFT JOIN kbedm.third_marketing_info m ON m.player_guuid = a.sm_guuid
LEFT JOIN kbedm.tbl_Account parent ON parent.sm_guuid = COALESCE(NULLIF(m.upper_guuid, ''), NULLIF(a.sm_agentID, ''))`
	agentChildCountsJoin = `
LEFT JOIN (
  SELECT cm.upper_guuid,
    SUM(CASE WHEN COALESCE(ca.sm_level, cm.level) > 0 OR (COALESCE(ca.sm_bigAgentID, '') <> '' AND ca.sm_bigAgentID = ca.sm_guuid) OR (COALESCE(ca.sm_supperAgentID, '') <> '' AND ca.sm_supperAgentID = ca.sm_guuid) OR (COALESCE(ca.sm_chiefAgentID, '') <> '' AND ca.sm_chiefAgentID = ca.sm_guuid) OR COALESCE(ca.sm_role, '') LIKE '%盟主%' OR COALESCE(ca.sm_role, '') LIKE '%合伙人%' OR COALESCE(ca.sm_role, '') LIKE '%总裁%' OR COALESCE(ca.sm_role, '') LIKE '%老板%' THEN 1 ELSE 0 END) AS direct_agent_count,
    SUM(CASE WHEN COALESCE(ca.sm_level, cm.level) <= 0 AND NOT ((COALESCE(ca.sm_bigAgentID, '') <> '' AND ca.sm_bigAgentID = ca.sm_guuid) OR (COALESCE(ca.sm_supperAgentID, '') <> '' AND ca.sm_supperAgentID = ca.sm_guuid) OR (COALESCE(ca.sm_chiefAgentID, '') <> '' AND ca.sm_chiefAgentID = ca.sm_guuid) OR COALESCE(ca.sm_role, '') LIKE '%盟主%' OR COALESCE(ca.sm_role, '') LIKE '%合伙人%' OR COALESCE(ca.sm_role, '') LIKE '%总裁%' OR COALESCE(ca.sm_role, '') LIKE '%老板%') THEN 1 ELSE 0 END) AS direct_player_count
  FROM kbedm.third_marketing_info cm
  LEFT JOIN kbedm.tbl_Account ca ON ca.sm_guuid = cm.player_guuid
  WHERE cm.upper_guuid <> ''
  GROUP BY cm.upper_guuid
) child_counts ON child_counts.upper_guuid = a.sm_guuid`
	agentSelectSQL = `SELECT
a.id, a.sm_guuid, a.sm_wxID, a.sm_name, a.sm_level, a.sm_role,
COALESCE(NULLIF(m.upper_guuid, ''), NULLIF(a.sm_agentID, ''), ''), COALESCE(parent.sm_name, ''),
COALESCE(m.upper_guuid, ''), COALESCE(a.sm_agentID, ''),
a.sm_big_percent, a.sm_super_percent,
(a.sm_role LIKE '%老板%'), (a.sm_bigAgentID = a.sm_guuid OR a.sm_role LIKE '%盟主%'),
(a.sm_supperAgentID = a.sm_guuid OR a.sm_role LIKE '%合伙人%'),
(a.sm_chiefAgentID = a.sm_guuid OR a.sm_role LIKE '%总裁%'),
COALESCE(child_counts.direct_agent_count, 0), COALESCE(child_counts.direct_player_count, 0),
COALESCE(m.all_lower_count, 0),
CASE WHEN m.today_lower_date = DATE_FORMAT(CURDATE(), '%Y-%m-%d') THEN m.today_lower_count ELSE 0 END,
TRIM(CONCAT_WS(' ', NULLIF(m.reg_proxy_date, ''), NULLIF(m.reg_proxy_time, ''))), a.sm_reg_time,
COALESCE(NULLIF(m.upper2_guuid, ''), NULLIF(a.sm_agentID2, ''), ''),
COALESCE(NULLIF(m.upper3_guuid, ''), NULLIF(a.sm_agentID3, ''), ''),
COALESCE(NULLIF(m.upper98_guuid, ''), NULLIF(a.sm_bigAgentID2, ''), ''),
COALESCE(NULLIF(m.upper99_guuid, ''), NULLIF(a.sm_bigAgentID, ''), ''),
COALESCE(NULLIF(m.upper100_guuid, ''), NULLIF(a.sm_supperAgentID, ''), ''),
COALESCE(NULLIF(m.upper101_guuid, ''), NULLIF(a.sm_chiefAgentID, ''), ''),
COALESCE(NULLIF(m.upperx_guuid, ''), NULLIF(a.sm_agentIDX, ''), '')`
)

type agentFilters struct {
	Keyword        string
	Type           string
	ParentID       string
	ParentName     string
	RegisteredFrom string
	RegisteredTo   string
	Level          *int64
	MinPercent     *int64
	MaxPercent     *int64
}

type agentSummary struct {
	TotalCount  int64 `json:"totalCount"`
	BossCount   int64 `json:"bossCount"`
	LeaderCount int64 `json:"leaderCount"`
	AgentCount  int64 `json:"agentCount"`
	LinkedCount int64 `json:"linkedCount"`
}

type agentItem struct {
	ID                  int64  `json:"id"`
	AgentID             string `json:"agentId"`
	LoginName           string `json:"loginName"`
	Name                string `json:"name"`
	Level               int64  `json:"level"`
	Role                string `json:"role"`
	Type                string `json:"type"`
	ParentID            string `json:"parentId"`
	ParentName          string `json:"parentName"`
	MarketingParentID   string `json:"marketingParentId"`
	AccountParentID     string `json:"accountParentId"`
	BigPercent          int64  `json:"bigPercent"`
	SuperPercent        int64  `json:"superPercent"`
	IsBoss              bool   `json:"isBoss"`
	IsLeader            bool   `json:"isLeader"`
	IsPartner           bool   `json:"isPartner"`
	IsChief             bool   `json:"isChief"`
	DirectAgentCount    int64  `json:"directAgentCount"`
	DirectPlayerCount   int64  `json:"directPlayerCount"`
	StoredLowerCount    int64  `json:"storedLowerCount"`
	TodayLowerCount     int64  `json:"todayLowerCount"`
	RegisteredProxyAt   string `json:"registeredProxyAt"`
	AccountRegisteredAt string `json:"accountRegisteredAt"`
	SecondParentID      string `json:"secondParentId"`
	ThirdParentID       string `json:"thirdParentId"`
	SmallLeaderID       string `json:"smallLeaderId"`
	BigLeaderID         string `json:"bigLeaderId"`
	PartnerID           string `json:"partnerId"`
	ChiefID             string `json:"chiefId"`
	UnlimitedParents    string `json:"unlimitedParents"`
	ChainState          string `json:"chainState"`
}

type scanner interface {
	Scan(dest ...any) error
}

func scanAgentItem(row scanner, item *agentItem) error {
	if err := row.Scan(
		&item.ID, &item.AgentID, &item.LoginName, &item.Name, &item.Level, &item.Role,
		&item.ParentID, &item.ParentName, &item.MarketingParentID, &item.AccountParentID,
		&item.BigPercent, &item.SuperPercent, &item.IsBoss, &item.IsLeader, &item.IsPartner, &item.IsChief,
		&item.DirectAgentCount, &item.DirectPlayerCount, &item.StoredLowerCount, &item.TodayLowerCount,
		&item.RegisteredProxyAt, &item.AccountRegisteredAt,
		&item.SecondParentID, &item.ThirdParentID, &item.SmallLeaderID, &item.BigLeaderID,
		&item.PartnerID, &item.ChiefID, &item.UnlimitedParents,
	); err != nil {
		return err
	}
	item.Type = classifyAgent(item.IsBoss, item.IsLeader, item.IsPartner, item.IsChief, item.Level)
	switch {
	case item.IsBoss:
		item.ChainState = "root"
	case item.ParentID == "" || item.ParentName == "":
		item.ChainState = "broken"
	default:
		item.ChainState = "linked"
	}
	if item.MarketingParentID != "" && item.AccountParentID != "" && item.MarketingParentID != item.AccountParentID {
		item.ChainState = "conflict"
	}
	return nil
}

func classifyAgent(isBoss, isLeader, isPartner, isChief bool, level int64) string {
	switch {
	case isBoss:
		return "boss"
	case isChief:
		return "chief"
	case isPartner:
		return "partner"
	case isLeader:
		return "leader"
	case level > 0:
		return "agent"
	default:
		return "player"
	}
}

func (item agentItem) isAgentCandidate() bool {
	return item.IsBoss || item.IsLeader || item.IsPartner || item.IsChief || item.Level > 0
}

func (s *Server) handleListAgents(w http.ResponseWriter, r *http.Request, _ principal) {
	page, size := pageParams(r)
	filters, err := parseAgentFilters(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_FILTER", err.Error())
		return
	}
	where, args := buildAgentWhere(filters)

	var total int64
	if err := s.db.QueryRowContext(r.Context(), `SELECT COUNT(DISTINCT a.id)`+agentCoreJoins+` WHERE `+where, args...).Scan(&total); err != nil {
		s.logger.Error("count game agents", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取代理数量失败")
		return
	}

	var summary agentSummary
	err = s.db.QueryRowContext(r.Context(), `SELECT
COUNT(DISTINCT a.id),
COUNT(DISTINCT CASE WHEN a.sm_role LIKE '%老板%' THEN a.id END),
COUNT(DISTINCT CASE WHEN NOT (a.sm_role LIKE '%老板%') AND (a.sm_bigAgentID = a.sm_guuid OR a.sm_role LIKE '%盟主%') THEN a.id END),
COUNT(DISTINCT CASE WHEN NOT (a.sm_role LIKE '%老板%') AND NOT (a.sm_bigAgentID = a.sm_guuid OR a.sm_role LIKE '%盟主%') THEN a.id END),
COUNT(DISTINCT CASE WHEN COALESCE(NULLIF(m.upper_guuid, ''), NULLIF(a.sm_agentID, '')) IS NOT NULL THEN a.id END)`+
		agentCoreJoins+` WHERE `+agentCandidateSQL).Scan(
		&summary.TotalCount, &summary.BossCount, &summary.LeaderCount, &summary.AgentCount, &summary.LinkedCount,
	)
	if err != nil {
		s.logger.Error("summarize game agents", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取代理概览失败")
		return
	}

	queryArgs := append(append([]any{}, args...), size, (page-1)*size)
	rows, err := s.db.QueryContext(r.Context(), agentSelectSQL+agentCoreJoins+agentChildCountsJoin+` WHERE `+where+`
ORDER BY (a.sm_role LIKE '%老板%') DESC, a.sm_level DESC, a.id DESC
LIMIT ? OFFSET ?`, queryArgs...)
	if err != nil {
		s.logger.Error("list game agents", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取代理列表失败")
		return
	}
	defer rows.Close()
	items := make([]agentItem, 0, size)
	for rows.Next() {
		var item agentItem
		if err := scanAgentItem(rows, &item); err != nil {
			s.logger.Error("scan game agent", "error", err)
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取代理数据失败")
			return
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		s.logger.Error("iterate game agents", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取代理数据失败")
		return
	}
	agentIDs := make([]string, len(items))
	for index := range items {
		agentIDs[index] = items[index].AgentID
	}
	lowerCounts, err := queryRegistrationLowerCounts(r.Context(), s.db, agentIDs)
	if err != nil {
		s.logger.Error("calculate game agent lower counts", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取代理下级人数失败")
		return
	}
	for index := range items {
		count := lowerCounts[items[index].AgentID]
		items[index].StoredLowerCount = count.All
		items[index].TodayLowerCount = count.Today
	}
	writeData(w, http.StatusOK, map[string]any{
		"items": items, "page": page, "pageSize": size, "total": total, "summary": summary,
	})
}

func parseAgentFilters(r *http.Request) (agentFilters, error) {
	query := r.URL.Query()
	filters := agentFilters{
		Keyword: strings.TrimSpace(query.Get("keyword")), Type: strings.TrimSpace(query.Get("type")),
		ParentID: strings.TrimSpace(query.Get("parentId")), ParentName: strings.TrimSpace(query.Get("parentName")),
		RegisteredFrom: strings.TrimSpace(query.Get("registeredFrom")), RegisteredTo: strings.TrimSpace(query.Get("registeredTo")),
	}
	for _, value := range []string{filters.Keyword, filters.ParentID, filters.ParentName} {
		if len([]rune(value)) > 100 {
			return agentFilters{}, errors.New("查询文字不能超过 100 个字符")
		}
	}
	if filters.Type == "" {
		filters.Type = "all"
	}
	validTypes := map[string]bool{"all": true, "boss": true, "leader": true, "agent": true, "partner": true, "chief": true}
	if !validTypes[filters.Type] {
		return agentFilters{}, errors.New("代理类型不正确")
	}
	var err error
	if filters.Level, err = optionalInt(query.Get("level"), "代理等级", 0, 10000); err != nil {
		return agentFilters{}, err
	}
	if filters.MinPercent, err = optionalInt(query.Get("minPercent"), "最低分红比例", 0, 100); err != nil {
		return agentFilters{}, err
	}
	if filters.MaxPercent, err = optionalInt(query.Get("maxPercent"), "最高分红比例", 0, 100); err != nil {
		return agentFilters{}, err
	}
	if filters.MinPercent != nil && filters.MaxPercent != nil && *filters.MinPercent > *filters.MaxPercent {
		return agentFilters{}, errors.New("最低分红比例不能大于最高分红比例")
	}
	for label, value := range map[string]string{"开始日期": filters.RegisteredFrom, "结束日期": filters.RegisteredTo} {
		if value != "" {
			if _, err := time.Parse("2006-01-02", value); err != nil {
				return agentFilters{}, fmt.Errorf("%s格式必须是 YYYY-MM-DD", label)
			}
		}
	}
	if filters.RegisteredFrom != "" && filters.RegisteredTo != "" && filters.RegisteredFrom > filters.RegisteredTo {
		return agentFilters{}, errors.New("开始日期不能晚于结束日期")
	}
	return filters, nil
}

func buildAgentWhere(filters agentFilters) (string, []any) {
	clauses := []string{agentCandidateSQL}
	args := []any{}
	if filters.Keyword != "" {
		like := "%" + filters.Keyword + "%"
		clauses = append(clauses, `(a.sm_guuid = ? OR a.sm_wxID LIKE ? OR a.sm_name LIKE ? OR
COALESCE(NULLIF(m.upper_guuid, ''), NULLIF(a.sm_agentID, '')) = ? OR parent.sm_name LIKE ?)`)
		args = append(args, filters.Keyword, like, like, filters.Keyword, like)
	}
	if filters.ParentID != "" {
		clauses = append(clauses, "COALESCE(NULLIF(m.upper_guuid, ''), NULLIF(a.sm_agentID, '')) = ?")
		args = append(args, filters.ParentID)
	}
	if filters.ParentName != "" {
		clauses = append(clauses, "parent.sm_name LIKE ?")
		args = append(args, "%"+filters.ParentName+"%")
	}
	if filters.Level != nil {
		clauses = append(clauses, "a.sm_level = ?")
		args = append(args, *filters.Level)
	}
	switch filters.Type {
	case "boss":
		clauses = append(clauses, "a.sm_role LIKE '%老板%'")
	case "leader":
		clauses = append(clauses, "NOT (a.sm_role LIKE '%老板%') AND (a.sm_bigAgentID = a.sm_guuid OR a.sm_role LIKE '%盟主%')")
	case "partner":
		clauses = append(clauses, "NOT (a.sm_role LIKE '%老板%') AND (a.sm_supperAgentID = a.sm_guuid OR a.sm_role LIKE '%合伙人%')")
	case "chief":
		clauses = append(clauses, "NOT (a.sm_role LIKE '%老板%') AND (a.sm_chiefAgentID = a.sm_guuid OR a.sm_role LIKE '%总裁%')")
	case "agent":
		clauses = append(clauses, `NOT (a.sm_role LIKE '%老板%') AND NOT (a.sm_bigAgentID = a.sm_guuid OR a.sm_role LIKE '%盟主%') AND NOT (a.sm_supperAgentID = a.sm_guuid OR a.sm_role LIKE '%合伙人%') AND NOT (a.sm_chiefAgentID = a.sm_guuid OR a.sm_role LIKE '%总裁%')`)
	}
	if filters.MinPercent != nil {
		clauses = append(clauses, "a.sm_big_percent >= ?")
		args = append(args, *filters.MinPercent)
	}
	if filters.MaxPercent != nil {
		clauses = append(clauses, "a.sm_big_percent <= ?")
		args = append(args, *filters.MaxPercent)
	}
	if filters.RegisteredFrom != "" {
		clauses = append(clauses, "m.reg_proxy_date >= ?")
		args = append(args, filters.RegisteredFrom)
	}
	if filters.RegisteredTo != "" {
		clauses = append(clauses, "m.reg_proxy_date <= ?")
		args = append(args, filters.RegisteredTo)
	}
	return strings.Join(clauses, " AND "), args
}

func validAgentID(value string) bool {
	return validGameID(value)
}

func validGameID(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 64 {
		return false
	}
	for _, r := range value {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || r == '-' || r == '_') {
			return false
		}
	}
	return true
}

func (s *Server) queryAgentItem(ctx context.Context, agentID string) (agentItem, error) {
	var item agentItem
	err := scanAgentItem(s.db.QueryRowContext(ctx, agentSelectSQL+agentCoreJoins+agentChildCountsJoin+`
WHERE a.sm_guuid = ? ORDER BY m.id DESC LIMIT 1`, agentID), &item)
	if err != nil {
		return item, err
	}
	counts, err := queryRegistrationLowerCounts(ctx, s.db, []string{agentID})
	if err != nil {
		return item, err
	}
	item.StoredLowerCount = counts[agentID].All
	item.TodayLowerCount = counts[agentID].Today
	return item, err
}

type agentChainNode struct {
	AgentID      string `json:"agentId"`
	Name         string `json:"name"`
	Type         string `json:"type"`
	Level        int64  `json:"level"`
	Role         string `json:"role"`
	ParentID     string `json:"parentId"`
	BigPercent   int64  `json:"bigPercent"`
	SuperPercent int64  `json:"superPercent"`
}

type tierRelation struct {
	Key       string `json:"key"`
	Name      string `json:"name"`
	AgentID   string `json:"agentId"`
	AgentName string `json:"agentName"`
}

func (s *Server) handleAgentRelationship(w http.ResponseWriter, r *http.Request, _ principal) {
	agentID := strings.TrimSpace(r.PathValue("agentId"))
	if !validAgentID(agentID) {
		writeError(w, http.StatusBadRequest, "INVALID_AGENT_ID", "代理 ID 不正确")
		return
	}
	selected, err := s.queryAgentItem(r.Context(), agentID)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && !selected.isAgentCandidate()) {
		writeError(w, http.StatusNotFound, "AGENT_NOT_FOUND", "代理不存在")
		return
	}
	if err != nil {
		s.logger.Error("query agent relationship", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取代理关系失败")
		return
	}

	chain := []agentChainNode{}
	seen := map[string]bool{}
	current := selected
	state := "healthy"
	message := "已从当前节点完整回溯到 BOSS"
	for depth := 0; depth < 64; depth++ {
		if seen[current.AgentID] {
			state, message = "cycle", "代理链存在循环关系"
			break
		}
		seen[current.AgentID] = true
		chain = append(chain, agentChainNode{
			AgentID: current.AgentID, Name: current.Name, Type: current.Type, Level: current.Level,
			Role: current.Role, ParentID: current.ParentID, BigPercent: current.BigPercent, SuperPercent: current.SuperPercent,
		})
		if current.MarketingParentID != "" && current.AccountParentID != "" && current.MarketingParentID != current.AccountParentID {
			state, message = "conflict", "注册关系表与游戏账号表记录了不同的直属上级"
			break
		}
		if current.IsBoss {
			if len(chain) == 1 {
				state, message = "root", "当前节点是 BOSS 根节点"
			}
			break
		}
		if current.ParentID == "" {
			state, message = "broken", "当前代理缺少直属上级，无法回溯到 BOSS"
			break
		}
		if seen[current.ParentID] {
			state, message = "cycle", "代理链存在循环关系"
			break
		}
		parent, parentErr := s.queryAgentItem(r.Context(), current.ParentID)
		if errors.Is(parentErr, sql.ErrNoRows) {
			state, message = "broken", "直属上级账号不存在，代理链已断开"
			break
		}
		if parentErr != nil {
			s.logger.Error("query upstream agent", "error", parentErr, "agentId", current.AgentID)
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取上级代理失败")
			return
		}
		if !parent.isAgentCandidate() {
			chain = append(chain, agentChainNode{AgentID: parent.AgentID, Name: parent.Name, Type: "player", Level: parent.Level, Role: parent.Role, ParentID: parent.ParentID})
			state, message = "broken", "直属上级不是代理、盟主或 BOSS"
			break
		}
		current = parent
		if depth == 63 {
			state, message = "depth_limit", "代理链超过 64 级，已停止继续回溯"
		}
	}
	for left, right := 0, len(chain)-1; left < right; left, right = left+1, right-1 {
		chain[left], chain[right] = chain[right], chain[left]
	}

	tiers := []tierRelation{
		{Key: "second", Name: "二级上级", AgentID: selected.SecondParentID},
		{Key: "third", Name: "三级上级", AgentID: selected.ThirdParentID},
		{Key: "smallLeader", Name: "小盟主", AgentID: selected.SmallLeaderID},
		{Key: "bigLeader", Name: "大盟主", AgentID: selected.BigLeaderID},
		{Key: "partner", Name: "合伙人", AgentID: selected.PartnerID},
		{Key: "chief", Name: "总裁", AgentID: selected.ChiefID},
	}
	if err := s.fillTierNames(r.Context(), tiers); err != nil {
		s.logger.Error("query agent tier names", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取层级代理名称失败")
		return
	}
	writeData(w, http.StatusOK, map[string]any{
		"agent": selected, "chain": chain, "chainState": state, "chainMessage": message, "tiers": tiers,
	})
}

func (s *Server) fillTierNames(ctx context.Context, tiers []tierRelation) error {
	ids := []string{}
	seen := map[string]bool{}
	for _, tier := range tiers {
		if tier.AgentID != "" && !seen[tier.AgentID] {
			seen[tier.AgentID] = true
			ids = append(ids, tier.AgentID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")
	args := make([]any, len(ids))
	for i := range ids {
		args[i] = ids[i]
	}
	rows, err := s.db.QueryContext(ctx, `SELECT sm_guuid, sm_name FROM kbedm.tbl_Account WHERE sm_guuid IN (`+placeholders+`)`, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	names := map[string]string{}
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			return err
		}
		names[id] = name
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for i := range tiers {
		tiers[i].AgentName = names[tiers[i].AgentID]
	}
	return nil
}

type agentChildItem struct {
	ID                int64  `json:"id"`
	PlayerID          string `json:"playerId"`
	LoginName         string `json:"loginName"`
	Name              string `json:"name"`
	Level             int64  `json:"level"`
	Role              string `json:"role"`
	Type              string `json:"type"`
	ParentID          string `json:"parentId"`
	ParentName        string `json:"parentName"`
	Depth             int    `json:"depth"`
	IsAgent           bool   `json:"isAgent"`
	BigPercent        int64  `json:"bigPercent"`
	SuperPercent      int64  `json:"superPercent"`
	StoredLowerCount  int64  `json:"storedLowerCount"`
	RegisteredProxyAt string `json:"registeredProxyAt"`
}

type agentChildrenResponse struct {
	Items       []agentChildItem `json:"items"`
	Page        int              `json:"page"`
	PageSize    int              `json:"pageSize"`
	Total       int              `json:"total"`
	AgentCount  int              `json:"agentCount"`
	PlayerCount int              `json:"playerCount"`
	MaxDepth    int              `json:"maxDepth"`
	Truncated   bool             `json:"truncated"`
}

func (s *Server) handleAgentChildren(w http.ResponseWriter, r *http.Request, _ principal) {
	agentID := strings.TrimSpace(r.PathValue("agentId"))
	if !validAgentID(agentID) {
		writeError(w, http.StatusBadRequest, "INVALID_AGENT_ID", "代理 ID 不正确")
		return
	}
	selected, err := s.queryAgentItem(r.Context(), agentID)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && !selected.isAgentCandidate()) {
		writeError(w, http.StatusNotFound, "AGENT_NOT_FOUND", "代理不存在")
		return
	}
	if err != nil {
		s.logger.Error("query agent before children", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取代理失败")
		return
	}

	scope := strings.TrimSpace(r.URL.Query().Get("scope"))
	if scope == "" {
		scope = "direct"
	}
	if scope != "direct" && scope != "all" {
		writeError(w, http.StatusBadRequest, "INVALID_FILTER", "下级范围不正确")
		return
	}
	childType := strings.TrimSpace(r.URL.Query().Get("type"))
	if childType == "" {
		childType = "all"
	}
	if childType != "all" && childType != "agents" && childType != "players" && childType != "leaders" {
		writeError(w, http.StatusBadRequest, "INVALID_FILTER", "下级类型不正确")
		return
	}
	keyword := strings.TrimSpace(r.URL.Query().Get("keyword"))
	if len([]rune(keyword)) > 100 {
		writeError(w, http.StatusBadRequest, "INVALID_FILTER", "查询文字不能超过 100 个字符")
		return
	}
	page, size := pageParams(r)
	items, truncated, err := s.collectAgentChildren(r.Context(), agentID, scope == "all")
	if err != nil {
		s.logger.Error("query agent children", "error", err, "agentId", agentID)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取代理下级失败")
		return
	}

	filtered := make([]agentChildItem, 0, len(items))
	keywordLower := strings.ToLower(keyword)
	agentCount, playerCount, maxDepth := 0, 0, 0
	for _, item := range items {
		if item.IsAgent {
			agentCount++
		} else {
			playerCount++
		}
		if item.Depth > maxDepth {
			maxDepth = item.Depth
		}
		if childType == "agents" && !item.IsAgent || childType == "players" && item.IsAgent || childType == "leaders" && item.Type != "leader" {
			continue
		}
		if keywordLower != "" {
			haystack := strings.ToLower(item.PlayerID + "\n" + item.LoginName + "\n" + item.Name)
			if !strings.Contains(haystack, keywordLower) {
				continue
			}
		}
		filtered = append(filtered, item)
	}
	total := len(filtered)
	start := (page - 1) * size
	if start > total {
		start = total
	}
	end := start + size
	if end > total {
		end = total
	}
	pageItems := filtered[start:end]
	if pageItems == nil {
		pageItems = []agentChildItem{}
	}
	writeData(w, http.StatusOK, agentChildrenResponse{
		Items: pageItems, Page: page, PageSize: size, Total: total,
		AgentCount: agentCount, PlayerCount: playerCount, MaxDepth: maxDepth, Truncated: truncated,
	})
}

func (s *Server) collectAgentChildren(ctx context.Context, rootID string, recursive bool) ([]agentChildItem, bool, error) {
	const maxItems = 20000
	seen := map[string]bool{rootID: true}
	parents := []string{rootID}
	items := []agentChildItem{}
	truncated := false
	for depth := 1; depth <= 64 && len(parents) > 0; depth++ {
		nextParents := []string{}
		for start := 0; start < len(parents); start += 250 {
			end := start + 250
			if end > len(parents) {
				end = len(parents)
			}
			batch, err := s.queryDirectChildren(ctx, parents[start:end], depth)
			if err != nil {
				return nil, false, err
			}
			for _, item := range batch {
				if seen[item.PlayerID] {
					continue
				}
				seen[item.PlayerID] = true
				items = append(items, item)
				if item.IsAgent {
					nextParents = append(nextParents, item.PlayerID)
				}
				if len(items) >= maxItems {
					truncated = true
					break
				}
			}
			if truncated {
				break
			}
		}
		if truncated || !recursive {
			break
		}
		parents = nextParents
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].Depth != items[j].Depth {
			return items[i].Depth < items[j].Depth
		}
		return items[i].ID > items[j].ID
	})
	return items, truncated, nil
}

func (s *Server) queryDirectChildren(ctx context.Context, parentIDs []string, depth int) ([]agentChildItem, error) {
	if len(parentIDs) == 0 {
		return []agentChildItem{}, nil
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(parentIDs)), ",")
	args := make([]any, len(parentIDs))
	for i := range parentIDs {
		args[i] = parentIDs[i]
	}
	rows, err := s.db.QueryContext(ctx, `SELECT
m.id, m.player_guuid, COALESCE(a.sm_wxID, m.player_wxid), COALESCE(NULLIF(a.sm_name, ''), m.player_wxname),
COALESCE(a.sm_level, m.level), COALESCE(a.sm_role, ''), m.upper_guuid, COALESCE(parent.sm_name, ''),
COALESCE(a.sm_big_percent, 0), COALESCE(a.sm_super_percent, 0), COALESCE(m.all_lower_count, 0),
TRIM(CONCAT_WS(' ', NULLIF(m.reg_proxy_date, ''), NULLIF(m.reg_proxy_time, ''))),
(COALESCE(a.sm_role, '') LIKE '%老板%'),
((COALESCE(a.sm_bigAgentID, '') <> '' AND a.sm_bigAgentID = a.sm_guuid) OR COALESCE(a.sm_role, '') LIKE '%盟主%'),
((COALESCE(a.sm_supperAgentID, '') <> '' AND a.sm_supperAgentID = a.sm_guuid) OR COALESCE(a.sm_role, '') LIKE '%合伙人%'),
((COALESCE(a.sm_chiefAgentID, '') <> '' AND a.sm_chiefAgentID = a.sm_guuid) OR COALESCE(a.sm_role, '') LIKE '%总裁%')
FROM kbedm.third_marketing_info m
LEFT JOIN kbedm.tbl_Account a ON a.sm_guuid = m.player_guuid
LEFT JOIN kbedm.tbl_Account parent ON parent.sm_guuid = m.upper_guuid
WHERE m.upper_guuid IN (`+placeholders+`)
ORDER BY m.id DESC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []agentChildItem{}
	for rows.Next() {
		var item agentChildItem
		var isBoss, isLeader, isPartner, isChief bool
		if err := rows.Scan(
			&item.ID, &item.PlayerID, &item.LoginName, &item.Name, &item.Level, &item.Role,
			&item.ParentID, &item.ParentName, &item.BigPercent, &item.SuperPercent,
			&item.StoredLowerCount, &item.RegisteredProxyAt, &isBoss, &isLeader, &isPartner, &isChief,
		); err != nil {
			return nil, err
		}
		item.Depth = depth
		item.Type = classifyAgent(isBoss, isLeader, isPartner, isChief, item.Level)
		item.IsAgent = item.Type != "player"
		items = append(items, item)
	}
	return items, rows.Err()
}
