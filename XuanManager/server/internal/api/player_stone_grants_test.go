package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGrantPlayerStoneValidatesInputBeforeTouchingGameServer(t *testing.T) {
	cases := []struct {
		name     string
		playerID string
		body     string
	}{
		{"bad player id", "abc", `{"amount":100,"reason":"活动奖励","expectedStone":0,"confirm":true}`},
		{"short player id", "12345", `{"amount":100,"reason":"活动奖励","expectedStone":0,"confirm":true}`},
		{"zero amount", "123456", `{"amount":0,"reason":"活动奖励","expectedStone":0,"confirm":true}`},
		{"negative amount", "123456", `{"amount":-100,"reason":"活动奖励","expectedStone":0,"confirm":true}`},
		{"too large", "123456", `{"amount":1000001,"reason":"活动奖励","expectedStone":0,"confirm":true}`},
		{"short reason", "123456", `{"amount":100,"reason":"a","expectedStone":0,"confirm":true}`},
		{"missing confirm", "123456", `{"amount":100,"reason":"活动奖励","expectedStone":0}`},
	}
	for _, test := range cases {
		request := httptest.NewRequest(http.MethodPost, "/api/game/players/"+test.playerID+"/stone-grants",
			strings.NewReader(test.body))
		request.SetPathValue("playerId", test.playerID)
		response := httptest.NewRecorder()
		server := &Server{}
		server.handleGrantPlayerStone(response, request, principal{IsSuper: true})
		if response.Code != http.StatusBadRequest {
			t.Fatalf("%s: expected 400 before reaching the game server, got %d: %s",
				test.name, response.Code, response.Body.String())
		}
	}
}

func TestEnrichPlayerStoneGrantRecordReadsAuditJSON(t *testing.T) {
	item := playerStoneGrantRecord{OperatorName: "admin"}
	enrichPlayerStoneGrantRecord(&item,
		`{"amount":100,"reason":" 活动奖励 ","context":"xuan-player-stone-abc"}`,
		`{"stone":10}`,
		`{"stone":110,"verified":true}`)
	if item.Amount != 100 || item.Reason != "活动奖励" || item.Context != "xuan-player-stone-abc" ||
		item.StoneBefore != 10 || item.StoneAfter != 110 {
		t.Fatalf("unexpected enriched record: %#v", item)
	}
}

func TestPlayerStoneGrantFilterRejectsInvalidDates(t *testing.T) {
	for _, query := range []string{"from=2026-11-09a", "to=not-a-date", "from=2026-11-10&to=2026-11-09"} {
		request := httptest.NewRequest(http.MethodGet, "/api/game/players/stone-grants?"+query, nil)
		if _, err := parsePlayerStoneGrantFilter(request); err == nil {
			t.Fatalf("query %q should be rejected", query)
		}
	}
	request := httptest.NewRequest(http.MethodGet, "/api/game/players/stone-grants?from=2026-11-01&to=2026-11-09&keyword=123456", nil)
	filter, err := parsePlayerStoneGrantFilter(request)
	if err != nil || filter.From != "2026-11-01" || filter.To != "2026-11-09" || filter.Keyword != "123456" {
		t.Fatalf("valid filter = %#v, %v", filter, err)
	}
}
