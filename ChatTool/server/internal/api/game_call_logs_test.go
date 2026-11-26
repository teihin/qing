package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"chattool/internal/config"
)

func TestGameCallLogsProxiesGameSideLog(t *testing.T) {
	const token = "0123456789abcdef0123456789abcdef"
	var gotAuth, gotPrefix string
	stub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/service/game-call-logs" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		gotAuth = r.Header.Get("Authorization")
		gotPrefix = r.URL.Query().Get("contextPrefix")
		_, _ = w.Write([]byte(`{"ok":true,"data":{"entries":[{"kind":"result","command":"添加_俱乐部_成员_积分","params":"{\"context\":\"cs-hosted-gold-x\"}","retCode":"512","httpStatus":"200","durationMs":"88"}],"updatedAt":"2026-11-26 15:00:00"}}`))
	}))
	defer stub.Close()

	s := &Server{cfg: config.Config{XuanManagerURL: stub.URL, XuanServiceToken: token}}
	recorder := httptest.NewRecorder()
	s.handleGameCallLogs(recorder, httptest.NewRequest(http.MethodGet, "/api/agent/game-call-logs?limit=20", nil),
		agentPrincipal{ID: 5, Username: "admin999", Role: "supervisor", IsSuper: true})

	if recorder.Code != http.StatusOK {
		t.Fatalf("期望 200，得到 %d body=%s", recorder.Code, recorder.Body.String())
	}
	if gotAuth != "Bearer "+token {
		t.Fatalf("服务令牌未透传: %q", gotAuth)
	}
	if gotPrefix != gameCallLogContextPrefix {
		t.Fatalf("context 前缀未透传: %q", gotPrefix)
	}
	var envelope struct {
		OK   bool `json:"ok"`
		Data struct {
			Entries []gameCallLogEntry `json:"entries"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil || !envelope.OK {
		t.Fatalf("返回内容无法解析: %v %s", err, recorder.Body.String())
	}
	if len(envelope.Data.Entries) != 1 || envelope.Data.Entries[0].Command != "添加_俱乐部_成员_积分" {
		t.Fatalf("游戏服返回未透出: %s", recorder.Body.String())
	}
}

func TestGameCallLogsOnlyForRootAgent(t *testing.T) {
	s := &Server{}
	denied := httptest.NewRecorder()
	s.handleGameCallLogs(denied, httptest.NewRequest(http.MethodGet, "/api/agent/game-call-logs", nil),
		agentPrincipal{ID: 7, Username: "kefu001", Role: "supervisor", IsSuper: true})
	if denied.Code != http.StatusForbidden {
		t.Fatalf("普通主管应当 403，得到 %d", denied.Code)
	}
}

func TestGameCallLogsWithoutServiceToken(t *testing.T) {
	s := &Server{cfg: config.Config{XuanManagerURL: "http://127.0.0.1:1"}}
	recorder := httptest.NewRecorder()
	s.handleGameCallLogs(recorder, httptest.NewRequest(http.MethodGet, "/api/agent/game-call-logs", nil),
		agentPrincipal{ID: 5, Username: "admin999"})
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("未配置令牌应当 503，得到 %d", recorder.Code)
	}
	if body := recorder.Body.String(); !strings.Contains(body, "后台服务令牌") {
		t.Fatalf("提示信息不明确: %s", body)
	}
}
