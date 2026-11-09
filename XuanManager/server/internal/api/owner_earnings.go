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
	"time"
)

// 联盟/俱乐部收益对账（只读）。
//
// 数据口径（2026-11-09 线上核对）：
//   - 暗抽：usr_income_info 中 remark5=uniondark（联盟暗抽）或 darkroot（独立俱乐部创建者暗抽）。
//     remark1 是收益归属账号，proxy_guuid=club-<俱乐部号> 是产生该笔收益的俱乐部；
//     remark3 是分成基数（元），remark4 是设置的暗抽百分点，tax_number 是到账金额（分），
//     bonus_tax_number 是平台再从这笔红利里扣走的红利暗抽（分）。
//   - 奖池：usr_income_info2 同一账号的 remark1 记录（unionroot / clubroot 两个层级），
//     与账号红利流水 usr_activity_info_sub_hongli 的 activity_type='红利2' 逐笔一致；
//     proxy_guuid 同样能拆到产生收益的俱乐部。
//
// 联盟大盟主的收益可能来自多个俱乐部，所以接口同时给出“按俱乐部汇总”；
// 群主所在俱乐部若已入盟，暗抽/奖池归联盟大盟主，接口会明确返回收益归属人。

const (
	ownerEarningsKindDark    = "dark"
	ownerEarningsKindJackpot = "jackpot"
	ownerEarningsMaxRange    = 31
)

type ownerEarningsClubRef struct {
	ClubID    string `json:"clubId"`
	ClubName  string `json:"clubName"`
	Status    string `json:"status"`
	OwnerID   string `json:"ownerId"`
	OwnerName string `json:"ownerName"`
}

type ownerEarningsTarget struct {
	Scope         string                 `json:"scope"`
	UnionID       string                 `json:"unionId"`
	UnionName     string                 `json:"unionName"`
	ClubID        string                 `json:"clubId"`
	ClubName      string                 `json:"clubName"`
	OwnerID       string                 `json:"ownerId"`
	OwnerName     string                 `json:"ownerName"`
	OwnerRole     string                 `json:"ownerRole"`
	ClubOwnerID   string                 `json:"clubOwnerId"`
	ClubOwnerName string                 `json:"clubOwnerName"`
	Clubs         []ownerEarningsClubRef `json:"clubs"`
}

type ownerEarningsSummary struct {
	AmountFen         int64   `json:"amountFen"`
	AmountYuan        float64 `json:"amountYuan"`
	GrossFen          int64   `json:"grossFen"`
	GrossYuan         float64 `json:"grossYuan"`
	BonusTaxFen       int64   `json:"bonusTaxFen"`
	BonusTaxYuan      float64 `json:"bonusTaxYuan"`
	Count             int64   `json:"count"`
	BaseYuan          float64 `json:"baseYuan"`
	RatioPercent      float64 `json:"ratioPercent"`
	AverageYuan       float64 `json:"averageYuan"`
	UnattributedFen   int64   `json:"unattributedFen"`
	UnattributedYuan  float64 `json:"unattributedYuan"`
	UnattributedCount int64   `json:"unattributedCount"`
}

type ownerEarningsDailyItem struct {
	Date         string  `json:"date"`
	AmountFen    int64   `json:"amountFen"`
	AmountYuan   float64 `json:"amountYuan"`
	GrossYuan    float64 `json:"grossYuan"`
	BonusTaxYuan float64 `json:"bonusTaxYuan"`
	Count        int64   `json:"count"`
	BaseYuan     float64 `json:"baseYuan"`
	RatioPercent float64 `json:"ratioPercent"`
	AverageYuan  float64 `json:"averageYuan"`
}

type ownerEarningsClubItem struct {
	ClubID       string  `json:"clubId"`
	ClubName     string  `json:"clubName"`
	Status       string  `json:"status"`
	AmountFen    int64   `json:"amountFen"`
	AmountYuan   float64 `json:"amountYuan"`
	Count        int64   `json:"count"`
	BaseYuan     float64 `json:"baseYuan"`
	RatioPercent float64 `json:"ratioPercent"`
}

type ownerEarningsDetailItem struct {
	ID            string  `json:"id"`
	Date          string  `json:"date"`
	Time          string  `json:"time"`
	ClubID        string  `json:"clubId"`
	ClubName      string  `json:"clubName"`
	RoomID        string  `json:"roomId"`
	PlayerID      string  `json:"playerId"`
	PlayerName    string  `json:"playerName"`
	BaseYuan      float64 `json:"baseYuan"`
	RatePercent   float64 `json:"ratePercent"`
	ActualPercent float64 `json:"actualPercent"`
	WaterRate     float64 `json:"waterRate"`
	AmountFen     int64   `json:"amountFen"`
	AmountYuan    float64 `json:"amountYuan"`
	GrossYuan     float64 `json:"grossYuan"`
	BonusTaxYuan  float64 `json:"bonusTaxYuan"`
	Level         string  `json:"level"`
	LevelLabel    string  `json:"levelLabel"`
	TypeLabel     string  `json:"typeLabel"`
	Note          string  `json:"note"`
}

type ownerEarningsDetails struct {
	Items    []ownerEarningsDetailItem `json:"items"`
	Page     int                       `json:"page"`
	PageSize int                       `json:"pageSize"`
	Total    int64                     `json:"total"`
}

type ownerEarningsRateCount struct {
	Percent int   `json:"percent"`
	Agents  int64 `json:"agents"`
}

type ownerEarningsDarkClub struct {
	ClubID     string                   `json:"clubId"`
	ClubName   string                   `json:"clubName"`
	Status     string                   `json:"status"`
	Configured int64                    `json:"configured"`
	Unset      int64                    `json:"unset"`
	Rates      []ownerEarningsRateCount `json:"rates"`
}

type ownerEarningsDarkConfig struct {
	Configured       int64                    `json:"configured"`
	Unset            int64                    `json:"unset"`
	Rates            []ownerEarningsRateCount `json:"rates"`
	Clubs            []ownerEarningsDarkClub  `json:"clubs"`
	EffectivePercent float64                  `json:"effectivePercent"`
	Note             string                   `json:"note"`
}

type ownerEarningsRetentionItem struct {
	Key    string `json:"key"`
	Label  string `json:"label"`
	Yuan   *int64 `json:"yuan"`
	Source string `json:"source"`
}

type ownerEarningsPayoutItem struct {
	Key     string `json:"key"`
	Percent *int64 `json:"percent"`
	Source  string `json:"source"`
}

type ownerEarningsJackpotConfig struct {
	PoolKey   string                       `json:"poolKey"`
	PoolType  string                       `json:"poolType"`
	RewardOn  bool                         `json:"rewardOn"`
	Retention []ownerEarningsRetentionItem `json:"retention"`
	Payouts   []ownerEarningsPayoutItem    `json:"payouts"`
	Source    string                       `json:"source"`
	Warnings  []string                     `json:"warnings"`
}

type ownerEarningsResponse struct {
	Scope        string                      `json:"scope"`
	Kind         string                      `json:"kind"`
	Target       ownerEarningsTarget         `json:"target"`
	DateFrom     string                      `json:"dateFrom"`
	DateTo       string                      `json:"dateTo"`
	FilterClubID string                      `json:"filterClubId"`
	Summary      ownerEarningsSummary        `json:"summary"`
	Daily        []ownerEarningsDailyItem    `json:"daily"`
	Clubs        []ownerEarningsClubItem     `json:"clubs"`
	Details      ownerEarningsDetails        `json:"details"`
	Dark         *ownerEarningsDarkConfig    `json:"dark,omitempty"`
	Jackpot      *ownerEarningsJackpotConfig `json:"jackpot,omitempty"`
	Warnings     []string                    `json:"warnings"`
}

type ownerEarningsFilters struct {
	Kind     string
	DateFrom string
	DateTo   string
	ClubID   string
}

func (s *Server) handleUnionEarnings(w http.ResponseWriter, r *http.Request, _ principal) {
	unionID, err := normalizeUnionID(r.PathValue("unionId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_UNION_ID", err.Error())
		return
	}
	target, err := s.readUnionEarningsTarget(r.Context(), unionID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "UNION_NOT_FOUND", "没有找到这个联盟")
		return
	}
	if err != nil {
		s.logger.Error("read union earnings target", "error", err, "unionId", unionID)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取联盟收益归属失败")
		return
	}
	s.serveOwnerEarnings(w, r, target)
}

func (s *Server) handleClubEarnings(w http.ResponseWriter, r *http.Request, _ principal) {
	clubID, err := normalizeClubID(r.PathValue("clubId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_CLUB_ID", err.Error())
		return
	}
	target, err := s.readClubEarningsTarget(r.Context(), clubID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "CLUB_NOT_FOUND", "没有找到这个俱乐部")
		return
	}
	if err != nil {
		s.logger.Error("read club earnings target", "error", err, "clubId", clubID)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取俱乐部收益归属失败")
		return
	}
	s.serveOwnerEarnings(w, r, target)
}

func (s *Server) readUnionEarningsTarget(ctx context.Context, unionID string) (ownerEarningsTarget, error) {
	target := ownerEarningsTarget{Scope: "union", UnionID: unionID, OwnerRole: "大盟主"}
	err := s.db.QueryRowContext(ctx, `SELECT COALESCE(union_name, ''), COALESCE(owner_guuid, ''), COALESCE(owner_name, '')
FROM kbedm.club_union_info
WHERE union_id = ? AND status = 'used'
LIMIT 1`, unionID).Scan(&target.UnionName, &target.OwnerID, &target.OwnerName)
	if err != nil {
		return target, err
	}

	rows, err := s.db.QueryContext(ctx, `SELECT club_guuid, COALESCE(club_name, ''), COALESCE(club_status, '')
FROM kbedm.club_guuid_info
WHERE union_id = ? AND club_status <> 'init'
ORDER BY id`, unionID)
	if err != nil {
		return target, err
	}
	defer rows.Close()

	clubs := make([]ownerEarningsClubRef, 0, 16)
	clubIDs := make([]string, 0, 16)
	for rows.Next() {
		var club ownerEarningsClubRef
		if err := rows.Scan(&club.ClubID, &club.ClubName, &club.Status); err != nil {
			return target, err
		}
		clubs = append(clubs, club)
		clubIDs = append(clubIDs, club.ClubID)
	}
	if err := rows.Err(); err != nil {
		return target, err
	}

	owners, _, err := s.clubOwnersAndAgentCounts(ctx, clubIDs)
	if err != nil {
		s.logger.Error("read union earnings club owners", "error", err, "unionId", unionID)
	} else {
		ownerIDs := make([]string, 0, len(clubs))
		for index := range clubs {
			clubs[index].OwnerID = owners[clubs[index].ClubID]
			if clubs[index].OwnerID != "" {
				ownerIDs = append(ownerIDs, clubs[index].OwnerID)
			}
		}
		if names, nameErr := s.playerNames(ctx, ownerIDs); nameErr == nil {
			for index := range clubs {
				clubs[index].OwnerName = names[clubs[index].OwnerID]
			}
		} else {
			s.logger.Error("read union earnings club owner names", "error", nameErr, "unionId", unionID)
		}
	}
	if target.OwnerName == "" && target.OwnerID != "" {
		if names, nameErr := s.playerNames(ctx, []string{target.OwnerID}); nameErr == nil {
			target.OwnerName = names[target.OwnerID]
		}
	}
	target.Clubs = clubs
	return target, nil
}

func (s *Server) readClubEarningsTarget(ctx context.Context, clubID string) (ownerEarningsTarget, error) {
	target := ownerEarningsTarget{Scope: "club", ClubID: clubID}
	var clubStatus, unionID, unionName, unionOwner, unionOwnerName string
	err := s.db.QueryRowContext(ctx, `SELECT COALESCE(c.club_name, ''), COALESCE(c.club_status, ''), COALESCE(c.union_id, ''),
COALESCE(cu.union_name, ''), COALESCE(cu.owner_guuid, ''), COALESCE(cu.owner_name, '')
FROM kbedm.club_guuid_info c
LEFT JOIN kbedm.club_union_info cu ON cu.union_id = c.union_id AND cu.status <> 'init'
WHERE c.club_guuid = ?
LIMIT 1`, clubID).Scan(&target.ClubName, &clubStatus, &unionID, &unionName, &unionOwner, &unionOwnerName)
	if err != nil {
		return target, err
	}

	owners, _, err := s.clubOwnersAndAgentCounts(ctx, []string{clubID})
	if err != nil {
		return target, err
	}
	clubOwner := owners[clubID]
	clubOwnerName := ""
	if clubOwner != "" {
		if names, nameErr := s.playerNames(ctx, []string{clubOwner}); nameErr == nil {
			clubOwnerName = names[clubOwner]
		}
	}
	target.ClubOwnerID = clubOwner
	target.ClubOwnerName = clubOwnerName
	target.Clubs = []ownerEarningsClubRef{{
		ClubID: clubID, ClubName: target.ClubName, Status: clubStatus,
		OwnerID: clubOwner, OwnerName: clubOwnerName,
	}}

	if unionID != "" && unionOwner != "" {
		target.UnionID = unionID
		target.UnionName = unionName
		target.OwnerID = unionOwner
		target.OwnerName = unionOwnerName
		target.OwnerRole = "联盟大盟主"
		if target.OwnerName == "" {
			if names, nameErr := s.playerNames(ctx, []string{target.OwnerID}); nameErr == nil {
				target.OwnerName = names[target.OwnerID]
			}
		}
		return target, nil
	}

	target.OwnerID = clubOwner
	target.OwnerName = clubOwnerName
	target.OwnerRole = "群主"
	if target.OwnerID == "" {
		return target, errors.New("俱乐部没有找到创建者")
	}
	return target, nil
}

func (s *Server) serveOwnerEarnings(w http.ResponseWriter, r *http.Request, target ownerEarningsTarget) {
	filters, err := parseOwnerEarningsFilters(r, time.Now().In(dashboardLocation))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_FILTER", err.Error())
		return
	}
	if filters.ClubID != "" {
		if target.Scope != "union" {
			writeError(w, http.StatusBadRequest, "INVALID_FILTER", "俱乐部维度不支持再按俱乐部筛选")
			return
		}
		found := false
		for _, club := range target.Clubs {
			if club.ClubID == filters.ClubID {
				found = true
				break
			}
		}
		if !found {
			writeError(w, http.StatusBadRequest, "INVALID_FILTER", "该俱乐部不属于当前联盟")
			return
		}
	}

	allKeys, clubByProxy := ownerEarningsProxyKeys(target.Clubs)
	effectiveKeys := allKeys
	if filters.ClubID != "" {
		effectiveKeys = []string{"club-" + filters.ClubID}
	}

	response := ownerEarningsResponse{
		Scope: target.Scope, Kind: filters.Kind, Target: target,
		DateFrom: filters.DateFrom, DateTo: filters.DateTo, FilterClubID: filters.ClubID,
		Daily: []ownerEarningsDailyItem{}, Clubs: []ownerEarningsClubItem{},
		Details:  ownerEarningsDetails{Items: []ownerEarningsDetailItem{}, Page: 1, PageSize: 20},
		Warnings: []string{},
	}
	if len(effectiveKeys) == 0 {
		response.Warnings = append(response.Warnings, "该联盟还没有俱乐部，暂无可对账收益。")
		writeData(w, http.StatusOK, response)
		return
	}
	if target.OwnerID == "" {
		response.Warnings = append(response.Warnings, "没有找到收益归属账号，暂无收益可对账。")
		writeData(w, http.StatusOK, response)
		return
	}
	if filters.DateTo == dashboardDateString(time.Now().In(dashboardLocation)) {
		response.Warnings = append(response.Warnings, "今日为实时累计，日终结算完成前金额仍可能变化。")
	}
	if target.Scope == "club" && target.UnionID != "" && target.OwnerID != target.ClubOwnerID {
		response.Warnings = append(response.Warnings, "该俱乐部已入盟，暗抽/奖池收益归联盟大盟主；本页按俱乐部生成口径统计，归属以游戏服当前记录为准。")
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	db := s.gameDB
	if db == nil {
		db = s.db
	}
	source := ownerEarningsSource(filters.Kind)
	summary, daily, err := s.queryOwnerEarningsSummary(ctx, db, source, target.OwnerID, allKeys, effectiveKeys, filters)
	if err != nil {
		s.logger.Error("query owner earnings summary", "error", err, "scope", target.Scope, "kind", filters.Kind)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取收益汇总失败")
		return
	}
	response.Summary = summary
	response.Daily = daily
	if summary.UnattributedCount > 0 {
		rangeLabel := "本联盟俱乐部"
		if target.Scope != "union" {
			rangeLabel = "本俱乐部"
		}
		response.Warnings = append(response.Warnings, fmt.Sprintf(
			"另有 %d 笔、%.2f 元归属该账号但不在%s下，未计入本页。",
			summary.UnattributedCount, summary.UnattributedYuan, rangeLabel))
	}

	clubTotals, err := s.queryOwnerEarningsClubs(ctx, db, source, target.OwnerID, allKeys, filters, clubByProxy)
	if err != nil {
		s.logger.Error("query owner earnings clubs", "error", err, "scope", target.Scope, "kind", filters.Kind)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取按俱乐部收益失败")
		return
	}
	response.Clubs = clubTotals

	page, pageSize := pageParams(r)
	details, err := s.queryOwnerEarningsDetails(ctx, db, source, target.OwnerID, effectiveKeys, filters, clubByProxy, page, pageSize)
	if err != nil {
		s.logger.Error("query owner earnings details", "error", err, "scope", target.Scope, "kind", filters.Kind)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取收益明细失败")
		return
	}
	response.Details = details

	if filters.Kind == ownerEarningsKindDark {
		dark, darkWarnings := s.queryOwnerEarningsDarkConfig(ctx, db, target.Clubs, summary)
		response.Dark = dark
		response.Warnings = append(response.Warnings, darkWarnings...)
	} else {
		poolKey := target.UnionID
		poolType := "union"
		if poolKey == "" {
			poolKey = "club-" + target.ClubID
			poolType = "club"
		}
		jackpot, _ := s.readOwnerEarningsJackpotConfig(ctx, poolKey, poolType)
		response.Jackpot = jackpot
	}

	writeData(w, http.StatusOK, response)
}

type ownerEarningsQuerySource struct {
	Table      string
	NetExpr    string
	BaseExpr   string
	LevelWhere string
}

func ownerEarningsSource(kind string) ownerEarningsQuerySource {
	if kind == ownerEarningsKindJackpot {
		return ownerEarningsQuerySource{
			Table:    "kbedm.usr_income_info2 i",
			NetExpr:  "(i.tax_number - COALESCE(i.bonus_tax_number, 0))",
			BaseExpr: "0",
		}
	}
	return ownerEarningsQuerySource{
		Table:      "kbedm.usr_income_info i",
		NetExpr:    "(i.tax_number - COALESCE(i.bonus_tax_number, 0))",
		BaseExpr:   "CAST(NULLIF(TRIM(i.remark3), '') AS DECIMAL(18,2))",
		LevelWhere: " AND i.remark5 IN ('uniondark', 'darkroot')",
	}
}

func parseOwnerEarningsFilters(r *http.Request, now time.Time) (ownerEarningsFilters, error) {
	query := r.URL.Query()
	filters := ownerEarningsFilters{
		Kind:     strings.TrimSpace(query.Get("kind")),
		DateFrom: strings.TrimSpace(query.Get("dateFrom")),
		DateTo:   strings.TrimSpace(query.Get("dateTo")),
		ClubID:   strings.TrimSpace(query.Get("clubId")),
	}
	if filters.Kind == "" {
		filters.Kind = ownerEarningsKindDark
	}
	if filters.Kind != ownerEarningsKindDark && filters.Kind != ownerEarningsKindJackpot {
		return ownerEarningsFilters{}, errors.New("收益类型只能是暗抽或奖池")
	}
	if filters.ClubID != "" {
		value, err := normalizeClubID(filters.ClubID)
		if err != nil {
			return ownerEarningsFilters{}, err
		}
		filters.ClubID = value
	}
	if filters.DateFrom == "" && filters.DateTo == "" {
		filters.DateFrom = now.Format("2006-01-02")
		filters.DateTo = filters.DateFrom
	}
	if filters.DateFrom == "" {
		filters.DateFrom = filters.DateTo
	}
	if filters.DateTo == "" {
		filters.DateTo = filters.DateFrom
	}
	from, err := time.ParseInLocation("2006-01-02", filters.DateFrom, dashboardLocation)
	if err != nil {
		return ownerEarningsFilters{}, errors.New("开始日期格式必须是 YYYY-MM-DD")
	}
	to, err := time.ParseInLocation("2006-01-02", filters.DateTo, dashboardLocation)
	if err != nil {
		return ownerEarningsFilters{}, errors.New("结束日期格式必须是 YYYY-MM-DD")
	}
	if to.Before(from) {
		return ownerEarningsFilters{}, errors.New("结束日期不能早于开始日期")
	}
	if int(to.Sub(from).Hours()/24)+1 > ownerEarningsMaxRange {
		return ownerEarningsFilters{}, fmt.Errorf("单次最多查询 %d 天，请缩短日期范围", ownerEarningsMaxRange)
	}
	return filters, nil
}

func ownerEarningsProxyKeys(clubs []ownerEarningsClubRef) ([]string, map[string]ownerEarningsClubRef) {
	keys := make([]string, 0, len(clubs))
	byProxy := make(map[string]ownerEarningsClubRef, len(clubs))
	for _, club := range clubs {
		if club.ClubID == "" {
			continue
		}
		key := "club-" + club.ClubID
		keys = append(keys, key)
		byProxy[key] = club
	}
	return keys, byProxy
}

func ownerEarningsPlaceholders(count int) string {
	if count <= 0 {
		return ""
	}
	return strings.TrimRight(strings.Repeat("?,", count), ",")
}

func ownerEarningsArgs(keys []string) []any {
	args := make([]any, 0, len(keys))
	for _, key := range keys {
		args = append(args, key)
	}
	return args
}

func (s *Server) queryOwnerEarningsSummary(ctx context.Context, db *sql.DB, source ownerEarningsQuerySource,
	ownerID string, allKeys, effectiveKeys []string, filters ownerEarningsFilters) (ownerEarningsSummary, []ownerEarningsDailyItem, error) {
	var summary ownerEarningsSummary
	where, args := ownerEarningsWhere(source, ownerID, effectiveKeys, filters)
	err := db.QueryRowContext(ctx, `SELECT COUNT(*),
COALESCE(SUM(`+source.NetExpr+`), 0), COALESCE(SUM(i.tax_number), 0),
COALESCE(SUM(COALESCE(i.bonus_tax_number, 0)), 0), COALESCE(SUM(`+source.BaseExpr+`), 0)
FROM `+source.Table+` FORCE INDEX(date) WHERE `+where, args...).Scan(
		&summary.Count, &summary.AmountFen, &summary.GrossFen, &summary.BonusTaxFen, &summary.BaseYuan)
	if err != nil {
		return summary, nil, err
	}
	summary.AmountYuan = fenToYuan(summary.AmountFen)
	summary.GrossYuan = fenToYuan(summary.GrossFen)
	summary.BonusTaxYuan = fenToYuan(summary.BonusTaxFen)
	summary.BaseYuan = round2(summary.BaseYuan)
	summary.RatioPercent = ownerEarningsRatio(summary.AmountFen, summary.BaseYuan)
	if summary.Count > 0 {
		summary.AverageYuan = round2(summary.AmountYuan / float64(summary.Count))
	}

	if len(allKeys) > 0 {
		unattributedWhere, unattributedArgs := ownerEarningsBaseWhere(source, ownerID, filters)
		unattributedWhere += " AND i.proxy_guuid NOT IN (" + ownerEarningsPlaceholders(len(allKeys)) + ")"
		unattributedArgs = append(unattributedArgs, ownerEarningsArgs(allKeys)...)
		if err := db.QueryRowContext(ctx, `SELECT COUNT(*), COALESCE(SUM(`+source.NetExpr+`), 0)
FROM `+source.Table+` FORCE INDEX(date) WHERE `+unattributedWhere, unattributedArgs...).Scan(
			&summary.UnattributedCount, &summary.UnattributedFen); err != nil {
			return summary, nil, err
		}
		summary.UnattributedYuan = fenToYuan(summary.UnattributedFen)
	}

	rows, err := db.QueryContext(ctx, `SELECT i.date, COUNT(*),
COALESCE(SUM(`+source.NetExpr+`), 0), COALESCE(SUM(i.tax_number), 0),
COALESCE(SUM(COALESCE(i.bonus_tax_number, 0)), 0), COALESCE(SUM(`+source.BaseExpr+`), 0)
FROM `+source.Table+` FORCE INDEX(date) WHERE `+where+`
GROUP BY i.date ORDER BY i.date DESC`, args...)
	if err != nil {
		return summary, nil, err
	}
	defer rows.Close()

	daily := make([]ownerEarningsDailyItem, 0, ownerEarningsMaxRange)
	for rows.Next() {
		var item ownerEarningsDailyItem
		var grossFen, bonusTaxFen int64
		if err := rows.Scan(&item.Date, &item.Count, &item.AmountFen, &grossFen, &bonusTaxFen, &item.BaseYuan); err != nil {
			return summary, nil, err
		}
		item.AmountYuan = fenToYuan(item.AmountFen)
		item.GrossYuan = fenToYuan(grossFen)
		item.BonusTaxYuan = fenToYuan(bonusTaxFen)
		item.BaseYuan = round2(item.BaseYuan)
		item.RatioPercent = ownerEarningsRatio(item.AmountFen, item.BaseYuan)
		if item.Count > 0 {
			item.AverageYuan = round2(item.AmountYuan / float64(item.Count))
		}
		daily = append(daily, item)
	}
	return summary, daily, rows.Err()
}

func (s *Server) queryOwnerEarningsClubs(ctx context.Context, db *sql.DB, source ownerEarningsQuerySource,
	ownerID string, allKeys []string, filters ownerEarningsFilters,
	clubByProxy map[string]ownerEarningsClubRef) ([]ownerEarningsClubItem, error) {
	where, args := ownerEarningsWhere(source, ownerID, allKeys, filters)
	rows, err := db.QueryContext(ctx, `SELECT i.proxy_guuid, COUNT(*),
COALESCE(SUM(`+source.NetExpr+`), 0), COALESCE(SUM(`+source.BaseExpr+`), 0)
FROM `+source.Table+` FORCE INDEX(date) WHERE `+where+`
GROUP BY i.proxy_guuid`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	byProxy := make(map[string]*ownerEarningsClubItem, len(allKeys))
	for rows.Next() {
		var proxyKey string
		var amountFen int64
		var baseYuan float64
		var item ownerEarningsClubItem
		if err := rows.Scan(&proxyKey, &item.Count, &amountFen, &baseYuan); err != nil {
			return nil, err
		}
		item.ClubID = ownerEarningsClubID(proxyKey)
		item.AmountFen = amountFen
		item.AmountYuan = fenToYuan(amountFen)
		item.BaseYuan = round2(baseYuan)
		item.RatioPercent = ownerEarningsRatio(amountFen, item.BaseYuan)
		byProxy[proxyKey] = &item
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	items := byProxyOrdered(allKeys, byProxy)
	for index := range items {
		key := "club-" + items[index].ClubID
		if club, ok := clubByProxy[key]; ok {
			items[index].ClubName = club.ClubName
			items[index].Status = club.Status
		}
	}
	return items, nil
}

func byProxyOrdered(keys []string, byProxy map[string]*ownerEarningsClubItem) []ownerEarningsClubItem {
	items := make([]ownerEarningsClubItem, 0, len(keys))
	for _, key := range keys {
		if item, ok := byProxy[key]; ok {
			items = append(items, *item)
			continue
		}
		items = append(items, ownerEarningsClubItem{ClubID: ownerEarningsClubID(key)})
	}
	return items
}

func (s *Server) queryOwnerEarningsDetails(ctx context.Context, db *sql.DB, source ownerEarningsQuerySource,
	ownerID string, effectiveKeys []string, filters ownerEarningsFilters,
	clubByProxy map[string]ownerEarningsClubRef, page, pageSize int) (ownerEarningsDetails, error) {
	details := ownerEarningsDetails{Items: []ownerEarningsDetailItem{}, Page: page, PageSize: pageSize}
	where, args := ownerEarningsWhere(source, ownerID, effectiveKeys, filters)
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM `+source.Table+` FORCE INDEX(date) WHERE `+where, args...).Scan(&details.Total); err != nil {
		return details, err
	}
	queryArgs := append(append([]any{}, args...), pageSize, (page-1)*pageSize)
	rows, err := db.QueryContext(ctx, `SELECT CAST(i.id AS CHAR), i.date, i.time, i.proxy_guuid,
CAST(i.roomID AS CHAR), i.winner_guuid, i.winner_name, i.remark2, i.remark3, i.remark4, i.remark5,
`+source.NetExpr+`, i.tax_number, COALESCE(i.bonus_tax_number, 0)
FROM `+source.Table+` FORCE INDEX(date) WHERE `+where+`
ORDER BY i.date DESC, i.time DESC, i.id DESC LIMIT ? OFFSET ?`, queryArgs...)
	if err != nil {
		return details, err
	}
	defer rows.Close()

	for rows.Next() {
		var item ownerEarningsDetailItem
		var proxyKey, winnerID, winnerName, remark2, remark3, remark4, remark5 string
		var netFen, taxFen, bonusTaxFen int64
		if err := rows.Scan(&item.ID, &item.Date, &item.Time, &proxyKey, &item.RoomID,
			&winnerID, &winnerName, &remark2, &remark3, &remark4, &remark5,
			&netFen, &taxFen, &bonusTaxFen); err != nil {
			return details, err
		}
		item.ClubID = ownerEarningsClubID(proxyKey)
		if club, ok := clubByProxy[proxyKey]; ok {
			item.ClubName = club.ClubName
		} else if item.ClubID != "" {
			item.ClubName = "俱乐部 " + item.ClubID
		}
		item.PlayerID = strings.TrimSpace(winnerID)
		item.PlayerName = strings.TrimSpace(winnerName)
		item.BaseYuan = round2(parseDecimal(remark3))
		item.RatePercent = round2(parseDecimal(remark4))
		item.WaterRate = round2(ownerEarningsWaterRate(remark2))
		item.AmountFen = netFen
		item.AmountYuan = fenToYuan(netFen)
		item.GrossYuan = fenToYuan(taxFen)
		item.BonusTaxYuan = fenToYuan(bonusTaxFen)
		item.Level = strings.TrimSpace(remark5)
		item.LevelLabel = ownerEarningsLevelLabel(filters.Kind, item.Level)
		if filters.Kind == ownerEarningsKindDark {
			item.ActualPercent = ownerEarningsRatio(netFen, item.BaseYuan)
			if item.WaterRate > 0 {
				item.Note = fmt.Sprintf("房间水率 %s%%", trimNumber(item.WaterRate))
			}
		} else {
			item.Note = strings.TrimSpace(remark2)
			if item.PlayerID == "badpool" || item.PlayerName == "惩罚池" {
				item.TypeLabel = "派奖分成"
			} else {
				item.TypeLabel = "提留"
			}
		}
		if bonusTaxFen > 0 {
			if item.Note != "" {
				item.Note += "；"
			}
			item.Note += fmt.Sprintf("已扣红利暗抽 %.2f 元", fenToYuan(bonusTaxFen))
		}
		details.Items = append(details.Items, item)
	}
	return details, rows.Err()
}

func ownerEarningsBaseWhere(source ownerEarningsQuerySource, ownerID string, filters ownerEarningsFilters) (string, []any) {
	return "i.date BETWEEN ? AND ? AND i.remark1 = ?" + source.LevelWhere,
		[]any{filters.DateFrom, filters.DateTo, ownerID}
}

func ownerEarningsWhere(source ownerEarningsQuerySource, ownerID string, keys []string, filters ownerEarningsFilters) (string, []any) {
	where, args := ownerEarningsBaseWhere(source, ownerID, filters)
	if len(keys) > 0 {
		where += " AND i.proxy_guuid IN (" + ownerEarningsPlaceholders(len(keys)) + ")"
		args = append(args, ownerEarningsArgs(keys)...)
	}
	return where, args
}

func (s *Server) queryOwnerEarningsDarkConfig(ctx context.Context, db *sql.DB, clubs []ownerEarningsClubRef,
	summary ownerEarningsSummary) (*ownerEarningsDarkConfig, []string) {
	config := &ownerEarningsDarkConfig{
		Rates: []ownerEarningsRateCount{}, Clubs: []ownerEarningsDarkClub{},
		EffectivePercent: summary.RatioPercent,
		Note:             "比例为当前代理设置快照；未单独设置时按房间玩法默认暗抽执行（不是不抽），历史实际比例以明细行为准。",
	}
	warnings := []string{}
	clubIDs := make([]string, 0, len(clubs))
	for _, club := range clubs {
		if club.ClubID != "" {
			clubIDs = append(clubIDs, club.ClubID)
		}
	}
	if len(clubIDs) == 0 {
		return config, warnings
	}
	rows, err := db.QueryContext(ctx, `SELECT club_guuid, COALESCE(dark_percent, -1), COUNT(*)
FROM kbedm.club_agent_info
WHERE status = 'used' AND club_guuid IN (`+ownerEarningsPlaceholders(len(clubIDs))+`)
GROUP BY club_guuid, COALESCE(dark_percent, -1)`, ownerEarningsArgs(clubIDs)...)
	if err != nil {
		s.logger.Error("query dark percent settings", "error", err)
		warnings = append(warnings, "暗抽比例设置读取失败；收益明细不受影响。")
		return config, warnings
	}
	defer rows.Close()

	clubByID := make(map[string]ownerEarningsClubRef, len(clubs))
	for _, club := range clubs {
		clubByID[club.ClubID] = club
	}
	byClub := make(map[string]*ownerEarningsDarkClub, len(clubs))
	overall := make(map[int]int64)
	for _, club := range clubs {
		byClub[club.ClubID] = &ownerEarningsDarkClub{
			ClubID: club.ClubID, ClubName: club.ClubName, Status: club.Status,
			Rates: []ownerEarningsRateCount{},
		}
	}
	for rows.Next() {
		var clubID string
		var percent int
		var agents int64
		if err := rows.Scan(&clubID, &percent, &agents); err != nil {
			return config, append(warnings, "暗抽比例设置读取失败；收益明细不受影响。")
		}
		item := byClub[clubID]
		if item == nil {
			club := clubByID[clubID]
			item = &ownerEarningsDarkClub{ClubID: clubID, ClubName: club.ClubName, Status: club.Status, Rates: []ownerEarningsRateCount{}}
			byClub[clubID] = item
		}
		if percent < 0 {
			item.Unset += agents
			config.Unset += agents
			continue
		}
		item.Configured += agents
		item.Rates = append(item.Rates, ownerEarningsRateCount{Percent: percent, Agents: agents})
		overall[percent] += agents
		config.Configured += agents
	}
	if err := rows.Err(); err != nil {
		return config, append(warnings, "暗抽比例设置读取失败；收益明细不受影响。")
	}
	for percent, agents := range overall {
		config.Rates = append(config.Rates, ownerEarningsRateCount{Percent: percent, Agents: agents})
	}
	sortRateCounts(config.Rates)
	for index := range clubs {
		item := byClub[clubs[index].ClubID]
		if item == nil {
			continue
		}
		sortRateCounts(item.Rates)
		config.Clubs = append(config.Clubs, *item)
	}
	return config, warnings
}

func sortRateCounts(items []ownerEarningsRateCount) {
	for left := 0; left < len(items); left++ {
		for right := left + 1; right < len(items); right++ {
			if items[right].Percent < items[left].Percent {
				items[left], items[right] = items[right], items[left]
			}
		}
	}
}

func (s *Server) readOwnerEarningsJackpotConfig(ctx context.Context, poolKey, poolType string) (*ownerEarningsJackpotConfig, []string) {
	config := &ownerEarningsJackpotConfig{
		PoolKey: poolKey, PoolType: poolType,
		Retention: []ownerEarningsRetentionItem{}, Payouts: []ownerEarningsPayoutItem{},
		Source: "none", Warnings: []string{},
	}
	warnings := []string{}

	var raw []byte
	db := s.gameDB
	if db == nil {
		db = s.db
	}
	err := db.QueryRowContext(ctx, `SELECT hash_content FROM kbedm.usr_hash_info
WHERE hash_key = ? ORDER BY id DESC LIMIT 1`, "club_reward_cfg|"+poolKey).Scan(&raw)
	poolModify := map[string]int64{}
	poolBili := map[string]int64{}
	if err == nil {
		rewardOn, modify, bili, parseErr := parseOwnerEarningsPoolConfig(raw)
		if parseErr != nil {
			warnings = append(warnings, "奖池配置解析失败；提留和赔付比例可能显示不全。")
		} else {
			config.Source = "pool"
			config.RewardOn = rewardOn
			poolModify = modify
			poolBili = bili
		}
	} else if !errors.Is(err, sql.ErrNoRows) {
		s.logger.Error("read jackpot pool config", "error", err, "poolKey", poolKey)
		config.Source = "unavailable"
		warnings = append(warnings, "奖池配置读取失败；提留和赔付比例暂时无法显示。")
	} else {
		warnings = append(warnings, "该池还没有独立配置，默认关闭奖池；提留和赔付比例跟随全局。")
	}
	config.Warnings = warnings

	tiers := rewardPoolDefinitions
	if configured := rewardPoolConfiguredTierCount(); configured < len(tiers) {
		tiers = tiers[:configured]
	}

	var globalModify []int64
	if len(poolModify) < len(tiers) {
		globalCtx, cancel := context.WithTimeout(ctx, 2500*time.Millisecond)
		rawValue, fetchErr := s.fetchHallConfigurationValue(globalCtx, "reward_modify",
			gameOperationContext("earnings-reward-modify"))
		cancel()
		if fetchErr != nil {
			config.Warnings = append(config.Warnings, "全局提留读取失败；未单独配置的底皮暂时无法显示。")
		} else {
			values, parseErr := parseRewardControlCSV(rawValue, len(tiers), 0, maxRewardPlatformRetentionYuan, "reward_modify")
			if parseErr != nil {
				config.Warnings = append(config.Warnings, "全局提留格式异常；未单独配置的底皮暂时无法显示。")
			} else {
				globalModify = values
			}
		}
	}
	for index, tier := range tiers {
		item := ownerEarningsRetentionItem{Key: tier.Key, Label: tier.Label, Source: "unavailable"}
		if value, ok := poolModify[tier.Key]; ok {
			valueCopy := value
			item.Yuan = &valueCopy
			item.Source = "pool"
		} else if index < len(globalModify) {
			valueCopy := globalModify[index]
			item.Yuan = &valueCopy
			item.Source = "global"
		}
		config.Retention = append(config.Retention, item)
	}
	for _, key := range []string{"天皇", "地皇", "朵皇", "朵朵", "丁二皇"} {
		item := ownerEarningsPayoutItem{Key: key, Source: "global"}
		if value, ok := poolBili[key]; ok {
			valueCopy := value
			item.Percent = &valueCopy
			item.Source = "pool"
		}
		config.Payouts = append(config.Payouts, item)
	}
	missingPayout := false
	for _, item := range config.Payouts {
		if item.Percent == nil {
			missingPayout = true
			break
		}
	}
	if missingPayout {
		globalCtx, cancel := context.WithTimeout(ctx, 2500*time.Millisecond)
		globalBili, fetchErr := s.fetchHallConfigurationObject(globalCtx, "reward_card_bili",
			gameOperationContext("earnings-reward-card-bili"))
		cancel()
		if fetchErr != nil {
			config.Warnings = append(config.Warnings, "全局派奖比例读取失败；未单独配置的牌型显示为跟随全局。")
		} else {
			for index := range config.Payouts {
				if config.Payouts[index].Percent != nil {
					continue
				}
				if value, ok := globalBili[config.Payouts[index].Key]; ok {
					valueCopy := value
					config.Payouts[index].Percent = &valueCopy
					config.Payouts[index].Source = "global"
				}
			}
		}
	}
	return config, config.Warnings
}

// fetchHallConfigurationObject 读取大厅配置里的 JSON 对象（如 reward_card_bili）。
// 既有 fetchHallConfigurationValue 只处理字符串/布尔/数字，对象型配置需要单独解。
func (s *Server) fetchHallConfigurationObject(ctx context.Context, key, operationContext string) (map[string]int64, error) {
	result, err := s.callGameCommand(ctx, "获取_大厅_配置数据", map[string]any{
		"param_name": key,
		"context":    operationContext,
	})
	if err != nil {
		return nil, err
	}
	if result.RetCode != 512 {
		return nil, fmt.Errorf("hall configuration %s query ret_code %d", key, result.RetCode)
	}
	var payload struct {
		ParamName  string          `json:"param_name"`
		ParamValue json.RawMessage `json:"param_value"`
	}
	if err := json.Unmarshal(result.RetResult, &payload); err != nil {
		return nil, fmt.Errorf("decode hall configuration %s: %w", key, err)
	}
	if payload.ParamName != key {
		return nil, fmt.Errorf("hall configuration response mismatch: expected %s, got %s", key, payload.ParamName)
	}
	objects := make([]map[string]json.Number, 0, 2)
	var object map[string]json.Number
	if err := json.Unmarshal(payload.ParamValue, &object); err == nil {
		objects = append(objects, object)
	}
	var text string
	if err := json.Unmarshal(payload.ParamValue, &text); err == nil && strings.TrimSpace(text) != "" {
		if err := json.Unmarshal([]byte(text), &object); err == nil {
			objects = append(objects, object)
		}
	}
	if len(objects) == 0 {
		return nil, fmt.Errorf("hall configuration %s is not an object", key)
	}
	values := make(map[string]int64, len(objects[0]))
	for name, raw := range objects[0] {
		if value, ok := jsonNumberInt(raw); ok {
			values[name] = value
		}
	}
	return values, nil
}

// parseOwnerEarningsPoolConfig 解析 club_reward_cfg|<pool_key> 的 JSON。
// 缺 reward_on 时按关闭处理（与游戏服默认一致）。
func parseOwnerEarningsPoolConfig(raw []byte) (bool, map[string]int64, map[string]int64, error) {
	var parsed struct {
		RewardOn       *bool                  `json:"reward_on"`
		RewardModify   map[string]json.Number `json:"reward_modify"`
		RewardCardBili map[string]json.Number `json:"reward_card_bili"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return false, nil, nil, err
	}
	modify := make(map[string]int64, len(parsed.RewardModify))
	for key, value := range parsed.RewardModify {
		if number, ok := jsonNumberInt(value); ok {
			modify[key] = number
		}
	}
	bili := make(map[string]int64, len(parsed.RewardCardBili))
	for key, value := range parsed.RewardCardBili {
		if number, ok := jsonNumberInt(value); ok {
			bili[key] = number
		}
	}
	return parsed.RewardOn != nil && *parsed.RewardOn, modify, bili, nil
}

func jsonNumberInt(value json.Number) (int64, bool) {
	if value == "" {
		return 0, false
	}
	if number, err := value.Int64(); err == nil {
		return number, true
	}
	number, err := value.Float64()
	if err != nil {
		return 0, false
	}
	return int64(math.Round(number)), true
}

func ownerEarningsRatio(amountFen int64, baseYuan float64) float64 {
	if amountFen == 0 || baseYuan <= 0 {
		return 0
	}
	// 金额是分、基数是元：amountFen/baseYuan 正好得到百分比数值。
	return round2(float64(amountFen) / baseYuan)
}

func ownerEarningsWaterRate(remark2 string) float64 {
	parts := strings.SplitN(strings.TrimSpace(remark2), "-", 2)
	if len(parts) != 2 {
		return 0
	}
	return parseDecimal(parts[0])
}

func ownerEarningsClubID(proxyKey string) string {
	key := strings.TrimSpace(proxyKey)
	if strings.HasPrefix(key, "club-") {
		return strings.TrimPrefix(key, "club-")
	}
	return ""
}

func ownerEarningsLevelLabel(kind, level string) string {
	if kind == ownerEarningsKindJackpot {
		switch level {
		case "unionroot":
			return "联盟层奖池"
		case "clubroot":
			return "俱乐部层奖池"
		case "poolroot":
			return "独立俱乐部奖池"
		}
		return level
	}
	switch level {
	case "uniondark":
		return "联盟暗抽"
	case "darkroot":
		return "创建者暗抽"
	}
	return level
}

func parseDecimal(raw string) float64 {
	value, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil {
		return 0
	}
	return value
}

func fenToYuan(fen int64) float64 {
	return round2(float64(fen) / 100)
}

func trimNumber(value float64) string {
	return strconv.FormatFloat(value, 'f', -1, 64)
}

func dashboardDateString(value time.Time) string {
	return value.In(dashboardLocation).Format("2006-01-02")
}
