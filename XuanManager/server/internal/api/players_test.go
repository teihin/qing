package api

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParsePlayerFilters(t *testing.T) {
	r := httptest.NewRequest("GET", "/api/game/players?playerId=292989&name=test&agentId=648425&agentName=agent&level=98&roomId=0&minBalance=-10.5&maxBalance=200&registeredFrom=2026-08-01&registeredTo=2026-08-09", nil)
	filters, err := parsePlayerFilters(r)
	if err != nil {
		t.Fatalf("parse filters: %v", err)
	}
	if filters.PlayerID != "292989" || filters.AgentID != "648425" || filters.Level == nil || *filters.Level != 98 {
		t.Fatalf("unexpected filters: %#v", filters)
	}
	where, args := buildPlayerWhere(filters)
	if strings.Contains(where, filters.PlayerID) || strings.Contains(where, filters.AgentID) {
		t.Fatalf("query values must not be interpolated: %s", where)
	}
	if !strings.Contains(where, "a.sm_guuid = ?") || !strings.Contains(where, "agent.sm_name LIKE ?") || len(args) != 10 {
		t.Fatalf("unexpected where clause or args: %s %#v", where, args)
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
}
