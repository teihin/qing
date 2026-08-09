package security

import "testing"

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
	if ValidatePassword("246813~!#") == nil {
		t.Fatal("不含字母且不足 10 位的弱密码不应通过通用用户策略")
	}
	if ValidatePassword("246813~!#A") != nil {
		t.Fatal("满足复杂度的密码应通过")
	}
	bootstrapHash, err := HashBootstrapPassword("246813~!#")
	if err != nil || !VerifyPassword(bootstrapHash, "246813~!#") {
		t.Fatal("初始超级管理员密码必须按用户提供的原值生成摘要")
	}
}
