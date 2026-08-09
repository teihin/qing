package api

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParseAgentBonusFilters(t *testing.T) {
	r := httptest.NewRequest("GET", "/api/game/agents/648425/bonuses?type=income&sourcePlayerId=292989&roomId=112859&dateFrom=2026-08-01&dateTo=2026-08-09", nil)
	filters, err := parseAgentBonusFilters(r)
	if err != nil {
		t.Fatalf("parse filters: %v", err)
	}
	if filters.Kind != "income" || filters.SourcePlayerID != "292989" || filters.RoomID != "112859" {
		t.Fatalf("unexpected filters: %#v", filters)
	}
	query, args := buildAgentBonusLedger("648425", filters)
	if strings.Contains(query, filters.SourcePlayerID) || strings.Contains(query, filters.RoomID) || len(args) != 5 {
		t.Fatalf("query must be parameterized: %s %#v", query, args)
	}
	if !strings.Contains(query, "i.winner_guuid = ?") || !strings.Contains(query, "i.roomID = ?") {
		t.Fatalf("missing source filters: %s", query)
	}
}

func TestParseAgentBonusFiltersRejectsInvalidValues(t *testing.T) {
	for _, target := range []string{
		"/api/game/agents/648425/bonuses?type=unknown",
		"/api/game/agents/648425/bonuses?sourcePlayerId=../292989",
		"/api/game/agents/648425/bonuses?roomId=room-1",
		"/api/game/agents/648425/bonuses?dateFrom=2026/08/01",
		"/api/game/agents/648425/bonuses?dateFrom=2026-08-09&dateTo=2026-08-01",
	} {
		r := httptest.NewRequest("GET", target, nil)
		if _, err := parseAgentBonusFilters(r); err == nil {
			t.Fatalf("expected invalid filters for %s", target)
		}
	}
}

func TestBuildAgentBonusLedgerExcludesWithdrawalsForSourceFilters(t *testing.T) {
	query, _ := buildAgentBonusLedger("648425", agentBonusFilters{Kind: "all", SourcePlayerID: "292989"})
	if strings.Contains(query, "usr_activity_info_sub_hongli") {
		t.Fatalf("withdrawals do not have source players and must be excluded: %s", query)
	}
}

func TestBonusFormattingHelpers(t *testing.T) {
	if got := bonusAmount(4401); got != 44.01 {
		t.Fatalf("bonusAmount() = %v", got)
	}
	got := bonusIncomeDescription("test01", "292989", "112859")
	if got != "test01（ID 292989）在房间 112859 产生的代理红利" {
		t.Fatalf("bonusIncomeDescription() = %q", got)
	}
}
