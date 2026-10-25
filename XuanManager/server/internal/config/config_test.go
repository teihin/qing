package config

import "testing"

func TestValidateGameAdminURL(t *testing.T) {
	for _, value := range []string{"http://127.0.0.1:8890", "http://localhost:8890/"} {
		if err := validateGameAdminURL(value); err != nil {
			t.Fatalf("expected valid URL %q: %v", value, err)
		}
	}
	for _, value := range []string{
		"https://127.0.0.1:8890",
		"http://154.37.155.17:8890",
		"http://127.0.0.1:8891",
		"http://127.0.0.1:8890/hall/command",
		"http://user@127.0.0.1:8890",
	} {
		if err := validateGameAdminURL(value); err == nil {
			t.Fatalf("expected invalid URL %q", value)
		}
	}
}

func TestValidateGameMode(t *testing.T) {
	for _, value := range []string{"club", "standard"} {
		if err := validateGameMode(value); err != nil {
			t.Fatalf("expected valid game mode %q: %v", value, err)
		}
	}
	if err := validateGameMode("other"); err == nil {
		t.Fatal("expected invalid game mode")
	}
}
