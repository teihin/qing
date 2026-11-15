package api

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"xuanmanager/internal/config"
)

func newMemoryRegistrationGuard(t *testing.T, cfg config.Config) *registrationGuard {
	t.Helper()
	if cfg.RegHoneypotBanHours == 0 {
		cfg.RegHoneypotBanHours = 24
	}
	return newRegistrationGuard(nil, cfg, slog.Default())
}

func TestRegistrationIPHashIsStableAndOpaque(t *testing.T) {
	first := registrationIPHash("203.0.113.9")
	second := registrationIPHash(" 203.0.113.9 ")
	if first != second {
		t.Fatalf("ip hash must be stable across whitespace: %q vs %q", first, second)
	}
	if len(first) != 16 {
		t.Fatalf("ip hash length = %d, want 16", len(first))
	}
	if strings.Contains(first, "203") {
		t.Fatalf("ip hash must not carry the raw address: %q", first)
	}
	if registrationIPHash("203.0.113.10") == first {
		t.Fatal("different ip addresses must produce different hashes")
	}
}

func TestRegistrationGuardBlocksAfterHourlyQuota(t *testing.T) {
	guard := newMemoryRegistrationGuard(t, config.Config{RegIPHourly: 2, RegIPDaily: 100})
	ctx := context.Background()
	hash := registrationIPHash("198.51.100.1")

	for i := 0; i < 2; i++ {
		guard.record(ctx, registrationEvent{IPHash: hash, Result: registrationResultOK})
	}
	reason, wait, err := guard.blocked(ctx, hash, "")
	if err != nil {
		t.Fatalf("blocked: %v", err)
	}
	if reason != registrationBlockIPHourly {
		t.Fatalf("reason = %q, want %q", reason, registrationBlockIPHourly)
	}
	if wait <= 0 {
		t.Fatalf("retry wait must be positive, got %s", wait)
	}

	// 另一个 IP 不受影响。
	other := registrationIPHash("198.51.100.2")
	if reason, _, _ := guard.blocked(ctx, other, ""); reason != registrationBlockNone {
		t.Fatalf("another ip must not be blocked, got %q", reason)
	}
}

func TestRegistrationGuardIgnoresRejectedAttempts(t *testing.T) {
	guard := newMemoryRegistrationGuard(t, config.Config{RegIPHourly: 1, RegIPDaily: 100})
	ctx := context.Background()
	hash := registrationIPHash("198.51.100.3")

	// 被拒的请求不能把配额占满，否则攻击者能让同 IP 的正常用户注册不了。
	for i := 0; i < 5; i++ {
		guard.record(ctx, registrationEvent{IPHash: hash, Result: registrationResultRateLimited})
	}
	if reason, _, _ := guard.blocked(ctx, hash, ""); reason != registrationBlockNone {
		t.Fatalf("rejected attempts must not consume quota, got %q", reason)
	}

	guard.record(ctx, registrationEvent{IPHash: hash, Result: registrationResultOK})
	if reason, _, _ := guard.blocked(ctx, hash, ""); reason != registrationBlockIPHourly {
		t.Fatalf("one successful registration must exhaust a quota of 1, got %q", reason)
	}
}

func TestRegistrationGuardBlocksAfterDeviceDailyQuota(t *testing.T) {
	guard := newMemoryRegistrationGuard(t, config.Config{RegIPHourly: 100, RegIPDaily: 100, RegDeviceDaily: 1})
	ctx := context.Background()
	deviceKey := registrationDeviceKey("550e8400-e29b-41d4-a716-446655440000")
	if deviceKey == "" {
		t.Fatal("device key must not be empty for a non-empty device id")
	}

	guard.record(ctx, registrationEvent{IPHash: registrationIPHash("203.0.113.1"), DeviceKey: deviceKey, Result: registrationResultOK})

	// 换了 IP，但同一设备，仍然要被拦。
	reason, _, err := guard.blocked(ctx, registrationIPHash("203.0.113.2"), deviceKey)
	if err != nil {
		t.Fatalf("blocked: %v", err)
	}
	if reason != registrationBlockDeviceDaily {
		t.Fatalf("reason = %q, want %q", reason, registrationBlockDeviceDaily)
	}

	// 不传设备标识的客户端只按 IP 算，不能被空设备误伤。
	if reason, _, _ := guard.blocked(ctx, registrationIPHash("203.0.113.3"), ""); reason != registrationBlockNone {
		t.Fatalf("empty device key must not be blocked, got %q", reason)
	}
}

func TestRegistrationGuardBlocksAtGlobalDailyLimit(t *testing.T) {
	guard := newMemoryRegistrationGuard(t, config.Config{RegIPHourly: 0, RegIPDaily: 0, RegGlobalDaily: 2})
	ctx := context.Background()

	guard.record(ctx, registrationEvent{IPHash: registrationIPHash("203.0.113.11"), Result: registrationResultOK})
	guard.record(ctx, registrationEvent{IPHash: registrationIPHash("203.0.113.12"), Result: registrationResultOK})

	reason, _, err := guard.blocked(ctx, registrationIPHash("203.0.113.13"), "")
	if err != nil {
		t.Fatalf("blocked: %v", err)
	}
	if reason != registrationBlockGlobalDaily {
		t.Fatalf("reason = %q, want %q", reason, registrationBlockGlobalDaily)
	}
}

func TestRegistrationGuardBanBlocksEvenBelowQuota(t *testing.T) {
	guard := newMemoryRegistrationGuard(t, config.Config{RegIPHourly: 100, RegIPDaily: 100, RegHoneypotBanHours: 1})
	ctx := context.Background()
	hash := registrationIPHash("203.0.113.20")

	guard.ban(ctx, hash, "honeypot", time.Now())
	reason, wait, err := guard.blocked(ctx, hash, "")
	if err != nil {
		t.Fatalf("blocked: %v", err)
	}
	if reason != registrationBlockIPBanned {
		t.Fatalf("reason = %q, want %q", reason, registrationBlockIPBanned)
	}
	if wait <= 0 || wait > time.Hour {
		t.Fatalf("ban wait = %s, want within one hour", wait)
	}
}

func TestGameRegistrationHoneypotRejectsAndBansIP(t *testing.T) {
	handler := New(nil, config.Config{}, slog.Default())

	post := func(body string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodPost, "/api/game/registrations", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		return response
	}

	first := post(`{"nickname":"玩家","loginName":"9001011","password":"111111","website":"http://spam.example"}`)
	if first.Code != http.StatusForbidden {
		t.Fatalf("honeypot status = %d, body = %s", first.Code, first.Body.String())
	}

	// 同一个 IP 之后的正常请求也要被拒，这才叫封禁。
	second := post(`{"nickname":"玩家","loginName":"9001012","password":"111111"}`)
	if second.Code != http.StatusForbidden {
		t.Fatalf("banned ip status = %d, body = %s", second.Code, second.Body.String())
	}
}
