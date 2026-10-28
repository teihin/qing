package security

import "testing"

func TestCredentialRoundTrip(t *testing.T) {
	key := DeriveCredentialKey("unit-test-material")
	sealed, err := SealCredential(key, "111111")
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	if sealed == "111111" || sealed[:3] != credentialVersion {
		t.Fatalf("密文格式不符合预期: %q", sealed)
	}
	plain, err := OpenCredential(key, sealed)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if plain != "111111" {
		t.Fatalf("解出的明文不对: %q", plain)
	}
}

func TestOpenCredentialRejectsWrongKey(t *testing.T) {
	sealed, err := SealCredential(DeriveCredentialKey("key-a"), "secret")
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	if _, err := OpenCredential(DeriveCredentialKey("key-b"), sealed); err == nil {
		t.Fatal("换密钥后不应解开")
	}
}

func TestOpenCredentialEmpty(t *testing.T) {
	plain, err := OpenCredential(DeriveCredentialKey("any"), "  ")
	if err != nil || plain != "" {
		t.Fatalf("空密文应返回空串，得到 %q / %v", plain, err)
	}
}
