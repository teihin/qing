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

func TestBuildPlayerClubChainWalksToCreatorAndUnionOwner(t *testing.T) {
	members := []clubMemberNode{
		{PlayerID: "100", Name: "本人", Role: "member", UpperID: "200"},
		{PlayerID: "200", Name: "直属代理", Role: "agent", UpperID: "500"},
		{PlayerID: "500", Name: "群主", Role: "owner"},
	}
	meta := userDataClubMeta{ClubID: "C1", Name: "俱乐部一", CreatorID: "500", UnionID: "U1", UnionOwnerID: "900"}
	names := map[string]string{"900": "老大哥"}

	chain := buildPlayerClubChain("100", members[0], members, meta, names)
	if len(chain) != 4 {
		t.Fatalf("chain = %+v, want 4 nodes", chain)
	}
	for index, want := range []string{"100", "200", "500", "900"} {
		if chain[index].PlayerID != want {
			t.Fatalf("chain[%d] = %s, want %s", index, chain[index].PlayerID, want)
		}
		if chain[index].Depth != index {
			t.Fatalf("chain[%d].Depth = %d, want %d", index, chain[index].Depth, index)
		}
	}
	if !chain[0].IsSelf {
		t.Fatal("first node must be the player himself")
	}
	if chain[2].RoleLabel != "盟主" {
		t.Fatalf("creator inside a union should be 盟主, got %q", chain[2].RoleLabel)
	}
	if chain[3].RoleLabel != "大盟主" || chain[3].Name != "老大哥" {
		t.Fatalf("unexpected union owner node: %+v", chain[3])
	}
}

func TestBuildPlayerClubChainStopsAtBrokenUpper(t *testing.T) {
	members := []clubMemberNode{{PlayerID: "100", Name: "本人", Role: "agent", UpperID: "999"}}
	chain := buildPlayerClubChain("100", members[0], members, userDataClubMeta{ClubID: "C1", CreatorID: "500"}, nil)
	if len(chain) != 2 {
		t.Fatalf("chain = %+v, want self + missing upper only", chain)
	}
	if !chain[1].Missing || chain[1].PlayerID != "999" || chain[1].RoleLabel != "上级账号缺失" {
		t.Fatalf("unexpected missing node: %+v", chain[1])
	}
}

func TestBuildPlayerClubChainCycleIsTruncated(t *testing.T) {
	members := []clubMemberNode{
		{PlayerID: "100", Name: "本人", Role: "agent", UpperID: "200"},
		{PlayerID: "200", Name: "上级", Role: "agent", UpperID: "100"},
	}
	chain := buildPlayerClubChain("100", members[0], members, userDataClubMeta{ClubID: "C1"}, nil)
	if len(chain) != 2 {
		t.Fatalf("chain = %+v, want cycle truncated to 2 nodes", chain)
	}
}

func TestBuildPlayerClubChainForIndependentOwner(t *testing.T) {
	members := []clubMemberNode{{PlayerID: "500", Name: "群主", Role: "owner"}}
	chain := buildPlayerClubChain("500", members[0], members, userDataClubMeta{ClubID: "C1", CreatorID: "500"}, nil)
	if len(chain) != 1 || !chain[0].IsSelf || chain[0].RoleLabel != "群主" {
		t.Fatalf("owner chain = %+v, want only himself", chain)
	}
}

