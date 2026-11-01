package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"chattool/internal/config"
)

func TestDirectCORSPrefightForLocalCocosPreview(t *testing.T) {
	server := &Server{cfg: config.Config{DirectCORSOrigins: []string{"http://localhost:7456"}}}
	handler := server.directCORS(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
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
	handler := server.directCORS(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
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
	handler := server.directCORS(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
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

func TestDirectCORSDoesNotAffectCustomerServiceAPI(t *testing.T) {
	server := &Server{cfg: config.Config{DirectCORSOrigins: []string{"http://localhost:7456"}}}
	called := false
	handler := server.directCORS(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusNoContent)
	}))

	request := httptest.NewRequest(http.MethodOptions, "/api/player/session", nil)
	request.Header.Set("Origin", "http://localhost:7456")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if !called || response.Code != http.StatusNoContent {
		t.Fatal("customer service API should bypass direct-chat CORS handling")
	}
	if response.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("customer service API must not receive direct-chat CORS headers")
	}
}
