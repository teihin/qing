package api

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

const (
	platformRevenueMaxRangeDays = 31
	platformRevenueQueryTimeout = 4 * time.Second
	platformRevenueModuleID     = int64(36)
	platformRevenuePermissionID = int64(3601)
)

type platformRevenueCents struct {
	NormalWater            int64
	NormalProxyPayout      int64
	RewardDiscount         int64
	RewardProxyPayout      int64
	RewardProxyPool        int64
	LotteryPoolTransfer    int64
	PlayerConsumption      int64
	WithdrawalFee          int64
	NormalEventCount       int64
	RewardDiscountCount    int64
	RewardProxyCount       int64
	PlayerConsumptionCount int64
	WithdrawalFeeCount     int64
}

type platformRevenueMetrics struct {
	NormalWater            float64 `json:"normalWater"`
	NormalProxyPayout      float64 `json:"normalProxyPayout"`
	RewardDiscount         float64 `json:"rewardDiscount"`
	RewardProxyPayout      float64 `json:"rewardProxyPayout"`
	RewardProxyPool        float64 `json:"rewardProxyPool"`
	LotteryPoolTransfer    float64 `json:"lotteryPoolTransfer"`
	PlayerConsumption      float64 `json:"playerConsumption"`
	WithdrawalFee          float64 `json:"withdrawalFee"`
	GrossInflow            float64 `json:"grossInflow"`
	ProxyPayout            float64 `json:"proxyPayout"`
	TotalExpense           float64 `json:"totalExpense"`
	NetRevenue             float64 `json:"netRevenue"`
	NormalEventCount       int64   `json:"normalEventCount"`
	RewardDiscountCount    int64   `json:"rewardDiscountCount"`
	RewardProxyCount       int64   `json:"rewardProxyCount"`
	PlayerConsumptionCount int64   `json:"playerConsumptionCount"`
	WithdrawalFeeCount     int64   `json:"withdrawalFeeCount"`
}

type platformRevenuePeriod struct {
	Label    string                 `json:"label"`
	DateFrom string                 `json:"dateFrom"`
	DateTo   string                 `json:"dateTo"`
	Complete bool                   `json:"complete"`
	Metrics  platformRevenueMetrics `json:"metrics"`
}

type platformRevenueCacheInfo struct {
	SourceFrom      string `json:"sourceFrom"`
	SyncedFrom      string `json:"syncedFrom"`
	SyncedTo        string `json:"syncedTo"`
	RefreshedAt     string `json:"refreshedAt"`
	HistoryComplete bool   `json:"historyComplete"`
	MonthComplete   bool   `json:"monthComplete"`
}

type platformRevenueSummaryResponse struct {
	Today    platformRevenuePeriod    `json:"today"`
	Month    platformRevenuePeriod    `json:"month"`
	Total    platformRevenuePeriod    `json:"total"`
	Cache    platformRevenueCacheInfo `json:"cache"`
	Unit     string                   `json:"unit"`
	Formula  string                   `json:"formula"`
	Warnings []string                 `json:"warnings"`
}

type platformRevenueDailyItem struct {
	Date    string                 `json:"date"`
	Metrics platformRevenueMetrics `json:"metrics"`
}

type platformRevenueDetailItem struct {
	ID                  string  `json:"id"`
	SourceType          string  `json:"sourceType"`
	Date                string  `json:"date"`
	Time                string  `json:"time"`
	OccurredAt          string  `json:"occurredAt"`
	PlayerID            string  `json:"playerId"`
	PlayerName          string  `json:"playerName"`
	RoomID              string  `json:"roomId"`
	RoomName            string  `json:"roomName"`
	Round               string  `json:"round"`
	ConsumeType         string  `json:"consumeType"`
	Inflow              float64 `json:"inflow"`
	ProxyPayout         float64 `json:"proxyPayout"`
	LotteryPoolTransfer float64 `json:"lotteryPoolTransfer"`
	RewardProxyPool     float64 `json:"rewardProxyPool"`
	NetRevenue          float64 `json:"netRevenue"`
	Note                string  `json:"note"`
}

type platformRevenueDetailsResponse struct {
	DateFrom string                      `json:"dateFrom"`
	DateTo   string                      `json:"dateTo"`
	Source   string                      `json:"source"`
	Summary  platformRevenueMetrics      `json:"summary"`
	Daily    []platformRevenueDailyItem  `json:"daily"`
	Items    []platformRevenueDetailItem `json:"items"`
	Page     int                         `json:"page"`
	PageSize int                         `json:"pageSize"`
	Total    int64                       `json:"total"`
}

type platformRevenueCacheState struct {
	SourceStart sql.NullTime
	SyncedStart sql.NullTime
	SyncedEnd   sql.NullTime
}

func (s *Server) handlePlatformRevenueSummary(w http.ResponseWriter, r *http.Request, p principal) {
	if !requirePlatformRevenueSuper(w, p) {
		return
	}
	if !s.acquirePlatformRevenueQuery() {
		writeError(w, http.StatusTooManyRequests, "REVENUE_QUERY_BUSY", "另一项收益查询正在执行，请稍后重试")
		return
	}
	defer s.releasePlatformRevenueQuery()

	localNow := time.Now().In(dashboardLocation)
	today := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), 0, 0, 0, 0, dashboardLocation)
	warnings := platformRevenueWarnings()
	syncCtx, cancelSync := context.WithTimeout(r.Context(), 3*time.Second)
	syncErr := s.syncPlatformRevenueCache(syncCtx, today)
	cancelSync()
	if syncErr != nil {
		s.logger.Warn("refresh platform revenue cache", "error", syncErr)
		warnings = append(warnings, "本次原始流水刷新超时或失败，页面暂时展示最近一次已缓存结果。")
	}

	readCtx, cancelRead := context.WithTimeout(r.Context(), time.Second)
	defer cancelRead()
	if syncErr != nil {
		var cachedDays int64
		if err := s.db.QueryRowContext(readCtx, `SELECT COUNT(*) FROM mgr_platform_revenue_daily`).Scan(&cachedDays); err != nil || cachedDays == 0 {
			writeError(w, http.StatusServiceUnavailable, "REVENUE_UNAVAILABLE", "平台收益首次统计未完成，请稍后重试")
			return
		}
	}

	response, err := s.queryPlatformRevenueSummary(readCtx, today, warnings)
	if err != nil {
		s.logger.Warn("refresh platform revenue cache", "error", err)
		writeError(w, http.StatusServiceUnavailable, "REVENUE_UNAVAILABLE", "平台收益暂时无法读取，请稍后重试")
		return
	}
	writeData(w, http.StatusOK, response)
}

func (s *Server) handlePlatformRevenueDetails(w http.ResponseWriter, r *http.Request, p principal) {
	if !requirePlatformRevenueSuper(w, p) {
		return
	}
	if !s.acquirePlatformRevenueQuery() {
		writeError(w, http.StatusTooManyRequests, "REVENUE_QUERY_BUSY", "另一项收益查询正在执行，请稍后重试")
		return
	}
	defer s.releasePlatformRevenueQuery()

	dateFrom, dateTo, source, err := parsePlatformRevenueDetailFilters(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_FILTER", err.Error())
		return
	}
	page, pageSize := pageParams(r)
	ctx, cancel := context.WithTimeout(r.Context(), platformRevenueQueryTimeout)
	defer cancel()

	if err := s.ensurePlatformRevenueRangeCached(ctx, dateFrom, dateTo); err != nil {
		s.logger.Warn("refresh selected platform revenue range", "error", err, "dateFrom", dateFrom, "dateTo", dateTo)
		writeError(w, http.StatusServiceUnavailable, "REVENUE_QUERY_TIMEOUT", "所选时间段统计超时，请缩短日期范围后重试")
		return
	}
	summary, daily, err := s.queryCachedPlatformRevenueRange(ctx, dateFrom, dateTo)
	if err != nil {
		s.logger.Error("query cached platform revenue range", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取收益汇总失败")
		return
	}
	summary = filterPlatformRevenueMetrics(summary, source)
	for index := range daily {
		daily[index].Metrics = filterPlatformRevenueMetrics(daily[index].Metrics, source)
	}
	items, total, err := s.queryPlatformRevenueLedger(ctx, dateFrom, dateTo, source, page, pageSize)
	if err != nil {
		s.logger.Error("query platform revenue ledger", "error", err)
		writeError(w, http.StatusServiceUnavailable, "REVENUE_QUERY_TIMEOUT", "收益明细查询超时，请缩短日期范围后重试")
		return
	}
	writeData(w, http.StatusOK, platformRevenueDetailsResponse{
		DateFrom: dateFrom, DateTo: dateTo, Source: source, Summary: summary, Daily: daily,
		Items: items, Page: page, PageSize: pageSize, Total: total,
	})
}

func (s *Server) acquirePlatformRevenueQuery() bool {
	select {
	case s.platformRevenueSem <- struct{}{}:
		return true
	default:
		return false
	}
}

func (s *Server) releasePlatformRevenueQuery() { <-s.platformRevenueSem }

func requirePlatformRevenueSuper(w http.ResponseWriter, p principal) bool {
	if p.IsSuper {
		return true
	}
	writeError(w, http.StatusForbidden, "SUPER_ADMIN_ONLY", "平台收益仅超级管理员可以查看")
	return false
}

func platformRevenueWarnings() []string {
	return []string{
		"当前为运营统计口径，不是财务结算账本；充值手续费尚未计入。",
		"提现手续费按已完成的 VIP 提现订单金额 2% 计入；普通提现通道不收取该费用。",
		"普通抽水来源依赖 usr_income_info；若玩家完全没有代理分成记录，对应抽水可能无法从现有表还原。",
		"玩家消费仅统计 玩家_消费_命令，已排除消费类型为“延长时间”的记录。",
	}
}

func parsePlatformRevenueDetailFilters(r *http.Request) (string, string, string, error) {
	query := r.URL.Query()
	dateFrom := strings.TrimSpace(query.Get("dateFrom"))
	dateTo := strings.TrimSpace(query.Get("dateTo"))
	source := strings.TrimSpace(query.Get("source"))
	if source == "" {
		source = "all"
	}
	allowed := map[string]bool{"all": true, "normal_water": true, "reward_discount": true, "reward_proxy": true, "player_consumption": true, "withdrawal_fee": true}
	if !allowed[source] {
		return "", "", "", errors.New("收益来源不正确")
	}
	if dateFrom == "" || dateTo == "" {
		return "", "", "", errors.New("请选择开始日期和结束日期")
	}
	from, err := time.ParseInLocation("2006-01-02", dateFrom, dashboardLocation)
	if err != nil {
		return "", "", "", errors.New("开始日期格式不正确")
	}
	to, err := time.ParseInLocation("2006-01-02", dateTo, dashboardLocation)
	if err != nil {
		return "", "", "", errors.New("结束日期格式不正确")
	}
	if to.Before(from) {
		return "", "", "", errors.New("结束日期不能早于开始日期")
	}
	if int(to.Sub(from).Hours()/24)+1 > platformRevenueMaxRangeDays {
		return "", "", "", fmt.Errorf("单次最多查询 %d 天，请缩短日期范围", platformRevenueMaxRangeDays)
	}
	return dateFrom, dateTo, source, nil
}

func (s *Server) syncPlatformRevenueCache(ctx context.Context, today time.Time) error {
	sourceStart, err := s.queryPlatformRevenueSourceStart(ctx)
	if err != nil {
		return err
	}
	if !sourceStart.Valid {
		sourceStart = sql.NullTime{Time: today, Valid: true}
	}
	state, err := s.queryPlatformRevenueCacheState(ctx)
	if err != nil {
		return err
	}
	if !state.SyncedStart.Valid || !state.SyncedEnd.Valid {
		start := sourceStart.Time
		minimum := today.AddDate(0, 0, -(platformRevenueMaxRangeDays - 1))
		if start.Before(minimum) {
			start = minimum
		}
		if err := s.refreshPlatformRevenueRange(ctx, start, today); err != nil {
			return err
		}
		return s.updatePlatformRevenueCacheState(ctx, sourceStart.Time, start, today)
	}

	refreshedToday := false
	advancedForward := false
	if dateString(state.SyncedEnd.Time) < dateString(today) {
		start := state.SyncedEnd.Time.AddDate(0, 0, 1)
		end := start.AddDate(0, 0, platformRevenueMaxRangeDays-1)
		if end.After(today) {
			end = today
		}
		if err := s.refreshPlatformRevenueRange(ctx, start, end); err != nil {
			return err
		}
		state.SyncedEnd = sql.NullTime{Time: end, Valid: true}
		refreshedToday = dateString(end) == dateString(today)
		advancedForward = true
	}
	if !refreshedToday {
		fresh, err := s.platformRevenueDateIsFresh(ctx, today)
		if err != nil {
			return err
		}
		if !fresh {
			if err := s.refreshPlatformRevenueRange(ctx, today, today); err != nil {
				return err
			}
		}
	}
	if !advancedForward && dateString(state.SyncedEnd.Time) == dateString(today) && dateString(state.SyncedStart.Time) > dateString(sourceStart.Time) {
		end := state.SyncedStart.Time.AddDate(0, 0, -1)
		start := end.AddDate(0, 0, -(platformRevenueMaxRangeDays - 1))
		if start.Before(sourceStart.Time) {
			start = sourceStart.Time
		}
		if err := s.refreshPlatformRevenueRange(ctx, start, end); err != nil {
			return err
		}
		state.SyncedStart = sql.NullTime{Time: start, Valid: true}
	}
	return s.updatePlatformRevenueCacheState(ctx, sourceStart.Time, state.SyncedStart.Time, state.SyncedEnd.Time)
}

func (s *Server) queryPlatformRevenueSourceStart(ctx context.Context) (sql.NullTime, error) {
	var raw sql.NullString
	err := s.gameDB.QueryRowContext(ctx, `SELECT MIN(source_date) FROM (
SELECT MIN(date) AS source_date FROM usr_income_info
UNION ALL SELECT MIN(date) FROM usr_income_info2
UNION ALL SELECT MIN(date) FROM usr_cash_water_sub_zhongjiangzhekou WHERE option_type = '中奖折扣'
UNION ALL SELECT MIN(date) FROM usr_cash_water WHERE option_type = '消费' AND remark4 <> '延长时间' AND add_money <> 0
UNION ALL SELECT MIN(date) FROM third_cash_info FORCE INDEX(date)
  WHERE work_type = '提现' AND status = '完成' AND money > 0
    AND TRIM(SUBSTRING_INDEX(remark, ',', -1)) = '1'
) source_dates`).Scan(&raw)
	if err != nil || !raw.Valid || strings.TrimSpace(raw.String) == "" {
		return sql.NullTime{}, err
	}
	parsed, err := time.ParseInLocation("2006-01-02", strings.TrimSpace(raw.String), dashboardLocation)
	if err != nil {
		return sql.NullTime{}, err
	}
	return sql.NullTime{Time: parsed, Valid: true}, nil
}

func (s *Server) queryPlatformRevenueCacheState(ctx context.Context) (platformRevenueCacheState, error) {
	var state platformRevenueCacheState
	err := s.db.QueryRowContext(ctx, `SELECT source_start_date, synced_start_date, synced_end_date
FROM mgr_platform_revenue_cache_state WHERE id = 1`).Scan(&state.SourceStart, &state.SyncedStart, &state.SyncedEnd)
	return state, err
}

func (s *Server) updatePlatformRevenueCacheState(ctx context.Context, sourceStart, syncedStart, syncedEnd time.Time) error {
	_, err := s.db.ExecContext(ctx, `UPDATE mgr_platform_revenue_cache_state
SET source_start_date = ?, synced_start_date = ?, synced_end_date = ? WHERE id = 1`,
		dateString(sourceStart), dateString(syncedStart), dateString(syncedEnd))
	return err
}

func (s *Server) platformRevenueDateIsFresh(ctx context.Context, date time.Time) (bool, error) {
	var fresh bool
	err := s.db.QueryRowContext(ctx, `SELECT refreshed_at >= DATE_SUB(NOW(), INTERVAL 60 SECOND)
FROM mgr_platform_revenue_daily WHERE metric_date = ?`, dateString(date)).Scan(&fresh)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return fresh, nil
}

func (s *Server) ensurePlatformRevenueRangeCached(ctx context.Context, dateFrom, dateTo string) error {
	from, _ := time.ParseInLocation("2006-01-02", dateFrom, dashboardLocation)
	to, _ := time.ParseInLocation("2006-01-02", dateTo, dashboardLocation)
	expected := int64(to.Sub(from).Hours()/24) + 1
	var count int64
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*)
FROM mgr_platform_revenue_daily WHERE metric_date BETWEEN ? AND ?`, dateFrom, dateTo).Scan(&count); err != nil {
		return err
	}
	if count == expected {
		return nil
	}
	return s.refreshPlatformRevenueRange(ctx, from, to)
}

func (s *Server) refreshPlatformRevenueRange(ctx context.Context, start, end time.Time) error {
	metrics := make(map[string]*platformRevenueCents)
	for cursor := start; !cursor.After(end); cursor = cursor.AddDate(0, 0, 1) {
		metrics[dateString(cursor)] = &platformRevenueCents{}
	}
	dateFrom, dateTo := dateString(start), dateString(end)
	if err := s.queryNormalRevenueDaily(ctx, dateFrom, dateTo, metrics); err != nil {
		return err
	}
	if err := s.queryRewardDiscountDaily(ctx, dateFrom, dateTo, metrics); err != nil {
		return err
	}
	if err := s.queryRewardProxyDaily(ctx, dateFrom, dateTo, metrics); err != nil {
		return err
	}
	if err := s.queryPlayerConsumptionDaily(ctx, dateFrom, dateTo, metrics); err != nil {
		return err
	}
	if err := s.queryWithdrawalFeeDaily(ctx, dateFrom, dateTo, metrics); err != nil {
		return err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for cursor := start; !cursor.After(end); cursor = cursor.AddDate(0, 0, 1) {
		date := dateString(cursor)
		m := metrics[date]
		_, err = tx.ExecContext(ctx, `INSERT INTO mgr_platform_revenue_daily
(metric_date, normal_water, normal_proxy_payout, reward_discount, reward_proxy_payout,
 reward_proxy_pool, lottery_pool_transfer, player_consumption, withdrawal_fee, normal_event_count,
 reward_discount_count, reward_proxy_count, player_consumption_count, withdrawal_fee_count, refreshed_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
ON DUPLICATE KEY UPDATE normal_water=VALUES(normal_water), normal_proxy_payout=VALUES(normal_proxy_payout),
 reward_discount=VALUES(reward_discount), reward_proxy_payout=VALUES(reward_proxy_payout),
 reward_proxy_pool=VALUES(reward_proxy_pool), lottery_pool_transfer=VALUES(lottery_pool_transfer),
 player_consumption=VALUES(player_consumption), withdrawal_fee=VALUES(withdrawal_fee), normal_event_count=VALUES(normal_event_count),
 reward_discount_count=VALUES(reward_discount_count), reward_proxy_count=VALUES(reward_proxy_count),
 player_consumption_count=VALUES(player_consumption_count), withdrawal_fee_count=VALUES(withdrawal_fee_count), refreshed_at=NOW()`,
			date, centsToMoney(m.NormalWater), centsToMoney(m.NormalProxyPayout), centsToMoney(m.RewardDiscount),
			centsToMoney(m.RewardProxyPayout), centsToMoney(m.RewardProxyPool), centsToMoney(m.LotteryPoolTransfer),
			centsToMoney(m.PlayerConsumption), centsToMoney(m.WithdrawalFee), m.NormalEventCount, m.RewardDiscountCount,
			m.RewardProxyCount, m.PlayerConsumptionCount, m.WithdrawalFeeCount)
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Server) queryNormalRevenueDaily(ctx context.Context, dateFrom, dateTo string, metrics map[string]*platformRevenueCents) error {
	rows, err := s.gameDB.QueryContext(ctx, `SELECT settled.date,
CAST(ROUND(SUM(settled.base_yuan) * 100, 0) AS SIGNED), COALESCE(SUM(settled.proxy_cents), 0), COUNT(*)
FROM (
  SELECT i.date, i.time, i.roomID, i.winner_guuid, i.remark3,
    MAX(CASE WHEN TRIM(i.remark3) REGEXP '^[0-9]+(\\.[0-9]+)?$' THEN CAST(i.remark3 AS DECIMAL(18,2)) ELSE 0 END) AS base_yuan,
    SUM(i.tax_number) AS proxy_cents
  FROM usr_income_info i FORCE INDEX(date)
  JOIN (SELECT DISTINCT date, roomID FROM usr_total_score FORCE INDEX(date)
        WHERE date BETWEEN ? AND ? AND remark LIKE '0,%') lobby
    ON lobby.date = i.date AND lobby.roomID = i.roomID
  WHERE i.date BETWEEN ? AND ?
  GROUP BY i.date, i.time, i.roomID, i.winner_guuid, i.remark3
) settled GROUP BY settled.date`, dateFrom, dateTo, dateFrom, dateTo)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var date string
		var water, proxy, count int64
		if err := rows.Scan(&date, &water, &proxy, &count); err != nil {
			return err
		}
		if m := metrics[date]; m != nil {
			m.NormalWater, m.NormalProxyPayout, m.NormalEventCount = water, proxy, count
		}
	}
	return rows.Err()
}

func (s *Server) queryRewardDiscountDaily(ctx context.Context, dateFrom, dateTo string, metrics map[string]*platformRevenueCents) error {
	rows, err := s.gameDB.QueryContext(ctx, `SELECT z.date,
CAST(ROUND(SUM(z.add_money) * 100, 0) AS SIGNED),
CAST(ROUND(SUM(CASE WHEN TRIM(z.remark4) REGEXP '^[0-9]+(\\.[0-9]+)?$' THEN CAST(z.remark4 AS DECIMAL(18,2)) ELSE 0 END) * 100, 0) AS SIGNED),
CAST(ROUND(SUM(CASE WHEN TRIM(z.remark5) REGEXP '^[0-9]+(\\.[0-9]+)?$' THEN CAST(z.remark5 AS DECIMAL(18,2)) ELSE 0 END) * 100, 0) AS SIGNED), COUNT(*)
FROM usr_cash_water_sub_zhongjiangzhekou z FORCE INDEX(date)
JOIN (SELECT DISTINCT date, roomID FROM usr_total_score FORCE INDEX(date)
      WHERE date BETWEEN ? AND ? AND remark LIKE '0,%') lobby
  ON lobby.date = z.date AND lobby.roomID = CAST(NULLIF(z.remark1, '') AS UNSIGNED)
WHERE z.date BETWEEN ? AND ? AND z.option_type = '中奖折扣'
GROUP BY z.date`, dateFrom, dateTo, dateFrom, dateTo)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var date string
		var discount, proxyPool, lotteryPool, count int64
		if err := rows.Scan(&date, &discount, &proxyPool, &lotteryPool, &count); err != nil {
			return err
		}
		if m := metrics[date]; m != nil {
			m.RewardDiscount, m.RewardProxyPool, m.LotteryPoolTransfer, m.RewardDiscountCount = discount, proxyPool, lotteryPool, count
		}
	}
	return rows.Err()
}

func (s *Server) queryRewardProxyDaily(ctx context.Context, dateFrom, dateTo string, metrics map[string]*platformRevenueCents) error {
	rows, err := s.gameDB.QueryContext(ctx, `SELECT i.date, COALESCE(SUM(i.tax_number), 0), COUNT(*)
FROM usr_income_info2 i FORCE INDEX(date)
JOIN (SELECT DISTINCT date, roomID FROM usr_total_score FORCE INDEX(date)
      WHERE date BETWEEN ? AND ? AND remark LIKE '0,%') lobby
  ON lobby.date = i.date AND lobby.roomID = i.roomID
WHERE i.date BETWEEN ? AND ? GROUP BY i.date`, dateFrom, dateTo, dateFrom, dateTo)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var date string
		var payout, count int64
		if err := rows.Scan(&date, &payout, &count); err != nil {
			return err
		}
		if m := metrics[date]; m != nil {
			m.RewardProxyPayout, m.RewardProxyCount = payout, count
		}
	}
	return rows.Err()
}

func (s *Server) queryPlayerConsumptionDaily(ctx context.Context, dateFrom, dateTo string, metrics map[string]*platformRevenueCents) error {
	rows, err := s.gameDB.QueryContext(ctx, `SELECT date,
CAST(ROUND(SUM(ABS(add_money)) * 100, 0) AS SIGNED), COUNT(*)
FROM usr_cash_water FORCE INDEX(date)
WHERE date BETWEEN ? AND ? AND option_type = '消费' AND remark4 <> '延长时间' AND add_money <> 0
GROUP BY date`, dateFrom, dateTo)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var date string
		var consumption, count int64
		if err := rows.Scan(&date, &consumption, &count); err != nil {
			return err
		}
		if m := metrics[date]; m != nil {
			m.PlayerConsumption, m.PlayerConsumptionCount = consumption, count
		}
	}
	return rows.Err()
}

func (s *Server) queryWithdrawalFeeDaily(ctx context.Context, dateFrom, dateTo string, metrics map[string]*platformRevenueCents) error {
	rows, err := s.gameDB.QueryContext(ctx, `SELECT date,
CAST(ROUND(SUM(ABS(money)) * 2, 0) AS SIGNED), COUNT(*)
FROM third_cash_info FORCE INDEX(date)
WHERE date BETWEEN ? AND ? AND work_type = '提现' AND status = '完成' AND money > 0
  AND TRIM(SUBSTRING_INDEX(remark, ',', -1)) = '1'
GROUP BY date`, dateFrom, dateTo)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var date string
		var fee, count int64
		if err := rows.Scan(&date, &fee, &count); err != nil {
			return err
		}
		if m := metrics[date]; m != nil {
			m.WithdrawalFee, m.WithdrawalFeeCount = fee, count
		}
	}
	return rows.Err()
}

func (s *Server) queryPlatformRevenueSummary(ctx context.Context, today time.Time, warnings []string) (platformRevenueSummaryResponse, error) {
	state, err := s.queryPlatformRevenueCacheState(ctx)
	if err != nil {
		return platformRevenueSummaryResponse{}, err
	}
	todayText := dateString(today)
	monthStart := time.Date(today.Year(), today.Month(), 1, 0, 0, 0, 0, dashboardLocation)
	monthStartText := dateString(monthStart)
	sourceStart, syncedStart, syncedEnd := todayText, todayText, todayText
	if state.SourceStart.Valid {
		sourceStart = dateString(state.SourceStart.Time)
	}
	if state.SyncedStart.Valid {
		syncedStart = dateString(state.SyncedStart.Time)
	}
	if state.SyncedEnd.Valid {
		syncedEnd = dateString(state.SyncedEnd.Time)
	}
	historyComplete := syncedStart <= sourceStart && syncedEnd >= todayText
	monthRequiredStart := monthStartText
	if sourceStart > monthRequiredStart {
		monthRequiredStart = sourceStart
	}
	monthComplete := syncedStart <= monthRequiredStart && syncedEnd >= todayText

	todayMetrics, err := s.queryCachedPlatformRevenuePeriod(ctx, todayText, todayText)
	if err != nil {
		return platformRevenueSummaryResponse{}, err
	}
	monthMetrics, err := s.queryCachedPlatformRevenuePeriod(ctx, monthStartText, todayText)
	if err != nil {
		return platformRevenueSummaryResponse{}, err
	}
	totalMetrics, err := s.queryCachedPlatformRevenuePeriod(ctx, syncedStart, syncedEnd)
	if err != nil {
		return platformRevenueSummaryResponse{}, err
	}
	var refreshedAt string
	_ = s.db.QueryRowContext(ctx, `SELECT COALESCE(DATE_FORMAT(DATE_ADD(MAX(refreshed_at), INTERVAL 8 HOUR), '%Y-%m-%d %H:%i:%s'), '')
FROM mgr_platform_revenue_daily`).Scan(&refreshedAt)
	if !historyComplete {
		warnings = append(warnings, "历史收益正在按 31 天一批补齐；同步完成前，总收益卡片只统计已缓存的连续日期。")
	}
	return platformRevenueSummaryResponse{
		Today: platformRevenuePeriod{Label: "今日", DateFrom: todayText, DateTo: todayText, Complete: true, Metrics: todayMetrics},
		Month: platformRevenuePeriod{Label: "本月", DateFrom: monthStartText, DateTo: todayText, Complete: monthComplete, Metrics: monthMetrics},
		Total: platformRevenuePeriod{Label: "累计", DateFrom: syncedStart, DateTo: syncedEnd, Complete: historyComplete, Metrics: totalMetrics},
		Cache: platformRevenueCacheInfo{SourceFrom: sourceStart, SyncedFrom: syncedStart, SyncedTo: syncedEnd, RefreshedAt: refreshedAt, HistoryComplete: historyComplete, MonthComplete: monthComplete},
		Unit:  "元", Formula: "平台净收益 = 普通抽水 + 中奖折扣 + 玩家消费 + 提现手续费 - 普通代理红利 - 奖池代理红利 - 抽奖池转入", Warnings: warnings,
	}, nil
}

func (s *Server) queryCachedPlatformRevenuePeriod(ctx context.Context, dateFrom, dateTo string) (platformRevenueMetrics, error) {
	var cents platformRevenueCents
	err := s.db.QueryRowContext(ctx, `SELECT
CAST(ROUND(COALESCE(SUM(normal_water),0)*100,0) AS SIGNED),
CAST(ROUND(COALESCE(SUM(normal_proxy_payout),0)*100,0) AS SIGNED),
CAST(ROUND(COALESCE(SUM(reward_discount),0)*100,0) AS SIGNED),
CAST(ROUND(COALESCE(SUM(reward_proxy_payout),0)*100,0) AS SIGNED),
CAST(ROUND(COALESCE(SUM(reward_proxy_pool),0)*100,0) AS SIGNED),
CAST(ROUND(COALESCE(SUM(lottery_pool_transfer),0)*100,0) AS SIGNED),
CAST(ROUND(COALESCE(SUM(player_consumption),0)*100,0) AS SIGNED),
CAST(ROUND(COALESCE(SUM(withdrawal_fee),0)*100,0) AS SIGNED),
COALESCE(SUM(normal_event_count),0), COALESCE(SUM(reward_discount_count),0),
COALESCE(SUM(reward_proxy_count),0), COALESCE(SUM(player_consumption_count),0),
COALESCE(SUM(withdrawal_fee_count),0)
FROM mgr_platform_revenue_daily WHERE metric_date BETWEEN ? AND ?`, dateFrom, dateTo).Scan(
		&cents.NormalWater, &cents.NormalProxyPayout, &cents.RewardDiscount, &cents.RewardProxyPayout,
		&cents.RewardProxyPool, &cents.LotteryPoolTransfer, &cents.PlayerConsumption,
		&cents.WithdrawalFee, &cents.NormalEventCount, &cents.RewardDiscountCount, &cents.RewardProxyCount,
		&cents.PlayerConsumptionCount, &cents.WithdrawalFeeCount)
	return cents.metrics(), err
}

func (s *Server) queryCachedPlatformRevenueRange(ctx context.Context, dateFrom, dateTo string) (platformRevenueMetrics, []platformRevenueDailyItem, error) {
	summary, err := s.queryCachedPlatformRevenuePeriod(ctx, dateFrom, dateTo)
	if err != nil {
		return platformRevenueMetrics{}, nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT metric_date,
CAST(ROUND(normal_water*100,0) AS SIGNED), CAST(ROUND(normal_proxy_payout*100,0) AS SIGNED),
CAST(ROUND(reward_discount*100,0) AS SIGNED), CAST(ROUND(reward_proxy_payout*100,0) AS SIGNED),
CAST(ROUND(reward_proxy_pool*100,0) AS SIGNED), CAST(ROUND(lottery_pool_transfer*100,0) AS SIGNED),
CAST(ROUND(player_consumption*100,0) AS SIGNED), CAST(ROUND(withdrawal_fee*100,0) AS SIGNED),
normal_event_count, reward_discount_count, reward_proxy_count, player_consumption_count,
withdrawal_fee_count
FROM mgr_platform_revenue_daily WHERE metric_date BETWEEN ? AND ? ORDER BY metric_date DESC`, dateFrom, dateTo)
	if err != nil {
		return platformRevenueMetrics{}, nil, err
	}
	defer rows.Close()
	daily := make([]platformRevenueDailyItem, 0)
	for rows.Next() {
		var date time.Time
		var cents platformRevenueCents
		if err := rows.Scan(&date, &cents.NormalWater, &cents.NormalProxyPayout, &cents.RewardDiscount,
			&cents.RewardProxyPayout, &cents.RewardProxyPool, &cents.LotteryPoolTransfer,
			&cents.PlayerConsumption, &cents.WithdrawalFee, &cents.NormalEventCount, &cents.RewardDiscountCount,
			&cents.RewardProxyCount, &cents.PlayerConsumptionCount, &cents.WithdrawalFeeCount); err != nil {
			return platformRevenueMetrics{}, nil, err
		}
		daily = append(daily, platformRevenueDailyItem{Date: dateString(date), Metrics: cents.metrics()})
	}
	return summary, daily, rows.Err()
}

func (c platformRevenueCents) metrics() platformRevenueMetrics {
	gross := c.NormalWater + c.RewardDiscount + c.PlayerConsumption + c.WithdrawalFee
	proxy := c.NormalProxyPayout + c.RewardProxyPayout
	expense := proxy + c.LotteryPoolTransfer
	return platformRevenueMetrics{
		NormalWater: centsToMoney(c.NormalWater), NormalProxyPayout: centsToMoney(c.NormalProxyPayout),
		RewardDiscount: centsToMoney(c.RewardDiscount), RewardProxyPayout: centsToMoney(c.RewardProxyPayout),
		RewardProxyPool: centsToMoney(c.RewardProxyPool), LotteryPoolTransfer: centsToMoney(c.LotteryPoolTransfer),
		PlayerConsumption: centsToMoney(c.PlayerConsumption), WithdrawalFee: centsToMoney(c.WithdrawalFee),
		GrossInflow: centsToMoney(gross),
		ProxyPayout: centsToMoney(proxy), TotalExpense: centsToMoney(expense), NetRevenue: centsToMoney(gross - expense),
		NormalEventCount: c.NormalEventCount, RewardDiscountCount: c.RewardDiscountCount,
		RewardProxyCount: c.RewardProxyCount, PlayerConsumptionCount: c.PlayerConsumptionCount,
		WithdrawalFeeCount: c.WithdrawalFeeCount,
	}
}

func filterPlatformRevenueMetrics(metrics platformRevenueMetrics, source string) platformRevenueMetrics {
	if source == "all" {
		return metrics
	}
	filtered := platformRevenueMetrics{}
	switch source {
	case "normal_water":
		filtered.NormalWater = metrics.NormalWater
		filtered.NormalProxyPayout = metrics.NormalProxyPayout
		filtered.NormalEventCount = metrics.NormalEventCount
	case "reward_discount":
		filtered.RewardDiscount = metrics.RewardDiscount
		filtered.RewardProxyPool = metrics.RewardProxyPool
		filtered.LotteryPoolTransfer = metrics.LotteryPoolTransfer
		filtered.RewardDiscountCount = metrics.RewardDiscountCount
	case "reward_proxy":
		filtered.RewardProxyPayout = metrics.RewardProxyPayout
		filtered.RewardProxyCount = metrics.RewardProxyCount
	case "player_consumption":
		filtered.PlayerConsumption = metrics.PlayerConsumption
		filtered.PlayerConsumptionCount = metrics.PlayerConsumptionCount
	case "withdrawal_fee":
		filtered.WithdrawalFee = metrics.WithdrawalFee
		filtered.WithdrawalFeeCount = metrics.WithdrawalFeeCount
	}
	filtered.GrossInflow = filtered.NormalWater + filtered.RewardDiscount + filtered.PlayerConsumption + filtered.WithdrawalFee
	filtered.ProxyPayout = filtered.NormalProxyPayout + filtered.RewardProxyPayout
	filtered.TotalExpense = filtered.ProxyPayout + filtered.LotteryPoolTransfer
	filtered.NetRevenue = filtered.GrossInflow - filtered.TotalExpense
	return filtered
}

func centsToMoney(value int64) float64  { return float64(value) / 100 }
func dateString(value time.Time) string { return value.In(dashboardLocation).Format("2006-01-02") }

func (s *Server) queryPlatformRevenueLedger(ctx context.Context, dateFrom, dateTo, source string, page, pageSize int) ([]platformRevenueDetailItem, int64, error) {
	ledgerSQL, args := buildPlatformRevenueLedgerSQL(dateFrom, dateTo, source)
	var total int64
	if err := s.gameDB.QueryRowContext(ctx, `SELECT COUNT(*) FROM (`+ledgerSQL+`) revenue_ledger`, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	queryArgs := append(append([]any{}, args...), pageSize, (page-1)*pageSize)
	rows, err := s.gameDB.QueryContext(ctx, `SELECT ledger_id, source_id, event_date, event_time, source_type,
player_id, player_name, room_id, room_name, round_no, consume_type,
inflow_cents, proxy_payout_cents, lottery_transfer_cents, reward_proxy_pool_cents,
balance_before_cents, balance_after_cents, source_note
FROM (`+ledgerSQL+`) revenue_ledger
ORDER BY event_date DESC, event_time DESC, source_id DESC LIMIT ? OFFSET ?`, queryArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	items := make([]platformRevenueDetailItem, 0, pageSize)
	for rows.Next() {
		var item platformRevenueDetailItem
		var sourceID, inflow, proxy, lottery, proxyPool, balanceBefore, balanceAfter int64
		if err := rows.Scan(&item.ID, &sourceID, &item.Date, &item.Time, &item.SourceType,
			&item.PlayerID, &item.PlayerName, &item.RoomID, &item.RoomName, &item.Round, &item.ConsumeType,
			&inflow, &proxy, &lottery, &proxyPool, &balanceBefore, &balanceAfter, &item.Note); err != nil {
			return nil, 0, err
		}
		item.OccurredAt = strings.TrimSpace(item.Date + " " + item.Time)
		item.Inflow, item.ProxyPayout = centsToMoney(inflow), centsToMoney(proxy)
		item.LotteryPoolTransfer, item.RewardProxyPool = centsToMoney(lottery), centsToMoney(proxyPool)
		item.NetRevenue = centsToMoney(inflow - proxy - lottery)
		if item.SourceType == "player_consumption" {
			item.Note = formatPlayerConsumptionBalanceNote(balanceBefore, balanceAfter)
		}
		items = append(items, item)
	}
	return items, total, rows.Err()
}

func buildPlatformRevenueLedgerSQL(dateFrom, dateTo, source string) (string, []any) {
	branches := make([]string, 0, 5)
	args := make([]any, 0, 16)
	if source == "all" || source == "normal_water" {
		branches = append(branches, `SELECT CONCAT('normal:', MAX(i.id)) AS ledger_id, MAX(i.id) AS source_id,
i.date AS event_date, i.time AS event_time, 'normal_water' AS source_type,
i.winner_guuid AS player_id, MAX(i.winner_name) AS player_name, CAST(i.roomID AS CHAR) AS room_id,
'' AS room_name, '' AS round_no, '' AS consume_type,
CAST(ROUND(MAX(CASE WHEN TRIM(i.remark3) REGEXP '^[0-9]+(\\.[0-9]+)?$' THEN CAST(i.remark3 AS DECIMAL(18,2)) ELSE 0 END)*100,0) AS SIGNED) AS inflow_cents,
SUM(i.tax_number) AS proxy_payout_cents, 0 AS lottery_transfer_cents, 0 AS reward_proxy_pool_cents,
0 AS balance_before_cents, 0 AS balance_after_cents,
CONCAT('已按结算键去重，合并 ', COUNT(*), ' 条代理分成记录') AS source_note
FROM usr_income_info i FORCE INDEX(date)
JOIN (SELECT DISTINCT date, roomID FROM usr_total_score FORCE INDEX(date)
      WHERE date BETWEEN ? AND ? AND remark LIKE '0,%') lobby
  ON lobby.date=i.date AND lobby.roomID=i.roomID
WHERE i.date BETWEEN ? AND ?
GROUP BY i.date,i.time,i.roomID,i.winner_guuid,i.remark3`)
		args = append(args, dateFrom, dateTo, dateFrom, dateTo)
	}
	if source == "all" || source == "reward_discount" {
		branches = append(branches, `SELECT CONCAT('reward:', z.id) AS ledger_id, z.id AS source_id,
z.date AS event_date, z.time AS event_time, 'reward_discount' AS source_type,
z.user_guuid AS player_id, z.user_name AS player_name, z.remark1 AS room_id,
z.remark2 AS room_name, z.remark3 AS round_no, '' AS consume_type,
CAST(ROUND(z.add_money*100,0) AS SIGNED) AS inflow_cents, 0 AS proxy_payout_cents,
CAST(ROUND((CASE WHEN TRIM(z.remark5) REGEXP '^[0-9]+(\\.[0-9]+)?$' THEN CAST(z.remark5 AS DECIMAL(18,2)) ELSE 0 END)*100,0) AS SIGNED) AS lottery_transfer_cents,
CAST(ROUND((CASE WHEN TRIM(z.remark4) REGEXP '^[0-9]+(\\.[0-9]+)?$' THEN CAST(z.remark4 AS DECIMAL(18,2)) ELSE 0 END)*100,0) AS SIGNED) AS reward_proxy_pool_cents,
0 AS balance_before_cents, 0 AS balance_after_cents,
'大厅奖池中奖折扣提留' AS source_note
FROM usr_cash_water_sub_zhongjiangzhekou z FORCE INDEX(date)
JOIN (SELECT DISTINCT date, roomID FROM usr_total_score FORCE INDEX(date)
      WHERE date BETWEEN ? AND ? AND remark LIKE '0,%') lobby
  ON lobby.date=z.date AND lobby.roomID=CAST(NULLIF(z.remark1,'') AS UNSIGNED)
WHERE z.date BETWEEN ? AND ? AND z.option_type='中奖折扣'`)
		args = append(args, dateFrom, dateTo, dateFrom, dateTo)
	}
	if source == "all" || source == "reward_proxy" {
		branches = append(branches, `SELECT CONCAT('reward-proxy:', i.id) AS ledger_id, i.id AS source_id,
i.date AS event_date, i.time AS event_time, 'reward_proxy' AS source_type,
i.winner_guuid AS player_id, i.winner_name AS player_name, CAST(i.roomID AS CHAR) AS room_id,
'' AS room_name, '' AS round_no, '' AS consume_type, 0 AS inflow_cents,
i.tax_number AS proxy_payout_cents, 0 AS lottery_transfer_cents, 0 AS reward_proxy_pool_cents,
0 AS balance_before_cents, 0 AS balance_after_cents,
CONCAT('奖池代理红利发放给 ', i.proxy_guuid) AS source_note
FROM usr_income_info2 i FORCE INDEX(date)
JOIN (SELECT DISTINCT date, roomID FROM usr_total_score FORCE INDEX(date)
      WHERE date BETWEEN ? AND ? AND remark LIKE '0,%') lobby
  ON lobby.date=i.date AND lobby.roomID=i.roomID
WHERE i.date BETWEEN ? AND ?`)
		args = append(args, dateFrom, dateTo, dateFrom, dateTo)
	}
	if source == "all" || source == "player_consumption" {
		branches = append(branches, `SELECT CONCAT('consume:', w.id) AS ledger_id, w.id AS source_id,
w.date AS event_date, w.time AS event_time, 'player_consumption' AS source_type,
w.user_guuid AS player_id, w.user_name AS player_name, w.remark1 AS room_id,
w.remark2 AS room_name, w.remark3 AS round_no, w.remark4 AS consume_type,
CAST(ROUND(ABS(w.add_money)*100,0) AS SIGNED) AS inflow_cents,
0 AS proxy_payout_cents, 0 AS lottery_transfer_cents, 0 AS reward_proxy_pool_cents,
CAST(ROUND(w.old_money*100,0) AS SIGNED) AS balance_before_cents,
CAST(ROUND(w.new_money*100,0) AS SIGNED) AS balance_after_cents,
COALESCE(NULLIF(w.remark5,''),'玩家消费') AS source_note
FROM usr_cash_water w FORCE INDEX(date)
WHERE w.date BETWEEN ? AND ? AND w.option_type='消费' AND w.remark4<>'延长时间' AND w.add_money<>0`)
		args = append(args, dateFrom, dateTo)
	}
	if source == "all" || source == "withdrawal_fee" {
		branches = append(branches, `SELECT CONCAT('withdrawal-fee:', w.id) AS ledger_id, w.id AS source_id,
w.date AS event_date, w.time AS event_time, 'withdrawal_fee' AS source_type,
w.user_guuid AS player_id, w.user_name AS player_name, '' AS room_id,
'' AS room_name, '' AS round_no, COALESCE(NULLIF(SUBSTRING_INDEX(w.remark, ',', 1), ''), '提现') AS consume_type,
CAST(ROUND(ABS(w.money) * 2, 0) AS SIGNED) AS inflow_cents,
0 AS proxy_payout_cents, 0 AS lottery_transfer_cents, 0 AS reward_proxy_pool_cents,
0 AS balance_before_cents, 0 AS balance_after_cents,
CONCAT('VIP 提现 ', ABS(w.money), ' 元，按 2% 收取手续费') AS source_note
FROM third_cash_info w FORCE INDEX(date)
WHERE w.date BETWEEN ? AND ? AND w.work_type = '提现' AND w.status = '完成' AND w.money > 0
  AND TRIM(SUBSTRING_INDEX(w.remark, ',', -1)) = '1'`)
		args = append(args, dateFrom, dateTo)
	}
	return strings.Join(branches, " UNION ALL "), args
}

func formatPlayerConsumptionBalanceNote(beforeCents, afterCents int64) string {
	return fmt.Sprintf("消费前余额 %.2f 元，消费后余额 %.2f 元", centsToMoney(beforeCents), centsToMoney(afterCents))
}
