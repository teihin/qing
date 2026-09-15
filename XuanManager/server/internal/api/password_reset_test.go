package api

import (
	"strings"
	"testing"
	"time"
)

func TestPlayerAccountPattern(t *testing.T) {
	valid := []string{"900101", "abc123", "USER0001", "a123456789012345"}
	for _, value := range valid {
		if !playerAccountPattern.MatchString(value) {
			t.Fatalf("expected valid account: %s", value)
		}
	}
	invalid := []string{"", "12345", "a12345678901234567", "账号900101", "abc 123", "中文账号"}
	for _, value := range invalid {
		if playerAccountPattern.MatchString(value) {
			t.Fatalf("expected invalid account: %s", value)
		}
	}
}

func TestMD5HexMatchesMySQLAndIsCaseInsensitive(t *testing.T) {
	hash := md5Hex("123456")
	if hash != "e10adc3949ba59abbe56e057f20f883e" {
		t.Fatalf("unexpected md5: %s", hash)
	}
	if !strings.EqualFold(hash, "E10ADC3949BA59ABBE56E057F20F883E") {
		t.Fatal("md5 comparison must ignore case")
	}
}

func TestPasswordAttemptLimiterLocksAccount(t *testing.T) {
	limiter := newPasswordAttemptLimiter(5, time.Hour, 30*time.Minute)
	start := time.Now()
	for i := 0; i < 5; i++ {
		if limiter.blocked("account:900101", start) {
			t.Fatalf("blocked too early at attempt %d", i)
		}
		limiter.fail("account:900101", start)
	}
	if !limiter.blocked("account:900101", start) {
		t.Fatal("expected the account to be locked after 5 failures")
	}
	if !limiter.blocked("account:900101", start.Add(29*time.Minute)) {
		t.Fatal("account must stay locked during the lock window")
	}
	if limiter.blocked("account:900101", start.Add(31*time.Minute)) {
		t.Fatal("lock should be released after the lock window")
	}
	limiter.succeed("account:900101")
	if limiter.blocked("account:900101", start) {
		t.Fatal("successful change must clear the failure counter")
	}
}
