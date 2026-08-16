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

func TestValidateGamePlayerPassword(t *testing.T) {
	for _, value := range []string{"123123", "安全密码六位", "Abc~123"} {
		if err := validateGamePlayerPassword(value); err != nil {
			t.Fatalf("valid password %q rejected: %v", value, err)
		}
	}
	for _, value := range []string{"12345", strings.Repeat("长", 33), " 123123", "12312\n3"} {
		if err := validateGamePlayerPassword(value); err == nil {
			t.Fatalf("invalid password %q accepted", value)
		}
	}
}

func TestParsePlayerGPS(t *testing.T) {
	lat, lng, message := parsePlayerGPS("31.234527,121.287689")
	if lat == nil || lng == nil || *lat != 31.234527 || *lng != 121.287689 || !strings.Contains(message, "WGS84") {
		t.Fatalf("unexpected parsed GPS: %v %v %q", lat, lng, message)
	}
	for _, value := range []string{"", "0,0", "121.2", "91,121", "31,181", "abc,def"} {
		lat, lng, _ := parsePlayerGPS(value)
		if lat != nil || lng != nil {
			t.Fatalf("invalid GPS %q accepted: %v %v", value, lat, lng)
		}
	}
}

func TestGetPlayerSensitiveInfoRequiresProtectedRoot(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/game/players/565923/sensitive", nil)
	request.SetPathValue("playerId", "565923")
	response := httptest.NewRecorder()
	server := &Server{}
	server.handleGetPlayerSensitiveInfo(response, request, principal{IsSuper: true})
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "PROTECTED_ROOT_REQUIRED") {
		t.Fatalf("unexpected response: %d %s", response.Code, response.Body.String())
	}
}

func TestResetPlayerPasswordRequiresExplicitConfirmation(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/game/players/565923/password", bytes.NewBufferString(`{"password":"123123","confirm":false}`))
	request.SetPathValue("playerId", "565923")
	response := httptest.NewRecorder()
	server := &Server{}
	server.handleResetPlayerPassword(response, request, principal{})
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "PLAYER_PASSWORD_CONFIRM_REQUIRED") {
		t.Fatalf("unexpected response: %d %s", response.Code, response.Body.String())
	}
}

func TestSetPlayerLoginPasswordUsesOfficialGameCommand(t *testing.T) {
	client := fakeGameHTTPClient(func(request *http.Request) (*http.Response, error) {
		if request.URL.Query().Get("header") != "异步_设置_玩家_属性" {
			t.Fatalf("unexpected command: %s", request.URL.Query().Get("header"))
		}
		var params map[string]any
		if err := json.Unmarshal([]byte(request.URL.Query().Get("param")), &params); err != nil {
			t.Fatalf("decode params: %v", err)
		}
		if params["guuid"] != "565923" || params["name"] != "userPWD" || params["value"] != "654321" || params["context"] != "test-context" {
			t.Fatalf("unexpected params: %#v", params)
		}
		return gameHTTPResponse(`{"ret_code":512,"ret_result":""}`), nil
	})
	server := &Server{cfg: config.Config{GameAdminURL: "http://127.0.0.1:8890"}, gameHTTPClient: client}
	if err := server.setPlayerLoginPassword(context.Background(), "565923", "654321", "test-context"); err != nil {
		t.Fatalf("setPlayerLoginPassword: %v", err)
	}
}
