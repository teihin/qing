package security

import "testing"

func TestRandomTokenAndHash(t *testing.T) {
	one, err := RandomToken()
	if err != nil {
		t.Fatal(err)
	}
	two, err := RandomToken()
	if err != nil {
		t.Fatal(err)
	}
	if len(one) != 64 || len(two) != 64 || one == two {
		t.Fatalf("unexpected tokens: %q %q", one, two)
	}
	if len(HashToken(one)) != 64 || EqualSecret(one, two) || !EqualSecret(one, one) {
		t.Fatal("token comparison failed")
	}
}

func TestPasswordBoundary(t *testing.T) {
	if ValidatePassword("12345") == nil {
		t.Fatal("five characters must fail")
	}
	if ValidatePassword("123456") != nil {
		t.Fatal("six characters must pass")
	}
	if ValidatePassword(string(make([]byte, 73))) == nil {
		t.Fatal("bcrypt byte limit must be enforced")
	}
	hash, err := HashPassword("测试pass123")
	if err != nil {
		t.Fatal(err)
	}
	if !CheckPassword(hash, "测试pass123") || CheckPassword(hash, "wrong-password") {
		t.Fatal("password verification failed")
	}
}

func TestUsernameValidation(t *testing.T) {
	for _, value := range []string{"agent_01", "support-admin", "Abc123"} {
		if err := ValidateUsername(value); err != nil {
			t.Fatalf("%s should pass: %v", value, err)
		}
	}
	for _, value := range []string{"ab", "客服", "agent name"} {
		if err := ValidateUsername(value); err == nil {
			t.Fatalf("%s should fail", value)
		}
	}
}
