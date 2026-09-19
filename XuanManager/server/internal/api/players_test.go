package api

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParsePlayerFilters(t *testing.T) {
	r := httptest.NewRequest("GET", "/api/game/players?playerId=292989&name=test&agentId=648425&agentName=agent&level=98&roomId=0&minBalance=-10.5&maxBalance=200&registeredFrom=2026-08-01&registeredTo=2026-08-09&loginFrom=2026-09-01&loginTo=2026-09-19", nil)
	filters, err := parsePlayerFilters(r)
	if err != nil {
		t.Fatalf("parse filters: %v", err)
	}
	if filters.PlayerID != "292989" || filters.AgentID != "648425" || filters.Level == nil || *filters.Level != 98 {
		t.Fatalf("unexpected filters: %#v", filters)
	}
	if filters.LoginFrom != "2026-09-01" || filters.LoginTo != "2026-09-19" {
		t.Fatalf("unexpected login range: %#v", filters)
	}
	where, args := buildPlayerWhere(filters)
	if strings.Contains(where, filters.PlayerID) || strings.Contains(where, filters.AgentID) {
		t.Fatalf("query values must not be interpolated: %s", where)
	}
	if !strings.Contains(where, "a.sm_guuid = ?") || !strings.Contains(where, "agent.sm_name LIKE ?") ||
		!strings.Contains(where, "k.lasttime >= UNIX_TIMESTAMP(CONCAT(?, ' 00:00:00'))") || len(args) != 12 {
		t.Fatalf("unexpected where clause or args: %s %#v", where, args)
	}
}

func TestBuildPlayerWhereLoginRangeUsesBeijingDayBounds(t *testing.T) {
	where, args := buildPlayerWhere(playerFilters{LoginFrom: "2026-09-01", LoginTo: "2026-09-19"})
	for _, expected := range []string{
		"k.lasttime >= UNIX_TIMESTAMP(CONCAT(?, ' 00:00:00'))",
		"k.lasttime <= UNIX_TIMESTAMP(CONCAT(?, ' 23:59:59'))",
	} {
		if !strings.Contains(where, expected) {
			t.Fatalf("missing login range clause %q in %s", expected, where)
		}
	}
	if len(args) != 2 || args[0] != "2026-09-01" || args[1] != "2026-09-19" {
		t.Fatalf("unexpected login range args: %#v", args)
	}
}

func TestParsePlayerFiltersRejectsInvalidRange(t *testing.T) {
	r := httptest.NewRequest("GET", "/api/game/players?minBalance=20&maxBalance=10", nil)
	if _, err := parsePlayerFilters(r); err == nil {
		t.Fatal("expected invalid balance range")
	}
}

func TestParsePlayerFiltersRejectsInvalidDate(t *testing.T) {
	r := httptest.NewRequest("GET", "/api/game/players?registeredFrom=2026/08/01", nil)
	if _, err := parsePlayerFilters(r); err == nil {
		t.Fatal("expected invalid date")
	}
	r = httptest.NewRequest("GET", "/api/game/players?loginFrom=2026/09/01", nil)
	if _, err := parsePlayerFilters(r); err == nil {
		t.Fatal("expected invalid login date")
	}
}

func TestParsePlayerFiltersRejectsInvertedLoginRange(t *testing.T) {
	r := httptest.NewRequest("GET", "/api/game/players?loginFrom=2026-09-19&loginTo=2026-09-01", nil)
	if _, err := parsePlayerFilters(r); err == nil {
		t.Fatal("expected inverted login range")
	}
}

func TestPlayerItemPayloadKeepsOnlyDirectAgentAndNoOptimization(t *testing.T) {
	payload, err := json.Marshal(playerItem{AgentID: "123456", AgentName: "直属代理"})
	if err != nil {
		t.Fatalf("marshal player item: %v", err)
	}
	value := string(payload)
	for _, expected := range []string{`"agentId":"123456"`, `"agentName":"直属代理"`} {
		if !strings.Contains(value, expected) {
			t.Fatalf("direct agent field missing from payload: %s", value)
		}
	}
	for _, removed := range []string{
		"bigAgentId", "partnerAgentId", "chiefAgentId",
		"optimizeOneCount", "optimizeOneChance", "optimizeTwoCount", "optimizeTwoChance",
	} {
		if strings.Contains(value, removed) {
			t.Fatalf("removed player detail field %q leaked into payload: %s", removed, value)
		}
	}
}
