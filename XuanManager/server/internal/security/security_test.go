package security

import (
	"strings"
	"testing"
)

func TestPasswordAndTokenSecurity(t *testing.T) {
	password := "safe-password-123!"
	hash, err := HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	if !VerifyPassword(hash, password) || VerifyPassword(hash, "wrong-password-123!") {
		t.Fatal("密码校验结果不正确")
	}

	token, err := NewToken()
	if err != nil {
		t.Fatal(err)
	}
	if len(token) != 64 || !EqualTokenHash(token, HashToken(token)) {
		t.Fatal("会话令牌生成或校验失败")
	}
}

func TestValidation(t *testing.T) {
	if ValidateUsername("admin_user") != nil {
		t.Fatal("合法账号被拒绝")
	}
	if ValidateUsername("a") == nil {
		t.Fatal("过短账号未被拒绝")
	}
	if ValidatePassword("12345") == nil {
		t.Fatal("5 位密码不应通过")
	}
	for _, password := range []string{"123123", "abcdef", "!@#$%^", "中文密码六字"} {
		if ValidatePassword(password) != nil {
			t.Fatalf("至少 6 位的密码被拒绝: %q", password)
		}
	}
	if ValidatePassword(strings.Repeat("1", 73)) == nil {
		t.Fatal("超过 bcrypt 72 字节上限的密码不应通过")
	}
	bootstrapHash, err := HashBootstrapPassword("123123")
	if err != nil || !VerifyPassword(bootstrapHash, "123123") {
		t.Fatal("初始超级管理员密码必须按用户提供的原值生成摘要")
	}
}
