package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBuildClubMemberTreeNestsByUpperAndKeepsOwnerRoot(t *testing.T) {
	members := []clubMemberNode{
		{PlayerID: "100000", Name: "群主", Role: "owner"},
		{PlayerID: "200000", Name: "盟主", Role: "agent", IsAgent: true, UpperID: "100000"},
		{PlayerID: "300000", Name: "代理", Role: "agent", IsAgent: true, UpperID: "200000"},
		{PlayerID: "400000", Name: "玩家", Role: "member", UpperID: "300000"},
	}
	roots, orphan, warnings := buildClubMemberTree(members)
	if len(roots) != 1 || roots[0].PlayerID != "100000" {
		t.Fatalf("expected a single owner root, got %+v", roots)
	}
	if len(orphan) != 0 {
		t.Fatalf("expected no orphan members, got %+v", orphan)
	}
	if len(warnings) != 0 {
		t.Fatalf("expected no warnings, got %v", warnings)
	}
	if roots[0].Level != 0 || roots[0].Children[0].Level != 1 ||
		roots[0].Children[0].Children[0].Level != 2 {
		t.Fatal("tree levels were not assigned by depth")
	}
	leaf := roots[0].Children[0].Children[0].Children[0]
	if leaf.PlayerID != "400000" || leaf.Level != 3 {
		t.Fatalf("deepest member not nested correctly: %+v", leaf)
	}
}

func TestBuildClubMemberTreeDoesNotFabricateParents(t *testing.T) {
	members := []clubMemberNode{
		{PlayerID: "100000", Role: "owner"},
		{PlayerID: "200000", Role: "agent", IsAgent: true, UpperID: "999999"},
		{PlayerID: "300000", Role: "member", UpperID: "300000"},
	}
	roots, orphan, warnings := buildClubMemberTree(members)
	if len(roots) != 1 {
		t.Fatalf("owner should still be the only root, got %d", len(roots))
	}
	if len(orphan) != 2 {
		t.Fatalf("members with missing or self parents must be orphaned, got %+v", orphan)
	}
	if roots[0].Children == nil || len(roots[0].Children) != 0 {
		t.Fatal("orphan members must not be silently attached to the owner")
	}
	if len(warnings) != 2 {
		t.Fatalf("expected one warning per problem member, got %v", warnings)
	}
}

func TestBuildClubMemberTreeFallsBackToOwnerOnlyWhenUpperIsEmpty(t *testing.T) {
	members := []clubMemberNode{
		{PlayerID: "100000", Role: "owner"},
		{PlayerID: "200000", Role: "member"},
	}
	roots, orphan, warnings := buildClubMemberTree(members)
	if len(roots) != 1 || len(roots[0].Children) != 1 || roots[0].Children[0].PlayerID != "200000" {
		t.Fatalf("member without an upper should hang under the owner, got %+v", roots)
	}
	if len(orphan) != 0 {
		t.Fatalf("owner fallback members are not orphans, got %+v", orphan)
	}
	if len(warnings) != 1 || !strings.Contains(warnings[0], "没有直属上级") {
		t.Fatalf("the implicit owner fallback must still be disclosed, got %v", warnings)
	}
}

func TestBuildClubMemberTreeDetectsCyclesWithoutHanging(t *testing.T) {
	members := []clubMemberNode{
		{PlayerID: "100000", Role: "owner"},
		{PlayerID: "200000", Role: "agent", IsAgent: true, UpperID: "300000"},
		{PlayerID: "300000", Role: "agent", IsAgent: true, UpperID: "200000"},
	}
	_, _, warnings := buildClubMemberTree(members)
	found := false
	for _, warning := range warnings {
		if strings.Contains(warning, "循环引用") {
			found = true
		}
	}
	if !found {
		t.Fatalf("cycle must be reported, got %v", warnings)
	}
}

func TestClubGoldFromHandlesScalarJSONAndSentinel(t *testing.T) {
	if value := clubGoldFrom(int64(12580), "820084"); value == nil || *value != 12580 {
		t.Fatalf("numeric club gold not read: %v", value)
	}
	if value := clubGoldFrom("12580", "820084"); value == nil || *value != 12580 {
		t.Fatalf("string club gold not read: %v", value)
	}
	// 接口文档 §11：club_gold 是 {"俱乐部ID": 积分} 的 JSON 串，多俱乐部各一份。
	if value := clubGoldFrom(`{"820084":300,"999999":50}`, "820084"); value == nil || *value != 300 {
		t.Fatalf("per-club JSON club gold not read: %v", value)
	}
	if value := clubGoldFrom(`{"999999":50}`, "820084"); value != nil {
		t.Fatalf("club gold of another club must not leak, got %v", *value)
	}
	// -99 是「无该俱乐部数据」，不能当真实余额。
	if value := clubGoldFrom("-99", "820084"); value != nil {
		t.Fatalf("-99 must be treated as missing data, got %v", *value)
	}
	if value := clubGoldFrom(`{"820084":-99}`, "820084"); value != nil {
		t.Fatalf("-99 inside JSON must be treated as missing data, got %v", *value)
	}
	if value := clubGoldFrom(nil, "820084"); value != nil {
		t.Fatal("nil club gold must stay missing")
	}
}

func TestClubMembershipWhereMatchesExactIDs(t *testing.T) {
	if !containsClubID("123456,789012", "789012") {
		t.Fatal("exact club id in list not matched")
	}
	if containsClubID("1234567", "123456") {
		t.Fatal("substring of a longer club id must not match")
	}
	if containsClubID("", "123456") {
		t.Fatal("empty membership must not match")
	}
}

func TestGameCommandErrorMessagePrefersServerWording(t *testing.T) {
	direct := gameCommandResponse{RetResult: json.RawMessage(`{"error":"该俱乐部额度不足"}`)}
	if got := gameCommandErrorMessage(direct, "兜底"); got != "该俱乐部额度不足" {
		t.Fatalf("direct error not used: %q", got)
	}
	nested := gameCommandResponse{RetResult: json.RawMessage(`{"result":{"error":"你的额度不足"}}`)}
	if got := gameCommandErrorMessage(nested, "兜底"); got != "你的额度不足" {
		t.Fatalf("nested error not used: %q", got)
	}
	empty := gameCommandResponse{RetResult: json.RawMessage(`{}`)}
	if got := gameCommandErrorMessage(empty, "兜底"); got != "兜底" {
		t.Fatalf("fallback not used when the server sends no error: %q", got)
	}
}

func buildClubWhereForTest(t *testing.T, query string) (string, []any) {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, "/api/game/clubs?"+query, nil)
	filters, err := parseClubFilters(request)
	if err != nil {
		t.Fatalf("filters rejected for %q: %v", query, err)
	}
	return buildClubWhere(filters)
}

func TestClubFiltersRejectInvalidInput(t *testing.T) {
	cases := []string{
		"mode=unknown",
		"clubId=12345",
		"unionId=12345",
		"status=bogus",
		"clubMode=9",
		"taxMin=80&taxMax=10",
		"minMembers=10&maxMembers=2",
		"taxMin=200",
	}
	for _, query := range cases {
		request := httptest.NewRequest(http.MethodGet, "/api/game/clubs?"+query, nil)
		if _, err := parseClubFilters(request); err == nil {
			t.Fatalf("expected %q to be rejected", query)
		}
	}
}

func TestClubFiltersDefaultToClubDimension(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/game/clubs", nil)
	filters, err := parseClubFilters(request)
	if err != nil {
		t.Fatalf("empty query rejected: %v", err)
	}
	if filters.Mode != clubQueryModeClub {
		t.Fatalf("default mode should be club, got %q", filters.Mode)
	}
}

func TestPlayerDimensionFiltersOnMembershipNotOwnerOnly(t *testing.T) {
	where, args := buildClubWhereForTest(t, "mode=player&playerId=496702")
	if !strings.Contains(where, "EXISTS(SELECT 1 FROM kbedm.tbl_Account p") {
		t.Fatalf("player dimension must use an EXISTS subquery, got %s", where)
	}
	// 玩家以群主/成员/管理员任一身份都要命中，因此五列都要参与判断。
	for _, column := range []string{"sm_club_make", "sm_club_join", "sm_club_make2", "sm_club_join2", "sm_club_manage"} {
		if !strings.Contains(where, column) {
			t.Fatalf("player dimension misses column %s: %s", column, where)
		}
	}
	found := false
	for _, arg := range args {
		if arg == "496702" {
			found = true
		}
	}
	if !found {
		t.Fatalf("player id not bound as an argument: %v", args)
	}
}

func TestPlayerDimensionIgnoresPlayerFiltersInClubMode(t *testing.T) {
	// 俱乐部维度下即使带了 playerId 也不该改变语义（前端切维度时不会串条件）。
	where, _ := buildClubWhereForTest(t, "mode=club&playerId=496702")
	if strings.Contains(where, "tbl_Account p") {
		t.Fatalf("club dimension must not apply the player subquery: %s", where)
	}
}

func TestClubFiltersAlwaysExcludePlaceholderClubs(t *testing.T) {
	// 库里有 88 万条 init 占位行，任何查询都必须继续排除。
	for _, query := range []string{"", "mode=player&playerId=496702", "status=used"} {
		where, _ := buildClubWhereForTest(t, query)
		if !strings.Contains(where, "NOT IN ('init', 'del')") {
			t.Fatalf("placeholder exclusion missing for %q: %s", query, where)
		}
	}
}

func TestClubUnionFilterBindsExactUnionID(t *testing.T) {
	where, args := buildClubWhereForTest(t, "unionId=123456")
	if !strings.Contains(where, "c.union_id = ?") {
		t.Fatalf("union filter must bind the union_id column, got %s", where)
	}
	found := false
	for _, arg := range args {
		if arg == "123456" {
			found = true
		}
	}
	if !found {
		t.Fatalf("union id not bound as an argument: %v", args)
	}
}

func TestParseClubGoldMapKeepsNumbersAndDropsSentinels(t *testing.T) {
	// 线上真实形态：{"俱乐部ID": 积分}；-99 是「无该俱乐部数据」的哨兵。
	cases := []struct {
		raw    string
		want   map[string]int64
		absent []string
	}{
		{raw: `{"885399": 20326}`, want: map[string]int64{"885399": 20326}},
		{raw: `{"775447": -2327}`, want: map[string]int64{"775447": -2327}},
		{raw: `{"575399": -99}`, absent: []string{"575399"}},
		{raw: `{"615555": "800"}`, want: map[string]int64{"615555": 800}},
		{raw: `{}`},
		{raw: ``},
		{raw: `618`},
		{raw: `not-json`},
	}
	for _, item := range cases {
		got := parseClubGoldMap(item.raw)
		if len(item.want) == 0 && len(item.absent) == 0 && len(got) != 0 {
			t.Fatalf("expected empty map for %q, got %v", item.raw, got)
		}
		for clubID, value := range item.want {
			if got[clubID] != value {
				t.Fatalf("club %s: want %d, got %v (raw %q)", clubID, value, got[clubID], item.raw)
			}
		}
		for _, clubID := range item.absent {
			if _, ok := got[clubID]; ok {
				t.Fatalf("sentinel value must be dropped for %q, got %v", item.raw, got)
			}
		}
	}
}
