package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadMergesDefaultsAndResolvesPaths(t *testing.T) {
	directory := t.TempDir()
	configPath := filepath.Join(directory, "config.json")
	content := `{
	  "server":{"http_address":"127.0.0.1:0"},
	  "storage":{"root_directory":"voice-data"},
	  "auth":{"hmac_secret":"` + strings.Repeat("x", 32) + `"}
	}`
	if err := os.WriteFile(configPath, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := Load(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Audio.SampleRate != 16000 || cfg.Audio.MaxDurationMS != 10000 {
		t.Fatalf("defaults were not preserved: %#v", cfg.Audio)
	}
	expectedRoot := filepath.Join(directory, "voice-data")
	if cfg.Storage.RootDirectory != expectedRoot {
		t.Fatalf("root path = %q, want %q", cfg.Storage.RootDirectory, expectedRoot)
	}
}

func TestEnvironmentSecretOverridesFile(t *testing.T) {
	directory := t.TempDir()
	configPath := filepath.Join(directory, "config.json")
	if err := os.WriteFile(configPath, []byte(`{
	  "auth":{"hmac_secret":"`+strings.Repeat("a", 32)+`"}
	}`), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("AUDIO_SERVER_TOKEN_SECRET", strings.Repeat("b", 32))
	cfg, err := Load(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Auth.HMACSecret != strings.Repeat("b", 32) {
		t.Fatal("environment secret did not override file")
	}
}
