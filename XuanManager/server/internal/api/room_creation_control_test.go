package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"xuanmanager/internal/config"
)

func TestParseRoomCreationAllowed(t *testing.T) {
	for _, test := range []struct {
		raw  string
		want bool
	}{{"true", true}, {" TRUE ", true}, {"false", false}, {"False", false}} {
		got, err := parseRoomCreationAllowed(test.raw)
		if err != nil || got != test.want {
			t.Fatalf("parse %q = %v, %v", test.raw, got, err)
		}
	}
	if _, err := parseRoomCreationAllowed("1"); err == nil {
		t.Fatal("non-boolean room creation value should be rejected")
	}
}

func TestDecodeConfigurationTextSupportsJSONBoolean(t *testing.T) {
	for _, raw := range []string{"true", "false"} {
		got, err := decodeConfigurationText(json.RawMessage(raw))
		if err != nil || got != raw {
			t.Fatalf("decode %s = %q, %v", raw, got, err)
		}
	}
}

func TestSetRoomCreationAllowedUsesJSONBoolean(t *testing.T) {
	client := fakeGameHTTPClient(func(request *http.Request) (*http.Response, error) {
		if request.URL.Query().Get("header") != "设置_大厅_配置数据" {
			t.Fatalf("unexpected header: %s", request.URL.Query().Get("header"))
		}
		var params map[string]any
		if err := json.Unmarshal([]byte(request.URL.Query().Get("param")), &params); err != nil {
			t.Fatalf("decode params: %v", err)
		}
		if params["param_name"] != roomCreationAllowedConfigKey || params["param_value"] != false || params["context"] != "admin-close-all-create-room" {
			t.Fatalf("unexpected params: %#v", params)
		}
		if _, stringValue := params["param_value"].(string); stringValue {
			t.Fatalf("param_value must be JSON boolean: %#v", params["param_value"])
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(`{"ret_code":512,"ret_result":{}}`))}, nil
	})
	s := &Server{cfg: config.Config{GameAdminURL: "http://127.0.0.1:8890"}, gameHTTPClient: client}
	if err := s.setRoomCreationAllowed(context.Background(), false, "admin-close-all-create-room"); err != nil {
		t.Fatalf("setRoomCreationAllowed: %v", err)
	}
}

func TestRoomCreationControlRequiresConfirmationBeforeGameCall(t *testing.T) {
	called := false
	client := fakeGameHTTPClient(func(request *http.Request) (*http.Response, error) {
		called = true
		return nil, nil
	})
	s := &Server{cfg: config.Config{GameAdminURL: "http://127.0.0.1:8890"}, gameHTTPClient: client}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPut, "/api/game/room-maintenance/creation-control", strings.NewReader(`{"allowed":false,"expectedAllowed":true,"confirm":false}`))
	request.Header.Set("Content-Type", "application/json")
	s.handleUpdateRoomCreationControl(recorder, request, principal{})
	if recorder.Code != http.StatusBadRequest || !strings.Contains(recorder.Body.String(), "ROOM_CREATION_CONTROL_CONFIRM_REQUIRED") {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if called {
		t.Fatal("game service must not be called before explicit confirmation")
	}
}
