package api

import (
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
