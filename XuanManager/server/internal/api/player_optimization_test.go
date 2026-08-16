package api

import (
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
	where, args := buildPlayerOptimizationWhere("292989", "active", &minimum, &maximum, principal{})
	if len(args) != 10 {
		t.Fatalf("args = %#v", args)
	}
	if !containsAll(where, "sm_optimize01_count > 0", "sm_optimize01_chance >= ?", "sm_optimize01_chance <= ?", "operator_log.operator_name LIKE ?") {
		t.Fatalf("where = %s", where)
	}
	if containsAll(where, "optimize02") {
		t.Fatalf("unused optimize02 leaked into query: %s", where)
	}
}

func TestApplyPlayerOptimizationVisibilityHidesSuperAttribution(t *testing.T) {
	configuredBy, configuredSource, configuredAt := "admin999", "", "2026-08-10 12:00:00"
	applyPlayerOptimizationVisibility(principal{}, &configuredBy, &configuredSource, &configuredAt, true, "648425")
	if configuredBy != "" || configuredSource != "hidden" || configuredAt != "" {
		t.Fatalf("protected-root attribution leaked: %q %q %q", configuredBy, configuredSource, configuredAt)
	}

	configuredBy, configuredSource, configuredAt = "admin999", "", "2026-08-10 12:00:00"
	applyPlayerOptimizationVisibility(principal{IsSuper: true}, &configuredBy, &configuredSource, &configuredAt, true, "648425")
	if configuredBy != "" || configuredSource != "hidden" || configuredAt != "" {
		t.Fatalf("super role saw protected-root attribution: %q %q %q", configuredBy, configuredSource, configuredAt)
	}

	configuredBy, configuredSource, configuredAt = "admin999", "", "2026-08-10 12:00:00"
	applyPlayerOptimizationVisibility(principal{IsSuper: true, IsProtectedRoot: true}, &configuredBy, &configuredSource, &configuredAt, true, "648425")
	if configuredBy != "admin999" || configuredSource != "admin" || configuredAt == "" {
		t.Fatalf("protected-root attribution was hidden from itself: %q %q %q", configuredBy, configuredSource, configuredAt)
	}
}

func TestParsePlayerOptimizationHistoryFilter(t *testing.T) {
	request := httptest.NewRequest("GET", "/api/game/player-optimization/history?keyword=292989&operation=create&result=success", nil)
	filter, err := parsePlayerOptimizationHistoryFilter(request)
	if err != nil {
		t.Fatalf("valid history filter rejected: %v", err)
	}
	if filter.Keyword != "292989" || filter.Operation != "create" || filter.Result != "success" {
		t.Fatalf("filter = %#v", filter)
	}

	request = httptest.NewRequest("GET", "/api/game/player-optimization/history?operation=unknown", nil)
	if _, err := parsePlayerOptimizationHistoryFilter(request); err == nil {
		t.Fatal("invalid history operation accepted")
	}
}

func TestBuildPlayerOptimizationHistoryWhereHidesSuperActions(t *testing.T) {
	filter := playerOptimizationHistoryFilter{Keyword: "292989", Operation: "update", Result: "failed"}
	where, args := buildPlayerOptimizationHistoryWhere(filter, principal{})
	if !containsAll(where,
		"audit_row.action IN (?, ?, ?)",
		"hidden_super.id = audit_row.operator_id",
		"audit_row.action = ?",
		"audit_row.result_code <> 0",
		"audit_row.operator_name LIKE ?",
	) {
		t.Fatalf("where = %s", where)
	}
	if len(args) != 14 || args[4] != 0 {
		t.Fatalf("ordinary history args = %#v", args)
	}

	_, superRoleArgs := buildPlayerOptimizationHistoryWhere(playerOptimizationHistoryFilter{}, principal{IsSuper: true})
	if len(superRoleArgs) != 5 || superRoleArgs[4] != 0 {
		t.Fatalf("super-role history args = %#v", superRoleArgs)
	}
	_, rootArgs := buildPlayerOptimizationHistoryWhere(playerOptimizationHistoryFilter{}, principal{IsSuper: true, IsProtectedRoot: true})
	if len(rootArgs) != 5 || rootArgs[4] != 1 {
		t.Fatalf("protected-root history args = %#v", rootArgs)
	}
}

func TestEnrichPlayerOptimizationHistoryItem(t *testing.T) {
	item := playerOptimizationHistoryItem{Operation: "update"}
	requestJSON := `{"playerId":"292989","reason":"客服复核"}`
	beforeJSON := `{"playerId":"292989","loginName":"player1","name":"测试玩家","remainingCount":10,"chance":50}`
	afterJSON := `{"playerId":"292989","loginName":"player1","name":"测试玩家","remainingCount":20,"chance":80}`
	enrichPlayerOptimizationHistoryItem(&item, requestJSON, beforeJSON, afterJSON)
	if !item.HasBefore || !item.HasAfter || item.PlayerID != "292989" || item.LoginName != "player1" || item.Name != "测试玩家" {
		t.Fatalf("history identity/state = %#v", item)
	}
	if item.BeforeRemainingCount != 10 || item.BeforeChance != 50 || item.AfterRemainingCount != 20 || item.AfterChance != 80 || item.Reason != "客服复核" {
		t.Fatalf("history values = %#v", item)
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
