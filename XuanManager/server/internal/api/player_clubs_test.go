package api

import "testing"

func TestClubIDsFromMembershipColumns(t *testing.T) {
	ids := clubIDsFromMembershipColumns("1001,1002", "", "1002", " 1003 ", "")
	if len(ids) != 3 {
		t.Fatalf("expected 3 unique club ids, got %#v", ids)
	}
	for index, expected := range []string{"1001", "1002", "1003"} {
		if ids[index] != expected {
			t.Fatalf("unexpected club id order: %#v", ids)
		}
	}
}

func TestClubRoleLabel(t *testing.T) {
	cases := map[string]string{
		"owner": "群主", "leader": "盟主", "agent": "代理", "manager": "管理员", "member": "成员", "": "成员",
	}
	for role, expected := range cases {
		if actual := clubRoleLabel(role); actual != expected {
			t.Fatalf("clubRoleLabel(%q) = %q, want %q", role, actual, expected)
		}
	}
}

func TestStoneAdjustmentConflict(t *testing.T) {
	before := playerStoneState{Stone: 50}
	if code, _ := stoneAdjustmentConflict(adjustPlayerStoneRequest{Action: "add", Amount: 10, ExpectedStone: 50}, before); code != "" {
		t.Fatalf("expected add to pass, got %s", code)
	}
	if code, _ := stoneAdjustmentConflict(adjustPlayerStoneRequest{Action: "add", Amount: 10, ExpectedStone: 49}, before); code != "STONE_CHANGED" {
		t.Fatalf("expected stale snapshot conflict, got %s", code)
	}
	if code, _ := stoneAdjustmentConflict(adjustPlayerStoneRequest{Action: "subtract", Amount: 51, ExpectedStone: 50}, before); code != "INSUFFICIENT_STONE" {
		t.Fatalf("expected insufficient stone, got %s", code)
	}
	if code, _ := stoneAdjustmentConflict(adjustPlayerStoneRequest{Action: "subtract", Amount: 50, ExpectedStone: 50}, before); code != "" {
		t.Fatalf("expected subtract to balance to pass, got %s", code)
	}
}
