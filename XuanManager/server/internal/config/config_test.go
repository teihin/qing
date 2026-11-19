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

func TestValidateRemoteDBHost(t *testing.T) {
	// 默认（未显式放行）时局域网地址必须被拒绝，保持原有只允许本机的基线。
	if err := validateRemoteDBHost("XUAN_DB_HOST", "172.22.161.126", false); err == nil {
		t.Fatal("expected remote host rejected when allowRemote=false")
	}
	// 显式放行后，局域网私有地址通过。
	for _, host := range []string{"172.22.161.126", "10.0.0.8", "192.168.1.20"} {
		if err := validateRemoteDBHost("XUAN_DB_HOST", host, true); err != nil {
			t.Fatalf("expected private host %q allowed: %v", host, err)
		}
	}
	// 公网地址和非法输入在放行状态下仍必须被拒绝。
	for _, host := range []string{"154.37.155.17", "8.153.70.197", "db.example.com", ""} {
		if err := validateRemoteDBHost("XUAN_DB_HOST", host, true); err == nil {
			t.Fatalf("expected non-private host %q rejected", host)
		}
	}
}
