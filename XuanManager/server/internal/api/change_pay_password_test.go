package api

import "testing"

func TestPlayerGUIDPattern(t *testing.T) {
	valid := []string{"954431", "529749", "1", "123456789012345678"}
	for _, value := range valid {
		if !playerGUIDPattern.MatchString(value) {
			t.Fatalf("expected valid guid: %s", value)
		}
	}
	invalid := []string{"", "abc123", "12 34", "-1", "12345678901234567890", "954431.0"}
	for _, value := range invalid {
		if playerGUIDPattern.MatchString(value) {
			t.Fatalf("expected invalid guid: %s", value)
		}
	}
}

func TestValidatePayPasswordChange(t *testing.T) {
	cases := []struct {
		name      string
		playerID  string
		loginPwd  string
		newPayPwd string
		wantCode  int
	}{
		{"ok", "954431", "test1234", "654321", codePasswordOK},
		{"ok with long pay password", "954431", "test1234", "01234567890123456789012345678901", codePasswordOK},
		{"bad guid", "abc", "test1234", "654321", codeBadParameters},
		{"empty login password", "954431", "", "654321", codeBadParameters},
		{"blank login password", "954431", "   ", "654321", codeBadParameters},
		{"empty pay password", "954431", "test1234", "", codeNewPwdEmpty},
		{"blank pay password", "954431", "test1234", "  ", codeNewPwdEmpty},
		{"pay password with space", "954431", "test1234", "65 4321", codeBadParameters},
		{"pay password too long", "954431", "test1234", "0123456789012345678901234567890123", codeBadParameters},
	}
	for _, c := range cases {
		code, _ := validatePayPasswordChange(c.playerID, c.loginPwd, c.newPayPwd)
		if code != c.wantCode {
			t.Fatalf("%s: got code %d, want %d", c.name, code, c.wantCode)
		}
	}
}
