package config

import (
	"strings"
	"testing"
)

func TestPublicPath(t *testing.T) {
	tests := map[string]string{
		"":           "/",
		"/":          "/",
		"/chattool":  "/chattool",
		"/chattool/": "/chattool",
	}
	for input, expected := range tests {
		if got := publicPath(input); got != expected {
			t.Fatalf("publicPath(%q) = %q, expected %q", input, got, expected)
		}
	}
}

func TestLoadHTTPIPSubPath(t *testing.T) {
	t.Setenv("CHAT_PUBLIC_BASE_URL", "http://154.37.155.17/chattool/")
	t.Setenv("CHAT_COOKIE_SECURE", "false")
	t.Setenv("CHAT_DB_USER", "chattool_test")
	t.Setenv("CHAT_DB_PASSWORD", "not-a-real-password")
	t.Setenv("CHAT_PLAYER_LINK_KEY", strings.Repeat("a", 32))

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.PublicBaseURL != "http://154.37.155.17/chattool" || cfg.CookiePath != "/chattool" || cfg.CookieSecure {
		t.Fatalf("unexpected HTTP IP configuration: %+v", cfg)
	}
	if cfg.MessageRetention.Hours() != 48 {
		t.Fatalf("unexpected message retention: %s", cfg.MessageRetention)
	}
}
