package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestParseUserDataFiltersDefaultsToSevenDays(t *testing.T) {
	now := time.Date(2026, 11, 13, 10, 30, 0, 0, dashboardLocation)
	request := httptest.NewRequest(http.MethodGet, "/api/game/user-data/records?playerId=292989&kind=gold", nil)
	filters, err := parseUserDataFilters(request, now)
	if err != nil {
		t.Fatalf("default filters rejected: %v", err)
	}
	if filters.From != "2026-11-07" || filters.To != "2026-11-13" {
		t.Fatalf("unexpected default range: %+v", filters)
	}
	if filters.Page != 1 || filters.PageSize != 20 {
		t.Fatalf("unexpected pagination: %+v", filters)
	}
}

func TestParseUserDataFiltersRejectsInvalidInput(t *testing.T) {
	now := time.Date(2026, 11, 13, 10, 30, 0, 0, dashboardLocation)
	cases := []string{
		"playerId=&kind=gold",
		"playerId=292989&kind=other",
		"playerId=292989&kind=gold&dateFrom=2026/11/01",
		"playerId=292989&kind=gold&dateFrom=2026-11-13&dateTo=2026-11-01",
		"playerId=292989&kind=gold&dateFrom=2026-10-01&dateTo=2026-11-13",
	}
	for _, query := range cases {
		request := httptest.NewRequest(http.MethodGet, "/api/game/user-data/records?"+query, nil)
		if _, err := parseUserDataFilters(request, now); err == nil {
			t.Fatalf("query %q should be rejected", query)
		}
	}
}

func TestUserDataBonusLevelLabel(t *testing.T) {
	cases := map[string]string{
		"clubroot":  "俱乐部创建者",
		"club2":     "2级代理",
		"club3":     "3级代理",
		"darkroot":  "创建者暗抽",
		"unionroot": "联盟上缴",
		"custom":    "custom",
	}
	for level, want := range cases {
		if got := userDataBonusLevelLabel(level); got != want {
			t.Fatalf("level %q label = %q, want %q", level, got, want)
		}
	}
}

func TestParseTrailingFloat(t *testing.T) {
	cases := map[string]float64{
		"2084":     2084,
		"100→200":  200,
		" 950000 ": 950000,
		"联盟池A→300": 300,
	}
	for raw, want := range cases {
		got, ok := parseTrailingFloat(raw)
		if !ok || got != want {
			t.Fatalf("parseTrailingFloat(%q) = %v, %v; want %v", raw, got, ok, want)
		}
	}
	if _, ok := parseTrailingFloat("未授信"); ok {
		t.Fatal("non numeric remark should not parse")
	}
}
