package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParsePlatformRevenueDetailFilters(t *testing.T) {
	request := httptest.NewRequest("GET", "/api/game/platform-revenue/details?dateFrom=2026-08-01&dateTo=2026-08-31&source=normal_water", nil)
	dateFrom, dateTo, source, err := parsePlatformRevenueDetailFilters(request)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if dateFrom != "2026-08-01" || dateTo != "2026-08-31" || source != "normal_water" {
		t.Fatalf("unexpected filters: %s %s %s", dateFrom, dateTo, source)
	}

	invalid := []string{
		"/api/game/platform-revenue/details?dateFrom=2026-08-01&dateTo=2026-09-01",
		"/api/game/platform-revenue/details?dateFrom=2026-08-02&dateTo=2026-08-01",
		"/api/game/platform-revenue/details?dateFrom=2026/08/01&dateTo=2026-08-01",
		"/api/game/platform-revenue/details?dateFrom=2026-08-01&dateTo=2026-08-01&source=unknown",
	}
	for _, path := range invalid {
		if _, _, _, err := parsePlatformRevenueDetailFilters(httptest.NewRequest("GET", path, nil)); err == nil {
			t.Fatalf("expected invalid filter error for %s", path)
		}
	}
}

func TestPlatformRevenueMetricsFormula(t *testing.T) {
	metrics := (platformRevenueCents{
		NormalWater: 10000, RewardDiscount: 2000, PlayerConsumption: 300,
		NormalProxyPayout: 7500, RewardProxyPayout: 500, LotteryPoolTransfer: 200,
		RewardProxyPool: 400, WithdrawalFee: 200, NormalEventCount: 8, RewardDiscountCount: 2,
	}).metrics()
	if metrics.GrossInflow != 125 || metrics.ProxyPayout != 80 || metrics.TotalExpense != 82 || metrics.NetRevenue != 43 {
		t.Fatalf("unexpected revenue formula result: %+v", metrics)
	}
	if metrics.RewardProxyPool != 4 {
		t.Fatalf("reward proxy pool must be informational and preserved: %+v", metrics)
	}
}

func TestFilterPlatformRevenueMetrics(t *testing.T) {
	metrics := (platformRevenueCents{
		NormalWater: 10000, NormalProxyPayout: 7500, RewardDiscount: 2000,
		RewardProxyPayout: 500, LotteryPoolTransfer: 200, PlayerConsumption: 300, WithdrawalFee: 200,
	}).metrics()
	normal := filterPlatformRevenueMetrics(metrics, "normal_water")
	if normal.GrossInflow != 100 || normal.TotalExpense != 75 || normal.NetRevenue != 25 || normal.RewardDiscount != 0 {
		t.Fatalf("unexpected normal source metrics: %+v", normal)
	}
	rewardProxy := filterPlatformRevenueMetrics(metrics, "reward_proxy")
	if rewardProxy.GrossInflow != 0 || rewardProxy.TotalExpense != 5 || rewardProxy.NetRevenue != -5 {
		t.Fatalf("unexpected reward proxy metrics: %+v", rewardProxy)
	}
	withdrawalFee := filterPlatformRevenueMetrics(metrics, "withdrawal_fee")
	if withdrawalFee.GrossInflow != 2 || withdrawalFee.NetRevenue != 2 || withdrawalFee.PlayerConsumption != 0 {
		t.Fatalf("unexpected withdrawal fee metrics: %+v", withdrawalFee)
	}
}

func TestBuildPlatformRevenueLedgerSQLKeepsPerformanceAndBusinessBoundaries(t *testing.T) {
	query, args := buildPlatformRevenueLedgerSQL("2026-08-01", "2026-08-07", "all")
	checks := []string{
		"FORCE INDEX(date)",
		"remark LIKE '0,%'",
		"GROUP BY i.date,i.time,i.roomID,i.winner_guuid,i.remark3",
		"w.remark4<>'延长时间'",
		"w.add_money<>0",
		"w.old_money*100",
		"w.new_money*100",
		"w.work_type = '提现'",
		"w.status = '完成'",
		"TRIM(SUBSTRING_INDEX(w.remark, ',', -1)) = '1'",
		"UNION ALL",
	}
	for _, expected := range checks {
		if !strings.Contains(query, expected) {
			t.Fatalf("ledger SQL is missing %q", expected)
		}
	}
	if len(args) != 16 {
		t.Fatalf("unexpected argument count: %d", len(args))
	}

	columnAliases := []string{
		"AS ledger_id", "AS source_id", "AS event_date", "AS event_time", "AS source_type",
		"AS player_id", "AS player_name", "AS room_id", "AS room_name", "AS round_no",
		"AS consume_type", "AS inflow_cents", "AS proxy_payout_cents",
		"AS lottery_transfer_cents", "AS reward_proxy_pool_cents", "AS balance_before_cents",
		"AS balance_after_cents", "AS source_note",
	}
	for _, source := range []string{"normal_water", "reward_discount", "reward_proxy", "player_consumption", "withdrawal_fee"} {
		sourceQuery, _ := buildPlatformRevenueLedgerSQL("2026-08-01", "2026-08-07", source)
		for _, alias := range columnAliases {
			if !strings.Contains(sourceQuery, alias) {
				t.Fatalf("%s ledger SQL is missing %q", source, alias)
			}
		}
	}
}

func TestFormatPlayerConsumptionBalanceNoteUsesAuthoritativeBalances(t *testing.T) {
	if actual := formatPlayerConsumptionBalanceNote(584300, 583300); actual != "消费前余额 5843.00 元，消费后余额 5833.00 元" {
		t.Fatalf("unexpected integer-balance note: %s", actual)
	}
	if actual := formatPlayerConsumptionBalanceNote(576730, 576720); actual != "消费前余额 5767.30 元，消费后余额 5767.20 元" {
		t.Fatalf("unexpected fractional-balance note: %s", actual)
	}
}

func TestPlatformRevenueHandlersRequireSuperAdministrator(t *testing.T) {
	server := &Server{}
	for _, handler := range []func(http.ResponseWriter, *http.Request, principal){
		server.handlePlatformRevenueSummary,
		server.handlePlatformRevenueDetails,
	} {
		response := httptest.NewRecorder()
		handler(response, httptest.NewRequest("GET", "/api/game/platform-revenue/summary", nil), principal{IsSuper: false})
		if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "SUPER_ADMIN_ONLY") {
			t.Fatalf("non-super platform revenue request was not rejected: %d %s", response.Code, response.Body.String())
		}
	}
}
