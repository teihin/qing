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

func TestUserDataQuotaTypeLabel(t *testing.T) {
	cases := map[string]string{
		"额度占用":   "带入",
		"额度回补":   "结算",
		"额度联盟授信": "联盟授信",
		"额度联盟注资": "平台注资",
		"额度奖励":   "平台奖励",
		"额度抽水回补": "抽水回补",
		"额度其他":   "其他",
	}
	for optType, want := range cases {
		if got := userDataQuotaTypeLabel(optType); got != want {
			t.Fatalf("quota type %q label = %q, want %q", optType, got, want)
		}
	}
}

func TestBuildUserDataChain(t *testing.T) {
	rows := map[string]userDataAgentRow{
		"100": {ClubID: "1", PlayerID: "100", Name: "member", UpperID: "200"},
		"200": {ClubID: "1", PlayerID: "200", Name: "agent", UpperID: "500", Percent: 50},
		"500": {ClubID: "1", PlayerID: "500", Name: "owner", Percent: 100},
	}
	hasCode := map[string]bool{"200": true}
	names := map[string]string{"900": "union owner"}

	unionMeta := userDataClubMeta{ClubID: "1", Name: "A", UnionID: "u1", UnionOwnerID: "900", CreatorID: "500"}
	memberChain := buildUserDataChain("100", unionMeta, userDataAgentRow{}, rows, hasCode, names)
	if len(memberChain) != 2 {
		t.Fatalf("member chain = %+v, want creator + union owner", memberChain)
	}
	if memberChain[0].PlayerID != "500" || memberChain[0].Role != "盟主" {
		t.Fatalf("unexpected creator node: %+v", memberChain[0])
	}
	if memberChain[1].PlayerID != "900" || memberChain[1].Role != "大盟主" || memberChain[1].Name != "union owner" {
		t.Fatalf("unexpected union node: %+v", memberChain[1])
	}

	agentChain := buildUserDataChain("200", unionMeta, rows["200"], rows, hasCode, names)
	if len(agentChain) != 2 || agentChain[0].PlayerID != "500" || agentChain[1].PlayerID != "900" {
		t.Fatalf("agent chain = %+v, want creator + union owner", agentChain)
	}

	creatorChain := buildUserDataChain("500", unionMeta, rows["500"], rows, hasCode, names)
	if len(creatorChain) != 1 || creatorChain[0].PlayerID != "900" {
		t.Fatalf("creator chain = %+v, want only union owner", creatorChain)
	}

	groupMeta := userDataClubMeta{ClubID: "1", Name: "A", CreatorID: "500"}
	ownerChain := buildUserDataChain("500", groupMeta, rows["500"], rows, hasCode, names)
	if len(ownerChain) != 0 {
		t.Fatalf("independent owner chain = %+v, want empty", ownerChain)
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
