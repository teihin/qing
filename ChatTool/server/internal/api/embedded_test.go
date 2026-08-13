package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"chattool/internal/security"
)

func TestSecurityHeadersAllowOnlyPlayerPageEmbedding(t *testing.T) {
	server := &Server{}
	handler := server.securityHeaders(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	for _, test := range []struct {
		path       string
		embeddable bool
	}{
		{path: "/player", embeddable: true},
		{path: "/player/", embeddable: true},
		{path: "/agent", embeddable: false},
		{path: "/api/player/me", embeddable: false},
	} {
		t.Run(test.path, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, test.path, nil)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)

			policy := response.Header().Get("Content-Security-Policy")
			if test.embeddable {
				if response.Header().Get("X-Frame-Options") != "" {
					t.Fatalf("player page unexpectedly sent X-Frame-Options: %q", response.Header().Get("X-Frame-Options"))
				}
				if !strings.Contains(policy, "frame-ancestors *") {
					t.Fatalf("player page policy does not allow the game frame: %q", policy)
				}
				return
			}
			if response.Header().Get("X-Frame-Options") != "DENY" {
				t.Fatalf("non-player page must deny framing")
			}
			if !strings.Contains(policy, "frame-ancestors 'none'") {
				t.Fatalf("non-player page policy must deny framing: %q", policy)
			}
		})
	}
}

func TestMediaTicketIsScopedAndExpires(t *testing.T) {
	validKey := strings.Repeat("a", 32)
	expiredKey := strings.Repeat("b", 32)
	server := &Server{mediaTickets: map[string]mediaAccessTicket{
		validKey: {
			MediaID:        "media-id",
			ConversationID: "conversation-id",
			ExpiresAt:      time.Now().Add(time.Minute),
		},
		expiredKey: {
			MediaID:        "media-id",
			ConversationID: "conversation-id",
			ExpiresAt:      time.Now().Add(-time.Second),
		},
	}}

	if !server.validMediaTicket(validKey, "media-id", "conversation-id") {
		t.Fatal("valid scoped media ticket was rejected")
	}
	if server.validMediaTicket(validKey, "other-media", "conversation-id") {
		t.Fatal("media ticket was accepted for another media item")
	}
	if server.validMediaTicket(validKey, "media-id", "other-conversation") {
		t.Fatal("media ticket was accepted for another conversation")
	}
	if server.validMediaTicket(expiredKey, "media-id", "conversation-id") {
		t.Fatal("expired media ticket was accepted")
	}
	if _, exists := server.mediaTickets[expiredKey]; exists {
		t.Fatal("expired media ticket was not removed")
	}
}

func TestPlayerMutationAuthorizationModes(t *testing.T) {
	headerRequest := httptest.NewRequest(http.MethodPost, "http://example.invalid/api/player/messages", nil)
	headerRequest.Header.Set("Origin", "null")
	if !playerMutationAllowed(headerRequest, playerPrincipal{HeaderAuth: true}) {
		t.Fatal("embedded bearer request should not depend on cookie CSRF or WebView Origin")
	}

	csrfToken := strings.Repeat("c", 64)
	cookieRequest := httptest.NewRequest(http.MethodPost, "http://chat.example/api/player/messages", nil)
	cookieRequest.Host = "chat.example"
	cookieRequest.Header.Set("Origin", "http://chat.example")
	cookieRequest.Header.Set("X-CSRF-Token", csrfToken)
	principal := playerPrincipal{CSRFHash: security.HashToken(csrfToken)}
	if !playerMutationAllowed(cookieRequest, principal) {
		t.Fatal("same-origin cookie request with valid CSRF was rejected")
	}

	cookieRequest.Header.Set("X-CSRF-Token", "wrong")
	if playerMutationAllowed(cookieRequest, principal) {
		t.Fatal("cookie request with invalid CSRF was accepted")
	}
}
