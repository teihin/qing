package directchat

import "testing"

func TestUniqueClubIDsUsesExactCommaTokens(t *testing.T) {
	got := uniqueClubIDs("100, 200,100", "", "300", "200")
	want := []string{"100", "200", "300"}
	if len(got) != len(want) {
		t.Fatalf("unexpected ids: %#v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("id[%d] = %q, want %q", i, got[i], want[i])
		}
	}
	if containsClubID("12, 123", "2") || !containsClubID("12, 123", "123") {
		t.Fatal("club ids must be matched as comma-separated tokens")
	}
}

func TestFindSuperiorLeaderFollowsClubSpecificAgentChain(t *testing.T) {
	relations := map[string]agentRelation{
		"player":  {UpperGuuid: "agent-a"},
		"agent-a": {UpperGuuid: "agent-b", IsAgent: true},
		"agent-b": {UpperGuuid: "owner", IsAgent: true},
	}
	if got := findSuperiorLeader("player", "owner", relations); got != "agent-b" {
		t.Fatalf("superior leader = %q, want agent-b", got)
	}
	if got := findSuperiorLeader("agent-b", "owner", relations); got != "" {
		t.Fatalf("leader must not list itself as its superior leader: %q", got)
	}
}

func TestMemberRoleUsesInviteCodeToDistinguishAgent(t *testing.T) {
	club := Club{ClubID: "567671", OwnerGuuid: "owner"}
	relations := map[string]agentRelation{
		"agent":  {UpperGuuid: "owner", IsAgent: true},
		"player": {UpperGuuid: "agent", Note: "玩家备注", IsAgent: false},
	}
	agent := (&GameDirectory{}).memberFromAccount(club, gameAccount{Guuid: "agent", Name: "代理"}, relations)
	player := (&GameDirectory{}).memberFromAccount(club, gameAccount{Guuid: "player", Name: "玩家"}, relations)
	if agent.Role != RoleLeader || player.Role != RoleMember {
		t.Fatalf("unexpected roles: agent=%q player=%q", agent.Role, player.Role)
	}
	if player.SuperiorAgentGuuid != "agent" {
		t.Fatalf("player superior agent = %q", player.SuperiorAgentGuuid)
	}
	if player.Note != "玩家备注" {
		t.Fatalf("player note = %q, want 玩家备注", player.Note)
	}
}
