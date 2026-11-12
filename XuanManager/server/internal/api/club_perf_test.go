package api

import (
	"encoding/json"
	"testing"
)

func TestDecodeClubPerfReport(t *testing.T) {
	raw := json.RawMessage(`{"context":"club-perf","result":{"ClubPerfReport":{"date":"2026-11-11","all_count":100,"list":[["100","a1","大盟主","联盟","A1",10,3,7,"0.07"]]}}}`)
	date, allCount, list, err := decodeClubPerfReport(raw)
	if err != nil {
		t.Fatalf("decode report: %v", err)
	}
	if date != "2026-11-11" || allCount != 100 || len(list) != 1 {
		t.Fatalf("unexpected report: date=%s all=%d list=%v", date, allCount, list)
	}
}

func TestBuildClubPerfTreeUnionRootAndNoCascade(t *testing.T) {
	union := clubPerfUnionOption{UnionID: "900", UnionName: "测试联盟", OwnerID: "100", OwnerName: "总群主"}
	clubs := map[string]*clubPerfClub{
		"7001": {ID: "7001", Name: "A1", CreatorID: "100", CreatorName: "总群主"},
		"7002": {ID: "7002", Name: "A3", CreatorID: "200", CreatorName: "盟主A3"},
	}
	order := []string{"7001", "7002"}
	agents := []clubPerfAgent{
		{ID: "100", Name: "总群主", ClubID: "7001", ClubName: "A1", IsOwner: true},
		{ID: "101", Name: "A1代理", ClubID: "7001", ClubName: "A1", Upper: "100"},
		{ID: "200", Name: "盟主A3", ClubID: "7002", ClubName: "A3", IsOwner: true},
		{ID: "201", Name: "A3代理", ClubID: "7002", ClubName: "A3", Upper: "200"},
	}
	// 盟主 200 未授权；其下级 201 已授权，验证不级联。
	reportRows := []clubPerfReportRow{
		{ID: "100", Name: "总群主", Role: "大盟主", ClubName: "A1", My: 10, Granted: 3, Left: 7, Percent: "0.07"},
		{ID: "101", Name: "A1代理", Role: "合伙人", ClubName: "A1", My: 3, Granted: 0, Left: 3, Percent: "0.03"},
		{ID: "201", Name: "A3代理", Role: "合伙人", ClubName: "A3", My: 5, Granted: 0, Left: 5, Percent: "0.05"},
	}

	root, total, enabled := buildClubPerfTree(union, "7001", clubs, order, agents, reportRows, 100)
	if root.PlayerID != "100" || !root.IsUnionOwner || !root.Enabled {
		t.Fatalf("unexpected root: %+v", root)
	}
	if root.My != 100 || root.Granted != 3 || root.Left != 97 || root.Percent != "97.00" {
		t.Fatalf("unexpected union totals: my=%d granted=%d left=%d percent=%s",
			root.My, root.Granted, root.Left, root.Percent)
	}
	if total != 4 || enabled != 3 {
		t.Fatalf("unexpected counts: total=%d enabled=%d", total, enabled)
	}

	var leader *clubPerfNode
	for _, child := range root.Children {
		if child.PlayerID == "200" {
			leader = child
		}
	}
	if leader == nil {
		t.Fatalf("leader 200 not attached to root")
	}
	if leader.Enabled {
		t.Fatalf("leader 200 should be unopened")
	}
	if len(leader.Children) != 1 || leader.Children[0].PlayerID != "201" || !leader.Children[0].Enabled {
		t.Fatalf("agent 201 should stay enabled under unopened leader: %+v", leader.Children)
	}
}
