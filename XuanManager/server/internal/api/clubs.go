package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
)

// 俱乐部管理：只读列出游戏库里的俱乐部与成员代理树。
//
// 数据来源：
//   - club_guuid_info        俱乐部本体（club_name / club_status / club_mode / club_tax / union_id / union_quota）
//   - club_union_info        联盟模式 V2：俱乐部所属联盟与联盟池额度
//   - tbl_Account            成员身份（sm_club_make / sm_club_join / sm_club_manage / sm_club_gold）
//   - club_invite_code_info  代理邀请码（status='used' 且属于本人 = 是代理）
//   - club_agent_info        直属上级（upper_guuid）与备注
//
// 额度不落后台表：唯一真相在游戏服。V2 下平台只能给联盟池注资（见 unions.go），
// 俱乐部额度由联盟总群主在游戏内授信，后台不直接改额度。

type clubListItem struct {
	ClubID      string `json:"clubId"`
	Name        string `json:"name"`
	Status      string `json:"status"`
	Mode        string `json:"mode"`
	OwnerID     string `json:"ownerId"`
	OwnerName   string `json:"ownerName"`
	MemberCount int64  `json:"memberCount"`
	AgentCount  int64  `json:"agentCount"`
	Tax         string `json:"tax"`
	PayMode     string `json:"payMode"`
	// Union 是旧双向结盟字段（club_union），V2 已停用，仅保留兼容。
	Union string `json:"union"`
	// UnionID / UnionName 是 V2 联盟归属；空表示未加入联盟。
	UnionID   string `json:"unionId"`
	UnionName string `json:"unionName"`
	// UnionPoolQuotaFen 是所属联盟的联盟池余额（分），供「调整群主额度」展示。
	UnionPoolQuotaFen *int64 `json:"unionPoolQuotaFen"`
	// OwnerQuotaFen 是俱乐部当前可用额度（club_guuid_info.union_quota，单位分）。
	// 未加入联盟时为 nil，与「额度 0」不是一回事。
	OwnerQuotaFen *int64 `json:"ownerQuotaFen"`
	// StonePool 是群主钻石池：club_agent_info 中该俱乐部创建者那一行的 stone（单位：钻）。
	// 玩家兑换钻石会从这个池子扣；找不到群主时为 nil。
	StonePool *int64 `json:"stonePool"`
	// TotalClubGold 是俱乐部总积分（单位：元）：全体成员在该俱乐部积分之和。
	// 游戏服「查询_俱乐部_成员_总分」只在客户端推送 AllPlayerGold，后台拿不到回包，
	// 这里按同一份落库数据（tbl_Account.sm_club_gold / sm_club_gold2）聚合。
	// nil 表示读取失败，与「0 分」不是一回事。
	TotalClubGold *int64 `json:"totalClubGold"`
	// DarkEnabled 是客户端开房页暗抽开关：usr_hash_info 的「暗抽_俱乐部_<clubId>」。
	DarkEnabled bool `json:"darkEnabled"`
}

type clubMemberNode struct {
	PlayerID  string `json:"playerId"`
	Name      string `json:"name"`
	Role      string `json:"role"`
	IsAgent   bool   `json:"isAgent"`
	UpperID   string `json:"upperId"`
	UpperName string `json:"upperName"`
	ClubGold  *int64 `json:"clubGold"`
	// QuotaFen 是 club_agent_info.quota（分）。null 表示未被授信，不是 0。
	QuotaFen   *int64 `json:"quotaFen"`
	InviteCode string `json:"inviteCode"`
	Note       string `json:"note"`
	Level      int    `json:"level"`
}

type clubMemberTree struct {
	clubMemberNode
	Children []*clubMemberTree `json:"children"`
}

type clubDetailResponse struct {
	Club    clubListItem     `json:"club"`
	Members []clubMemberNode `json:"members"`
	// 树结构：根是创建者，children 按 upper_guuid 嵌套；同时给扁平列表方便检索。
	Roots []*clubMemberTree `json:"roots"`
	// 上级缺失/指错/成环的成员单独列出，界面必须显式告知，不能静默挂到根上伪造关系。
	Orphan   []clubMemberNode `json:"orphan"`
	Warnings []string         `json:"warnings"`
}

// clubFilters 是俱乐部列表的查询条件。
//
// 两种查询维度（mode）：
//   - club：按俱乐部维度筛选，条件全部作用在 club_guuid_info 上；
//   - player：按玩家维度反查——给玩家 ID/名字，找出他所在的俱乐部。
//     「玩家」指该俱乐部的群主、代理或普通成员（看 club_make/join/manage 五列）。
type clubFilters struct {
	Mode    string
	Keyword string
	ClubID  string
	Name    string
	OwnerID string
	Status  string
	Mode2   string
	UnionID string
	TaxMin  *int64
	TaxMax  *int64
	// 玩家维度
	PlayerID   string
	PlayerName string
	// 成员规模
	MinMembers *int64
	MaxMembers *int64
}

const (
	clubQueryModeClub   = "club"
	clubQueryModePlayer = "player"
)

func parseClubFilters(r *http.Request) (clubFilters, error) {
	query := r.URL.Query()
	filters := clubFilters{
		Mode:       strings.TrimSpace(query.Get("mode")),
		Keyword:    strings.TrimSpace(query.Get("keyword")),
		ClubID:     strings.TrimSpace(query.Get("clubId")),
		Name:       strings.TrimSpace(query.Get("name")),
		OwnerID:    strings.TrimSpace(query.Get("ownerId")),
		Status:     strings.TrimSpace(query.Get("status")),
		Mode2:      strings.TrimSpace(query.Get("clubMode")),
		UnionID:    strings.TrimSpace(query.Get("unionId")),
		PlayerID:   strings.TrimSpace(query.Get("playerId")),
		PlayerName: strings.TrimSpace(query.Get("playerName")),
	}
	if filters.Mode == "" {
		filters.Mode = clubQueryModeClub
	}
	if filters.Mode != clubQueryModeClub && filters.Mode != clubQueryModePlayer {
		return clubFilters{}, errors.New("查询维度只能是俱乐部或玩家")
	}
	for label, value := range map[string]string{
		"关键字": filters.Keyword, "俱乐部 ID": filters.ClubID, "俱乐部名称": filters.Name,
		"群主 ID": filters.OwnerID, "玩家 ID": filters.PlayerID, "玩家名称": filters.PlayerName,
	} {
		if len([]rune(value)) > 100 {
			return clubFilters{}, errors.New(label + "不能超过 100 个字符")
		}
	}
	if filters.ClubID != "" && !isSixDigitCode(filters.ClubID) {
		return clubFilters{}, errors.New("俱乐部 ID 必须是 6 位数字")
	}
	if filters.UnionID != "" && !isSixDigitCode(filters.UnionID) {
		return clubFilters{}, errors.New("联盟 ID 必须是 6 位数字")
	}
	if filters.PlayerID != "" && !isSixDigitCode(filters.PlayerID) {
		// 玩家 ID 也可能不是 6 位（历史账号），这里只拦明显非法输入。
		if len([]rune(filters.PlayerID)) > 32 {
			return clubFilters{}, errors.New("玩家 ID 格式不正确")
		}
	}
	if filters.Status != "" && filters.Status != "used" && filters.Status != "del" && filters.Status != "init" {
		return clubFilters{}, errors.New("俱乐部状态不正确")
	}
	if filters.Mode2 != "" && filters.Mode2 != "1" && filters.Mode2 != "2" && filters.Mode2 != "3" {
		return clubFilters{}, errors.New("俱乐部模式不正确")
	}
	var err error
	if filters.TaxMin, err = optionalInt(query.Get("taxMin"), "最低抽成", 0, 100); err != nil {
		return clubFilters{}, err
	}
	if filters.TaxMax, err = optionalInt(query.Get("taxMax"), "最高抽成", 0, 100); err != nil {
		return clubFilters{}, err
	}
	if filters.TaxMin != nil && filters.TaxMax != nil && *filters.TaxMin > *filters.TaxMax {
		return clubFilters{}, errors.New("最低抽成不能大于最高抽成")
	}
	if filters.MinMembers, err = optionalInt(query.Get("minMembers"), "最少成员数", 0, 1<<31-1); err != nil {
		return clubFilters{}, err
	}
	if filters.MaxMembers, err = optionalInt(query.Get("maxMembers"), "最多成员数", 0, 1<<31-1); err != nil {
		return clubFilters{}, err
	}
	if filters.MinMembers != nil && filters.MaxMembers != nil && *filters.MinMembers > *filters.MaxMembers {
		return clubFilters{}, errors.New("最少成员数不能大于最多成员数")
	}
	return filters, nil
}

// buildClubWhere 生成 WHERE 片段。
// 玩家维度不是直接查 tbl_Account 再回来拼 ID，而是用 EXISTS 子查询，让分页与计数仍然作用在俱乐部上，
// 同一个人出现在多个俱乐部时也不会重复出行。
func buildClubWhere(filters clubFilters) (string, []any) {
	// club_status 是 NOT NULL 且带索引；一旦用 COALESCE() 包起来索引就失效，
	// COUNT 会退化成扫 89 万行（实测 3.4s → 0.02s）。这里必须直接比较列。
	conditions := []string{"c.club_status NOT IN ('init', 'del')"}
	args := []any{}
	if filters.Status != "" {
		conditions = append(conditions, "c.club_status = ?")
		args = append(args, filters.Status)
	}
	if filters.Keyword != "" {
		like := "%" + escapeLike(filters.Keyword) + "%"
		conditions = append(conditions,
			"(c.club_guuid LIKE ? ESCAPE '\\\\' OR c.club_name LIKE ? ESCAPE '\\\\')")
		args = append(args, like, like)
	}
	if filters.ClubID != "" {
		conditions = append(conditions, "c.club_guuid = ?")
		args = append(args, filters.ClubID)
	}
	if filters.Name != "" {
		conditions = append(conditions, "c.club_name LIKE ? ESCAPE '\\\\'")
		args = append(args, "%"+escapeLike(filters.Name)+"%")
	}
	if filters.UnionID != "" {
		conditions = append(conditions, "c.union_id = ?")
		args = append(args, filters.UnionID)
	}
	if filters.Mode2 != "" {
		conditions = append(conditions, "COALESCE(c.club_mode, '') = ?")
		args = append(args, filters.Mode2)
	}
	if filters.TaxMin != nil {
		conditions = append(conditions, "c.club_tax >= ?")
		args = append(args, *filters.TaxMin)
	}
	if filters.TaxMax != nil {
		conditions = append(conditions, "c.club_tax <= ?")
		args = append(args, *filters.TaxMax)
	}
	if filters.MinMembers != nil {
		conditions = append(conditions, "c.number_count >= ?")
		args = append(args, *filters.MinMembers)
	}
	if filters.MaxMembers != nil {
		conditions = append(conditions, "c.number_count <= ?")
		args = append(args, *filters.MaxMembers)
	}
	if filters.OwnerID != "" {
		conditions = append(conditions, `EXISTS(SELECT 1 FROM kbedm.tbl_Account o
WHERE o.sm_guuid = ?
  AND (FIND_IN_SET(c.club_guuid, REPLACE(COALESCE(o.sm_club_make, ''), ' ', '')) > 0
    OR FIND_IN_SET(c.club_guuid, REPLACE(COALESCE(o.sm_club_make2, ''), ' ', '')) > 0))`)
		args = append(args, filters.OwnerID)
	}
	if filters.Mode == clubQueryModePlayer && (filters.PlayerID != "" || filters.PlayerName != "") {
		// 玩家维度：这个人以任何身份（群主/成员/管理员）出现在俱乐部里都算命中。
		playerConditions := []string{}
		playerArgs := []any{}
		if filters.PlayerID != "" {
			playerConditions = append(playerConditions, "p.sm_guuid = ?")
			playerArgs = append(playerArgs, filters.PlayerID)
		}
		if filters.PlayerName != "" {
			playerConditions = append(playerConditions,
				"p.sm_name LIKE ? ESCAPE '\\\\'")
			playerArgs = append(playerArgs, "%"+escapeLike(filters.PlayerName)+"%")
		}
		conditions = append(conditions, `EXISTS(SELECT 1 FROM kbedm.tbl_Account p
WHERE `+strings.Join(playerConditions, " AND ")+`
  AND (`+membershipColumnSQL("p", "c.club_guuid")+`))`)
		args = append(args, playerArgs...)
	}
	return strings.Join(conditions, " AND "), args
}

func (s *Server) handleListClubs(w http.ResponseWriter, r *http.Request, _ principal) {
	page, size := pageParams(r)
	filters, err := parseClubFilters(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_FILTER", err.Error())
		return
	}
	where, args := buildClubWhere(filters)

	var total int64
	if err := s.db.QueryRowContext(r.Context(),
		`SELECT COUNT(*) FROM kbedm.club_guuid_info c WHERE `+where, args...).Scan(&total); err != nil {
		s.logger.Error("count clubs", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取俱乐部数量失败")
		return
	}

	queryArgs := append([]any{}, args...)
	queryArgs = append(queryArgs, size, (page-1)*size)
	rows, err := s.db.QueryContext(r.Context(), `SELECT
c.club_guuid, COALESCE(c.club_name, ''), COALESCE(c.club_status, ''),
COALESCE(c.club_mode, ''), c.club_tax, c.club_pay_mode,
COALESCE(c.club_union, ''), COALESCE(c.number_count, 0),
COALESCE(c.union_id, ''), COALESCE(c.union_quota, 0),
COALESCE(cu.union_name, ''), COALESCE(cu.union_quota, 0)
FROM kbedm.club_guuid_info c
LEFT JOIN kbedm.club_union_info cu
  ON cu.union_id = c.union_id AND cu.status <> 'init'
WHERE `+where+`
ORDER BY c.id DESC
LIMIT ? OFFSET ?`, queryArgs...)
	if err != nil {
		s.logger.Error("list clubs", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取俱乐部列表失败")
		return
	}
	defer rows.Close()

	items := make([]clubListItem, 0, size)
	for rows.Next() {
		var item clubListItem
		var tax, payMode any
		var clubQuotaFen, unionPoolFen int64
		if err := rows.Scan(&item.ClubID, &item.Name, &item.Status, &item.Mode,
			&tax, &payMode, &item.Union, &item.MemberCount,
			&item.UnionID, &clubQuotaFen, &item.UnionName, &unionPoolFen); err != nil {
			s.logger.Error("scan club row", "error", err)
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取俱乐部数据失败")
			return
		}
		item.Tax = stringOrEmpty(tax)
		item.PayMode = stringOrEmpty(payMode)
		if item.UnionID != "" {
			item.OwnerQuotaFen = &clubQuotaFen
			item.UnionPoolQuotaFen = &unionPoolFen
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取俱乐部列表失败")
		return
	}

	clubIDs := make([]string, 0, len(items))
	for _, item := range items {
		clubIDs = append(clubIDs, item.ClubID)
	}
	owners, agentCounts, err := s.clubOwnersAndAgentCounts(r.Context(), clubIDs)
	if err != nil {
		s.logger.Error("read club owners", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取俱乐部群主失败")
		return
	}
	for index := range items {
		items[index].OwnerID = owners[items[index].ClubID]
		items[index].AgentCount = agentCounts[items[index].ClubID]
	}
	if names, nameErr := s.playerNames(r.Context(), ownerIDsOf(items)); nameErr == nil {
		for index := range items {
			items[index].OwnerName = names[items[index].OwnerID]
		}
	} else {
		s.logger.Error("read club owner names", "error", nameErr)
	}
	if pools, poolErr := s.clubStonePools(r.Context(), items); poolErr == nil {
		for index := range items {
			if pool, ok := pools[items[index].ClubID]; ok {
				value := pool
				items[index].StonePool = &value
			}
		}
	} else {
		s.logger.Error("read club stone pools", "error", poolErr)
	}
	if totalGolds, goldErr := s.clubTotalGolds(r.Context(), items); goldErr == nil {
		for index := range items {
			value := totalGolds[items[index].ClubID]
			items[index].TotalClubGold = &value
		}
	} else {
		s.logger.Error("read club total golds", "error", goldErr)
	}
	if darkSettings, darkErr := s.readClubDarkSettings(r.Context(), clubIDs); darkErr == nil {
		for index := range items {
			items[index].DarkEnabled = darkSettings[items[index].ClubID]
		}
	} else {
		s.logger.Error("read club dark settings", "error", darkErr)
	}
	writeData(w, http.StatusOK, map[string]any{
		"items": items, "total": total, "page": page, "pageSize": size,
		"mode": filters.Mode,
	})
}

// clubOwnersAndAgentCounts 批量取每个俱乐部的创建者（sm_club_make）与代理人数。
func (s *Server) clubOwnersAndAgentCounts(ctx context.Context, clubIDs []string) (map[string]string, map[string]int64, error) {
	owners := map[string]string{}
	counts := map[string]int64{}
	if len(clubIDs) == 0 {
		return owners, counts, nil
	}

	// 创建者只认 sm_club_make / sm_club_make2；用 FIND_IN_SET 精确匹配，
	// 不能 LIKE（那样 123456 会命中 1234567）。
	parts := make([]string, 0, len(clubIDs))
	args := make([]any, 0, len(clubIDs)*2)
	for _, clubID := range clubIDs {
		parts = append(parts,
			"(FIND_IN_SET(?, REPLACE(COALESCE(a.sm_club_make, ''), ' ', '')) > 0"+
				" OR FIND_IN_SET(?, REPLACE(COALESCE(a.sm_club_make2, ''), ' ', '')) > 0)")
		args = append(args, clubID, clubID)
	}
	rows, err := s.db.QueryContext(ctx, `SELECT a.sm_guuid, a.sm_club_make, a.sm_club_make2
FROM kbedm.tbl_Account a WHERE `+strings.Join(parts, " OR "), args...)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var guuid string
		var make, make2 sql.NullString
		if err := rows.Scan(&guuid, &make, &make2); err != nil {
			return nil, nil, err
		}
		for _, clubID := range clubIDs {
			if owners[clubID] != "" {
				continue
			}
			if containsClubID(make.String, clubID) || containsClubID(make2.String, clubID) {
				owners[clubID] = guuid
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}

	placeholders := strings.TrimRight(strings.Repeat("?,", len(clubIDs)), ",")
	agentArgs := make([]any, 0, len(clubIDs))
	for _, clubID := range clubIDs {
		agentArgs = append(agentArgs, clubID)
	}
	agentRows, err := s.db.QueryContext(ctx, `SELECT club_guuid, COUNT(DISTINCT user_guuid)
FROM kbedm.club_invite_code_info
WHERE status = 'used' AND club_guuid IN (`+placeholders+`)
GROUP BY club_guuid`, agentArgs...)
	if err != nil {
		return nil, nil, err
	}
	defer agentRows.Close()
	for agentRows.Next() {
		var clubID string
		var count int64
		if err := agentRows.Scan(&clubID, &count); err != nil {
			return nil, nil, err
		}
		counts[clubID] = count
	}
	return owners, counts, agentRows.Err()
}

func ownerIDsOf(items []clubListItem) []string {
	seen := map[string]bool{}
	ids := make([]string, 0, len(items))
	for _, item := range items {
		if item.OwnerID != "" && !seen[item.OwnerID] {
			seen[item.OwnerID] = true
			ids = append(ids, item.OwnerID)
		}
	}
	return ids
}

// readClubStonePool 读取单个俱乐部群主的钻石池；没有 agent 行时按 0 处理。
func (s *Server) readClubStonePool(ctx context.Context, clubID, ownerID string) (int64, error) {
	var stone int64
	err := s.db.QueryRowContext(ctx, `SELECT COALESCE(stone, 0)
FROM kbedm.club_agent_info
WHERE club_guuid = ? AND user_guuid = ? AND status = 'used'
LIMIT 1`, clubID, ownerID).Scan(&stone)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	return stone, err
}

// clubStonePools 批量读取每个俱乐部的群主钻石池（club_agent_info.stone）。
// 用 (club_guuid,user_guuid) 精确匹配，避免把同一群主名下其他俱乐部的池子串过来。
func (s *Server) clubStonePools(ctx context.Context, items []clubListItem) (map[string]int64, error) {
	result := map[string]int64{}
	parts := make([]string, 0, len(items))
	args := make([]any, 0, len(items)*2)
	for _, item := range items {
		if item.ClubID == "" || item.OwnerID == "" {
			continue
		}
		// 有群主但还没有 agent 行时，池子按 0 展示，而不是“未找到群主”。
		result[item.ClubID] = 0
		parts = append(parts, "(club_guuid = ? AND user_guuid = ?)")
		args = append(args, item.ClubID, item.OwnerID)
	}
	if len(parts) == 0 {
		return result, nil
	}
	rows, err := s.db.QueryContext(ctx, `SELECT club_guuid, COALESCE(stone, 0)
FROM kbedm.club_agent_info
WHERE status = 'used' AND (`+strings.Join(parts, " OR ")+`)`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var clubID string
		var stone int64
		if err := rows.Scan(&clubID, &stone); err != nil {
			return nil, err
		}
		result[clubID] = stone
	}
	return result, rows.Err()
}

// clubTotalGolds 批量计算每个俱乐部的总积分（单位：元）。
//
// 口径：tbl_Account.sm_club_gold / sm_club_gold2 里以该俱乐部 ID 为键的积分求和；
// 茶楼/带分模式（club_mode 2/3）优先取 *_2 列，与成员列表 readClubMembers 保持一致。
// -99 是「无该俱乐部数据」哨兵，不参与求和。
//
// 这里用 LIKE '%"俱乐部ID"%' 命中 JSON 键，Key 是纯数字不会误伤；代价是全表扫，
// 但只回传有积分记录的行，且只算当前页的俱乐部。
func (s *Server) clubTotalGolds(ctx context.Context, items []clubListItem) (map[string]int64, error) {
	result := map[string]int64{}
	modes := map[string]string{}
	conditions := make([]string, 0, len(items))
	args := make([]any, 0, len(items)*2)
	for _, item := range items {
		if item.ClubID == "" {
			continue
		}
		// 有成员但一条积分记录都没有时按 0 展示。
		result[item.ClubID] = 0
		modes[item.ClubID] = item.Mode
		like := "%\"" + escapeLike(item.ClubID) + "\"%"
		conditions = append(conditions,
			"(sm_club_gold LIKE ? OR sm_club_gold2 LIKE ?)")
		args = append(args, like, like)
	}
	if len(conditions) == 0 {
		return result, nil
	}
	rows, err := s.db.QueryContext(ctx, `SELECT COALESCE(sm_club_gold, ''), COALESCE(sm_club_gold2, '')
FROM kbedm.tbl_Account WHERE `+strings.Join(conditions, " OR "), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var gold, gold2 string
		if err := rows.Scan(&gold, &gold2); err != nil {
			return nil, err
		}
		primary := parseClubGoldMap(gold)
		secondary := parseClubGoldMap(gold2)
		if len(primary) == 0 && len(secondary) == 0 {
			continue
		}
		for clubID, mode := range modes {
			value, ok := int64(0), false
			if isSecondaryClubMode(mode) {
				value, ok = secondary[clubID]
				if !ok {
					value, ok = primary[clubID]
				}
			} else {
				value, ok = primary[clubID]
				if !ok {
					value, ok = secondary[clubID]
				}
			}
			if ok {
				result[clubID] += value
			}
		}
	}
	return result, rows.Err()
}

// parseClubGoldMap 把 {"俱乐部ID": 积分} 解析成俱乐部 → 积分。
// 解析失败（含历史裸数字形态，无法判断归属）一律返回空，不猜。
func parseClubGoldMap(raw string) map[string]int64 {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "{}" {
		return nil
	}
	var mapping map[string]any
	if err := json.Unmarshal([]byte(raw), &mapping); err != nil {
		return nil
	}
	result := make(map[string]int64, len(mapping))
	for key, value := range mapping {
		clubID := strings.TrimSpace(key)
		if clubID == "" {
			continue
		}
		number, err := toInt64(value)
		if err != nil || number == -99 {
			continue
		}
		result[clubID] = number
	}
	return result
}

func (s *Server) playerNames(ctx context.Context, ids []string) (map[string]string, error) {
	result := map[string]string{}
	if len(ids) == 0 {
		return result, nil
	}
	placeholders := strings.TrimRight(strings.Repeat("?,", len(ids)), ",")
	args := make([]any, 0, len(ids))
	for _, id := range ids {
		args = append(args, id)
	}
	rows, err := s.db.QueryContext(ctx, `SELECT sm_guuid, COALESCE(sm_name, '')
FROM kbedm.tbl_Account WHERE sm_guuid IN (`+placeholders+`)`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, err
		}
		result[id] = name
	}
	return result, rows.Err()
}

func (s *Server) handleGetClub(w http.ResponseWriter, r *http.Request, _ principal) {
	clubID, err := normalizeClubID(r.PathValue("clubId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_CLUB_ID", err.Error())
		return
	}
	detail, err := s.readClubDetail(r.Context(), clubID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "CLUB_NOT_FOUND", "没有找到这个俱乐部")
		return
	}
	if err != nil {
		s.logger.Error("read club detail", "error", err, "clubId", clubID)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取俱乐部详情失败")
		return
	}
	writeData(w, http.StatusOK, detail)
}

func (s *Server) readClubDetail(ctx context.Context, clubID string) (clubDetailResponse, error) {
	var detail clubDetailResponse
	var tax, payMode any
	var clubQuotaFen, unionPoolFen int64
	err := s.db.QueryRowContext(ctx, `SELECT c.club_guuid, COALESCE(c.club_name, ''), COALESCE(c.club_status, ''),
COALESCE(c.club_mode, ''), c.club_tax, c.club_pay_mode, COALESCE(c.club_union, ''), COALESCE(c.number_count, 0),
COALESCE(c.union_id, ''), COALESCE(c.union_quota, 0), COALESCE(cu.union_name, ''), COALESCE(cu.union_quota, 0)
FROM kbedm.club_guuid_info c
LEFT JOIN kbedm.club_union_info cu
  ON cu.union_id = c.union_id AND cu.status <> 'init'
WHERE c.club_guuid = ? LIMIT 1`, clubID).Scan(
		&detail.Club.ClubID, &detail.Club.Name, &detail.Club.Status, &detail.Club.Mode,
		&tax, &payMode, &detail.Club.Union, &detail.Club.MemberCount,
		&detail.Club.UnionID, &clubQuotaFen, &detail.Club.UnionName, &unionPoolFen)
	if err != nil {
		return detail, err
	}
	detail.Club.Tax = stringOrEmpty(tax)
	detail.Club.PayMode = stringOrEmpty(payMode)
	if detail.Club.UnionID != "" {
		detail.Club.OwnerQuotaFen = &clubQuotaFen
		detail.Club.UnionPoolQuotaFen = &unionPoolFen
	}
	if darkEnabled, _, darkErr := s.readClubDarkSetting(ctx, clubID); darkErr == nil {
		detail.Club.DarkEnabled = darkEnabled
	} else {
		s.logger.Error("read club dark setting", "error", darkErr, "clubId", clubID)
	}

	members, err := s.readClubMembers(ctx, clubID, detail.Club.Mode)
	if err != nil {
		return detail, err
	}
	names := map[string]string{}
	for _, member := range members {
		names[member.PlayerID] = member.Name
		if member.Role == "owner" {
			detail.Club.OwnerID = member.PlayerID
			detail.Club.OwnerName = member.Name
		}
	}
	if detail.Club.OwnerID != "" {
		if stone, poolErr := s.readClubStonePool(ctx, clubID, detail.Club.OwnerID); poolErr == nil {
			detail.Club.StonePool = &stone
		} else {
			s.logger.Error("read club stone pool", "error", poolErr, "clubId", clubID)
		}
	}
	// 俱乐部总积分与列表同一口径，详情页顶部要能看到同一数字。
	if totalGolds, goldErr := s.clubTotalGolds(ctx, []clubListItem{detail.Club}); goldErr == nil {
		value := totalGolds[detail.Club.ClubID]
		detail.Club.TotalClubGold = &value
	} else {
		s.logger.Error("read club total gold", "error", goldErr, "clubId", clubID)
	}
	// V2 的额度挂在俱乐部（union_quota），代理不再有独立额度：
	// 成员树里只给群主显示俱乐部额度，其他节点的旧 club_agent_info.quota 不再展示。
	for index := range members {
		if members[index].Role == "owner" {
			members[index].QuotaFen = detail.Club.OwnerQuotaFen
		} else {
			members[index].QuotaFen = nil
		}
	}
	for index := range members {
		if upperName, ok := names[members[index].UpperID]; ok {
			members[index].UpperName = upperName
		}
	}
	detail.Members = members
	detail.Roots, detail.Orphan, detail.Warnings = buildClubMemberTree(members)

	var agentCount int64
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(DISTINCT user_guuid)
FROM kbedm.club_invite_code_info WHERE club_guuid = ? AND status = 'used'`, clubID).Scan(&agentCount); err == nil {
		detail.Club.AgentCount = agentCount
	}
	return detail, nil
}

type rawClubMember struct {
	Guuid    string
	Name     string
	IsOwner  bool
	Manages  bool
	ClubGold *int64
}

// readClubMembers 读取俱乐部成员并定角色、定直属上级。
// clubMode 为 2/3（茶楼/带分模式）时余额落在 *_2 列，与客户端口径一致。
func (s *Server) readClubMembers(ctx context.Context, clubID, clubMode string) ([]clubMemberNode, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT a.sm_guuid, COALESCE(a.sm_name, ''),
COALESCE(a.sm_club_make, ''), COALESCE(a.sm_club_join, ''), COALESCE(a.sm_club_make2, ''),
COALESCE(a.sm_club_join2, ''), COALESCE(a.sm_club_manage, ''), a.sm_club_gold, a.sm_club_gold2
FROM kbedm.tbl_Account a
WHERE `+membershipAnyColumnSQL("a"),
		clubID, clubID, clubID, clubID, clubID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	raws := make([]rawClubMember, 0, 64)
	for rows.Next() {
		var item rawClubMember
		var make, join, make2, join2, manage sql.NullString
		var gold, gold2 any
		if err := rows.Scan(&item.Guuid, &item.Name, &make, &join, &make2, &join2, &manage,
			&gold, &gold2); err != nil {
			return nil, err
		}
		// FIND_IN_SET 已过滤一次，这里再按逗号切分精确复核，防止历史脏数据串号。
		if !containsClubID(make.String, clubID) && !containsClubID(join.String, clubID) &&
			!containsClubID(make2.String, clubID) && !containsClubID(join2.String, clubID) &&
			!containsClubID(manage.String, clubID) {
			continue
		}
		item.IsOwner = containsClubID(make.String, clubID) || containsClubID(make2.String, clubID)
		item.Manages = containsClubID(manage.String, clubID)
		if isSecondaryClubMode(clubMode) {
			item.ClubGold = clubGoldFrom(gold2, clubID)
			if item.ClubGold == nil {
				item.ClubGold = clubGoldFrom(gold, clubID)
			}
		} else {
			item.ClubGold = clubGoldFrom(gold, clubID)
			if item.ClubGold == nil {
				item.ClubGold = clubGoldFrom(gold2, clubID)
			}
		}
		raws = append(raws, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	relations, err := s.clubAgentRelations(ctx, clubID)
	if err != nil {
		return nil, err
	}

	members := make([]clubMemberNode, 0, len(raws))
	for _, item := range raws {
		node := clubMemberNode{PlayerID: item.Guuid, Name: item.Name, ClubGold: item.ClubGold}
		if node.Name == "" {
			node.Name = item.Guuid
		}
		relation, hasRelation := relations[item.Guuid]
		switch {
		case item.IsOwner:
			node.Role = "owner"
		case hasRelation && relation.IsAgent:
			node.IsAgent = true
			node.Role = "agent"
		default:
			// 俱乐部当前只有群主、代理、成员；旧的 club_manage 不再单列角色。
			node.Role = "member"
		}
		if hasRelation {
			node.UpperID = relation.UpperID
			node.Note = relation.Note
			node.InviteCode = relation.InviteCode
			node.QuotaFen = relation.QuotaFen
		}
		members = append(members, node)
	}

	// 创建者 → 代理 → 普通成员；同级按 ID，保证树渲染稳定。
	rank := map[string]int{"owner": 0, "agent": 1, "member": 2}
	sort.SliceStable(members, func(i, j int) bool {
		if rank[members[i].Role] != rank[members[j].Role] {
			return rank[members[i].Role] < rank[members[j].Role]
		}
		return members[i].PlayerID < members[j].PlayerID
	})
	return members, nil
}

func isSecondaryClubMode(mode string) bool {
	return mode == "2" || mode == "3"
}

// clubGoldFrom 解析账号上的俱乐部积分。历史数据有数字、也有 {"俱乐部ID": 积分} 的 JSON 串，
// 两种都要能读；-99 是「无该俱乐部数据」的哨兵，不能当余额显示。
func clubGoldFrom(raw any, clubID string) *int64 {
	text := strings.TrimSpace(stringOrEmpty(raw))
	if text == "" {
		return nil
	}
	if value, err := strconv.ParseInt(text, 10, 64); err == nil {
		if value == -99 {
			return nil
		}
		return &value
	}
	var mapping map[string]any
	if err := json.Unmarshal([]byte(text), &mapping); err != nil {
		return nil
	}
	value, ok := mapping[clubID]
	if !ok {
		return nil
	}
	number, err := toInt64(value)
	if err != nil || number == -99 {
		return nil
	}
	return &number
}

func toInt64(value any) (int64, error) {
	switch typed := value.(type) {
	case float64:
		return int64(math.Round(typed)), nil
	case string:
		return strconv.ParseInt(strings.TrimSpace(typed), 10, 64)
	case json.Number:
		return typed.Int64()
	case nil:
		return 0, errors.New("空值")
	default:
		return 0, errors.New("不支持的数值类型")
	}
}

type clubAgentRelation struct {
	UpperID    string
	Note       string
	InviteCode string
	IsAgent    bool
	// QuotaFen 是 club_agent_info.quota（分）；nil 表示还没被授信。
	QuotaFen *int64
}

func (s *Server) clubAgentRelations(ctx context.Context, clubID string) (map[string]clubAgentRelation, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT r.user_guuid, COALESCE(r.upper_guuid, ''), COALESCE(r.note, ''),
COALESCE(i.invite_code, ''), r.quota,
EXISTS(SELECT 1 FROM kbedm.club_invite_code_info c
       WHERE c.club_guuid = r.club_guuid AND c.user_guuid = r.user_guuid AND c.status = 'used')
FROM kbedm.club_agent_info r
LEFT JOIN kbedm.club_invite_code_info i
  ON i.club_guuid = r.club_guuid AND i.user_guuid = r.user_guuid AND i.status = 'used'
WHERE r.club_guuid = ? AND r.status = 'used'
ORDER BY r.id ASC`, clubID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := map[string]clubAgentRelation{}
	for rows.Next() {
		var guuid string
		var relation clubAgentRelation
		var isAgent int64
		var quota sql.NullInt64
		if err := rows.Scan(&guuid, &relation.UpperID, &relation.Note, &relation.InviteCode, &quota, &isAgent); err != nil {
			return nil, err
		}
		if quota.Valid {
			value := quota.Int64
			relation.QuotaFen = &value
		}
		relation.UpperID = strings.TrimSpace(relation.UpperID)
		relation.Note = strings.TrimSpace(relation.Note)
		relation.InviteCode = strings.TrimSpace(relation.InviteCode)
		relation.IsAgent = isAgent == 1
		if guuid = strings.TrimSpace(guuid); guuid != "" {
			result[guuid] = relation
		}
	}
	return result, rows.Err()
}

// buildClubMemberTree 按 upper_guuid 组装树。
// 上级不在本俱乐部、指向自己、或成环的节点一律进 orphan 并写 warning，
// 不能静默挂到根上——那等于伪造代理关系。
func buildClubMemberTree(members []clubMemberNode) ([]*clubMemberTree, []clubMemberNode, []string) {
	nodes := make(map[string]*clubMemberTree, len(members))
	ownerID := ""
	for _, member := range members {
		nodes[member.PlayerID] = &clubMemberTree{clubMemberNode: member, Children: []*clubMemberTree{}}
		if member.Role == "owner" && ownerID == "" {
			ownerID = member.PlayerID
		}
	}

	roots := make([]*clubMemberTree, 0, 1)
	orphan := make([]clubMemberNode, 0)
	warnings := make([]string, 0)

	for _, member := range members {
		node := nodes[member.PlayerID]
		if member.Role == "owner" {
			roots = append(roots, node)
			continue
		}
		upper := strings.TrimSpace(member.UpperID)
		if upper == "" {
			// 没有直属上级记录：按游戏服口径兜底挂创建者直属。
			// 挂上去但必须写出 warning：这是推断出来的关系，不是服务端给的。
			if ownerID != "" && member.PlayerID != ownerID {
				if parent, ok := nodes[ownerID]; ok {
					parent.Children = append(parent.Children, node)
					warnings = append(warnings, "成员 "+member.PlayerID+" 没有直属上级记录，已按创建者直属显示")
					continue
				}
			}
			orphan = append(orphan, member)
			warnings = append(warnings, "成员 "+member.PlayerID+" 没有直属上级记录")
			continue
		}
		if upper == member.PlayerID {
			orphan = append(orphan, member)
			warnings = append(warnings, "成员 "+member.PlayerID+" 的直属上级指向自己")
			continue
		}
		parent, ok := nodes[upper]
		if !ok {
			orphan = append(orphan, member)
			warnings = append(warnings, "成员 "+member.PlayerID+" 的直属上级 "+upper+" 不在本俱乐部")
			continue
		}
		parent.Children = append(parent.Children, node)
	}

	// 环检测：从每个节点沿 upper 向上最多走 len(members) 步，重访即视为成环。
	// 只沿「上级存在且不是自己」的链走，自引用已经在上面按独立问题报过，不重复报。
	for _, member := range members {
		seen := map[string]bool{member.PlayerID: true}
		current := strings.TrimSpace(member.UpperID)
		if current == "" || current == member.PlayerID {
			continue
		}
		for steps := 0; current != "" && steps <= len(members); steps++ {
			if seen[current] {
				warnings = append(warnings, "成员 "+member.PlayerID+" 的代理链存在循环引用")
				break
			}
			seen[current] = true
			index := -1
			for position, candidate := range members {
				if candidate.PlayerID == current {
					index = position
					break
				}
			}
			if index < 0 {
				break
			}
			current = strings.TrimSpace(members[index].UpperID)
		}
	}

	assignLevels(roots, 0)
	sort.SliceStable(orphan, func(i, j int) bool { return orphan[i].PlayerID < orphan[j].PlayerID })
	return roots, orphan, dedupeStrings(warnings)
}

func assignLevels(nodes []*clubMemberTree, level int) {
	for _, node := range nodes {
		node.Level = level
		assignLevels(node.Children, level+1)
	}
}

func gameCommandErrorMessage(result gameCommandResponse, fallback string) string {
	raw := strings.TrimSpace(string(result.RetResult))
	if raw == "" || raw == "null" {
		return fallback
	}
	var message string
	decode := func(data []byte) bool {
		var direct struct {
			Error string `json:"error"`
		}
		if err := json.Unmarshal(data, &direct); err == nil && strings.TrimSpace(direct.Error) != "" {
			message = strings.TrimSpace(direct.Error)
			return true
		}
		var nested struct {
			Result struct {
				Error string `json:"error"`
			} `json:"result"`
		}
		if err := json.Unmarshal(data, &nested); err == nil && strings.TrimSpace(nested.Result.Error) != "" {
			message = strings.TrimSpace(nested.Result.Error)
			return true
		}
		return false
	}
	if decode([]byte(raw)) {
		return message
	}
	var text string
	if err := json.Unmarshal([]byte(raw), &text); err == nil && decode([]byte(text)) {
		return message
	}
	return fallback
}

// membershipAnyColumnSQL 生成「该账号属于这个俱乐部」的条件。
// 五列都查：创建者/成员/茶楼模式/管理员的俱乐部关系分别落在不同列上。
// membershipColumnSQL 生成「alias 的俱乐部列里含有 clubExpr」的条件。
// clubExpr 必须是受控的表达式（列名或值），不能来自用户输入。
func membershipColumnSQL(alias, clubExpr string) string {
	columns := []string{"sm_club_make", "sm_club_join", "sm_club_make2", "sm_club_join2", "sm_club_manage"}
	parts := make([]string, 0, len(columns))
	for _, column := range columns {
		parts = append(parts, "FIND_IN_SET("+clubExpr+", REPLACE(COALESCE("+alias+"."+column+", ''), ' ', '')) > 0")
	}
	return strings.Join(parts, " OR ")
}

func membershipAnyColumnSQL(alias string) string {
	columns := []string{"sm_club_make", "sm_club_join", "sm_club_make2", "sm_club_join2", "sm_club_manage"}
	parts := make([]string, 0, len(columns))
	for _, column := range columns {
		parts = append(parts, "FIND_IN_SET(?, REPLACE(COALESCE("+alias+"."+column+", ''), ' ', '')) > 0")
	}
	return strings.Join(parts, " OR ")
}

func containsClubID(value, clubID string) bool {
	clubID = strings.TrimSpace(clubID)
	if clubID == "" {
		return false
	}
	for _, item := range strings.Split(value, ",") {
		if strings.TrimSpace(item) == clubID {
			return true
		}
	}
	return false
}

func normalizeClubID(value string) (string, error) {
	value = strings.TrimSpace(value)
	if !isSixDigitCode(value) {
		return "", errors.New("俱乐部 ID 必须是 6 位数字")
	}
	return value, nil
}

func escapeLike(value string) string {
	return strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_").Replace(value)
}

func stringOrEmpty(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return typed
	case []byte:
		return string(typed)
	case int64:
		return strconv.FormatInt(typed, 10)
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	default:
		return ""
	}
}

func dedupeStrings(values []string) []string {
	seen := make(map[string]bool, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}
