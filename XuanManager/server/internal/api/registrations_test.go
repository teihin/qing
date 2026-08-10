package api

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"xuanmanager/internal/config"
)

func TestNormalizeGameRegistration(t *testing.T) {
	input := gameRegistrationRequest{
		InvitationCode:   " 648425 ",
		Nickname:         " 测试Player ",
		LoginName:        "User001",
		Password:         "abc123!",
		AvatarIndex:      "100",
		AntiTheftEnabled: true,
		DeviceID:         "550e8400-e29b-41d4-a716-446655440000",
		DevicePlatform:   "web",
		DeviceVersion:    1,
	}
	got, err := normalizeGameRegistration(input)
	if err != nil {
		t.Fatalf("normalize registration: %v", err)
	}
	if got.InvitationCode != "648425" || got.Nickname != "测试Player" || got.LoginName != "User001" || got.Password != "abc123!" || got.AvatarIndex != "100" || !got.AntiTheftEnabled || got.DevicePlatform != "web" {
		t.Fatalf("unexpected registration: %#v", got)
	}
}

func TestNormalizeGameRegistrationSupportsDocumentAliases(t *testing.T) {
	input := gameRegistrationRequest{
		UpperGUID:    "648425",
		PlayerWXName: "临时玩家",
		PlayerWXID:   "Player1",
		Password:     "111111",
		Photo:        "20",
	}
	got, err := normalizeGameRegistration(input)
	if err != nil {
		t.Fatalf("normalize aliases: %v", err)
	}
	if got.InvitationCode != input.UpperGUID || got.LoginName != input.PlayerWXID || got.Nickname != input.PlayerWXName || got.AvatarIndex != input.Photo {
		t.Fatalf("unexpected alias mapping: %#v", got)
	}
}

func TestNormalizeGameRegistrationRejectsInvalidInput(t *testing.T) {
	tests := []gameRegistrationRequest{
		{InvitationCode: "12345", Nickname: "玩家", LoginName: "9001011", Password: "111111"},
		{InvitationCode: "abc123", Nickname: "玩家", LoginName: "User001", Password: "111111"},
		{InvitationCode: "648425", Nickname: "玩家", LoginName: "user_01", Password: "111111"},
		{InvitationCode: "648425", Nickname: "玩家", LoginName: "user01", Password: "111111"},
		{InvitationCode: "648425", Nickname: "玩家", LoginName: "abcdefghijklmno", Password: "111111"},
		{InvitationCode: "648425", Nickname: "", LoginName: "9001011", Password: "111111"},
		{InvitationCode: "648425", Nickname: "玩家1", LoginName: "9001011", Password: "111111"},
		{InvitationCode: "648425", Nickname: "玩家!", LoginName: "9001011", Password: "111111"},
		{InvitationCode: "648425", Nickname: "玩\n家", LoginName: "9001011", Password: "111111"},
		{InvitationCode: "648425", Nickname: "玩家", LoginName: "9001011", Password: "12345"},
		{InvitationCode: "648425", Nickname: "玩家", LoginName: "9001011", Password: " 111111"},
		{InvitationCode: "648425", UpperGUID: "648426", Nickname: "玩家", LoginName: "9001011", Password: "111111"},
		{InvitationCode: "648425", Nickname: "玩家", LoginName: "9001011", Password: "111111", AvatarIndex: "0"},
		{InvitationCode: "648425", Nickname: "玩家", LoginName: "9001011", Password: "111111", AvatarIndex: "101"},
		{InvitationCode: "648425", Nickname: "玩家", LoginName: "9001011", Password: "111111", AvatarIndex: "01"},
		{InvitationCode: "648425", Nickname: "玩家", LoginName: "9001011", Password: "111111", AvatarIndex: "2", Photo: "3"},
		{InvitationCode: "648425", Nickname: "玩家", LoginName: "9001011", Password: "111111", AntiTheftEnabled: true},
		{InvitationCode: "648425", Nickname: "玩家", LoginName: "9001011", Password: "111111", AntiTheftEnabled: true, DeviceID: "bad id", DevicePlatform: "web", DeviceVersion: 1},
		{InvitationCode: "648425", Nickname: "玩家", LoginName: "9001011", Password: "111111", AntiTheftEnabled: true, DeviceID: "550e8400-e29b-41d4-a716-446655440000", DevicePlatform: "WEB", DeviceVersion: 1},
		{InvitationCode: "648425", Nickname: "玩家", LoginName: "9001011", Password: "111111", AntiTheftEnabled: true, DeviceID: "550e8400-e29b-41d4-a716-446655440000", DevicePlatform: "web", DeviceVersion: 2},
	}
	for index, input := range tests {
		if _, err := normalizeGameRegistration(input); err == nil {
			t.Fatalf("case %d: expected validation error", index)
		}
	}
}

func TestRegistrationLoginNameLengthBounds(t *testing.T) {
	for _, value := range []string{"A123456", "A1234567890123"} {
		if !isRegistrationLoginName(value) {
			t.Fatalf("expected valid login name: %q", value)
		}
	}
	for _, value := range []string{"A12345", "A12345678901234", "A123_456"} {
		if isRegistrationLoginName(value) {
			t.Fatalf("expected invalid login name: %q", value)
		}
	}
}

func TestSetRegistrationAvatarUsesGamePropertyCommand(t *testing.T) {
	client := fakeGameHTTPClient(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path != "/hall/command" || r.URL.Query().Get("header") != "异步_设置_玩家_属性" {
			t.Fatalf("unexpected request: %s %s", r.URL.Path, r.URL.RawQuery)
		}
		var params map[string]any
		if err := json.Unmarshal([]byte(r.URL.Query().Get("param")), &params); err != nil {
			t.Fatalf("decode params: %v", err)
		}
		if params["guuid"] != "292989" || params["name"] != "photo" || params["value"] != "12" {
			t.Fatalf("unexpected params: %#v", params)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body:       io.NopCloser(strings.NewReader(`{"ret_code":1280,"ret_result":{}}`)),
		}, nil
	})
	s := &Server{
		cfg:            config.Config{GameAdminURL: "http://127.0.0.1:8890"},
		gameHTTPClient: client,
	}
	if err := s.setRegistrationAvatar(context.Background(), "292989", "12"); err != nil {
		t.Fatalf("set registration avatar: %v", err)
	}
}

func TestRegistrationRateLimiter(t *testing.T) {
	limiter := newRegistrationRateLimiter(2, time.Minute)
	now := time.Unix(100, 0)
	if allowed, _ := limiter.allow("127.0.0.1", now); !allowed {
		t.Fatal("first request should be allowed")
	}
	if allowed, _ := limiter.allow("127.0.0.1", now.Add(time.Second)); !allowed {
		t.Fatal("second request should be allowed")
	}
	if allowed, retryAfter := limiter.allow("127.0.0.1", now.Add(2*time.Second)); allowed || retryAfter <= 0 {
		t.Fatalf("third request should be rate limited, retryAfter=%s", retryAfter)
	}
	if allowed, _ := limiter.allow("127.0.0.1", now.Add(time.Minute)); !allowed {
		t.Fatal("request after the window should be allowed")
	}
}

func TestGameRegistrationPublicRouteValidation(t *testing.T) {
	handler := New(nil, config.Config{}, slog.Default())
	request := httptest.NewRequest(http.MethodPost, "/api/game/registrations", strings.NewReader(`{"invitationCode":"123","nickname":"玩家","loginName":"9001011","password":"111111"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if response.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Fatal("public registration route must expose CORS headers")
	}
}

func TestGameRegistrationOptions(t *testing.T) {
	handler := New(nil, config.Config{}, slog.Default())
	request := httptest.NewRequest(http.MethodOptions, "/api/game/registrations", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("status = %d", response.Code)
	}
}

func TestClientIPUsesLastForwardedAddressOnlyFromLoopback(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.RemoteAddr = "127.0.0.1:12345"
	request.Header.Set("X-Forwarded-For", "203.0.113.1, 198.51.100.7")
	if got := clientIP(request); got != "198.51.100.7" {
		t.Fatalf("clientIP = %q", got)
	}

	request.RemoteAddr = "192.0.2.10:12345"
	if got := clientIP(request); got != "192.0.2.10" {
		t.Fatalf("untrusted forwarded clientIP = %q", got)
	}
}
