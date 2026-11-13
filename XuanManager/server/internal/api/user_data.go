package api

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// 用户端数据查询（只读）。
//
// 按游戏用户ID汇总客户端「我的」里能看到的五类明细：
//   - 上下分记录：club_history_info.opt_type='添加积分'（客户端的 AddMemberGoldList 口径）
//   - 赠送金币：club_history_info.opt_type='积分赠送'/'积分受赠'
//   - 金币流向：usr_cash_water.money_type='gold'
//   - 钻石流向：usr_cash_water.money_type='stone'
//   - 收益红利：usr_income_info.remark1=归属账号（客户端 ClubBonusList 口径，排除 clubtotal 对账基线）
//
// 客户端这些页都只取最近 8 天；后台默认最近 7 天，可手动改日期，单次最多 31 天。

const userDataMaxRange = 31

const (
	userDataKindClub  = "club"
	userDataKindGift  = "gift"
	userDataKindGold  = "gold"
	userDataKindStone = "stone"
	userDataKindBonus = "bonus"
)

type userDataClub struct {
	ClubID   string `json:"clubId"`
	ClubName string `json:"clubName"`
	Role     string `json:"role"`
}

type userDataProfile struct {
	PlayerID       string         `json:"playerId"`
	LoginName      string         `json:"loginName"`
	Name           string         `json:"name"`
	Gold           float64        `json:"gold"`
	Stone          int64          `json:"stone"`
	UnclaimedBonus float64        `json:"unclaimedBonus"`
	Clubs          []userDataClub `json:"clubs"`
}

type userDataRecord struct {
	ID             int64   `json:"id"`
	Kind           string  `json:"kind"`
	OccurredAt     string  `json:"occurredAt"`
	Type           string  `json:"type"`
	TypeLabel      string  `json:"typeLabel"`
	Amount         float64 `json:"amount"`
	Before         float64 `json:"before"`
	Balance        float64 `json:"balance"`
	Unit           string  `json:"unit"`
	PlayerID       string  `json:"playerId"`
	PlayerName     string  `json:"playerName"`
	Counterparty   string  `json:"counterparty"`
	CounterpartyID string  `json:"counterpartyId"`
	ClubID         string  `json:"clubId"`
	ClubName       string  `json:"clubName"`
	RoomID         string  `json:"roomId"`
	Level          string  `json:"level"`
	LevelLabel     string  `json:"levelLabel"`
	Contrib        float64 `json:"contrib"`
	Bonus          float64 `json:"bonus"`
	Remark         string  `json:"remark"`
	Remark1        string  `json:"remark1"`
	Remark2        string  `json:"remark2"`
	Remark3        string  `json:"remark3"`
	Remark4        string  `json:"remark4"`
	Remark5        string  `json:"remark5"`
}

type userDataSummary struct {
	Count          int64   `json:"count"`
	TotalIn        float64 `json:"totalIn"`
	TotalOut       float64 `json:"totalOut"`
	Net            float64 `json:"net"`
	ContribTotal   float64 `json:"contribTotal"`
	BonusTotal     float64 `json:"bonusTotal"`
	TodayBonus     float64 `json:"todayBonus"`
	YesterdayBonus float64 `json:"yesterdayBonus"`
	ExtractedBonus float64 `json:"extractedBonus"`
	UnclaimedBonus float64 `json:"unclaimedBonus"`
}

type userDataRecordsResponse struct {
	Items    []userDataRecord `json:"items"`
	Page     int              `json:"page"`
	PageSize int              `json:"pageSize"`
	Total    int64            `json:"total"`
	Summary  userDataSummary  `json:"summary"`
}

type userDataFilters struct {
	PlayerID string
	Kind     string
	From     string
	To       string
	Keyword  string
	Page     int
	PageSize int
}

func (s *Server) handleUserDataProfile(w http.ResponseWriter, r *http.Request, _ principal) {
	playerID := strings.TrimSpace(r.URL.Query().Get("playerId"))
	if !validGameID(playerID) {
		writeError(w, http.StatusBadRequest, "INVALID_PLAYER_ID", "请输入正确的游戏用户ID")
		return
	}
	profile, err := s.readUserDataProfile(r.Context(), playerID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "PLAYER_NOT_FOUND", "没有找到这个游戏用户ID")
		return
	}
	if err != nil {
		s.logger.Error("read user data profile", "playerId", playerID, "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取玩家信息失败")
		return
	}
	writeData(w, http.StatusOK, profile)
}

func (s *Server) handleUserDataRecords(w http.ResponseWriter, r *http.Request, _ principal) {
	filters, err := parseUserDataFilters(r, time.Now().In(dashboardLocation))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_FILTER", err.Error())
		return
	}
	if _, err := s.readUserDataProfile(r.Context(), filters.PlayerID); errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "PLAYER_NOT_FOUND", "没有找到这个游戏用户ID")
		return
	} else if err != nil {
		s.logger.Error("read user data profile before records", "playerId", filters.PlayerID, "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取玩家信息失败")
		return
	}

	var response userDataRecordsResponse
	switch filters.Kind {
	case userDataKindGold, userDataKindStone:
		response, err = s.queryUserDataCashWater(r.Context(), filters)
	case userDataKindClub, userDataKindGift:
		response, err = s.queryUserDataClubHistory(r.Context(), filters)
	case userDataKindBonus:
		response, err = s.queryUserDataBonus(r.Context(), filters)
	default:
		err = errors.New("明细类型不正确")
	}
	if err != nil {
		s.logger.Error("query user data records", "playerId", filters.PlayerID, "kind", filters.Kind, "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取明细失败")
		return
	}
	writeData(w, http.StatusOK, response)
}

func parseUserDataFilters(r *http.Request, now time.Time) (userDataFilters, error) {
	query := r.URL.Query()
	filters := userDataFilters{
		PlayerID: strings.TrimSpace(query.Get("playerId")),
		Kind:     strings.TrimSpace(query.Get("kind")),
		From:     strings.TrimSpace(query.Get("dateFrom")),
		To:       strings.TrimSpace(query.Get("dateTo")),
		Keyword:  strings.TrimSpace(query.Get("keyword")),
	}
	if !validGameID(filters.PlayerID) {
		return userDataFilters{}, errors.New("请输入正确的游戏用户ID")
	}
	switch filters.Kind {
	case userDataKindClub, userDataKindGift, userDataKindGold, userDataKindStone, userDataKindBonus:
	default:
		return userDataFilters{}, errors.New("明细类型不正确")
	}
	if len([]rune(filters.Keyword)) > 100 {
		return userDataFilters{}, errors.New("查询文字不能超过 100 个字符")
	}
	if filters.From == "" && filters.To == "" {
		filters.From = now.AddDate(0, 0, -6).Format("2006-01-02")
		filters.To = now.Format("2006-01-02")
	}
	if filters.From == "" {
		filters.From = filters.To
	}
	if filters.To == "" {
		filters.To = filters.From
	}
	from, err := time.ParseInLocation("2006-01-02", filters.From, dashboardLocation)
	if err != nil {
		return userDataFilters{}, errors.New("开始日期格式必须是 YYYY-MM-DD")
	}
	to, err := time.ParseInLocation("2006-01-02", filters.To, dashboardLocation)
	if err != nil {
		return userDataFilters{}, errors.New("结束日期格式必须是 YYYY-MM-DD")
	}
	if to.Before(from) {
		return userDataFilters{}, errors.New("结束日期不能早于开始日期")
	}
	if int(to.Sub(from).Hours()/24)+1 > userDataMaxRange {
		return userDataFilters{}, fmt.Errorf("单次最多查询 %d 天，请缩短日期范围", userDataMaxRange)
	}
	filters.Page, filters.PageSize = pageParams(r)
	return filters, nil
}

func (s *Server) readUserDataProfile(ctx context.Context, playerID string) (userDataProfile, error) {
	var profile userDataProfile
	var clubMake, clubMake2, clubJoin, clubJoin2, clubManage string
	var hongliRaw int64
	err := s.db.QueryRowContext(ctx, `SELECT sm_guuid, COALESCE(sm_wxID, ''), COALESCE(sm_name, ''),
COALESCE(sm_gold, 0) + COALESCE(sm_gold2, 0) / 100.0,
COALESCE(sm_stone, 0), COALESCE(sm_hongli, 0),
COALESCE(sm_club_make, ''), COALESCE(sm_club_make2, ''),
COALESCE(sm_club_join, ''), COALESCE(sm_club_join2, ''),
COALESCE(sm_club_manage, '')
FROM kbedm.tbl_Account WHERE sm_guuid = ? LIMIT 1`, playerID).Scan(
		&profile.PlayerID, &profile.LoginName, &profile.Name, &profile.Gold,
		&profile.Stone, &hongliRaw, &clubMake, &clubMake2, &clubJoin, &clubJoin2, &clubManage,
	)
	if err != nil {
		return userDataProfile{}, err
	}
	profile.UnclaimedBonus = float64(hongliRaw) / 100
	profile.Clubs = s.readUserDataClubs(ctx, clubMake, clubMake2, clubJoin, clubJoin2, clubManage)
	return profile, nil
}

func (s *Server) readUserDataClubs(ctx context.Context, clubMake, clubMake2, clubJoin, clubJoin2, clubManage string) []userDataClub {
	makeIDs := toStringSet(clubMake, clubMake2)
	manageIDs := toStringSet(clubManage)
	joinIDs := toStringSet(clubJoin, clubJoin2)
	allIDs := clubIDsFromMembershipColumns(clubMake, clubMake2, clubJoin, clubJoin2, clubManage)
	if len(allIDs) == 0 {
		return []userDataClub{}
	}
	metas, err := s.readActiveClubMeta(ctx, allIDs)
	if err != nil {
		if s.logger != nil {
			s.logger.Warn("read user club names", "error", err)
		}
		metas = map[string]clubMeta{}
	}
	clubs := make([]userDataClub, 0, len(allIDs))
	for _, clubID := range allIDs {
		role := "成员"
		if makeIDs[clubID] {
			role = "群主"
		} else if manageIDs[clubID] {
			role = "管理员"
		} else if !joinIDs[clubID] {
			continue
		}
		clubs = append(clubs, userDataClub{ClubID: clubID, ClubName: metas[clubID].Name, Role: role})
	}
	return clubs
}

func toStringSet(values ...string) map[string]bool {
	result := map[string]bool{}
	for _, value := range values {
		for _, raw := range strings.Split(value, ",") {
			if id := strings.TrimSpace(raw); id != "" {
				result[id] = true
			}
		}
	}
	return result
}

func (s *Server) queryUserDataCashWater(ctx context.Context, filters userDataFilters) (userDataRecordsResponse, error) {
	where := []string{"w.user_guuid = ?", "w.money_type = ?", "COALESCE(w.add_money, 0) <> 0", "w.date >= ?", "w.date < ?"}
	args := []any{filters.PlayerID, filters.Kind, filters.From, nextDate(filters.To)}
	if clause, clauseArgs := userDataLikeClause(filters.Keyword,
		"w.option_type", "w.remark1", "w.remark2", "w.remark3", "w.remark4", "w.remark5", "w.user_name"); clause != "" {
		where = append(where, clause)
		args = append(args, clauseArgs...)
	}
	whereSQL := strings.Join(where, " AND ")

	var response userDataRecordsResponse
	deltaExpr := "ROUND(COALESCE(w.new_money, 0) - COALESCE(w.old_money, 0), 2)"
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*),
COALESCE(SUM(CASE WHEN `+deltaExpr+` > 0 THEN `+deltaExpr+` ELSE 0 END), 0),
COALESCE(ABS(SUM(CASE WHEN `+deltaExpr+` < 0 THEN `+deltaExpr+` ELSE 0 END)), 0),
COALESCE(SUM(`+deltaExpr+`), 0)
FROM kbedm.usr_cash_water w WHERE `+whereSQL, args...).Scan(
		&response.Summary.Count, &response.Summary.TotalIn, &response.Summary.TotalOut, &response.Summary.Net,
	); err != nil {
		return userDataRecordsResponse{}, err
	}

	queryArgs := append(append([]any{}, args...), filters.PageSize, (filters.Page-1)*filters.PageSize)
	rows, err := s.db.QueryContext(ctx, `SELECT w.id, CONCAT(w.date, ' ', COALESCE(w.time, '00:00:00')), COALESCE(w.option_type, ''),
COALESCE(w.old_money, 0), COALESCE(w.add_money, 0), COALESCE(w.new_money, 0), `+deltaExpr+`,
COALESCE(w.remark1, ''), COALESCE(w.remark2, ''), COALESCE(w.remark3, ''), COALESCE(w.remark4, ''), COALESCE(w.remark5, ''),
COALESCE(w.user_guuid, ''), COALESCE(w.user_name, '')
FROM kbedm.usr_cash_water w WHERE `+whereSQL+`
ORDER BY w.date DESC, w.time DESC, w.id DESC
LIMIT ? OFFSET ?`, queryArgs...)
	if err != nil {
		return userDataRecordsResponse{}, err
	}
	defer rows.Close()

	response.Items = make([]userDataRecord, 0, filters.PageSize)
	response.Page = filters.Page
	response.PageSize = filters.PageSize
	response.Total = response.Summary.Count
	unit := "元"
	if filters.Kind == userDataKindStone {
		unit = "钻"
	}
	for rows.Next() {
		var item userDataRecord
		item.Kind = filters.Kind
		item.Unit = unit
		if err := rows.Scan(&item.ID, &item.OccurredAt, &item.Type,
			&item.Before, &item.Amount, &item.Balance, &item.Amount,
			&item.Remark1, &item.Remark2, &item.Remark3, &item.Remark4, &item.Remark5,
			&item.PlayerID, &item.PlayerName); err != nil {
			return userDataRecordsResponse{}, err
		}
		item.TypeLabel = item.Type
		item.RoomID = strings.TrimSpace(item.Remark1)
		item.Remark = strings.TrimSpace(strings.Join(nonEmpty(item.Remark2, item.Remark3, item.Remark4, item.Remark5), " · "))
		if filters.Kind == userDataKindStone {
			if item.Remark4 != "" {
				item.TypeLabel = item.Remark4
			}
			item.Remark = strings.TrimSpace(item.Remark5)
		}
		response.Items = append(response.Items, item)
	}
	return response, rows.Err()
}

func (s *Server) queryUserDataClubHistory(ctx context.Context, filters userDataFilters) (userDataRecordsResponse, error) {
	where := []string{"h.user_guuid = ?", "h.date >= ?", "h.date < ?"}
	args := []any{filters.PlayerID, filters.From, nextDate(filters.To)}
	if filters.Kind == userDataKindGift {
		where = append(where, "h.opt_type IN (?, ?)")
		args = append(args, "积分赠送", "积分受赠")
	} else {
		where = append(where, "h.opt_type = ?")
		args = append(args, "添加积分")
	}
	if clause, clauseArgs := userDataLikeClause(filters.Keyword,
		"h.opt_type", "h.remark", "h.room_id", "h.user_name", "h.opter_name", "h.club_guuid"); clause != "" {
		where = append(where, clause)
		args = append(args, clauseArgs...)
	}
	whereSQL := strings.Join(where, " AND ")

	var response userDataRecordsResponse
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*),
COALESCE(SUM(CASE WHEN COALESCE(h.user_gold, 0) > 0 THEN h.user_gold ELSE 0 END), 0),
COALESCE(ABS(SUM(CASE WHEN COALESCE(h.user_gold, 0) < 0 THEN h.user_gold ELSE 0 END)), 0),
COALESCE(SUM(COALESCE(h.user_gold, 0)), 0)
FROM kbedm.club_history_info h WHERE `+whereSQL, args...).Scan(
		&response.Summary.Count, &response.Summary.TotalIn, &response.Summary.TotalOut, &response.Summary.Net,
	); err != nil {
		return userDataRecordsResponse{}, err
	}

	queryArgs := append(append([]any{}, args...), filters.PageSize, (filters.Page-1)*filters.PageSize)
	rows, err := s.db.QueryContext(ctx, `SELECT h.id, `+s.userDataClubHistoryTimeExpr(ctx)+`, COALESCE(h.opt_type, ''),
COALESCE(h.user_gold, 0), COALESCE(h.remark, ''), COALESCE(h.room_id, ''),
COALESCE(h.user_guuid, ''), COALESCE(h.user_name, ''),
COALESCE(h.opter_guuid, ''), COALESCE(h.opter_name, ''), COALESCE(h.club_guuid, '')
FROM kbedm.club_history_info h WHERE `+whereSQL+`
ORDER BY h.date DESC, h.id DESC
LIMIT ? OFFSET ?`, queryArgs...)
	if err != nil {
		return userDataRecordsResponse{}, err
	}
	defer rows.Close()

	response.Items = make([]userDataRecord, 0, filters.PageSize)
	response.Page = filters.Page
	response.PageSize = filters.PageSize
	response.Total = response.Summary.Count
	clubIDs := make([]string, 0, len(response.Items))
	for rows.Next() {
		var item userDataRecord
		var balanceRaw string
		item.Kind = filters.Kind
		item.Unit = "元"
		if err := rows.Scan(&item.ID, &item.OccurredAt, &item.Type,
			&item.Amount, &balanceRaw, &item.RoomID,
			&item.PlayerID, &item.PlayerName, &item.CounterpartyID, &item.Counterparty, &item.ClubID); err != nil {
			return userDataRecordsResponse{}, err
		}
		item.Balance, _ = parseTrailingFloat(balanceRaw)
		item.Remark = strings.TrimSpace(balanceRaw)
		switch item.Type {
		case "添加积分":
			if item.Amount < 0 {
				item.TypeLabel = "下分"
			} else {
				item.TypeLabel = "上分"
			}
		case "积分赠送":
			item.TypeLabel = "送出积分"
		case "积分受赠":
			item.TypeLabel = "收到积分"
		default:
			item.TypeLabel = item.Type
		}
		if item.ClubID != "" {
			clubIDs = append(clubIDs, item.ClubID)
		}
		response.Items = append(response.Items, item)
	}
	if err := rows.Err(); err != nil {
		return userDataRecordsResponse{}, err
	}
	s.attachUserDataClubNames(ctx, response.Items, clubIDs)
	return response, nil
}

func (s *Server) queryUserDataBonus(ctx context.Context, filters userDataFilters) (userDataRecordsResponse, error) {
	where := []string{"i.remark1 = ?", "COALESCE(i.remark5, '') <> 'clubtotal'", "i.date >= ?", "i.date < ?"}
	args := []any{filters.PlayerID, filters.From, nextDate(filters.To)}
	if clause, clauseArgs := userDataLikeClause(filters.Keyword,
		"i.remark2", "i.remark3", "i.remark4", "i.remark5", "i.winner_name", "i.proxy_guuid"); clause != "" {
		where = append(where, clause)
		args = append(args, clauseArgs...)
	}
	whereSQL := strings.Join(where, " AND ")

	var response userDataRecordsResponse
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*),
COALESCE(SUM(COALESCE(i.tax_number, 0)), 0),
COALESCE(SUM(COALESCE(i.tax_number, 0) - COALESCE(i.bonus_tax_number, 0)), 0)
FROM kbedm.usr_income_info i WHERE `+whereSQL, args...).Scan(
		&response.Summary.Count, &response.Summary.ContribTotal, &response.Summary.BonusTotal,
	); err != nil {
		return userDataRecordsResponse{}, err
	}
	response.Summary.ContribTotal /= 100
	response.Summary.BonusTotal /= 100

	queryArgs := append(append([]any{}, args...), filters.PageSize, (filters.Page-1)*filters.PageSize)
	rows, err := s.db.QueryContext(ctx, `SELECT i.id, CONCAT(i.date, ' ', COALESCE(i.time, '00:00:00')),
COALESCE(i.tax_number, 0), COALESCE(i.bonus_tax_number, 0),
COALESCE(i.remark1, ''), COALESCE(i.winner_guuid, ''), COALESCE(i.winner_name, ''),
COALESCE(CAST(i.roomID AS CHAR), ''), COALESCE(i.remark5, ''), COALESCE(i.proxy_guuid, ''),
COALESCE(i.remark2, ''), COALESCE(i.remark3, ''), COALESCE(i.remark4, '')
FROM kbedm.usr_income_info i WHERE `+whereSQL+`
ORDER BY i.date DESC, i.time DESC, i.id DESC
LIMIT ? OFFSET ?`, queryArgs...)
	if err != nil {
		return userDataRecordsResponse{}, err
	}
	defer rows.Close()

	response.Items = make([]userDataRecord, 0, filters.PageSize)
	response.Page = filters.Page
	response.PageSize = filters.PageSize
	response.Total = response.Summary.Count
	clubIDs := make([]string, 0, len(response.Items))
	for rows.Next() {
		var item userDataRecord
		var contribRaw, taxRaw int64
		item.Kind = userDataKindBonus
		item.Unit = "元"
		if err := rows.Scan(&item.ID, &item.OccurredAt, &contribRaw, &taxRaw,
			&item.PlayerID, &item.CounterpartyID, &item.Counterparty, &item.RoomID,
			&item.Level, &item.ClubID, &item.Remark2, &item.Remark3, &item.Remark4); err != nil {
			return userDataRecordsResponse{}, err
		}
		item.Contrib = float64(contribRaw) / 100
		item.Bonus = float64(contribRaw-taxRaw) / 100
		item.Amount = item.Bonus
		item.Balance = item.Bonus
		item.Type = item.Level
		item.TypeLabel = userDataBonusLevelLabel(item.Level)
		item.LevelLabel = item.TypeLabel
		item.Remark = strings.TrimSpace(strings.Join(nonEmpty(item.Remark2, item.Remark3, item.Remark4), " · "))
		item.ClubID = userDataClubIDFromProxy(item.ClubID)
		if item.ClubID != "" {
			clubIDs = append(clubIDs, item.ClubID)
		}
		response.Items = append(response.Items, item)
	}
	if err := rows.Err(); err != nil {
		return userDataRecordsResponse{}, err
	}
	s.attachUserDataClubNames(ctx, response.Items, clubIDs)

	response.Summary.UnclaimedBonus, response.Summary.TodayBonus, response.Summary.YesterdayBonus, response.Summary.ExtractedBonus, err =
		s.readUserDataBonusStats(ctx, filters.PlayerID)
	if err != nil {
		return userDataRecordsResponse{}, err
	}
	return response, nil
}

func (s *Server) readUserDataBonusStats(ctx context.Context, playerID string) (unclaimed, today, yesterday, extracted float64, err error) {
	var unclaimedRaw, extractedRaw, todayRaw, yesterdayRaw int64
	if err = s.db.QueryRowContext(ctx, `SELECT COALESCE(sm_hongli, 0) FROM kbedm.tbl_Account WHERE sm_guuid = ?`, playerID).Scan(&unclaimedRaw); err != nil {
		return
	}
	now := time.Now().In(dashboardLocation)
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, dashboardLocation)
	tomorrowStart := todayStart.AddDate(0, 0, 1)
	yesterdayStart := todayStart.AddDate(0, 0, -1)
	if err = s.db.QueryRowContext(ctx, `SELECT
COALESCE(SUM(CASE WHEN i.date >= ? AND i.date < ? THEN COALESCE(i.tax_number, 0) - COALESCE(i.bonus_tax_number, 0) ELSE 0 END), 0),
COALESCE(SUM(CASE WHEN i.date >= ? AND i.date < ? THEN COALESCE(i.tax_number, 0) - COALESCE(i.bonus_tax_number, 0) ELSE 0 END), 0)
FROM kbedm.usr_income_info i
WHERE i.remark1 = ? AND COALESCE(i.remark5, '') <> 'clubtotal'`,
		todayStart.Format("2006-01-02 15:04:05"), tomorrowStart.Format("2006-01-02 15:04:05"),
		yesterdayStart.Format("2006-01-02 15:04:05"), todayStart.Format("2006-01-02 15:04:05"),
		playerID).Scan(&todayRaw, &yesterdayRaw); err != nil {
		return
	}
	if err = s.db.QueryRowContext(ctx, `SELECT COALESCE(SUM(ABS(activity_int)), 0)
FROM kbedm.usr_activity_info_sub_hongli
WHERE user_guuid = ? AND (activity_int < 0 OR activity_type LIKE '%提取%')`, playerID).Scan(&extractedRaw); err != nil {
		return
	}
	unclaimed = float64(unclaimedRaw) / 100
	extracted = float64(extractedRaw) / 100
	today = float64(todayRaw) / 100
	yesterday = float64(yesterdayRaw) / 100
	return
}

func (s *Server) attachUserDataClubNames(ctx context.Context, items []userDataRecord, clubIDs []string) {
	if len(items) == 0 || len(clubIDs) == 0 {
		return
	}
	unique := make([]string, 0, len(clubIDs))
	seen := map[string]bool{}
	for _, clubID := range clubIDs {
		if clubID != "" && !seen[clubID] {
			seen[clubID] = true
			unique = append(unique, clubID)
		}
	}
	if len(unique) == 0 {
		return
	}
	metas, err := s.readActiveClubMeta(ctx, unique)
	if err != nil {
		if s.logger != nil {
			s.logger.Warn("read user data club names", "error", err)
		}
		return
	}
	for index := range items {
		if meta, ok := metas[items[index].ClubID]; ok {
			items[index].ClubName = meta.Name
		}
	}
}

func userDataLikeClause(keyword string, columns ...string) (string, []any) {
	keyword = strings.TrimSpace(keyword)
	if keyword == "" || len(columns) == 0 {
		return "", nil
	}
	like := "%" + keyword + "%"
	parts := make([]string, 0, len(columns))
	args := make([]any, 0, len(columns))
	for _, column := range columns {
		parts = append(parts, column+" LIKE ?")
		args = append(args, like)
	}
	return "(" + strings.Join(parts, " OR ") + ")", args
}

func nextDate(value string) string {
	day, err := time.ParseInLocation("2006-01-02", value, dashboardLocation)
	if err != nil {
		return value
	}
	return day.AddDate(0, 0, 1).Format("2006-01-02")
}

func parseTrailingFloat(value string) (float64, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, false
	}
	if index := strings.LastIndex(value, "→"); index >= 0 {
		value = strings.TrimSpace(value[index+len("→"):])
	}
	number, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return 0, false
	}
	return number, true
}

func userDataClubIDFromProxy(value string) string {
	value = strings.TrimSpace(value)
	if !strings.HasPrefix(value, "club-") {
		return ""
	}
	value = strings.TrimPrefix(value, "club-")
	if !validGameID(value) {
		return ""
	}
	return value
}

// userDataClubHistoryTimeExpr 兼容两种历史表布局：
// 老表 date 是 DATETIME；若 date 只是 DATE 且另有 time 列，就拼成完整时间。
func (s *Server) userDataClubHistoryTimeExpr(ctx context.Context) string {
	s.clubHistoryTimeMu.Lock()
	defer s.clubHistoryTimeMu.Unlock()
	if s.clubHistoryTimeChecked {
		return s.clubHistoryTimeExpr
	}
	expr := "DATE_FORMAT(h.date, '%Y-%m-%d %H:%i:%s')"
	rows, err := s.db.QueryContext(ctx, `SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'kbedm' AND table_name = 'club_history_info' AND column_name IN ('date', 'time')`)
	if err == nil {
		hasTime := false
		dateType := ""
		for rows.Next() {
			var name, dataType string
			if rows.Scan(&name, &dataType) != nil {
				continue
			}
			switch strings.ToLower(name) {
			case "time":
				hasTime = true
			case "date":
				dateType = strings.ToLower(dataType)
			}
		}
		_ = rows.Close()
		if hasTime && (dateType == "date" || dateType == "") {
			expr = "CONCAT(DATE_FORMAT(h.date, '%Y-%m-%d'), ' ', IFNULL(TIME_FORMAT(h.time, '%H:%i:%s'), '00:00:00'))"
		}
	}
	s.clubHistoryTimeExpr = expr
	s.clubHistoryTimeChecked = true
	return expr
}

func userDataBonusLevelLabel(level string) string {
	switch level {
	case "", "clubtotal":
		return "普通红利"
	case "clubroot":
		return "俱乐部创建者"
	case "unionroot":
		return "联盟上缴"
	case "darkroot":
		return "创建者暗抽"
	case "uniondark":
		return "联盟暗抽"
	}
	if strings.HasPrefix(level, "club") {
		if depth, err := strconv.Atoi(strings.TrimPrefix(level, "club")); err == nil && depth >= 2 {
			return fmt.Sprintf("%d级代理", depth)
		}
	}
	return level
}

func nonEmpty(values ...string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			result = append(result, value)
		}
	}
	return result
}
