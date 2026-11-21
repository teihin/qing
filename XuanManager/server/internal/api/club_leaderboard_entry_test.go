package api

import "testing"

func TestLeaderboardEntryKeys(t *testing.T) {
	if got := leaderboardEntryClubKey(" 820084 "); got != "排行榜_俱乐部_820084" {
		t.Fatalf("unexpected club key: %q", got)
	}
	if got := leaderboardEntryUnionKey(" 330011 "); got != "排行榜_联盟_330011" {
		t.Fatalf("unexpected union key: %q", got)
	}
	if got := leaderboardEntryKeyForClub("820084", ""); got != "排行榜_俱乐部_820084" {
		t.Fatalf("standalone club should use club key, got %q", got)
	}
	if got := leaderboardEntryKeyForClub("820084", " 330011 "); got != "排行榜_联盟_330011" {
		t.Fatalf("club in union should use union key, got %q", got)
	}
	if got := leaderboardEntryContent(true); got != "1" {
		t.Fatalf("unexpected enabled content: %q", got)
	}
	if got := leaderboardEntryContent(false); got != "0" {
		t.Fatalf("unexpected disabled content: %q", got)
	}
}

func TestValidateLeaderboardEntryRequest(t *testing.T) {
	enabled := true
	expected := false
	target, current, note, err := validateLeaderboardEntryRequest(updateLeaderboardEntryRequest{
		Enabled:         &enabled,
		ExpectedEnabled: &expected,
		Note:            "  俱乐部申请开榜  ",
		Confirm:         true,
	})
	if err != nil {
		t.Fatalf("validateLeaderboardEntryRequest: %v", err)
	}
	if !target || current {
		t.Fatalf("unexpected states: target=%v current=%v", target, current)
	}
	if note != "俱乐部申请开榜" {
		t.Fatalf("unexpected note: %q", note)
	}
}

func TestValidateLeaderboardEntryRequestRejectsIncomplete(t *testing.T) {
	enabled := true
	expected := false
	cases := []struct {
		name  string
		input updateLeaderboardEntryRequest
	}{
		{"missing states", updateLeaderboardEntryRequest{Note: "开榜申请", Confirm: true}},
		{"missing confirm", updateLeaderboardEntryRequest{Enabled: &enabled, ExpectedEnabled: &expected, Note: "开榜申请"}},
		{"short note", updateLeaderboardEntryRequest{Enabled: &enabled, ExpectedEnabled: &expected, Note: " 开 ", Confirm: true}},
	}
	for _, item := range cases {
		if _, _, _, err := validateLeaderboardEntryRequest(item.input); err == nil {
			t.Fatalf("%s: expected error", item.name)
		}
	}
}
