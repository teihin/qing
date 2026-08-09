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

func TestNormalizeGamePlayerID(t *testing.T) {
	valid, err := normalizeGamePlayerID(" 565923 ")
	if err != nil || valid != "565923" {
		t.Fatalf("valid player ID rejected: %q %v", valid, err)
	}
	for _, input := range []string{"", "12345", "1234567", "12345a", "１２３４５６"} {
		if _, err := normalizeGamePlayerID(input); err == nil {
			t.Fatalf("invalid player ID %q accepted", input)
		}
	}
}

func TestNormalizeBanReason(t *testing.T) {
	reason, err := normalizeBanReason("")
	if err != nil || reason != defaultBanReason {
		t.Fatalf("default ban reason = %q, %v", reason, err)
	}
	reason, err = normalizeBanReason("  违规操作   请联系客服  ")
	if err != nil || reason != "违规操作 请联系客服" {
		t.Fatalf("normalized reason = %q, %v", reason, err)
	}
	if _, err := normalizeBanReason("第一行\n第二行"); err == nil {
		t.Fatal("newline should be rejected")
	}
	if _, err := normalizeBanReason(strings.Repeat("封", 121)); err == nil {
		t.Fatal("reason over 120 characters should be rejected")
	}
}

func TestBuildBannedPlayerWhereIsParameterized(t *testing.T) {
	where, args := buildBannedPlayerWhere("565923")
	if strings.Contains(where, "565923") || !strings.Contains(where, "a.sm_guuid = ?") {
		t.Fatalf("unsafe or incomplete where: %s", where)
	}
	if len(args) != 5 {
		t.Fatalf("args = %#v", args)
	}
}

func TestSetPlayerClientStatusUsesOfficialGameCommand(t *testing.T) {
	client := fakeGameHTTPClient(func(r *http.Request) (*http.Response, error) {
		if r.URL.Query().Get("header") != "异步_设置_玩家_属性" {
			t.Fatalf("unexpected header: %s", r.URL.Query().Get("header"))
		}
		var params map[string]any
		if err := json.Unmarshal([]byte(r.URL.Query().Get("param")), &params); err != nil {
			t.Fatalf("decode param: %v", err)
		}
		if params["guuid"] != "565923" || params["name"] != "client_status" || params["value"] != "测试封号" || params["context"] != "test-context" {
			t.Fatalf("unexpected params: %#v", params)
		}
		return gameHTTPResponse(`{"ret_code":512,"ret_result":""}`), nil
	})
	s := &Server{cfg: config.Config{GameAdminURL: "http://127.0.0.1:8890"}, gameHTTPClient: client}
	if err := s.setPlayerClientStatus(context.Background(), "565923", "测试封号", "test-context"); err != nil {
		t.Fatalf("setPlayerClientStatus: %v", err)
	}
}

func TestCreatePlayerBanRequiresExplicitConfirmation(t *testing.T) {
	s := &Server{}
	body := bytes.NewBufferString(`{"playerId":"565923","reason":"测试提示","confirm":false}`)
	request := httptest.NewRequest(http.MethodPost, "/api/game/bans", body)
	response := httptest.NewRecorder()
	s.handleCreatePlayerBan(response, request, principal{})
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "BAN_CONFIRM_REQUIRED") {
		t.Fatalf("unexpected response: %d %s", response.Code, response.Body.String())
	}
}

func TestRemovePlayerBanRequiresExplicitConfirmation(t *testing.T) {
	s := &Server{}
	request := httptest.NewRequest(http.MethodPost, "/api/game/bans/565923/unban", bytes.NewBufferString(`{"confirm":false}`))
	request.SetPathValue("playerId", "565923")
	response := httptest.NewRecorder()
	s.handleRemovePlayerBan(response, request, principal{})
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "UNBAN_CONFIRM_REQUIRED") {
		t.Fatalf("unexpected response: %d %s", response.Code, response.Body.String())
	}
}
