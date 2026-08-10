package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"xuanmanager/internal/config"
)

func TestMaskDeviceID(t *testing.T) {
	cases := map[string]string{
		"":                                     "",
		"a":                                    "••••",
		"12345678":                             "1••••8",
		"9f12c588-3c79-46de-9974-b8373423d2c8": "9f12••••d2c8",
	}
	for input, expected := range cases {
		if actual := maskDeviceID(input); actual != expected {
			t.Fatalf("maskDeviceID(%q) = %q, want %q", input, actual, expected)
		}
	}
}

func TestBuildAntiTheftWhereIsParameterized(t *testing.T) {
	where, args := buildAntiTheftWhere("565923", "enabled", "web")
	if strings.Contains(where, "565923") || !strings.Contains(where, "m.player_guuid = ?") || !strings.Contains(where, "m.device_platform") {
		t.Fatalf("unsafe or incomplete where: %s", where)
	}
	if len(args) != 5 || args[4] != "web" {
		t.Fatalf("args = %#v", args)
	}
}

func TestNormalizeAntiTheftUnbindReason(t *testing.T) {
	code, reason, err := normalizeAntiTheftUnbindReason("DEVICE_LOST", "  已核对   注册资料  ")
	if err != nil || code != "DEVICE_LOST" || reason != "已核对 注册资料" {
		t.Fatalf("normalized = %q %q, %v", code, reason, err)
	}
	if _, _, err := normalizeAntiTheftUnbindReason("UNKNOWN", "已核对"); err == nil {
		t.Fatal("unknown reason code should be rejected")
	}
	if _, _, err := normalizeAntiTheftUnbindReason("OTHER", "第一行\n第二行"); err == nil {
		t.Fatal("newline should be rejected")
	}
}

func TestRequestAntiTheftUnbindUsesKBCommand(t *testing.T) {
	client := fakeGameHTTPClient(func(r *http.Request) (*http.Response, error) {
		if r.URL.Query().Get("header") != "异步_解除_玩家_防盗号绑定" {
			t.Fatalf("unexpected header: %s", r.URL.Query().Get("header"))
		}
		var params map[string]any
		if err := json.Unmarshal([]byte(r.URL.Query().Get("param")), &params); err != nil {
			t.Fatalf("decode param: %v", err)
		}
		if params["player_guuid"] != "565923" || params["login_name"] != "player01" || params["reason_code"] != "DEVICE_LOST" || params["request_id"] != "request-1" {
			t.Fatalf("unexpected params: %#v", params)
		}
		return gameHTTPResponse(`{"ret_code":512,"ret_result":""}`), nil
	})
	s := &Server{cfg: config.Config{GameAdminURL: "http://127.0.0.1:8890"}, gameHTTPClient: client}
	if err := s.requestAntiTheftUnbind(context.Background(), "565923", "player01", "DEVICE_LOST", "request-1"); err != nil {
		t.Fatalf("requestAntiTheftUnbind: %v", err)
	}
}

func TestUnbindAntiTheftRequiresExplicitConfirmation(t *testing.T) {
	s := &Server{}
	request := httptest.NewRequest(http.MethodPost, "/api/game/anti-theft/565923/unbind", bytes.NewBufferString(`{"reasonCode":"DEVICE_LOST","reason":"已核对注册资料","confirm":false}`))
	request.SetPathValue("playerId", "565923")
	response := httptest.NewRecorder()
	s.handleUnbindAntiTheftAccount(response, request, principal{})
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "ANTI_THEFT_UNBIND_CONFIRM_REQUIRED") {
		t.Fatalf("unexpected response: %d %s", response.Code, response.Body.String())
	}
}
