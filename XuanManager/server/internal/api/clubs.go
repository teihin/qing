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
	"sync"
	"time"
)

// 俱乐部管理：只读列出游戏库里的俱乐部与成员代理树，外加一个写操作——给群主调整额度。
//
// 数据来源：
//   - club_guuid_info        俱乐部本体（club_name / club_status / club_mode / club_tax）
//   - tbl_Account            成员身份（sm_club_make / sm_club_join / sm_club_manage / sm_club_gold）
//   - club_invite_code_info  代理邀请码（status='used' 且属于本人 = 是代理）
//   - club_agent_info        直属上级（upper_guuid）与备注
//
// 额度不落后台表：唯一真相在游戏服，后台只负责发「增加_俱乐部_额度」并在写后回读校验。

// clubQuotaMutationMu 串行化额度调整：额度是钱，并发叠加会让「结果不能小于 0」的判断失效。
var clubQuotaMutationMu sync.Mutex

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
	Union       string `json:"union"`
	// OwnerQuotaFen 是群主在当前俱乐部的可用额度（club_agent_info.quota，单位分）。
	// 指针为 nil 表示读不到（群主没有代理行或 quota 为 NULL），与「额度 0」不是一回事。
	OwnerQuotaFen *int64 `json:"ownerQuotaFen"`
}

type clubMemberNode struct {
	PlayerID   string `json:"playerId"`
	Name       string `json:"name"`
	Role       string `json:"role"`
	IsAgent    bool   `json:"isAgent"`
	IsLeader   bool   `json:"isLeader"`
	UpperID    string `json:"upperId"`
	UpperName  string `json:"upperName"`
	ClubGold   *int64 `json:"clubGold"`
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
COALESCE(c.club_union, ''), COALESCE(c.number_count, 0)
FROM kbedm.club_guuid_info c
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
		if err := rows.Scan(&item.ClubID, &item.Name, &item.Status, &item.Mode,
			&tax, &payMode, &item.Union, &item.MemberCount); err != nil {
			s.logger.Error("scan club row", "error", err)
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取俱乐部数据失败")
			return
		}
		item.Tax = stringOrEmpty(tax)
		item.PayMode = stringOrEmpty(payMode)
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
	// 群主额度：一次批量查完，不能按行 N+1（列表最多 100 行）。
	if quotas, quotaErr := s.clubOwnerQuotas(r.Context(), items); quotaErr == nil {
		for index := range items {
			if quota, ok := quotas[items[index].ClubID+"\x00"+items[index].OwnerID]; ok {
				items[index].OwnerQuotaFen = quota
			}
		}
	} else {
		s.logger.Error("read club owner quotas", "error", quotaErr)
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

// clubOwnerQuotas 批量读取每个俱乐部群主的额度（club_agent_info.quota，分）。
//
// 返回 map 用 "俱乐部ID\x00群主ID" 作键。注意「没有这一行」和「quota 为 NULL」
// 都表示未授信/无数据，调用方据此保持指针为 nil，界面上不能显示成 0。
// 用 (club_guuid, user_guuid) 元组 IN 一次查完，避免逐行查。
func (s *Server) clubOwnerQuotas(ctx context.Context, items []clubListItem) (map[string]*int64, error) {
	result := map[string]*int64{}
	pairs := make([][2]string, 0, len(items))
	for _, item := range items {
		if item.ClubID != "" && item.OwnerID != "" {
			pairs = append(pairs, [2]string{item.ClubID, item.OwnerID})
		}
	}
	if len(pairs) == 0 {
		return result, nil
	}
	placeholders := strings.TrimRight(strings.Repeat("(?,?),", len(pairs)), ",")
	args := make([]any, 0, len(pairs)*2)
	for _, pair := range pairs {
		args = append(args, pair[0], pair[1])
	}
	rows, err := s.db.QueryContext(ctx, `SELECT club_guuid, user_guuid, quota
FROM kbedm.club_agent_info
WHERE status = 'used' AND (club_guuid, user_guuid) IN (`+placeholders+`)`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var clubID, ownerID string
		var quota sql.NullInt64
		if err := rows.Scan(&clubID, &ownerID, &quota); err != nil {
			return nil, err
		}
		if !quota.Valid {
			continue
		}
		value := quota.Int64
		result[clubID+"\x00"+ownerID] = &value
	}
	return result, rows.Err()
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
	err := s.db.QueryRowContext(ctx, `SELECT club_guuid, COALESCE(club_name, ''), COALESCE(club_status, ''),
COALESCE(club_mode, ''), club_tax, club_pay_mode, COALESCE(club_union, ''), COALESCE(number_count, 0)
FROM kbedm.club_guuid_info WHERE club_guuid = ? LIMIT 1`, clubID).Scan(
		&detail.Club.ClubID, &detail.Club.Name, &detail.Club.Status, &detail.Club.Mode,
		&tax, &payMode, &detail.Club.Union, &detail.Club.MemberCount)
	if err != nil {
		return detail, err
	}
	detail.Club.Tax = stringOrEmpty(tax)
	detail.Club.PayMode = stringOrEmpty(payMode)

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
	Guuid     string
	Name      string
	IsOwner   bool
	Manages   bool
	ClubGold  *int64
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

	ownerID := ""
	for _, item := range raws {
		if item.IsOwner {
			ownerID = item.Guuid
			break
		}
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
			// 盟主 = 创建者的直属代理（与游戏内 is_leader 同口径）。
			node.IsLeader = ownerID != "" && relation.UpperID == ownerID
		case item.Manages:
			node.Role = "manager"
		default:
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

	// 创建者 → 代理 → 管理员 → 普通成员；同级按 ID，保证树渲染稳定。
	rank := map[string]int{"owner": 0, "agent": 1, "manager": 2, "member": 3}
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

type adjustClubQuotaRequest struct {
	PlayerID          string   `json:"playerId"`
	Action            string   `json:"action"`
	AmountYuan        float64  `json:"amountYuan"`
	Reason            string   `json:"reason"`
	ExpectedQuotaYuan *float64 `json:"expectedQuotaYuan"`
	Confirm           bool     `json:"confirm"`
}

type clubQuotaState struct {
	PlayerID  string  `json:"playerId"`
	ClubID    string  `json:"clubId"`
	QuotaFen  int64   `json:"quotaFen"`
	QuotaYuan float64 `json:"quotaYuan"`
	IsAgent   int     `json:"isAgent"`
	IsGranted int     `json:"isGranted"`
	Queried   bool    `json:"queried"`
}

// handleAdjustClubQuota 给俱乐部群主调整额度。
// 依据《俱乐部积分与额度方案-客户端接口文档》§7：增加_俱乐部_额度，单位是分，
// 允许负值纠错但结果不能小于 0。
func (s *Server) handleAdjustClubQuota(w http.ResponseWriter, r *http.Request, p principal) {
	clubID, err := normalizeClubID(r.PathValue("clubId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_CLUB_ID", err.Error())
		return
	}
	var input adjustClubQuotaRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	playerID, err := normalizeGamePlayerID(input.PlayerID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PLAYER_ID", err.Error())
		return
	}
	input.Action = strings.TrimSpace(strings.ToLower(input.Action))
	if input.Action != "add" && input.Action != "subtract" {
		writeError(w, http.StatusBadRequest, "INVALID_ADJUSTMENT_ACTION", "请选择增加或扣减额度")
		return
	}
	if math.IsNaN(input.AmountYuan) || math.IsInf(input.AmountYuan, 0) {
		writeError(w, http.StatusBadRequest, "INVALID_ADJUSTMENT_AMOUNT", "额度必须是数字")
		return
	}
	deltaFen := int64(math.Round(math.Abs(input.AmountYuan) * 100))
	if deltaFen == 0 {
		writeError(w, http.StatusBadRequest, "INVALID_ADJUSTMENT_AMOUNT", "额度金额不能为 0")
		return
	}
	if deltaFen > 100000000 {
		writeError(w, http.StatusBadRequest, "INVALID_ADJUSTMENT_AMOUNT", "单次调整不能超过 100 万元")
		return
	}
	if input.Action == "subtract" {
		deltaFen = -deltaFen
	}
	if input.Reason, err = normalizeAdjustmentReason(input.Reason); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_ADJUSTMENT_REASON", err.Error())
		return
	}
	if !input.Confirm {
		writeError(w, http.StatusBadRequest, "ADJUSTMENT_CONFIRM_REQUIRED", "请确认本次操作会直接改变俱乐部额度")
		return
	}
	if err := s.ensureClubOwner(r.Context(), clubID, playerID); err != nil {
		var mismatch *clubMemberMismatch
		if errors.As(err, &mismatch) {
			writeError(w, http.StatusBadRequest, "CLUB_OWNER_REQUIRED", mismatch.Error())
			return
		}
		s.logger.Error("verify club owner", "error", err, "clubId", clubID, "playerId", playerID)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "校验俱乐部群主失败")
		return
	}

	clubQuotaMutationMu.Lock()
	defer clubQuotaMutationMu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	before, beforeErr := s.queryClubQuota(ctx, clubID, playerID)
	known := beforeErr == nil && before.Queried
	if !known && beforeErr != nil {
		s.logger.Error("query club quota before adjust", "error", beforeErr, "clubId", clubID, "playerId", playerID)
	}
	if known && input.ExpectedQuotaYuan != nil &&
		math.Abs(before.QuotaYuan-*input.ExpectedQuotaYuan) > 0.005 {
		writeError(w, http.StatusConflict, "QUOTA_CHANGED", "该成员额度已变化，请刷新后重新操作")
		return
	}
	if known && deltaFen < 0 && before.QuotaFen+deltaFen < 0 {
		writeError(w, http.StatusConflict, "INSUFFICIENT_QUOTA", "扣减后额度会小于 0，请先核对当前额度")
		return
	}

	operationContext := gameOperationContext("club-quota")
	requestAudit := map[string]any{
		"clubId": clubID, "playerId": playerID, "action": input.Action,
		"deltaFen": deltaFen, "reason": input.Reason, "context": operationContext,
	}
	auditBefore := map[string]any{"quotaFen": before.QuotaFen, "queried": known}

	result, callErr := s.callGameCommand(ctx, "增加_俱乐部_额度", map[string]any{
		"club_id": clubID, "user_id": playerID, "quota_fen": deltaFen, "context": operationContext,
	})
	if callErr != nil {
		s.audit(ctx, &p, "game.club.quota_adjust", "game_club", clubID, requestAudit, auditBefore, nil,
			502, "俱乐部额度调整服务调用失败", clientIP(r))
		writeError(w, http.StatusBadGateway, "QUOTA_ADJUSTMENT_FAILED", "游戏服务调用失败，额度未确认变更")
		return
	}
	if result.RetCode != 512 {
		message := gameCommandErrorMessage(result, "俱乐部额度调整被拒绝")
		s.audit(ctx, &p, "game.club.quota_adjust", "game_club", clubID, requestAudit, auditBefore, nil,
			400, message, clientIP(r))
		writeError(w, http.StatusBadRequest, "QUOTA_ADJUSTMENT_REJECTED", message)
		return
	}

	// 命令受理不等于额度已经变了：能回读就回读，读不到要明确说明，不能装作已校验。
	after, afterErr := s.waitForClubQuota(ctx, clubID, playerID, before, deltaFen, known)
	verified := afterErr == nil && after.Queried
	message := "俱乐部额度已调整，游戏服已回读校验"
	if !verified {
		message = "额度调整已提交，但未能回读校验；请稍后在客户端查看额度，确认无误再继续操作"
		s.logger.Error("verify club quota after adjust", "error", afterErr, "clubId", clubID, "playerId", playerID)
	}
	resultCode := 0
	if !verified {
		resultCode = 202
	}
	s.audit(ctx, &p, "game.club.quota_adjust", "game_club", clubID, requestAudit, auditBefore,
		map[string]any{"quotaFen": after.QuotaFen, "queried": after.Queried, "verified": verified},
		resultCode, message, clientIP(r))
	writeData(w, http.StatusOK, map[string]any{
		"quota": after, "deltaFen": deltaFen, "verified": verified, "message": message,
	})
}

type clubMemberMismatch struct{ message string }

func (m *clubMemberMismatch) Error() string { return m.message }

// ensureClubOwner 只允许给该俱乐部的群主（创建者）调额度。
// 额度是平台注入代理的钱，后台入口限定在群主这一层，避免绕过游戏服的授信链。
func (s *Server) ensureClubOwner(ctx context.Context, clubID, playerID string) error {
	var make, make2 sql.NullString
	err := s.db.QueryRowContext(ctx, `SELECT sm_club_make, sm_club_make2
FROM kbedm.tbl_Account WHERE sm_guuid = ? LIMIT 1`, playerID).Scan(&make, &make2)
	if errors.Is(err, sql.ErrNoRows) {
		return &clubMemberMismatch{"没有找到这个玩家"}
	}
	if err != nil {
		return err
	}
	if !containsClubID(make.String, clubID) && !containsClubID(make2.String, clubID) {
		return &clubMemberMismatch{"该玩家不是这个俱乐部的群主，额度调整只允许给群主"}
	}
	return nil
}

// queryClubQuota 读该成员在当前俱乐部的额度。
// 游戏服的 GetClubQuota 走异步推送，后台按同步通道取；取不到就标记未确认，
// 绝不能把「读不到」当成 0。
// 游戏服的 查询_俱乐部_额度 只走 GetClubQuota 异步推送，同步回包通常是空壳，
// 后台拿不到推送、也就无法据此校验。额度真正的落库点在 club_agent_info.quota（bigint，单位分），
// 游戏服自己读写这一列，所以后台以它为准：先读库，读不到再退回命令（兼容只推异步的环境）。
func (s *Server) queryClubQuota(ctx context.Context, clubID, playerID string) (clubQuotaState, error) {
	state := clubQuotaState{PlayerID: playerID, ClubID: clubID}
	if err := s.readClubQuotaFromDB(ctx, clubID, playerID, &state); err != nil {
		return state, err
	}
	if state.Queried {
		return state, nil
	}
	// 库里没有该成员的代理行时，再试一次游戏服，仍然只认同步回包里有 quota_fen 的情况。
	result, err := s.callGameCommand(ctx, "查询_俱乐部_额度", map[string]any{
		"club_id": clubID, "user_id": playerID,
		"context": gameOperationContext("club-quota-query"),
	})
	if err != nil {
		return state, nil
	}
	if result.RetCode != 512 {
		return state, nil
	}
	payload := clubQuotaPayload(result.RetResult)
	if payload == nil {
		return state, nil
	}
	state.Queried = true
	state.QuotaFen = payload.QuotaFen
	state.QuotaYuan = float64(payload.QuotaFen) / 100
	state.IsAgent = payload.IsAgent
	state.IsGranted = payload.IsGranted
	return state, nil
}

// readClubQuotaFromDB 读 club_agent_info.quota（分）。
// quota 为 NULL 表示「还没被授信」，与「额度 0」不同：前者 Queried=false，界面显示未确认。
func (s *Server) readClubQuotaFromDB(ctx context.Context, clubID, playerID string, state *clubQuotaState) error {
	var quota sql.NullInt64
	var upper sql.NullString
	var status sql.NullString
	err := s.db.QueryRowContext(ctx, `SELECT quota, upper_guuid, status
FROM kbedm.club_agent_info WHERE club_guuid = ? AND user_guuid = ? LIMIT 1`,
		clubID, playerID).Scan(&quota, &upper, &status)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if status.String != "" && status.String != "used" {
		// 关系已失效：不是代理了，不能把旧额度当成可用额度。
		return nil
	}
	state.IsAgent = 1
	if strings.TrimSpace(upper.String) == "" {
		state.IsGranted = 1 // 群主没有上级，天然已授信
	}
	if !quota.Valid {
		return nil
	}
	state.Queried = true
	state.IsGranted = 1
	state.QuotaFen = quota.Int64
	state.QuotaYuan = float64(quota.Int64) / 100
	return nil
}

type clubQuotaPayloadResult struct {
	QuotaFen  int64
	IsAgent   int
	IsGranted int
}

func clubQuotaPayload(raw json.RawMessage) *clubQuotaPayloadResult {
	type quotaBody struct {
		QuotaFen  *float64 `json:"quota_fen"`
		IsAgent   *int     `json:"is_agent"`
		IsGranted *int     `json:"is_granted"`
	}
	var body quotaBody
	decode := func(data []byte) bool {
		if len(strings.TrimSpace(string(data))) == 0 || string(data) == "null" {
			return false
		}
		var direct quotaBody
		if err := json.Unmarshal(data, &direct); err == nil && direct.QuotaFen != nil {
			body = direct
			return true
		}
		// 推送形态：{"GetClubQuota": {...}}
		var wrapped struct {
			GetClubQuota *quotaBody `json:"GetClubQuota"`
		}
		if err := json.Unmarshal(data, &wrapped); err == nil && wrapped.GetClubQuota != nil &&
			wrapped.GetClubQuota.QuotaFen != nil {
			body = *wrapped.GetClubQuota
			return true
		}
		return false
	}
	if !decode(raw) {
		var text string
		if err := json.Unmarshal(raw, &text); err != nil || !decode([]byte(text)) {
			return nil
		}
	}
	result := &clubQuotaPayloadResult{QuotaFen: int64(math.Round(*body.QuotaFen))}
	if body.IsAgent != nil {
		result.IsAgent = *body.IsAgent
	}
	if body.IsGranted != nil {
		result.IsGranted = *body.IsGranted
	}
	return result
}

func (s *Server) waitForClubQuota(ctx context.Context, clubID, playerID string,
	before clubQuotaState, deltaFen int64, known bool) (clubQuotaState, error) {
	expected := before.QuotaFen + deltaFen
	var last clubQuotaState
	var lastErr error
	for attempt := 0; attempt < 6; attempt++ {
		last, lastErr = s.queryClubQuota(ctx, clubID, playerID)
		if lastErr == nil && last.Queried {
			if !known || last.QuotaFen == expected {
				return last, nil
			}
		}
		if attempt < 5 {
			select {
			case <-ctx.Done():
				return last, ctx.Err()
			case <-time.After(400 * time.Millisecond):
			}
		}
	}
	if lastErr != nil {
		return last, lastErr
	}
	if !last.Queried {
		return last, errors.New("俱乐部额度无法回读")
	}
	return last, errors.New("俱乐部额度未达到预期值")
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
