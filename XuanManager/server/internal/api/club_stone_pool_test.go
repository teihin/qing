package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNormalizeClubStonePoolAction(t *testing.T) {
	for _, test := range []struct{ input, want string }{
		{" ADD ", "add"},
		{"subtract", "subtract"},
	} {
		value, err := normalizeClubStonePoolAction(test.input)
		if err != nil || value != test.want {
			t.Fatalf("action %q: got %q %v, want %q", test.input, value, err, test.want)
		}
	}
	for _, value := range []string{"", "remove"} {
		if _, err := normalizeClubStonePoolAction(value); err == nil {
			t.Fatalf("action %q should be rejected", value)
		}
	}
}

func TestAdjustClubStonePoolValidatesInputBeforeTouchingGameServer(t *testing.T) {
	cases := []struct {
		name string
		club string
		body string
	}{
		{"bad club id", "abc", `{"action":"add","amount":100,"reason":"运营调整","expectedStone":0,"confirm":true}`},
		{"missing action", "123456", `{"amount":100,"reason":"运营调整","expectedStone":0,"confirm":true}`},
		{"zero amount", "123456", `{"action":"add","amount":0,"reason":"运营调整","expectedStone":0,"confirm":true}`},
		{"negative amount", "123456", `{"action":"subtract","amount":-100,"reason":"运营调整","expectedStone":0,"confirm":true}`},
		{"too large", "123456", `{"action":"add","amount":1000001,"reason":"运营调整","expectedStone":0,"confirm":true}`},
		{"short reason", "123456", `{"action":"add","amount":100,"reason":"a","expectedStone":0,"confirm":true}`},
		{"missing confirm", "123456", `{"action":"add","amount":100,"reason":"运营调整","expectedStone":0}`},
	}
	for _, test := range cases {
		request := httptest.NewRequest(http.MethodPost, "/api/game/clubs/"+test.club+"/stone-pool-adjustments",
			strings.NewReader(test.body))
		request.SetPathValue("clubId", test.club)
		response := httptest.NewRecorder()
		server := &Server{}
		server.handleAdjustClubStonePool(response, request, principal{IsSuper: true})
		if response.Code != http.StatusBadRequest {
			t.Fatalf("%s: expected 400 before reaching the game server, got %d: %s",
				test.name, response.Code, response.Body.String())
		}
	}
}
