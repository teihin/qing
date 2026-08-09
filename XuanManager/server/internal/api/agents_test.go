package api

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParseAgentFilters(t *testing.T) {
	r := httptest.NewRequest("GET", "/api/game/agents?keyword=test&type=leader&parentId=648425&parentName=boss&level=98&minPercent=2&maxPercent=20&registeredFrom=2026-08-01&registeredTo=2026-08-09", nil)
	filters, err := parseAgentFilters(r)
	if err != nil {
		t.Fatalf("parse filters: %v", err)
	}
	if filters.Type != "leader" || filters.ParentID != "648425" || filters.Level == nil || *filters.Level != 98 {
		t.Fatalf("unexpected filters: %#v", filters)
	}
	where, args := buildAgentWhere(filters)
	if strings.Contains(where, filters.Keyword) || strings.Contains(where, filters.ParentID) {
		t.Fatalf("query values must not be interpolated: %s", where)
	}
	if !strings.Contains(where, "parent.sm_name LIKE ?") || !strings.Contains(where, "a.sm_big_percent >= ?") || len(args) != 12 {
		t.Fatalf("unexpected where clause or args: %s %#v", where, args)
	}
}

func TestParseAgentFiltersRejectsInvalidValues(t *testing.T) {
	for _, target := range []string{
		"/api/game/agents?type=unknown",
		"/api/game/agents?minPercent=30&maxPercent=20",
		"/api/game/agents?registeredFrom=2026/08/01",
	} {
		r := httptest.NewRequest("GET", target, nil)
		if _, err := parseAgentFilters(r); err == nil {
			t.Fatalf("expected invalid filters for %s", target)
		}
	}
}

func TestClassifyAgent(t *testing.T) {
	tests := []struct {
		boss, leader, partner, chief bool
		level                        int64
		want                         string
	}{
		{boss: true, level: 99, want: "boss"},
		{leader: true, level: 98, want: "leader"},
		{partner: true, level: 100, want: "partner"},
		{chief: true, level: 101, want: "chief"},
		{level: 98, want: "agent"},
		{level: 0, want: "player"},
	}
	for _, test := range tests {
		if got := classifyAgent(test.boss, test.leader, test.partner, test.chief, test.level); got != test.want {
			t.Fatalf("classifyAgent() = %q, want %q", got, test.want)
		}
	}
}

func TestValidAgentID(t *testing.T) {
	for _, id := range []string{"648425", "agent_A-1"} {
		if !validAgentID(id) {
			t.Fatalf("expected valid ID: %s", id)
		}
	}
	for _, id := range []string{"", "../648425", "代理"} {
		if validAgentID(id) {
			t.Fatalf("expected invalid ID: %s", id)
		}
	}
}
