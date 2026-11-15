package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCreatePlayerOptimizationDoesNotRequireSuperAdministrator(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/game/player-optimization", strings.NewReader("{"))
	response := httptest.NewRecorder()
	server := &Server{}
	server.handleCreatePlayerOptimization(response, request, principal{IsSuper: false})
	if response.Code == http.StatusForbidden {
		t.Fatal("ordinary role with create permission was still blocked by a super-administrator-only check")
	}
	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected request validation after permission middleware, got %d", response.Code)
	}
}

func TestNormalizeAndValidateWinTargetRequest(t *testing.T) {
	valid := setWinTargetRequest{TargetValue: 3000, Chance: 30, Confirm: true}
	if err := normalizeAndValidateWinTargetRequest(&valid); err != nil {
		t.Fatalf("valid request rejected: %v", err)
	}
	negative := setWinTargetRequest{TargetValue: -3000, Chance: 100, Confirm: true}
	if err := normalizeAndValidateWinTargetRequest(&negative); err != nil {
		t.Fatalf("negative target rejected: %v", err)
	}
	withReason := setWinTargetRequest{TargetValue: 500, Chance: 1, Reason: " 客服  复核 ", Confirm: true}
	if err := normalizeAndValidateWinTargetRequest(&withReason); err != nil || withReason.Reason != "客服 复核" {
		t.Fatalf("reason normalization failed: %q %v", withReason.Reason, err)
	}

	cases := []setWinTargetRequest{
		{TargetValue: 0, Chance: 30, Confirm: true},
		{TargetValue: winTargetMaxAmount + 1, Chance: 30, Confirm: true},
		{TargetValue: -winTargetMaxAmount - 1, Chance: 30, Confirm: true},
		{TargetValue: 100, Chance: 0, Confirm: true},
		{TargetValue: 100, Chance: 101, Confirm: true},
		{TargetValue: 100, Chance: -10, Confirm: true},
		{TargetValue: 100, Chance: 30, Reason: "x", Confirm: true},
		{TargetValue: 100, Chance: 30, Confirm: false},
	}
	for index := range cases {
		if err := normalizeAndValidateWinTargetRequest(&cases[index]); err == nil {
			t.Fatalf("invalid case %d accepted", index)
		}
	}
}

func TestNormalizeOptimizationReason(t *testing.T) {
	reason := " 停止  优化 "
	if err := normalizeOptimizationReason(&reason); err != nil {
		t.Fatalf("valid reason rejected: %v", err)
	}
	if reason != "停止 优化" {
		t.Fatalf("reason = %q", reason)
	}
	invalid := "x"
	if err := normalizeOptimizationReason(&invalid); err == nil {
		t.Fatal("short reason accepted")
	}
}

func TestWinTargetItemFromGame(t *testing.T) {
	object := map[string]any{
		"id": float64(26), "guuid": "470390", "name": "333000", "state": "done",
		"target_value": float64(-3000), "chance": float64(-30), "progress": float64(-1200),
		"round_count": float64(11), "peer_count": float64(16), "online": float64(1),
		"cur_chance": float64(-30), "cur_count": float64(1),
		"man": "383393", "man_name": "哦哦哦", "set_time": "2026-11-12 20:31:39",
		"finish_time": "2026-11-13 02:36:09", "finish_reason": "done",
	}
	item := winTargetItemFromGame(object)
	if item.PlayerID != "470390" || item.Name != "333000" || item.State != "done" || item.Active {
		t.Fatalf("basic fields = %#v", item)
	}
	if item.TargetValue != -3000 || item.Chance != 30 {
		t.Fatalf("target/chance = %d %d", item.TargetValue, item.Chance)
	}
	if item.Remain != 1800 {
		t.Fatalf("remain = %d", item.Remain)
	}
	if !item.Online || item.CurCount != 1 || item.ManName != "哦哦哦" {
		t.Fatalf("runtime fields = %#v", item)
	}

	active := winTargetItemFromGame(map[string]any{"guuid": "718968", "state": "active", "target_value": float64(500), "chance": float64(100), "progress": float64(320)})
	if !active.Active {
		t.Fatal("active state not recognized")
	}
	if active.Remain != 180 {
		t.Fatalf("active remain = %d", active.Remain)
	}
}

func TestParseWinTargetReplyError(t *testing.T) {
	if err := parseWinTargetReplyError(json.RawMessage(`{"ok":[{"guuid":"718968"}],"failed":[]}`)); err != nil {
		t.Fatalf("success reply rejected: %v", err)
	}
	if err := parseWinTargetReplyError(json.RawMessage(`{"failed":[{"guuid":"all","error":"chance 必须在 1~100"}]}`)); err == nil {
		t.Fatal("failed reply accepted")
	}
	if err := parseWinTargetReplyError(json.RawMessage(`"{\"error\":\"无权限\"}"`)); err == nil {
		t.Fatal("string-wrapped error accepted")
	}
	if err := parseWinTargetReplyError(json.RawMessage(`{"ok":[]}`)); err != nil {
		t.Fatalf("empty ok reply rejected: %v", err)
	}
}

func TestSummarizeWinTargets(t *testing.T) {
	items := []winTargetItem{
		{Active: true, State: "active", TargetValue: 3000, Chance: 30},
		{Active: true, State: "active", TargetValue: -1000, Chance: 50},
		{Active: false, State: "done", TargetValue: 2000, Chance: 100},
	}
	summary := summarizeWinTargets(items)
	if summary.ActivePlayers != 2 || summary.TotalTargetAmount != 4000 {
		t.Fatalf("summary = %#v", summary)
	}
	if summary.AverageChance != 40 {
		t.Fatalf("average = %v", summary.AverageChance)
	}
}

func TestFilterWinTargetsMatchesLoginAndMan(t *testing.T) {
	items := []winTargetItem{
		{PlayerID: "470390", Name: "333000", LoginName: "player1", ManName: "哦哦哦"},
		{PlayerID: "188798", Name: "333999", LoginName: "player2", ManName: "jjdkd"},
	}
	if got := filterWinTargets(items, "PLAYER2"); len(got) != 1 || got[0].PlayerID != "188798" {
		t.Fatalf("login filter = %#v", got)
	}
	if got := filterWinTargets(items, "哦哦哦"); len(got) != 1 || got[0].PlayerID != "470390" {
		t.Fatalf("operator filter = %#v", got)
	}
	if got := filterWinTargets(items, "nothing"); len(got) != 0 {
		t.Fatalf("miss filter = %#v", got)
	}
}

func TestDescribeWinTargetValue(t *testing.T) {
	if got := describeWinTargetValue(3000); got != "赢 3,000" {
		t.Fatalf("win = %q", got)
	}
	if got := describeWinTargetValue(-1200); got != "输 1,200" {
		t.Fatalf("lose = %q", got)
	}
	if got := formatThousands(1234567); got != "1,234,567" {
		t.Fatalf("thousands = %q", got)
	}
}
