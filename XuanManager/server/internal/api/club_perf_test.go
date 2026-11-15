package api

import (
	"encoding/json"
	"testing"
)

func TestDecodeClubPerfReport(t *testing.T) {
	raw := json.RawMessage(`{"context":"club-perf","result":{"ClubPerfReport":{"date":"2026-11-11","all_count":100,"list":[["100","a1","大盟主","联盟","A1",10,3,7,"0.07"]]}}}`)
	date, scalePercent, allCount, list, err := decodeClubPerfReport(raw)
	if err != nil {
		t.Fatalf("decode report: %v", err)
	}
	if date != "2026-11-11" || allCount != 100 || len(list) != 1 {
		t.Fatalf("unexpected report: date=%s all=%d list=%v", date, allCount, list)
	}
	// 老服务端没有 scale_percent，按 -1 表示"缺失"，由调用方回落 100。
	if scalePercent != -1 {
		t.Fatalf("expected missing scale_percent to be -1, got %d", scalePercent)
	}
}

func TestDecodeClubPerfReportScalePercent(t *testing.T) {
	raw := json.RawMessage(`{"context":"club-perf","result":{"ClubPerfReport":{"date":"2026-11-15","scale_percent":50,"all_count":100,"list":[["100","a1","盟主","联盟","A1",10,3.5,6.5,"0.065"]]}}}`)
	_, scalePercent, allCount, list, err := decodeClubPerfReport(raw)
	if err != nil {
		t.Fatalf("decode report: %v", err)
	}
	if scalePercent != 50 || allCount != 100 || len(list) != 1 {
		t.Fatalf("unexpected report: scale=%d all=%d list=%v", scalePercent, allCount, list)
	}
	if got := anyFloat(list[0][6]); got != 3.5 {
		t.Fatalf("折算后的小数被截断了: %v", got)
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

	root, total, enabled := buildClubPerfTree(union, "7001", clubs, order, agents, reportRows, 100, 100)
	if root.PlayerID != "100" || !root.IsUnionOwner || !root.Enabled {
		t.Fatalf("unexpected root: %+v", root)
	}
	if root.My != 100 || root.Granted != 3 || root.Left != 97 || root.Percent != "97.00" {
		t.Fatalf("unexpected union totals: my=%v granted=%v left=%v percent=%s",
			root.My, root.Granted, root.Left, root.Percent)
	}
	if total != 3 || enabled != 3 {
		t.Fatalf("unexpected counts: total=%d enabled=%d", total, enabled)
	}

	var promoted *clubPerfNode
	for _, child := range root.Children {
		if child.PlayerID == "200" {
			t.Fatalf("unopened leader 200 should be filtered out")
		}
		if child.PlayerID == "201" {
			promoted = child
		}
	}
	if promoted == nil || !promoted.Enabled {
		t.Fatalf("enabled agent 201 should be promoted to nearest enabled ancestor")
	}
}

// 50% 折算：联盟根的「我」必须是原始总次数的一半，且 我 = 下放 + 剩 仍成立。
func TestBuildClubPerfTreeScalesUnionRoot(t *testing.T) {
	union := clubPerfUnionOption{UnionID: "900", UnionName: "测试联盟", OwnerID: "100", OwnerName: "总群主"}
	clubs := map[string]*clubPerfClub{
		"7001": {ID: "7001", Name: "A1", CreatorID: "100", CreatorName: "总群主"},
	}
	agents := []clubPerfAgent{
		{ID: "100", Name: "总群主", ClubID: "7001", ClubName: "A1", IsOwner: true},
	}
	reportRows := []clubPerfReportRow{
		{ID: "100", Name: "总群主", Role: "大盟主", ClubName: "A1", My: 50, Granted: 0, Left: 50, Percent: "0.50"},
	}
	root, _, _ := buildClubPerfTree(union, "7001", clubs, []string{"7001"}, agents, reportRows, 100, 50)
	if root.My != 50 {
		t.Fatalf("联盟根应按 50%% 折算: got my=%v", root.My)
	}
	if root.Granted+root.Left != root.My {
		t.Fatalf("我 = 下放 + 剩 不成立: my=%v granted=%v left=%v", root.My, root.Granted, root.Left)
	}
	if root.Percent != "50.00" {
		t.Fatalf("50%% 折算后根节点占比应为 50.00: got %s", root.Percent)
	}
}

// 奇数次折算出 .5，不能被截断成整数。
func TestScaledClubPerfCountKeepsDecimals(t *testing.T) {
	if got := scaledClubPerfCount(3, 50); got != 1.5 {
		t.Fatalf("3 × 50%% 应为 1.5, got %v", got)
	}
	if got := scaledClubPerfCount(7, 100); got != 7 {
		t.Fatalf("100%% 应为原值 7, got %v", got)
	}
	if got := scaledClubPerfCount(7, 0); got != 0 {
		t.Fatalf("0%% 应为 0, got %v", got)
	}
	if got := scaledClubPerfCount(7, 150); got != 7 {
		t.Fatalf("超过 100 应夹到 100, got %v", got)
	}
}

// 后台配置解析：合法整数、带百分号、非法值。
func TestParseClubPerfScale(t *testing.T) {
	cases := []struct {
		raw     string
		want    int
		wantErr bool
	}{
		{"50", 50, false},
		{" 50 ", 50, false},
		{"50%", 50, false},
		{"0", 0, false},
		{"100", 100, false},
		{"101", 0, true},
		{"abc", 0, true},
		{"", 0, true},
	}
	for _, item := range cases {
		got, err := parseClubPerfScale(item.raw)
		if item.wantErr {
			if err == nil {
				t.Fatalf("parseClubPerfScale(%q) 应报错，实际 %d", item.raw, got)
			}
			continue
		}
		if err != nil || got != item.want {
			t.Fatalf("parseClubPerfScale(%q) = %d, %v; want %d", item.raw, got, err, item.want)
		}
	}
	if _, err := validateClubPerfScale(101); err == nil {
		t.Fatal("101 应该被拒绝")
	}
	if got, err := validateClubPerfScale(50); err != nil || got != 50 {
		t.Fatalf("50 应该通过, got %d, %v", got, err)
	}
}
