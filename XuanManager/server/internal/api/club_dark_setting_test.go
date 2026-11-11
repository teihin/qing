package api

import "testing"

func TestParseDarkSettingContent(t *testing.T) {
	cases := []struct {
		content string
		want    bool
	}{
		{"1", true},
		{" 1 ", true},
		{"true", true},
		{"True", true},
		{"on", true},
		{"开", true},
		{"0", false},
		{"", false},
		{"false", false},
		{"随便什么", false},
	}
	for _, item := range cases {
		if got := parseDarkSettingContent(item.content); got != item.want {
			t.Fatalf("parseDarkSettingContent(%q) = %v, want %v", item.content, got, item.want)
		}
	}
}

func TestClubDarkSettingKey(t *testing.T) {
	if got := clubDarkSettingKey(" 820084 "); got != "暗抽_俱乐部_820084" {
		t.Fatalf("unexpected key: %q", got)
	}
}

func TestValidateDarkSettingRequest(t *testing.T) {
	enabled := true
	expected := false
	target, current, note, err := validateDarkSettingRequest(updateDarkSettingRequest{
		Enabled:         &enabled,
		ExpectedEnabled: &expected,
		Note:            "  运营开放暗抽  ",
		Confirm:         true,
	})
	if err != nil {
		t.Fatalf("validateDarkSettingRequest: %v", err)
	}
	if !target || current {
		t.Fatalf("unexpected states: target=%v current=%v", target, current)
	}
	if note != "运营开放暗抽" {
		t.Fatalf("unexpected note: %q", note)
	}
}

func TestValidateDarkSettingRequestRejectsMissingConfirm(t *testing.T) {
	enabled := true
	expected := false
	if _, _, _, err := validateDarkSettingRequest(updateDarkSettingRequest{
		Enabled:         &enabled,
		ExpectedEnabled: &expected,
		Note:            "运营开放暗抽",
		Confirm:         false,
	}); err == nil {
		t.Fatal("expected confirm error")
	}
}
