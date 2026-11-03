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
