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
	"unicode/utf8"
)

// 排行榜独立模块。
//
// 背景：
//   - 游戏服只按 (scope, rank_type, dipi) 存一份「当前生效配置」，没有活动概念，
//     关掉或改配置后旧活动就查不到时间窗了；
//   - 运营需要「历史上所有排行榜活动 + 点开看实时排名」，所以后台自建留档表
//     mgr_honor_rank_activity，每次创建活动写一条，并在创建时照旧把 7 行配置
//     下发游戏服（复用 club_honor_rank.go 的展开/写入逻辑）；
//   - 排名不走游戏服：客户端那几条 查询_俱乐部_活动_* 命令要靠在线玩家 entity
//     接收推送，后台直接调只会拿到 GC_FAILED。这里按服务端文档 v2.6 §4 的口径
//     直读游戏库计算，且用的是「活动自己的时间窗」，所以历史活动也能回看。
const (
	honorRankActivityCreateAudit = "game.honor_rank.activity.create"
	honorRankActivityUpdateAudit = "game.honor_rank.activity.update"
	honorRankActivityCloseAudit  = "game.honor_rank.activity.close"
	honorRankActivityTargetType  = "game_honor_rank_activity"

	honorRankActivityMaxNote    = 120
	honorRankActivityMaxKeyword = 50
	honorRankRankingMaxRows     = 2000
	honorRankRankingPageSizeMax = 100
)

var honorRankBeijingLocation = time.FixedZone("Asia/Shanghai", 8*60*60)

// 后台活动状态：on=运营开着（游戏服活动开关为 1），closed=已结束。
const (
	honorRankActivityOn     = "on"
	honorRankActivityClosed = "closed"
)

// 由时间推导的运行阶段，不落库，避免历史数据与状态不同步。
const (
	honorRankPhasePending  = "pending"
	honorRankPhaseRunning  = "running"
	honorRankPhaseFinished = "finished"
	honorRankPhaseClosed   = "closed"
)

type honorRankActivity struct {
	ID         int64                   `json:"id"`
	ScopeType  string                  `json:"scopeType"`
	ScopeID    string                  `json:"scopeId"`
	ScopeName  string                  `json:"scopeName"`
	Title      string                  `json:"title"`
	State      string                  `json:"state"`
	Phase      string                  `json:"phase"`
	ActivityOn bool                    `json:"activityOn"`
	StartDate  string                  `json:"startDate"`
	StartTime  string                  `json:"startTime"`
	EndDate    string                  `json:"endDate"`
	EndTime    string                  `json:"endTime"`
	Boards     []updateHonorRankBoard  `json:"boards"`
	OpenBoards []string                `json:"openBoards"`
	Note       string                  `json:"note"`
	Superseded bool                    `json:"superseded"`
	CreatedBy  string                  `json:"createdBy"`
	CreatedAt  string                  `json:"createdAt"`
	ClubID     string                  `json:"clubId"`
	Ranks      []honorRankBoardSummary `json:"ranks"`
}

// 榜级摘要，前端列表/详情直接按这个渲染开关状态。
type honorRankBoardSummary struct {
	RankType string `json:"rankType"`
	Name     string `json:"name"`
	On       bool   `json:"on"`
	Rewards  string `json:"rewards"`
}

type honorRankActivityDetail struct {
	Activity honorRankActivity `json:"activity"`
	Game     honorRankState    `json:"game"`
	InSync   bool              `json:"inSync"`
	CanEdit  bool              `json:"canEdit"`
	Message  string            `json:"message"`
}

type honorRankActivityListResponse struct {
	Items    []honorRankActivity `json:"items"`
	Total    int64               `json:"total"`
	Page     int                 `json:"page"`
	PageSize int                 `json:"pageSize"`
}

// 创建请求：在原来的「开关 + 时间 + 三榜」基础上加 scope（联盟 / 独立俱乐部）。
type createHonorRankActivityBody struct {
	ScopeType  string                 `json:"scopeType"`
	ScopeID    string                 `json:"scopeId"`
	ActivityOn bool                   `json:"activityOn"`
	StartDate  string                 `json:"startDate"`
	StartTime  string                 `json:"startTime"`
	EndDate    string                 `json:"endDate"`
	EndTime    string                 `json:"endTime"`
	Boards     []updateHonorRankBoard `json:"boards"`
	Note       string                 `json:"note"`
	Confirm    bool                   `json:"confirm"`
}

type honorRankRankingRow struct {
	Rank     int     `json:"rank"`
	PlayerID string  `json:"playerId"`
	Name     string  `json:"name"`
	Value    float64 `json:"value"`
	Reward   string  `json:"reward"`
	Remark   string  `json:"remark"`
}

type honorRankRankingResponse struct {
	ActivityID int64                 `json:"activityId"`
	RankType   string                `json:"rankType"`
	Dipi       string                `json:"dipi"`
	Unit       string                `json:"unit"`
	StartDate  string                `json:"startDate"`
	EndDate    string                `json:"endDate"`
	Phase      string                `json:"phase"`
	Total      int                   `json:"total"`
	Page       int                   `json:"page"`
	PageSize   int                   `json:"pageSize"`
	Truncated  bool                  `json:"truncated"`
	Items      []honorRankRankingRow `json:"items"`
	Count      int                   `json:"count"`
}

func honorRankBoardName(rankType string) string {
	return honorRankTypeName(rankType)
}

// normalizeActivityClock 统一成 HH:MM:SS，落库和展示都用同一形式。
func normalizeActivityClock(value string) string {
	return normalizeHonorRankClock(value)
}

func honorRankActivityTitle(scopeType, scopeName, scopeID, startDate, endDate string) string {
	name := strings.TrimSpace(scopeName)
	if name == "" {
		name = scopeID
	}
	prefix := "俱乐部"
	if scopeType == "union" {
		prefix = "联盟"
	}
	if startDate == "" || endDate == "" {
		return fmt.Sprintf("%s·%s 排行榜", prefix, name)
	}
	return fmt.Sprintf("%s·%s %s 至 %s", prefix, name, startDate, endDate)
}

func honorRankActivityPhase(state, startDate, startTime, endDate, endTime string, now time.Time) string {
	if state == honorRankActivityClosed {
		return honorRankPhaseClosed
	}
	start, err := parseActivityDateTime(startDate, startTime)
	if err != nil {
		return honorRankPhasePending
	}
	end, endErr := parseActivityDateTime(endDate, endTime)
	if now.Before(start) {
		return honorRankPhasePending
	}
	if endErr == nil && now.After(end) {
		return honorRankPhaseFinished
	}
	return honorRankPhaseRunning
}

func honorRankActivityOpenBoards(boards []updateHonorRankBoard) []string {
	opened := make([]string, 0, len(boards))
	for _, board := range boards {
		if board.On {
			opened = append(opened, honorRankBoardName(board.RankType))
		}
	}
	sort.Strings(opened)
	return opened
}

func honorRankActivitySummaries(boards []updateHonorRankBoard) []honorRankBoardSummary {
	result := make([]honorRankBoardSummary, 0, len(honorRankTypes))
	for _, rankType := range honorRankTypes {
		summary := honorRankBoardSummary{RankType: rankType, Name: honorRankBoardName(rankType)}
		for _, board := range boards {
			if strings.TrimSpace(board.RankType) != rankType {
				continue
			}
			summary.On = board.On
			parts := make([]string, 0, len(board.Rewards))
			for _, reward := range board.Rewards {
				parts = append(parts, reward.Dipi+"="+reward.List)
			}
			summary.Rewards = strings.Join(parts, " ")
		}
		result = append(result, summary)
	}
	return result
}

func decodeHonorRankBoards(raw string) ([]updateHonorRankBoard, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return []updateHonorRankBoard{}, nil
	}
	var boards []updateHonorRankBoard
	if err := json.Unmarshal([]byte(raw), &boards); err != nil {
		return nil, err
	}
	return boards, nil
}

func encodeHonorRankBoards(boards []updateHonorRankBoard) string {
	body, err := json.Marshal(boards)
	if err != nil {
		return "[]"
	}
	return string(body)
}

// 活动记录里的榜结构用 updateHonorRankBoard（rankType/on/rewards[{dipi,list}]），
// 与创建请求、游戏服下发三处共用一份结构，避免字段漂移。

func honorRankScopeName(ctx context.Context, db *sql.DB, scopeType, scopeID string) (string, error) {
	if scopeType == "union" {
		var name string
		err := db.QueryRowContext(ctx,
			`SELECT COALESCE(union_name, '') FROM kbedm.club_union_info WHERE union_id = ? AND status <> 'init' LIMIT 1`,
			scopeID).Scan(&name)
		if errors.Is(err, sql.ErrNoRows) {
			return "", errHonorRankNotFound
		}
		return strings.TrimSpace(name), err
	}
	var name string
	err := db.QueryRowContext(ctx,
		`SELECT COALESCE(club_name, '') FROM kbedm.club_guuid_info WHERE club_guuid = ? LIMIT 1`,
		scopeID).Scan(&name)
	if errors.Is(err, sql.ErrNoRows) {
		return "", errHonorRankNotFound
	}
	return strings.TrimSpace(name), err
}

// honorRankScopeClubs 返回参与排名的俱乐部集合：联盟取联盟下全部俱乐部，独立俱乐部取自身。
func (s *Server) honorRankScopeClubs(ctx context.Context, scopeType, scopeID string) ([]string, error) {
	if scopeType != "union" {
		return []string{scopeID}, nil
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT club_guuid FROM kbedm.club_guuid_info WHERE union_id = ? ORDER BY id`, scopeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	clubs := []string{}
	for rows.Next() {
		var clubID string
		if err := rows.Scan(&clubID); err != nil {
			return nil, err
		}
		clubID = strings.TrimSpace(clubID)
		if clubID != "" {
			clubs = append(clubs, clubID)
		}
	}
	return clubs, rows.Err()
}

// honorRankMemberCondition 成员判定：账号的 sm_club_join / sm_club_join2 是逗号分隔的俱乐部列表。
func honorRankMemberCondition(clubs []string) (string, []any) {
	parts := make([]string, 0, len(clubs))
	args := make([]any, 0, len(clubs)*2)
	for _, clubID := range clubs {
		parts = append(parts, "(FIND_IN_SET(?, REPLACE(acc.sm_club_join, ' ', '')) > 0 OR FIND_IN_SET(?, REPLACE(acc.sm_club_join2, ' ', '')) > 0)")
		args = append(args, clubID, clubID)
	}
	if len(parts) == 0 {
		return "1 = 0", args
	}
	return "(" + strings.Join(parts, " OR ") + ")", args
}

type honorRankRawRow struct {
	PlayerID string
	Name     string
	Value    float64
	Remark   string
	// sm_custom_id：绑了靓号时界面显示「ID（靓号）」，与后台其它页面一致。
	CustomID string
}

// queryHonorRanking 按活动时间窗直读游戏库算榜。
// 口径见 服务器文档整理/俱乐部荣耀榜-客户端接口文档.md v2.6 §4：
//   - play  玩家手数榜：usr_activity_info 的 activity_type='手数'，按 remark2 档位求和，单位「局」；
//   - score 玩家赢分榜：club_member_score_info.score 求和（只取正数），单位「积分」；
//   - bonus 代理红利榜：usr_income_info 的 tax_number - bonus_tax_number，单位「元」，排除 clubtotal 基线。
func (s *Server) queryHonorRanking(ctx context.Context, clubs []string, activity honorRankActivity, rankType, dipi string) ([]honorRankRawRow, string, error) {
	startDate, startTime, endDate, endTime := activity.StartDate, activity.StartTime, activity.EndDate, activity.EndTime
	now := time.Now().In(honorRankBeijingLocation)
	if endTime == "" {
		endTime = "23:59:59"
	}
	if endDate == "" {
		endDate = startDate
	}
	// 活动还没结束时按「现在」截断，和客户端看到的口径一致。
	if end, err := parseActivityDateTime(endDate, endTime); err == nil && now.Before(end) {
		endDate = now.Format("2006-01-02")
		endTime = now.Format("15:04:05")
	}
	startStamp := strings.TrimSpace(startDate + " " + startTime)
	endStamp := strings.TrimSpace(endDate + " " + endTime)

	switch rankType {
	case honorRankBoardPlay:
		if strings.TrimSpace(dipi) == "" {
			dipi = honorRankPlayDipis[0]
		}
		member, memberArgs := honorRankMemberCondition(clubs)
		args := []any{dipi, startDate, endDate, startStamp, endStamp}
		args = append(args, memberArgs...)
		args = append(args, honorRankRankingMaxRows)
		query := `
SELECT a.user_guuid, COALESCE(NULLIF(acc.sm_name, ''), ''), SUM(a.activity_int), COALESCE(MAX(a.remark), ''),
       COALESCE(acc.sm_custom_id, '')
FROM kbedm.usr_activity_info a
JOIN kbedm.tbl_Account acc ON acc.sm_guuid = a.user_guuid
WHERE a.activity_type = '手数'
  AND a.remark2 = ?
  AND a.date BETWEEN ? AND ?
  AND CONCAT(a.date, ' ', a.time) BETWEEN ? AND ?
  AND acc.sm_level < 99
  AND ` + member + `
GROUP BY a.user_guuid, acc.sm_name, acc.sm_custom_id
ORDER BY SUM(a.activity_int) DESC, a.user_guuid DESC
LIMIT ?`
		rows, err := s.queryHonorRankRows(ctx, query, args)
		return rows, "局", err
	case honorRankBoardScore:
		if len(clubs) == 0 {
			return []honorRankRawRow{}, "积分", nil
		}
		args := make([]any, 0, len(clubs)+3)
		for _, clubID := range clubs {
			args = append(args, clubID)
		}
		args = append(args, startDate, endDate, honorRankRankingMaxRows)
		query := `
SELECT s.user_guuid, COALESCE(NULLIF(acc.sm_name, ''), ''), SUM(s.score), '',
       COALESCE(acc.sm_custom_id, '')
FROM kbedm.club_member_score_info s
LEFT JOIN kbedm.tbl_Account acc ON acc.sm_guuid = s.user_guuid
WHERE s.club_guuid IN (` + placeholders(len(clubs)) + `)
  AND s.date BETWEEN ? AND ?
GROUP BY s.user_guuid, acc.sm_name, acc.sm_custom_id
-- 不再只取正数：赢分榜要能看到负分/0 分玩家（文档 v2.9 口径）
ORDER BY SUM(s.score) DESC, s.user_guuid DESC
LIMIT ?`
		rows, err := s.queryHonorRankRows(ctx, query, args)
		return rows, "积分", err
	case honorRankBoardBonus:
		if len(clubs) == 0 {
			return []honorRankRawRow{}, "元", nil
		}
		// 归属俱乐部用 proxy_guuid = 'club-<俱乐部ID>' 判定（与文档 §4.3 一致），
		// 金额来自 remark1（分成的归属账号）聚合，单位由分换算成元。
		args := make([]any, 0, len(clubs)+5)
		for _, clubID := range clubs {
			args = append(args, "club-"+clubID)
		}
		args = append(args, startDate, endDate, startStamp, endStamp, honorRankRankingMaxRows)
		query := `
SELECT i.remark1, COALESCE(NULLIF(acc.sm_name, ''), ''),
       SUM(i.tax_number - COALESCE(i.bonus_tax_number, 0)) / 100, '',
       COALESCE(acc.sm_custom_id, '')
FROM kbedm.usr_income_info i
LEFT JOIN kbedm.tbl_Account acc ON acc.sm_guuid = i.remark1
WHERE i.proxy_guuid IN (` + placeholders(len(clubs)) + `)
  AND COALESCE(i.remark5, '') <> 'clubtotal'
  AND i.remark1 <> ''
  AND i.date BETWEEN ? AND ?
  AND CONCAT(i.date, ' ', i.time) BETWEEN ? AND ?
GROUP BY i.remark1, acc.sm_name, acc.sm_custom_id
HAVING SUM(i.tax_number - COALESCE(i.bonus_tax_number, 0)) > 0
ORDER BY SUM(i.tax_number - COALESCE(i.bonus_tax_number, 0)) DESC, i.remark1 DESC
LIMIT ?`
		rows, err := s.queryHonorRankRows(ctx, query, args)
		return rows, "元", err
	}
	return nil, "", errors.New("rank_type 非法")
}

// honorRankPlayerLabel 账号 ID 后面带靓号：496702（88888888）。
// 靓号和 ID 相同时不重复展示（有账号绑的靓号就是自身 ID）。
func honorRankPlayerLabel(playerID, customID string) string {
	playerID = strings.TrimSpace(playerID)
	customID = strings.TrimSpace(customID)
	if customID == "" || customID == playerID {
		return playerID
	}
	return playerID + "（" + customID + "）"
}

func (s *Server) queryHonorRankRows(ctx context.Context, query string, args []any) ([]honorRankRawRow, error) {
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []honorRankRawRow{}
	for rows.Next() {
		var item honorRankRawRow
		if err := rows.Scan(&item.PlayerID, &item.Name, &item.Value, &item.Remark, &item.CustomID); err != nil {
			return nil, err
		}
		item.PlayerID = strings.TrimSpace(item.PlayerID)
		item.Name = strings.TrimSpace(item.Name)
		item.CustomID = strings.TrimSpace(item.CustomID)
		result = append(result, item)
	}
	return result, rows.Err()
}

// honorRankRewardAt 取活动配置里第 rank 名（1 起）的展示奖励。
func honorRankRewardAt(boards []updateHonorRankBoard, rankType, dipi string, rank int) string {
	for _, board := range boards {
		if strings.TrimSpace(board.RankType) != rankType {
			continue
		}
		for _, reward := range board.Rewards {
			if strings.TrimSpace(reward.Dipi) != strings.TrimSpace(dipi) {
				continue
			}
			values := strings.Split(reward.List, ",")
			if rank >= 1 && rank <= len(values) {
				return strings.TrimSpace(values[rank-1])
			}
			return ""
		}
	}
	return ""
}

func (s *Server) loadHonorRankActivity(ctx context.Context, id int64) (honorRankActivity, error) {
	var item honorRankActivity
	var boardsRaw string
	var createdAt time.Time
	err := s.db.QueryRowContext(ctx, `
SELECT a.id, a.scope_type, a.scope_id, a.scope_name, a.title, a.state, a.activity_on,
       a.start_date, a.start_time, a.end_date, a.end_time, a.boards, a.note, a.created_by, a.created_at,
       EXISTS(SELECT 1 FROM mgr_honor_rank_activity b
               WHERE b.scope_type = a.scope_type AND b.scope_id = a.scope_id AND b.id > a.id)
FROM mgr_honor_rank_activity a WHERE a.id = ?`, id).Scan(
		&item.ID, &item.ScopeType, &item.ScopeID, &item.ScopeName, &item.Title, &item.State, &item.ActivityOn,
		&item.StartDate, &item.StartTime, &item.EndDate, &item.EndTime, &boardsRaw, &item.Note,
		&item.CreatedBy, &createdAt, &item.Superseded)
	if errors.Is(err, sql.ErrNoRows) {
		return honorRankActivity{}, errHonorRankActivityNotFound
	}
	if err != nil {
		return honorRankActivity{}, err
	}
	item.Boards, err = decodeHonorRankBoards(boardsRaw)
	if err != nil {
		return honorRankActivity{}, fmt.Errorf("活动配置损坏: %w", err)
	}
	item.CreatedAt = createdAt.In(honorRankBeijingLocation).Format("2006-01-02 15:04:05")
	item.Phase = honorRankActivityPhase(item.State, item.StartDate, item.StartTime, item.EndDate, item.EndTime, time.Now().In(honorRankBeijingLocation))
	item.OpenBoards = honorRankActivityOpenBoards(item.Boards)
	item.Ranks = honorRankActivitySummaries(item.Boards)
	return item, nil
}

var (
	errHonorRankActivityNotFound = errors.New("排行榜活动不存在")
)

type honorRankScopeOption struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Note string `json:"note"`
}

// handleHonorRankScopes 给创建弹窗选范围用。
// 单独开一个接口，是因为只有排行榜权限的角色也该能选联盟/俱乐部，
// 不应该顺带要求「俱乐部管理」或「联盟管理」的查看权限。
func (s *Server) handleHonorRankScopes(w http.ResponseWriter, r *http.Request, _ principal) {
	scopeType := strings.TrimSpace(r.URL.Query().Get("scopeType"))
	if scopeType != "union" && scopeType != "club" {
		writeError(w, http.StatusBadRequest, "INVALID_SCOPE", "统计范围只能是联盟或俱乐部")
		return
	}
	keyword := strings.TrimSpace(r.URL.Query().Get("keyword"))
	if utf8.RuneCountInString(keyword) > honorRankActivityMaxKeyword {
		writeError(w, http.StatusBadRequest, "INVALID_KEYWORD", "关键字不能超过 50 个字符")
		return
	}

	var query string
	args := []any{}
	if scopeType == "union" {
		query = `SELECT union_id, COALESCE(union_name, ''), COUNT(*)
FROM kbedm.club_union_info WHERE status <> 'init'`
		if keyword != "" {
			query += ` AND (union_id LIKE ? OR union_name LIKE ?)`
			args = append(args, "%"+keyword+"%", "%"+keyword+"%")
		}
		query += ` GROUP BY union_id, union_name ORDER BY union_id DESC LIMIT 50`
	} else {
		// 已入盟的俱乐部按联盟维度开榜，这里只给独立俱乐部。
		query = `SELECT club_guuid, COALESCE(club_name, '')
FROM kbedm.club_guuid_info WHERE COALESCE(union_id, '') = ''`
		if keyword != "" {
			query += ` AND (club_guuid LIKE ? OR club_name LIKE ?)`
			args = append(args, "%"+keyword+"%", "%"+keyword+"%")
		}
		query += ` ORDER BY id DESC LIMIT 50`
	}

	rows, err := s.db.QueryContext(r.Context(), query, args...)
	if err != nil {
		s.logger.Error("list honor rank scopes", "error", err, "scopeType", scopeType)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取联盟/俱乐部列表失败")
		return
	}
	defer rows.Close()
	items := []honorRankScopeOption{}
	for rows.Next() {
		item := honorRankScopeOption{}
		if scopeType == "union" {
			var clubCount int
			if err := rows.Scan(&item.ID, &item.Name, &clubCount); err != nil {
				s.logger.Error("scan honor rank union scope", "error", err)
				writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "解析联盟列表失败")
				return
			}
			item.Note = fmt.Sprintf("%d 个俱乐部", clubCount)
		} else {
			if err := rows.Scan(&item.ID, &item.Name); err != nil {
				s.logger.Error("scan honor rank club scope", "error", err)
				writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "解析俱乐部列表失败")
				return
			}
		}
		item.ID = strings.TrimSpace(item.ID)
		item.Name = strings.TrimSpace(item.Name)
		if item.ID != "" {
			items = append(items, item)
		}
	}
	if err := rows.Err(); err != nil {
		s.logger.Error("iterate honor rank scopes", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取联盟/俱乐部列表失败")
		return
	}
	writeData(w, http.StatusOK, map[string]any{"items": items})
}

func writeHonorRankActivityError(w http.ResponseWriter, err error) {
	if errors.Is(err, errHonorRankActivityNotFound) {
		writeError(w, http.StatusNotFound, "HONOR_RANK_ACTIVITY_NOT_FOUND", err.Error())
		return
	}
	writeError(w, http.StatusInternalServerError, "HONOR_RANK_ACTIVITY_FAILED", "读取排行榜活动失败："+err.Error())
}

func (s *Server) handleListHonorRankActivities(w http.ResponseWriter, r *http.Request, _ principal) {
	page, size := pageParams(r)
	query := r.URL.Query()
	scopeType := strings.TrimSpace(query.Get("scopeType"))
	if scopeType != "" && scopeType != "union" && scopeType != "club" {
		writeError(w, http.StatusBadRequest, "INVALID_SCOPE", "统计范围只能是联盟或俱乐部")
		return
	}
	keyword := strings.TrimSpace(query.Get("keyword"))
	if utf8.RuneCountInString(keyword) > honorRankActivityMaxKeyword {
		writeError(w, http.StatusBadRequest, "INVALID_KEYWORD", "关键字不能超过 50 个字符")
		return
	}
	phase := strings.TrimSpace(query.Get("phase"))

	where := []string{"1 = 1"}
	args := []any{}
	if scopeType != "" {
		where = append(where, "a.scope_type = ?")
		args = append(args, scopeType)
	}
	if keyword != "" {
		like := "%" + keyword + "%"
		where = append(where, "(a.scope_id LIKE ? OR a.scope_name LIKE ? OR a.title LIKE ? OR a.note LIKE ?)")
		args = append(args, like, like, like, like)
	}
	// 阶段用字符串比较近似（时间列都是定长文本），避免逐行解析。
	nowIn := time.Now().In(honorRankBeijingLocation)
	nowStamp := nowIn.Format("2006-01-02 15:04:05")
	switch phase {
	case "pending":
		where = append(where, "a.state = 'on'", "CONCAT(a.start_date, ' ', a.start_time) > ?")
		args = append(args, nowStamp)
	case "running":
		where = append(where, "a.state = 'on'",
			"CONCAT(a.start_date, ' ', a.start_time) <= ?", "CONCAT(a.end_date, ' ', a.end_time) >= ?")
		args = append(args, nowStamp, nowStamp)
	case "finished":
		where = append(where, "CONCAT(a.end_date, ' ', a.end_time) < ?")
		args = append(args, nowStamp)
	case "closed":
		where = append(where, "a.state = 'closed'")
	}

	whereSQL := strings.Join(where, " AND ")
	var total int64
	if err := s.db.QueryRowContext(r.Context(),
		`SELECT COUNT(*) FROM mgr_honor_rank_activity a WHERE `+whereSQL, args...).Scan(&total); err != nil {
		s.logger.Error("count honor rank activities", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取排行榜活动数量失败")
		return
	}

	queryArgs := append([]any{}, args...)
	queryArgs = append(queryArgs, size, (page-1)*size)
	rows, err := s.db.QueryContext(r.Context(), `
SELECT a.id, a.scope_type, a.scope_id, a.scope_name, a.title, a.state, a.activity_on,
       a.start_date, a.start_time, a.end_date, a.end_time, a.boards, a.note, a.created_by, a.created_at,
       EXISTS(SELECT 1 FROM mgr_honor_rank_activity b
               WHERE b.scope_type = a.scope_type AND b.scope_id = a.scope_id AND b.id > a.id)
FROM mgr_honor_rank_activity a
WHERE `+whereSQL+`
ORDER BY a.id DESC
LIMIT ? OFFSET ?`, queryArgs...)
	if err != nil {
		s.logger.Error("list honor rank activities", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取排行榜活动失败")
		return
	}
	defer rows.Close()

	items := make([]honorRankActivity, 0, size)
	for rows.Next() {
		var item honorRankActivity
		var boardsRaw string
		var createdAt time.Time
		if err := rows.Scan(
			&item.ID, &item.ScopeType, &item.ScopeID, &item.ScopeName, &item.Title, &item.State, &item.ActivityOn,
			&item.StartDate, &item.StartTime, &item.EndDate, &item.EndTime, &boardsRaw, &item.Note,
			&item.CreatedBy, &createdAt, &item.Superseded); err != nil {
			s.logger.Error("scan honor rank activity", "error", err)
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "解析排行榜活动失败")
			return
		}
		item.Boards, _ = decodeHonorRankBoards(boardsRaw)
		item.CreatedAt = createdAt.In(honorRankBeijingLocation).Format("2006-01-02 15:04:05")
		item.Phase = honorRankActivityPhase(item.State, item.StartDate, item.StartTime, item.EndDate, item.EndTime, nowIn)
		item.OpenBoards = honorRankActivityOpenBoards(item.Boards)
		item.Ranks = honorRankActivitySummaries(item.Boards)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		s.logger.Error("iterate honor rank activities", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取排行榜活动失败")
		return
	}
	writeData(w, http.StatusOK, honorRankActivityListResponse{Items: items, Total: total, Page: page, PageSize: size})
}

// recordHonorRankActivityFromScopeEdit 让「俱乐部管理 / 联盟管理」里的旧入口也进活动列表：
// 开启就按本次配置新增一条活动，关闭就把该范围最新一条标成已结束。
// 任何失败都只记日志，不影响已经下发成功的配置。
func (s *Server) recordHonorRankActivityFromScopeEdit(ctx context.Context, p *principal, scopeType, scopeID string, input updateHonorRankRequest) {
	scopeName, err := honorRankScopeName(ctx, s.db, scopeType, scopeID)
	if err != nil {
		s.logger.Warn("read scope name for honor rank activity", "error", err, "scope", scopeType, "targetId", scopeID)
	}
	startTime := normalizeActivityClock(input.StartTime)
	endTime := normalizeActivityClock(input.EndTime)
	startDate := strings.TrimSpace(input.StartDate)
	endDate := strings.TrimSpace(input.EndDate)
	note := strings.TrimSpace(input.Note)
	if utf8.RuneCountInString(note) > honorRankActivityMaxNote {
		note = string([]rune(note)[:honorRankActivityMaxNote])
	}
	createdBy := ""
	if p != nil {
		createdBy = p.Username
	}
	if !input.ActivityOn {
		if _, err := s.db.ExecContext(ctx, `UPDATE mgr_honor_rank_activity
SET state = ?, activity_on = 0
WHERE scope_type = ? AND scope_id = ? AND state = ?
ORDER BY id DESC LIMIT 1`, honorRankActivityClosed, scopeType, scopeID, honorRankActivityOn); err != nil {
			s.logger.Warn("close honor rank activity from scope edit", "error", err, "scope", scopeType, "targetId", scopeID)
		}
		return
	}
	if _, err := s.db.ExecContext(ctx, `INSERT INTO mgr_honor_rank_activity
(scope_type, scope_id, scope_name, title, state, activity_on, start_date, start_time, end_date, end_time, boards, note, created_by)
VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
		scopeType, scopeID, scopeName,
		honorRankActivityTitle(scopeType, scopeName, scopeID, startDate, endDate),
		honorRankActivityOn, startDate, startTime, endDate, endTime,
		encodeHonorRankBoards(input.Boards), note, createdBy); err != nil {
		s.logger.Warn("insert honor rank activity from scope edit", "error", err, "scope", scopeType, "targetId", scopeID)
	}
}

func (s *Server) handleGetHonorRankActivity(w http.ResponseWriter, r *http.Request, _ principal) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "活动编号不正确")
		return
	}
	ctx := r.Context()
	item, err := s.loadHonorRankActivity(ctx, id)
	if err != nil {
		writeHonorRankActivityError(w, err)
		return
	}
	game, gameErr := s.queryHonorRankConfig(ctx, item.ScopeType, item.ScopeID)
	detail := honorRankActivityDetail{
		Activity: item,
		Game:     game,
		// 已被取代的活动，游戏服那份配置一定属于后面的活动，不能报"一致"。
		InSync:  gameErr == nil && !item.Superseded && honorRankActivityMatchesGame(item, game),
		CanEdit: !item.Superseded,
	}
	if item.Superseded {
		detail.Message = "该范围已有更新的活动，游戏服当前配置属于那场活动"
	} else if gameErr != nil {
		detail.Message = "读取游戏服当前配置失败：" + gameErr.Error()
	}
	writeData(w, http.StatusOK, detail)
}

// honorRankActivityMatchesGame 判断游戏服当前 7 行是否仍是这次活动的配置。
func honorRankActivityMatchesGame(item honorRankActivity, game honorRankState) bool {
	if len(game.Rows) == 0 {
		return false
	}
	for _, row := range game.Rows {
		if row.ActivityOn != item.ActivityOn {
			return false
		}
		if item.ActivityOn {
			if row.StartDate != item.StartDate || row.EndDate != item.EndDate {
				return false
			}
			if normalizeHonorRankClock(row.StartTime) != normalizeHonorRankClock(item.StartTime) ||
				normalizeHonorRankClock(row.EndTime) != normalizeHonorRankClock(item.EndTime) {
				return false
			}
		}
	}
	return true
}

func (s *Server) handleCreateHonorRankActivity(w http.ResponseWriter, r *http.Request, p principal) {
	var body createHonorRankActivityBody
	if !decodeJSON(w, r, &body) {
		return
	}
	scopeType := strings.TrimSpace(body.ScopeType)
	scopeID := strings.TrimSpace(body.ScopeID)
	if scopeType != "union" && scopeType != "club" {
		writeError(w, http.StatusBadRequest, "INVALID_SCOPE", "请选择本次活动面向联盟还是独立俱乐部")
		return
	}
	if scopeType == "union" {
		normalized, err := normalizeUnionID(scopeID)
		if err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_UNION_ID", err.Error())
			return
		}
		scopeID = normalized
	} else {
		normalized, err := normalizeClubID(scopeID)
		if err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_CLUB_ID", err.Error())
			return
		}
		scopeID = normalized
	}

	note, err := normalizeHonorRankNote(body.Note)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_HONOR_RANK", err.Error())
		return
	}
	body.StartTime = normalizeActivityClock(body.StartTime)
	body.EndTime = normalizeActivityClock(body.EndTime)
	update := updateHonorRankRequest{
		ActivityOn: body.ActivityOn,
		StartDate:  strings.TrimSpace(body.StartDate),
		StartTime:  body.StartTime,
		EndDate:    strings.TrimSpace(body.EndDate),
		EndTime:    body.EndTime,
		Boards:     body.Boards,
		Note:       note,
		Confirm:    body.Confirm,
	}
	writes, err := buildHonorRankWrites(&update)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_HONOR_RANK", err.Error())
		return
	}

	honorRankMutationMu.Lock()
	defer honorRankMutationMu.Unlock()

	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()

	if _, err := s.readHonorRankScope(ctx, scopeType, scopeID); err != nil {
		s.writeHonorRankScopeError(w, err, scopeType, scopeID)
		return
	}
	scopeName, err := honorRankScopeName(ctx, s.db, scopeType, scopeID)
	if err != nil {
		writeHonorRankActivityError(w, err)
		return
	}

	before, beforeErr := s.queryHonorRankConfig(ctx, scopeType, scopeID)
	if beforeErr != nil {
		s.logger.Warn("read honor rank before activity create", "error", beforeErr, "scope", scopeType, "targetId", scopeID)
	}

	for _, row := range writes {
		if err := s.writeHonorRankRow(ctx, scopeType, scopeID, row); err != nil {
			label := honorRankTypeName(row.RankType) + row.Dipi
			message := fmt.Sprintf("%s下发失败：%s（该行之前的配置可能已写入，请重开本页核对）", label, err.Error())
			s.audit(ctx, &p, honorRankActivityCreateAudit, honorRankActivityTargetType, scopeType+":"+scopeID,
				map[string]any{"scopeType": scopeType, "scopeId": scopeID, "boards": honorRankAuditBoards(writes), "note": note},
				honorRankAuditSnapshot(before, beforeErr), nil, http.StatusBadGateway, message, clientIP(r))
			writeError(w, http.StatusBadGateway, "HONOR_RANK_UPDATE_FAILED", message)
			return
		}
	}

	state := honorRankActivityOn
	if !body.ActivityOn {
		state = honorRankActivityClosed
	}
	title := honorRankActivityTitle(scopeType, scopeName, scopeID, update.StartDate, update.EndDate)
	result, err := s.db.ExecContext(ctx, `INSERT INTO mgr_honor_rank_activity
(scope_type, scope_id, scope_name, title, state, activity_on, start_date, start_time, end_date, end_time, boards, note, created_by)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		scopeType, scopeID, scopeName, title, state, body.ActivityOn,
		update.StartDate, update.StartTime, update.EndDate, update.EndTime,
		encodeHonorRankBoards(body.Boards), note, p.Username)
	if err != nil {
		s.logger.Error("insert honor rank activity", "error", err)
		s.audit(ctx, &p, honorRankActivityCreateAudit, honorRankActivityTargetType, scopeType+":"+scopeID,
			map[string]any{"scopeType": scopeType, "scopeId": scopeID, "boards": honorRankAuditBoards(writes), "note": note},
			honorRankAuditSnapshot(before, beforeErr), nil, http.StatusInternalServerError,
			"配置已下发游戏服，但活动留档失败："+err.Error(), clientIP(r))
		writeError(w, http.StatusInternalServerError, "HONOR_RANK_ACTIVITY_SAVE_FAILED",
			"配置已下发游戏服，但活动留档失败，请刷新核对："+err.Error())
		return
	}
	activityID, _ := result.LastInsertId()

	after, err := s.queryHonorRankConfig(ctx, scopeType, scopeID)
	if err != nil {
		s.logger.Warn("read honor rank after activity create", "error", err)
		after = honorRankState{Scope: scopeType, TargetID: scopeID, Rows: []honorRankRowState{}}
	}
	message := honorRankSummary(update, scopeType)
	s.audit(ctx, &p, honorRankActivityCreateAudit, honorRankActivityTargetType, strconv.FormatInt(activityID, 10),
		map[string]any{"scopeType": scopeType, "scopeId": scopeID, "boards": honorRankAuditBoards(writes), "note": note},
		honorRankAuditSnapshot(before, beforeErr), honorRankAuditSnapshot(after, nil), 0, message, clientIP(r))

	created, loadErr := s.loadHonorRankActivity(ctx, activityID)
	if loadErr != nil {
		writeData(w, http.StatusOK, honorRankActivityDetail{
			Game:    after,
			InSync:  true,
			CanEdit: true,
			Message: message + "（活动已保存，回读留档失败，请刷新列表核对）",
		})
		return
	}
	writeData(w, http.StatusOK, honorRankActivityDetail{
		Activity: created,
		Game:     after,
		InSync:   true,
		CanEdit:  true,
		Message:  message,
	})
}

// handleUpdateHonorRankActivity 修改一场已有活动：范围固定，其余（开关、起止时间、三榜、名次奖励、备注）
// 全部覆盖，并重新下发游戏服 7 行配置。已被更新的活动取代时拒绝，避免把旧活动的配置写回去。
func (s *Server) handleUpdateHonorRankActivity(w http.ResponseWriter, r *http.Request, p principal) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "活动编号不正确")
		return
	}
	var body createHonorRankActivityBody
	if !decodeJSON(w, r, &body) {
		return
	}
	note, err := normalizeHonorRankNote(body.Note)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_HONOR_RANK", err.Error())
		return
	}
	body.StartTime = normalizeActivityClock(body.StartTime)
	body.EndTime = normalizeActivityClock(body.EndTime)
	update := updateHonorRankRequest{
		ActivityOn: body.ActivityOn,
		StartDate:  strings.TrimSpace(body.StartDate),
		StartTime:  body.StartTime,
		EndDate:    strings.TrimSpace(body.EndDate),
		EndTime:    body.EndTime,
		Boards:     body.Boards,
		Note:       note,
		Confirm:    body.Confirm,
	}
	writes, err := buildHonorRankWrites(&update)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_HONOR_RANK", err.Error())
		return
	}

	honorRankMutationMu.Lock()
	defer honorRankMutationMu.Unlock()

	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()

	item, err := s.loadHonorRankActivity(ctx, id)
	if err != nil {
		writeHonorRankActivityError(w, err)
		return
	}
	if item.Superseded {
		writeError(w, http.StatusConflict, "HONOR_RANK_ACTIVITY_SUPERSEDED",
			"这个活动已被该范围的更新活动取代，改它会把新活动的配置覆盖掉；请改最新那场活动")
		return
	}
	if _, err := s.readHonorRankScope(ctx, item.ScopeType, item.ScopeID); err != nil {
		s.writeHonorRankScopeError(w, err, item.ScopeType, item.ScopeID)
		return
	}
	scopeName, err := honorRankScopeName(ctx, s.db, item.ScopeType, item.ScopeID)
	if err != nil {
		s.logger.Warn("read scope name for honor rank activity update", "error", err, "activityId", id)
		scopeName = item.ScopeName
	}

	before, beforeErr := s.queryHonorRankConfig(ctx, item.ScopeType, item.ScopeID)
	if beforeErr != nil {
		s.logger.Warn("read honor rank before activity update", "error", beforeErr, "activityId", id)
	}
	beforeAudit := map[string]any{"activity": honorRankActivityAuditSnapshot(item)}
	if beforeErr == nil {
		beforeAudit["game"] = honorRankAuditSnapshot(before, nil)
	}
	requestAudit := map[string]any{
		"activityId": id,
		"activityOn": update.ActivityOn,
		"startDate":  update.StartDate,
		"startTime":  update.StartTime,
		"endDate":    update.EndDate,
		"endTime":    update.EndTime,
		"boards":     honorRankAuditBoards(writes),
		"note":       note,
	}

	for _, row := range writes {
		if err := s.writeHonorRankRow(ctx, item.ScopeType, item.ScopeID, row); err != nil {
			label := honorRankTypeName(row.RankType) + row.Dipi
			message := fmt.Sprintf("%s下发失败：%s（该行之前的配置可能已写入，请重开本页核对）", label, err.Error())
			s.audit(ctx, &p, honorRankActivityUpdateAudit, honorRankActivityTargetType, strconv.FormatInt(id, 10),
				requestAudit, beforeAudit, nil, http.StatusBadGateway, message, clientIP(r))
			writeError(w, http.StatusBadGateway, "HONOR_RANK_UPDATE_FAILED", message)
			return
		}
	}

	state := honorRankActivityOn
	if !body.ActivityOn {
		state = honorRankActivityClosed
	}
	title := honorRankActivityTitle(item.ScopeType, scopeName, item.ScopeID, update.StartDate, update.EndDate)
	if _, err := s.db.ExecContext(ctx, `UPDATE mgr_honor_rank_activity
SET scope_name = ?, title = ?, state = ?, activity_on = ?, start_date = ?, start_time = ?,
    end_date = ?, end_time = ?, boards = ?, note = ?
WHERE id = ?`,
		scopeName, title, state, body.ActivityOn,
		update.StartDate, update.StartTime, update.EndDate, update.EndTime,
		encodeHonorRankBoards(body.Boards), note, id); err != nil {
		s.logger.Error("update honor rank activity", "error", err, "activityId", id)
		message := "配置已下发游戏服，但活动留档更新失败，请刷新核对：" + err.Error()
		s.audit(ctx, &p, honorRankActivityUpdateAudit, honorRankActivityTargetType, strconv.FormatInt(id, 10),
			requestAudit, beforeAudit, nil, http.StatusInternalServerError, message, clientIP(r))
		writeError(w, http.StatusInternalServerError, "HONOR_RANK_ACTIVITY_SAVE_FAILED", message)
		return
	}

	after, err := s.queryHonorRankConfig(ctx, item.ScopeType, item.ScopeID)
	if err != nil {
		s.logger.Warn("read honor rank after activity update", "error", err, "activityId", id)
		after = honorRankState{Scope: item.ScopeType, TargetID: item.ScopeID, Rows: []honorRankRowState{}}
	}
	message := honorRankSummary(update, item.ScopeType)
	updated, loadErr := s.loadHonorRankActivity(ctx, id)
	var afterSnapshot map[string]any
	if loadErr == nil {
		afterSnapshot = honorRankActivityAuditSnapshot(updated)
	}
	s.audit(ctx, &p, honorRankActivityUpdateAudit, honorRankActivityTargetType, strconv.FormatInt(id, 10),
		requestAudit, beforeAudit, afterSnapshot, 0, message, clientIP(r))

	if loadErr != nil {
		writeData(w, http.StatusOK, honorRankActivityDetail{
			Game:    after,
			InSync:  true,
			CanEdit: true,
			Message: message + "（活动已保存，回读失败，请刷新列表核对）",
		})
		return
	}
	writeData(w, http.StatusOK, honorRankActivityDetail{
		Activity: updated,
		Game:     after,
		InSync:   true,
		CanEdit:  true,
		Message:  message,
	})
}

// honorRankActivityAuditSnapshot 只记活动本身的字段，避免把整份 boards 展开成 7 行噪音。
func honorRankActivityAuditSnapshot(item honorRankActivity) map[string]any {
	boards := make([]map[string]any, 0, len(item.Boards))
	for _, board := range item.Boards {
		rewards := make([]string, 0, len(board.Rewards))
		for _, reward := range board.Rewards {
			rewards = append(rewards, reward.Dipi+"="+reward.List)
		}
		boards = append(boards, map[string]any{"rankType": board.RankType, "on": board.On, "rewards": rewards})
	}
	return map[string]any{
		"scopeType":  item.ScopeType,
		"scopeId":    item.ScopeID,
		"activityOn": item.ActivityOn,
		"state":      item.State,
		"startDate":  item.StartDate,
		"startTime":  item.StartTime,
		"endDate":    item.EndDate,
		"endTime":    item.EndTime,
		"boards":     boards,
		"note":       item.Note,
	}
}

func (s *Server) handleCloseHonorRankActivity(w http.ResponseWriter, r *http.Request, p principal) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "活动编号不正确")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()

	honorRankMutationMu.Lock()
	defer honorRankMutationMu.Unlock()

	item, err := s.loadHonorRankActivity(ctx, id)
	if err != nil {
		writeHonorRankActivityError(w, err)
		return
	}
	if item.Superseded {
		writeError(w, http.StatusConflict, "HONOR_RANK_ACTIVITY_SUPERSEDED",
			"这个活动已被该范围的更新活动取代，改它只会覆盖新活动的配置；请到最新活动里操作")
		return
	}
	if item.State == honorRankActivityClosed {
		writeData(w, http.StatusOK, map[string]any{"message": "这个活动已经结束了", "activity": item})
		return
	}

	boards := item.Boards
	update := updateHonorRankRequest{
		ActivityOn: false,
		StartDate:  item.StartDate,
		StartTime:  item.StartTime,
		EndDate:    item.EndDate,
		EndTime:    item.EndTime,
		Boards:     boards,
		Note:       "结束排行榜活动",
		Confirm:    true,
	}
	writes, err := buildHonorRankWrites(&update)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_HONOR_RANK", err.Error())
		return
	}
	before, beforeErr := s.queryHonorRankConfig(ctx, item.ScopeType, item.ScopeID)
	for _, row := range writes {
		if err := s.writeHonorRankRow(ctx, item.ScopeType, item.ScopeID, row); err != nil {
			message := fmt.Sprintf("关闭 %s 失败：%s", honorRankTypeName(row.RankType)+row.Dipi, err.Error())
			s.audit(ctx, &p, honorRankActivityCloseAudit, honorRankActivityTargetType, strconv.FormatInt(id, 10),
				map[string]any{"action": "close"}, honorRankAuditSnapshot(before, beforeErr), nil,
				http.StatusBadGateway, message, clientIP(r))
			writeError(w, http.StatusBadGateway, "HONOR_RANK_UPDATE_FAILED", message)
			return
		}
	}
	if _, err := s.db.ExecContext(ctx,
		`UPDATE mgr_honor_rank_activity SET state = ?, activity_on = 0 WHERE id = ?`,
		honorRankActivityClosed, id); err != nil {
		s.logger.Error("close honor rank activity", "error", err)
		writeError(w, http.StatusInternalServerError, "HONOR_RANK_ACTIVITY_SAVE_FAILED",
			"游戏服配置已关闭，但活动留档更新失败，请刷新核对："+err.Error())
		return
	}
	after, err := s.queryHonorRankConfig(ctx, item.ScopeType, item.ScopeID)
	if err != nil {
		after = honorRankState{Scope: item.ScopeType, TargetID: item.ScopeID, Rows: []honorRankRowState{}}
	}
	message := "已结束该排行榜活动（名次奖励与时间保留，可回看最终排名）"
	s.audit(ctx, &p, honorRankActivityCloseAudit, honorRankActivityTargetType, strconv.FormatInt(id, 10),
		map[string]any{"action": "close"}, honorRankAuditSnapshot(before, beforeErr),
		honorRankAuditSnapshot(after, nil), 0, message, clientIP(r))

	updated, loadErr := s.loadHonorRankActivity(ctx, id)
	if loadErr != nil {
		writeData(w, http.StatusOK, map[string]any{"message": message})
		return
	}
	writeData(w, http.StatusOK, map[string]any{"message": message, "activity": updated})
}

func (s *Server) handleHonorRankActivityRanking(w http.ResponseWriter, r *http.Request, _ principal) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "活动编号不正确")
		return
	}
	ctx := r.Context()
	item, err := s.loadHonorRankActivity(ctx, id)
	if err != nil {
		writeHonorRankActivityError(w, err)
		return
	}
	query := r.URL.Query()
	rankType := strings.TrimSpace(query.Get("rankType"))
	if rankType == "" {
		rankType = honorRankBoardPlay
	}
	switch rankType {
	case honorRankBoardPlay, honorRankBoardScore, honorRankBoardBonus:
	default:
		writeError(w, http.StatusBadRequest, "INVALID_RANK_TYPE", "榜单类型只能是手数、赢分或红利")
		return
	}
	dipi := ""
	if rankType == honorRankBoardPlay {
		dipi = strings.TrimSpace(query.Get("dipi"))
		if dipi == "" {
			dipi = honorRankPlayDipis[0]
		}
		valid := false
		for _, candidate := range honorRankPlayDipis {
			if candidate == dipi {
				valid = true
				break
			}
		}
		if !valid {
			writeError(w, http.StatusBadRequest, "INVALID_DIPI", "手数档位只能是 1皮/2皮/5皮/10皮/20皮")
			return
		}
	}
	page, size := pageParams(r)
	if size > honorRankRankingPageSizeMax {
		size = honorRankRankingPageSizeMax
	}

	// 榜开关关着也允许看：运营要看活动期间实际跑了多少数据。
	clubs, err := s.honorRankScopeClubs(ctx, item.ScopeType, item.ScopeID)
	if err != nil {
		s.logger.Error("read honor rank scope clubs", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取联盟/俱乐部成员范围失败")
		return
	}
	rows, unit, err := s.queryHonorRanking(ctx, clubs, item, rankType, dipi)
	if err != nil {
		s.logger.Error("query honor rank ranking", "error", err, "activityId", id, "rankType", rankType)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "查询排行榜数据失败："+err.Error())
		return
	}
	total := len(rows)
	truncated := total >= honorRankRankingMaxRows
	items := make([]honorRankRankingRow, 0, size)
	start := (page - 1) * size
	if start < total {
		end := start + size
		if end > total {
			end = total
		}
		for index := start; index < end; index++ {
			row := rows[index]
			items = append(items, honorRankRankingRow{
				Rank:     index + 1,
				PlayerID: honorRankPlayerLabel(row.PlayerID, row.CustomID),
				Name:     row.Name,
				Value:    row.Value,
				Reward:   honorRankRewardAt(item.Boards, rankType, dipi, index+1),
				Remark:   row.Remark,
			})
		}
	}
	writeData(w, http.StatusOK, honorRankRankingResponse{
		ActivityID: id,
		RankType:   rankType,
		Dipi:       dipi,
		Unit:       unit,
		StartDate:  item.StartDate + " " + item.StartTime,
		EndDate:    item.EndDate + " " + item.EndTime,
		Phase:      item.Phase,
		Total:      total,
		Page:       page,
		PageSize:   size,
		Truncated:  truncated,
		Items:      items,
		Count:      total,
	})
}
