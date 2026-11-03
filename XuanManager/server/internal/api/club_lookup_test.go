package api

import "testing"

func TestNormalizeClubIDsDropsPlaceholdersAndDuplicates(t *testing.T) {
	ids := normalizeClubIDs([]string{"535696", " 535696 ", "0", "", "479053"})
	if len(ids) != 2 || ids[0] != "535696" || ids[1] != "479053" {
		t.Fatalf("unexpected normalized club ids: %#v", ids)
	}
}

func TestClubRoomGroupMatchesClubNameAndInviteCode(t *testing.T) {
	group := clubRoomGroup{
		ClubID: "535696", ClubName: "功能测试",
		CreatorID: "895742", CreatorName: "znfkfiv", CreatorInviteCode: "928882",
	}
	for _, keyword := range []string{"535696", "功能", "928882", "znfk"} {
		if !clubRoomGroupMatches(group, keyword) {
			t.Fatalf("keyword %q should match the club group", keyword)
		}
	}
	if clubRoomGroupMatches(group, "不存在的俱乐部") {
		t.Fatal("unrelated keyword must not match")
	}
}

func TestGroupHallRoomsAggregatesByClubAndKeepsUnassigned(t *testing.T) {
	rooms := []hallRoomItem{
		{RoomID: 2, ClubID: "535696", ClubName: "功能测试", PlayerCount: 4, WatcherCount: 1, InholdCount: 2},
		{RoomID: 1, ClubID: "535696", PlayerCount: 3, WatcherCount: 2},
		{RoomID: 3, ClubID: "", PlayerCount: 1},
	}
	groups, clubIDs := groupHallRooms(rooms)
	if len(clubIDs) != 1 || clubIDs[0] != "535696" {
		t.Fatalf("unexpected club ids: %#v", clubIDs)
	}
	club := groups["535696"]
	if club == nil || club.ClubName != "功能测试" || club.RoomCount != 2 ||
		club.PlayerCount != 7 || club.WatcherCount != 3 || club.InholdCount != 2 || len(club.Rooms) != 2 {
		t.Fatalf("unexpected club group: %#v", club)
	}
	unassigned := groups["0"]
	if unassigned == nil || unassigned.RoomCount != 1 || unassigned.PlayerCount != 1 {
		t.Fatalf("rooms without a club must stay in the placeholder group: %#v", unassigned)
	}
}
