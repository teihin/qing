package security

import (
	"strings"
	"testing"
	"time"
)

// RFC 6238 附录 B 的 SHA-1 测试向量；本项目固定 6 位，取 8 位结果的后 6 位。
func TestTOTPMatchesRFC6238Vectors(t *testing.T) {
	secret := "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" // ASCII "12345678901234567890"
	cases := []struct {
		unix int64
		code string
	}{
		{59, "287082"},
		{1111111109, "081804"},
		{1111111111, "050471"},
		{1234567890, "005924"},
		{2000000000, "279037"},
		{20000000000, "353130"},
	}
	for _, item := range cases {
		at := time.Unix(item.unix, 0)
		code, err := TOTPCode(secret, at)
		if err != nil {
			t.Fatalf("TOTPCode(%d): %v", item.unix, err)
		}
		if code != item.code {
			t.Fatalf("TOTPCode(%d) = %s, want %s", item.unix, code, item.code)
		}
		if step, ok := ValidateTOTP(secret, item.code, at); !ok || step != item.unix/TOTPPeriodSeconds {
			t.Fatalf("ValidateTOTP(%d) = %d,%v, want %d,true", item.unix, step, ok, item.unix/TOTPPeriodSeconds)
		}
	}
}

func TestValidateTOTPAcceptsAdjacentWindowOnly(t *testing.T) {
	secret := "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
	at := time.Unix(1700000000, 0)
	code, err := TOTPCode(secret, at)
	if err != nil {
		t.Fatal(err)
	}
	for _, offset := range []time.Duration{-30 * time.Second, 0, 30 * time.Second} {
		if _, ok := ValidateTOTP(secret, code, at.Add(offset)); !ok {
			t.Fatalf("code should be accepted at offset %s", offset)
		}
	}
	if _, ok := ValidateTOTP(secret, code, at.Add(90*time.Second)); ok {
		t.Fatal("code outside the ±30s window must be rejected")
	}
	if _, ok := ValidateTOTP(secret, "12345", at); ok {
		t.Fatal("short code must be rejected")
	}
	if _, ok := ValidateTOTP(secret, "abcdef", at); ok {
		t.Fatal("non-numeric code must be rejected")
	}
}

func TestTOTPURIContainsManualSetupFields(t *testing.T) {
	uri := TOTPURI("ChatTool", "agent01", "JBSWY3DPEHPK3PXP")
	for _, fragment := range []string{
		"otpauth://totp/ChatTool:agent01?",
		"secret=JBSWY3DPEHPK3PXP",
		"issuer=ChatTool",
		"digits=6",
		"period=30",
	} {
		if !strings.Contains(uri, fragment) {
			t.Fatalf("uri %q missing %q", uri, fragment)
		}
	}
}

func TestNewRecoveryCodesAreUniqueAndNormalizable(t *testing.T) {
	codes, err := NewRecoveryCodes()
	if err != nil {
		t.Fatal(err)
	}
	if len(codes) != 10 {
		t.Fatalf("got %d recovery codes, want 10", len(codes))
	}
	seen := map[string]bool{}
	for _, code := range codes {
		if len(code) != 10 {
			t.Fatalf("recovery code %q should be 10 characters", code)
		}
		if seen[code] {
			t.Fatalf("duplicate recovery code %q", code)
		}
		seen[code] = true
		if NormalizeRecoveryCode(strings.ToLower(code[:5]+" "+code[5:])) != code {
			t.Fatalf("normalize did not restore %q", code)
		}
	}
}

func TestSealCredentialRoundTrip(t *testing.T) {
	key := DeriveTOTPKey("test-material")
	sealed, err := SealCredential(key, "JBSWY3DPEHPK3PXP")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(sealed, credentialVersion) {
		t.Fatalf("sealed value %q should carry version prefix", sealed)
	}
	plain, err := OpenCredential(key, sealed)
	if err != nil || plain != "JBSWY3DPEHPK3PXP" {
		t.Fatalf("OpenCredential = %q,%v", plain, err)
	}
	if _, err := OpenCredential(DeriveTOTPKey("other-material"), sealed); err == nil {
		t.Fatal("a different key must not decrypt the secret")
	}
}
