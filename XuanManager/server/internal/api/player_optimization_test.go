package api

import (
	"net/http/httptest"
	"testing"
)

func TestNormalizeAndValidateOptimizationRequest(t *testing.T) {
	valid := updatePlayerOptimizationRequest{
		RemainingCount: 100, Chance: 35,
		ExpectedCount: 0, ExpectedChance: 0, Confirm: true,
	}
	if err := normalizeAndValidateOptimizationRequest(&valid); err != nil {
		t.Fatalf("valid request rejected: %v", err)
	}

	cases := []updatePlayerOptimizationRequest{
		{RemainingCount: -1, Chance: 1, Reason: "原因合规", Confirm: true},
		{RemainingCount: 1, Chance: 0, Reason: "原因合规", Confirm: true},
		{RemainingCount: 0, Chance: 10, Reason: "原因合规", Confirm: true},
		{RemainingCount: 1, Chance: 101, Reason: "原因合规", Confirm: true},
		{RemainingCount: 1, Chance: 10, Confirm: false},
	}
	for index := range cases {
		if err := normalizeAndValidateOptimizationRequest(&cases[index]); err == nil {
			t.Fatalf("invalid case %d accepted", index)
		}
	}
}

func TestNormalizeAndValidateCreateOptimizationRequest(t *testing.T) {
	valid := createPlayerOptimizationRequest{
		PlayerID: "292989", RemainingCount: 20, Chance: 75, Confirm: true,
	}
	if err := normalizeAndValidateCreateOptimizationRequest(&valid); err != nil {
		t.Fatalf("valid create request rejected: %v", err)
	}

	cases := []createPlayerOptimizationRequest{
		{RemainingCount: 0, Chance: 0, Confirm: true},
		{RemainingCount: 1, Chance: 0, Confirm: true},
		{RemainingCount: 1, Chance: 101, Confirm: true},
		{RemainingCount: 1, Chance: 50, Confirm: false},
	}
	for index := range cases {
		if err := normalizeAndValidateCreateOptimizationRequest(&cases[index]); err == nil {
			t.Fatalf("invalid create case %d accepted", index)
		}
	}
	optionalReason := createPlayerOptimizationRequest{RemainingCount: 1, Chance: 50, Reason: " 可选说明 ", Confirm: true}
	if err := normalizeAndValidateCreateOptimizationRequest(&optionalReason); err != nil || optionalReason.Reason != "可选说明" {
		t.Fatalf("optional reason rejected: %q %v", optionalReason.Reason, err)
	}
}

func TestNormalizeOptimizationReason(t *testing.T) {
	reason := " 删除  发牌优化 "
	if err := normalizeOptimizationReason(&reason); err != nil {
		t.Fatalf("valid reason rejected: %v", err)
	}
	if reason != "删除 发牌优化" {
		t.Fatalf("reason = %q", reason)
	}
	invalid := "x"
	if err := normalizeOptimizationReason(&invalid); err == nil {
		t.Fatal("short reason accepted")
	}
}

func TestOptimizationStateMatchesAllPersistedFields(t *testing.T) {
	base := playerOptimizationState{ManagerID: "648425", RemainingCount: 58, Chance: 100}
	if !optimizationStateMatches(base, base) {
		t.Fatal("identical optimization states did not match")
	}
	for _, changed := range []playerOptimizationState{
		{ManagerID: "111111", RemainingCount: 58, Chance: 100},
		{ManagerID: "648425", RemainingCount: 57, Chance: 100},
		{ManagerID: "648425", RemainingCount: 58, Chance: 99},
	} {
		if optimizationStateMatches(base, changed) {
			t.Fatalf("different optimization state matched: %#v", changed)
		}
	}
}

func TestParseOptimizationChanceRange(t *testing.T) {
	request := httptest.NewRequest("GET", "/api/game/player-optimization?minChance=20&maxChance=80", nil)
	minimum, maximum, err := parseOptimizationChanceRange(request)
	if err != nil || minimum == nil || maximum == nil || *minimum != 20 || *maximum != 80 {
		t.Fatalf("range = %v %v %v", minimum, maximum, err)
	}
	request = httptest.NewRequest("GET", "/api/game/player-optimization?minChance=81&maxChance=80", nil)
	if _, _, err := parseOptimizationChanceRange(request); err == nil {
		t.Fatal("reversed chance range accepted")
	}
}

func TestBuildPlayerOptimizationWhereUsesDealOptimizationOnly(t *testing.T) {
	minimum, maximum := int64(10), int64(90)
	where, args := buildPlayerOptimizationWhere("292989", "active", &minimum, &maximum)
	if len(args) != 9 {
		t.Fatalf("args = %#v", args)
	}
	if !containsAll(where, "sm_optimize01_count > 0", "sm_optimize01_chance >= ?", "sm_optimize01_chance <= ?", "operator_log.operator_name LIKE ?") {
		t.Fatalf("where = %s", where)
	}
	if containsAll(where, "optimize02") {
		t.Fatalf("unused optimize02 leaked into query: %s", where)
	}
}

func TestPlayerOptimizationConfiguredSource(t *testing.T) {
	if got := playerOptimizationConfiguredSource("admin999", "648425"); got != "admin" {
		t.Fatalf("admin source = %q", got)
	}
	if got := playerOptimizationConfiguredSource("", "648425"); got != "game" {
		t.Fatalf("game source = %q", got)
	}
	if got := playerOptimizationConfiguredSource("", ""); got != "" {
		t.Fatalf("empty source = %q", got)
	}
}

func containsAll(value string, parts ...string) bool {
	for _, part := range parts {
		if len(part) > 0 && !stringContains(value, part) {
			return false
		}
	}
	return true
}

func stringContains(value, part string) bool {
	for index := 0; index+len(part) <= len(value); index++ {
		if value[index:index+len(part)] == part {
			return true
		}
	}
	return false
}
