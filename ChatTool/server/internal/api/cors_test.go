package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"chattool/internal/config"
)

func TestDirectCORSPrefightForLocalCocosPreview(t *testing.T) {
	server := &Server{cfg: config.Config{DirectCORSOrigins: []string{"http://localhost:7456"}}}
	handler := server.browserCORS(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Fatal("allowed preflight must not reach the API handler")
	}))

	request := httptest.NewRequest(http.MethodOptions, "/api/direct/session", nil)
	request.Header.Set("Origin", "http://localhost:7456")
	request.Header.Set("Access-Control-Request-Method", http.MethodPost)
	request.Header.Set("Access-Control-Request-Headers", "content-type,x-direct-token")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("preflight status = %d, want %d", response.Code, http.StatusNoContent)
	}
	if got := response.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:7456" {
		t.Fatalf("allow origin = %q", got)
	}
	if got := response.Header().Get("Access-Control-Allow-Methods"); got != "GET, POST, DELETE, OPTIONS" {
		t.Fatalf("allow methods = %q", got)
	}
}

func TestDirectCORSAddsHeaderToAllowedResponse(t *testing.T) {
	server := &Server{cfg: config.Config{DirectCORSOrigins: []string{"http://localhost:7456"}}}
	handler := server.browserCORS(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))

	request := httptest.NewRequest(http.MethodPost, "/api/direct/session", nil)
	request.Header.Set("Origin", "http://localhost:7456")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("API status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	if got := response.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:7456" {
		t.Fatalf("allow origin = %q", got)
	}
}

func TestDirectCORSRejectsUnknownPreflightOrigin(t *testing.T) {
	server := &Server{cfg: config.Config{DirectCORSOrigins: []string{"http://localhost:7456"}}}
	handler := server.browserCORS(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Fatal("unknown preflight must not reach the API handler")
	}))

	request := httptest.NewRequest(http.MethodOptions, "/api/direct/session", nil)
	request.Header.Set("Origin", "http://evil.example")
	request.Header.Set("Access-Control-Request-Method", http.MethodPost)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("unknown origin status = %d, want %d", response.Code, http.StatusForbidden)
	}
	if response.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("unknown origin must not receive allow-origin")
	}
}

func TestPlayerCORSPreflightForLocalCocosPreview(t *testing.T) {
	server := &Server{cfg: config.Config{DirectCORSOrigins: []string{"http://localhost:7456"}}}
	handler := server.browserCORS(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Fatal("allowed preflight must not reach the API handler")
	}))

	request := httptest.NewRequest(http.MethodOptions, "/api/player/session", nil)
	request.Header.Set("Origin", "http://localhost:7456")
	request.Header.Set("Access-Control-Request-Method", http.MethodPost)
	request.Header.Set("Access-Control-Request-Headers", "content-type,x-player-embedded-token,x-player-session-ref")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("preflight status = %d, want %d", response.Code, http.StatusNoContent)
	}
	if got := response.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:7456" {
		t.Fatalf("allow origin = %q", got)
	}
	if got := response.Header().Get("Access-Control-Allow-Methods"); got != "GET, POST, OPTIONS" {
		t.Fatalf("allow methods = %q", got)
	}
	allowHeaders := response.Header().Get("Access-Control-Allow-Headers")
	for _, header := range []string{"X-Player-Embedded-Token", "X-Player-Session-Ref"} {
		if !strings.Contains(allowHeaders, header) {
			t.Fatalf("allow headers %q missing %q", allowHeaders, header)
		}
	}
}

func TestPlayerCORSAddsHeaderToAllowedResponse(t *testing.T) {
	server := &Server{cfg: config.Config{DirectCORSOrigins: []string{"http://localhost:7456"}}}
	handler := server.browserCORS(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))

	request := httptest.NewRequest(http.MethodPost, "/api/player/messages", nil)
	request.Header.Set("Origin", "http://localhost:7456")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("API status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	if got := response.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:7456" {
		t.Fatalf("allow origin = %q", got)
	}
}

func TestPlayerCORSRejectsDirectOnlyHeader(t *testing.T) {
	server := &Server{cfg: config.Config{DirectCORSOrigins: []string{"http://localhost:7456"}}}
	handler := server.browserCORS(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Fatal("preflight with a direct-only header must not reach the API handler")
	}))

	request := httptest.NewRequest(http.MethodOptions, "/api/player/messages", nil)
	request.Header.Set("Origin", "http://localhost:7456")
	request.Header.Set("Access-Control-Request-Method", http.MethodPost)
	request.Header.Set("Access-Control-Request-Headers", "content-type,x-direct-token")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("preflight status = %d, want %d", response.Code, http.StatusForbidden)
	}
}

func TestMediaCORSAddsHeaderToAllowedImageResponse(t *testing.T) {
	server := &Server{cfg: config.Config{DirectCORSOrigins: []string{"http://localhost:7456"}}}
	handler := server.browserCORS(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	request := httptest.NewRequest(http.MethodGet, "/api/media/0123456789abcdef0123456789abcdef?ticket=x", nil)
	request.Header.Set("Origin", "http://localhost:7456")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("media status = %d, want %d", response.Code, http.StatusOK)
	}
	if got := response.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:7456" {
		t.Fatalf("allow origin = %q", got)
	}
}

func TestCORSIgnoresAgentAPI(t *testing.T) {
	server := &Server{cfg: config.Config{DirectCORSOrigins: []string{"http://localhost:7456"}}}
	called := false
	handler := server.browserCORS(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusNoContent)
	}))

	request := httptest.NewRequest(http.MethodOptions, "/api/agent/auth/login", nil)
	request.Header.Set("Origin", "http://localhost:7456")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if !called || response.Code != http.StatusNoContent {
		t.Fatal("agent API should bypass browser CORS handling")
	}
	if response.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("agent API must not receive CORS headers")
	}
}
