package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestParseOwnerEarningsFiltersDefaultsToToday(t *testing.T) {
	now := time.Date(2026, 11, 9, 21, 30, 0, 0, dashboardLocation)
	request := httptest.NewRequest(http.MethodGet, "/api/game/unions/947486/earnings", nil)
	filters, err := parseOwnerEarningsFilters(request, now)
	if err != nil {
		t.Fatalf("default filters rejected: %v", err)
	}
	if filters.Kind != ownerEarningsKindDark || filters.DateFrom != "2026-11-09" || filters.DateTo != "2026-11-09" {
		t.Fatalf("unexpected defaults: %+v", filters)
	}
}

func TestParseOwnerEarningsFiltersRejectsInvalidRanges(t *testing.T) {
	now := time.Date(2026, 11, 9, 21, 30, 0, 0, dashboardLocation)
	cases := []string{
		"kind=other",
		"kind=dark&dateFrom=2026/11/01",
		"kind=dark&dateFrom=2026-11-09&dateTo=2026-11-01",
		"kind=dark&dateFrom=2026-10-01&dateTo=2026-11-09",
		"kind=dark&clubId=abc",
	}
	for _, query := range cases {
		request := httptest.NewRequest(http.MethodGet, "/api/game/earnings?"+query, nil)
		if _, err := parseOwnerEarningsFilters(request, now); err == nil {
			t.Fatalf("query %q should be rejected", query)
		}
	}
}

func TestParseOwnerEarningsFiltersAcceptsSingleBoundaryDate(t *testing.T) {
	now := time.Date(2026, 11, 9, 21, 30, 0, 0, dashboardLocation)
	request := httptest.NewRequest(http.MethodGet, "/api/game/earnings?kind=jackpot&dateFrom=2026-11-07", nil)
	filters, err := parseOwnerEarningsFilters(request, now)
	if err != nil {
		t.Fatalf("single date rejected: %v", err)
	}
	if filters.Kind != ownerEarningsKindJackpot || filters.DateFrom != "2026-11-07" || filters.DateTo != "2026-11-07" {
		t.Fatalf("unexpected single-date filters: %+v", filters)
	}
}

func TestOwnerEarningsRatioUsesFenOverYuan(t *testing.T) {
	cases := []struct {
		amountFen int64
		baseYuan  float64
		want      float64
	}{
		{500, 25, 20},
		{1075, 10.75, 100},
		{0, 12, 0},
		{100, 0, 0},
	}
	for _, test := range cases {
		if got := ownerEarningsRatio(test.amountFen, test.baseYuan); got != test.want {
			t.Fatalf("ratio(%d, %v) = %v, want %v", test.amountFen, test.baseYuan, got, test.want)
		}
	}
}

func TestOwnerEarningsProxyHelpers(t *testing.T) {
	clubs := []ownerEarningsClubRef{
		{ClubID: "260673", ClubName: "测试测试"},
		{ClubID: "885399", ClubName: "踩踩踩"},
	}
	keys, byProxy := ownerEarningsProxyKeys(clubs)
	if len(keys) != 2 || keys[0] != "club-260673" || byProxy["club-885399"].ClubName != "踩踩踩" {
		t.Fatalf("proxy keys not built correctly: %v %+v", keys, byProxy)
	}
	if got := ownerEarningsClubID("club-260673"); got != "260673" {
		t.Fatalf("club id not parsed: %q", got)
	}
	if got := ownerEarningsClubID("proxy-260673"); got != "" {
		t.Fatalf("unexpected proxy prefix parsed as club: %q", got)
	}
	if got := ownerEarningsWaterRate("10-193998"); got != 10 {
		t.Fatalf("water rate not parsed: %v", got)
	}
	if got := ownerEarningsWaterRate("bad"); got != 0 {
		t.Fatalf("invalid water rate should be 0: %v", got)
	}
}

func TestOwnerEarningsLevelLabels(t *testing.T) {
	if got := ownerEarningsLevelLabel(ownerEarningsKindDark, "uniondark"); got != "联盟暗抽" {
		t.Fatalf("uniondark label = %q", got)
	}
	if got := ownerEarningsLevelLabel(ownerEarningsKindDark, "darkroot"); got != "创建者暗抽" {
		t.Fatalf("darkroot label = %q", got)
	}
	if got := ownerEarningsLevelLabel(ownerEarningsKindJackpot, "clubroot"); got != "俱乐部层奖池" {
		t.Fatalf("clubroot label = %q", got)
	}
}

func TestOwnerEarningsWhereSplitsLevelAndClubFilters(t *testing.T) {
	filters := ownerEarningsFilters{DateFrom: "2026-11-05", DateTo: "2026-11-09"}
	where, args := ownerEarningsWhere(ownerEarningsSource(ownerEarningsKindDark), "895742",
		[]string{"club-260673", "club-885399"}, filters)
	want := "i.date BETWEEN ? AND ? AND i.remark1 = ? AND i.remark5 IN ('uniondark', 'darkroot') AND i.proxy_guuid IN (?,?)"
	if where != want {
		t.Fatalf("where = %q, want %q", where, want)
	}
	if len(args) != 5 || args[0] != filters.DateFrom || args[1] != filters.DateTo || args[2] != "895742" {
		t.Fatalf("unexpected args: %#v", args)
	}

	base, baseArgs := ownerEarningsBaseWhere(ownerEarningsSource(ownerEarningsKindJackpot), "895742", filters)
	if base != "i.date BETWEEN ? AND ? AND i.remark1 = ?" || len(baseArgs) != 3 {
		t.Fatalf("unexpected base where: %q %#v", base, baseArgs)
	}
}

func TestJsonNumberIntAcceptsNumbersAndRejectsText(t *testing.T) {
	if value, ok := jsonNumberInt(json.Number("12")); !ok || value != 12 {
		t.Fatalf("integer number not parsed: %v %v", value, ok)
	}
	if value, ok := jsonNumberInt(json.Number("12.6")); !ok || value != 13 {
		t.Fatalf("decimal number not rounded: %v %v", value, ok)
	}
	if _, ok := jsonNumberInt(json.Number("")); ok {
		t.Fatal("empty number should be rejected")
	}
}

func TestParseOwnerEarningsPoolConfig(t *testing.T) {
	raw := []byte(`{"reward_on":true,"reward_modify":{"底皮1/3":2},"reward_card_bili":{"天皇":20,"丁二皇":2}}`)
	on, modify, payouts, err := parseOwnerEarningsPoolConfig(raw)
	if err != nil {
		t.Fatalf("pool config rejected: %v", err)
	}
	if !on || modify["底皮1/3"] != 2 || payouts["天皇"] != 20 || payouts["丁二皇"] != 2 {
		t.Fatalf("unexpected pool config: on=%v modify=%v payouts=%v", on, modify, payouts)
	}

	on, modify, payouts, err = parseOwnerEarningsPoolConfig([]byte(`{}`))
	if err != nil {
		t.Fatalf("empty pool config rejected: %v", err)
	}
	if on || len(modify) != 0 || len(payouts) != 0 {
		t.Fatalf("empty pool config must default to closed: on=%v modify=%v payouts=%v", on, modify, payouts)
	}

	if _, _, _, err := parseOwnerEarningsPoolConfig([]byte(`not-json`)); err == nil {
		t.Fatal("invalid pool config should be rejected")
	}
}
