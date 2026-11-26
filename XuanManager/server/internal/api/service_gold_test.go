package api

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"xuanmanager/internal/config"
)

func TestServiceAuthorizedOnlyLoopbackWithToken(t *testing.T) {
	const token = "0123456789abcdef0123456789abcdef"
	server := &Server{cfg: config.Config{ServiceToken: token}}
	nextCalled := false
	handler := server.serviceAuthorized(func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
		w.WriteHeader(http.StatusNoContent)
	})

	cases := []struct {
		name       string
		remoteAddr string
		forwarded  string
		auth       string
		want       int
		called     bool
	}{
		{name: "ok", remoteAddr: "127.0.0.1:5000", auth: "Bearer " + token, want: http.StatusNoContent, called: true},
		{name: "proxied", remoteAddr: "127.0.0.1:5000", forwarded: "203.0.113.8", auth: "Bearer " + token, want: http.StatusForbidden},
		{name: "remote", remoteAddr: "203.0.113.8:5000", auth: "Bearer " + token, want: http.StatusForbidden},
		{name: "bad token", remoteAddr: "127.0.0.1:5000", auth: "Bearer wrong", want: http.StatusUnauthorized},
	}
	for _, item := range cases {
		t.Run(item.name, func(t *testing.T) {
			nextCalled = false
			request := httptest.NewRequest(http.MethodPost, "/api/service/clubs/1/members/2/gold", strings.NewReader(`{}`))
			request.RemoteAddr = item.remoteAddr
			if item.forwarded != "" {
				request.Header.Set("X-Forwarded-For", item.forwarded)
			}
			if item.auth != "" {
				request.Header.Set("Authorization", item.auth)
			}
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, request)
			if recorder.Code != item.want {
				t.Fatalf("status=%d want=%d", recorder.Code, item.want)
			}
			if nextCalled != item.called {
				t.Fatalf("next called=%v want=%v", nextCalled, item.called)
			}
		})
	}
}

// 客服上分同步额度必须只下发新命令，不得再走「发放_盟主_奖励」。
func TestSyncClubUnionQuotaUsesCreditCommand(t *testing.T) {
	var commands []string
	var params []string
	game := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		commands = append(commands, r.URL.Query().Get("header"))
		params = append(params, r.URL.Query().Get("param"))
		_, _ = w.Write([]byte(`{"ret_code":512,"ret_result":{"club_quota":"100"}}`))
	}))
	defer game.Close()

	s := &Server{
		cfg:            config.Config{GameAdminURL: game.URL},
		gameHTTPClient: game.Client(),
		logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	if message := s.syncClubUnionQuota(context.Background(), "club-1", 100, "cs-hosted-gold-test"); message != "" {
		t.Fatalf("成功时应为空串，实际 %q", message)
	}
	if len(commands) != 1 || commands[0] != clubQuotaCreditCommand {
		t.Fatalf("只应下发新命令，实际 %v", commands)
	}
	if strings.Contains(params[0], "union_id") {
		t.Fatalf("新命令不应再带 union_id: %s", params[0])
	}
}

// 下分同步扣额度仍走同一条命令，金额传负数（游戏命令按符号区分方向）。
func TestSyncClubUnionQuotaSendsNegativeForDebit(t *testing.T) {
	var header, param string
	game := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header = r.URL.Query().Get("header")
		param = r.URL.Query().Get("param")
		_, _ = w.Write([]byte(`{"ret_code":512,"ret_result":{"club_quota":"0"}}`))
	}))
	defer game.Close()

	s := &Server{
		cfg:            config.Config{GameAdminURL: game.URL},
		gameHTTPClient: game.Client(),
		logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	if message := s.syncClubUnionQuota(context.Background(), "club-1", -1100, "cs-hosted-gold-test"); message != "" {
		t.Fatalf("成功时应为空串，实际 %q", message)
	}
	if header != clubQuotaCreditCommand {
		t.Fatalf("上下分应走同一条授信命令，实际 %q", header)
	}
	if !strings.Contains(param, `"quota_fen":-1100`) {
		t.Fatalf("扣减金额应传负数 -1100 分，实际 %s", param)
	}
}
