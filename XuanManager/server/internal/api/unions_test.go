package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNormalizeUnionIDRequiresSixDigits(t *testing.T) {
	if value, err := normalizeUnionID(" 123456 "); err != nil || value != "123456" {
		t.Fatalf("valid union id rejected: %q %v", value, err)
	}
	for _, value := range []string{"", "12345", "1234567", "abcdef"} {
		if _, err := normalizeUnionID(value); err == nil {
			t.Fatalf("union id %q should be rejected", value)
		}
	}
}

func TestParseUnionFiltersRejectsOverlongKeyword(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet,
		"/api/game/unions?keyword="+strings.Repeat("盟", 101), nil)
	if _, err := parseUnionFilters(request); err == nil {
		t.Fatal("overlong union keyword should be rejected")
	}
}

func TestNormalizeUnionQuotaReasonTrimsAndValidates(t *testing.T) {
	if value, err := normalizeUnionQuotaReason("  平台  季度注资 "); err != nil || value != "平台 季度注资" {
		t.Fatalf("reason not normalized: %q %v", value, err)
	}
	if _, err := normalizeUnionQuotaReason("a"); err == nil {
		t.Fatal("too short reason should be rejected")
	}
	if _, err := normalizeUnionQuotaReason("注资\n换行"); err == nil {
		t.Fatal("control characters should be rejected")
	}
}

func TestNormalizeUnionQuotaAction(t *testing.T) {
	for _, test := range []struct{ input, want string }{
		{"", "add"},
		{" ADD ", "add"},
		{"subtract", "subtract"},
	} {
		value, err := normalizeUnionQuotaAction(test.input)
		if err != nil || value != test.want {
			t.Fatalf("action %q: got %q %v, want %q", test.input, value, err, test.want)
		}
	}
	if _, err := normalizeUnionQuotaAction("remove"); err == nil {
		t.Fatal("unknown action should be rejected")
	}
}

func TestAdjustUnionQuotaValidatesInputBeforeTouchingGameServer(t *testing.T) {
	cases := []struct {
		name  string
		union string
		body  string
	}{
		{"bad union id", "abc", `{"action":"add","amountYuan":100,"reason":"运营注资","confirm":true}`},
		{"zero amount", "123456", `{"action":"add","amountYuan":0,"reason":"运营注资","confirm":true}`},
		{"negative amount", "123456", `{"action":"add","amountYuan":-100,"reason":"运营注资","confirm":true}`},
		{"unknown action", "123456", `{"action":"remove","amountYuan":100,"reason":"运营注资","confirm":true}`},
		{"missing confirm", "123456", `{"action":"add","amountYuan":100,"reason":"运营注资"}`},
		{"short reason", "123456", `{"action":"add","amountYuan":100,"reason":"a","confirm":true}`},
		{"too large", "123456", `{"action":"add","amountYuan":1000001,"reason":"运营注资","confirm":true}`},
	}
	for _, test := range cases {
		request := httptest.NewRequest(http.MethodPost, "/api/game/unions/"+test.union+"/quota-adjustments",
			strings.NewReader(test.body))
		request.SetPathValue("unionId", test.union)
		response := httptest.NewRecorder()
		server := &Server{}
		server.handleAdjustUnionQuota(response, request, principal{IsSuper: true})
		if response.Code != http.StatusBadRequest {
			t.Fatalf("%s: expected 400 before reaching the game server, got %d", test.name, response.Code)
		}
	}
}
