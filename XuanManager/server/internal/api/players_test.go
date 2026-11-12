package api

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCanViewPlayerLoginPasswordOnlyForSuperAdmin(t *testing.T) {
	if canViewPlayerLoginPassword(principal{}) {
		t.Fatal("普通角色不应看到玩家登录密码")
	}
	if !canViewPlayerLoginPassword(principal{IsSuper: true}) {
		t.Fatal("超级管理员应当可以看到玩家登录密码")
	}
}

func TestPlayerItemLoginPasswordOmittedUnlessPopulated(t *testing.T) {
	payload, err := json.Marshal(playerItem{PlayerID: "565923"})
	if err != nil {
		t.Fatalf("marshal player item: %v", err)
	}
	if strings.Contains(string(payload), "loginPassword") {
		t.Fatalf("未收录密码时不应出现密码字段: %s", payload)
	}
	if !strings.Contains(string(payload), `"passwordRecorded":false`) {
		t.Fatalf("未收录密码时应明确标记 passwordRecorded=false: %s", payload)
	}
	payload, err = json.Marshal(playerItem{PlayerID: "565923", LoginPassword: "111111", PasswordRecorded: true})
	if err != nil {
		t.Fatalf("marshal player item: %v", err)
	}
	if !strings.Contains(string(payload), `"loginPassword":"111111"`) || !strings.Contains(string(payload), `"passwordRecorded":true`) {
		t.Fatalf("管理员应拿到明文密码并标记已收录: %s", payload)
	}
}

func TestSavePlayerLoginPasswordSkipsEmptyInput(t *testing.T) {
	server := &Server{}
	if err := server.savePlayerLoginPassword(context.Background(), "", "111111", playerPasswordSourceRegistration); err != nil {
		t.Fatalf("空登录账号不应写库: %v", err)
	}
	if err := server.savePlayerLoginPassword(context.Background(), "a000005", "", playerPasswordSourceRegistration); err != nil {
		t.Fatalf("空密码不应写库: %v", err)
	}
}

func TestNormalizeLoginNameKey(t *testing.T) {
	if got := normalizeLoginNameKey("  A000005 "); got != "a000005" {
		t.Fatalf("登录账号应统一小写去空格: %q", got)
	}
	if got := normalizeLoginNameKey(""); got != "" {
		t.Fatalf("空登录账号应返回空: %q", got)
	}
}

func TestParsePlayerFilters(t *testing.T) {
	r := httptest.NewRequest("GET", "/api/game/players?playerId=292989&name=test&agentId=648425&agentName=agent&level=98&roomId=0&minBalance=-10.5&maxBalance=200&registeredFrom=2026-08-01&registeredTo=2026-08-09&loginFrom=2026-09-01&loginTo=2026-09-19", nil)
	filters, err := parsePlayerFilters(r)
	if err != nil {
		t.Fatalf("parse filters: %v", err)
	}
	if filters.PlayerID != "292989" || filters.AgentID != "648425" || filters.Level == nil || *filters.Level != 98 {
		t.Fatalf("unexpected filters: %#v", filters)
	}
	if filters.LoginFrom != "2026-09-01" || filters.LoginTo != "2026-09-19" {
		t.Fatalf("unexpected login range: %#v", filters)
	}
	where, args := buildPlayerWhere(filters, true)
	if strings.Contains(where, filters.PlayerID) || strings.Contains(where, filters.AgentID) {
		t.Fatalf("query values must not be interpolated: %s", where)
	}
	if !strings.Contains(where, "a.sm_guuid = ?") || !strings.Contains(where, "agent.sm_name LIKE ?") ||
		!strings.Contains(where, "k.lasttime >= UNIX_TIMESTAMP(CONCAT(?, ' 00:00:00'))") || len(args) != 12 {
		t.Fatalf("unexpected where clause or args: %s %#v", where, args)
	}
}

func TestBuildPlayerWhereLoginRangeUsesBeijingDayBounds(t *testing.T) {
	where, args := buildPlayerWhere(playerFilters{LoginFrom: "2026-09-01", LoginTo: "2026-09-19"}, true)
	for _, expected := range []string{
		"k.lasttime >= UNIX_TIMESTAMP(CONCAT(?, ' 00:00:00'))",
		"k.lasttime <= UNIX_TIMESTAMP(CONCAT(?, ' 23:59:59'))",
	} {
		if !strings.Contains(where, expected) {
			t.Fatalf("missing login range clause %q in %s", expected, where)
		}
	}
	if len(args) != 2 || args[0] != "2026-09-01" || args[1] != "2026-09-19" {
		t.Fatalf("unexpected login range args: %#v", args)
	}
}

func TestBuildPlayerWhereBossOnly(t *testing.T) {
	r := httptest.NewRequest("GET", "/api/game/players?boss=1", nil)
	filters, err := parsePlayerFilters(r)
	if err != nil {
		t.Fatalf("parse filters: %v", err)
	}
	if !filters.BossOnly {
		t.Fatal("boss=1 应当只筛大小BOSS")
	}
	where, args := buildPlayerWhere(filters, true)
	if !strings.Contains(where, "COALESCE(TRIM(a.sm_union_manage), '') <> ''") ||
		!strings.Contains(where, "COALESCE(TRIM(a.sm_club_manage), '') <> ''") || len(args) != 0 {
		t.Fatalf("unexpected boss where clause or args: %s %#v", where, args)
	}
	if strings.Contains(where, "sm_level") {
		t.Fatalf("大小BOSS 筛选不应再看等级: %s", where)
	}

	// 游戏服未部署 union_manage 时退回只按 club_manage 筛。
	where, _ = buildPlayerWhere(filters, false)
	if strings.Contains(where, "sm_union_manage") || !strings.Contains(where, "sm_club_manage") {
		t.Fatalf("missing union column fallback: %s", where)
	}

	r = httptest.NewRequest("GET", "/api/game/players?boss=0", nil)
	filters, err = parsePlayerFilters(r)
	if err != nil {
		t.Fatalf("parse filters: %v", err)
	}
	where, _ = buildPlayerWhere(filters, true)
	if strings.Contains(where, "sm_union_manage") || strings.Contains(where, "sm_club_manage") {
		t.Fatalf("boss=0 不应附加大小BOSS条件: %s", where)
	}
}

func TestParsePlayerFiltersRejectsInvalidRange(t *testing.T) {
	r := httptest.NewRequest("GET", "/api/game/players?minBalance=20&maxBalance=10", nil)
	if _, err := parsePlayerFilters(r); err == nil {
		t.Fatal("expected invalid balance range")
	}
}

func TestParsePlayerFiltersRejectsInvalidDate(t *testing.T) {
	r := httptest.NewRequest("GET", "/api/game/players?registeredFrom=2026/08/01", nil)
	if _, err := parsePlayerFilters(r); err == nil {
		t.Fatal("expected invalid date")
	}
	r = httptest.NewRequest("GET", "/api/game/players?loginFrom=2026/09/01", nil)
	if _, err := parsePlayerFilters(r); err == nil {
		t.Fatal("expected invalid login date")
	}
}

func TestParsePlayerFiltersRejectsInvertedLoginRange(t *testing.T) {
	r := httptest.NewRequest("GET", "/api/game/players?loginFrom=2026-09-19&loginTo=2026-09-01", nil)
	if _, err := parsePlayerFilters(r); err == nil {
		t.Fatal("expected inverted login range")
	}
}

func TestPlayerItemPayloadKeepsOnlyDirectAgentAndNoOptimization(t *testing.T) {
	payload, err := json.Marshal(playerItem{AgentID: "123456", AgentName: "直属代理"})
	if err != nil {
		t.Fatalf("marshal player item: %v", err)
	}
	value := string(payload)
	for _, expected := range []string{`"agentId":"123456"`, `"agentName":"直属代理"`} {
		if !strings.Contains(value, expected) {
			t.Fatalf("direct agent field missing from payload: %s", value)
		}
	}
	for _, removed := range []string{
		"bigAgentId", "partnerAgentId", "chiefAgentId",
		"optimizeOneCount", "optimizeOneChance", "optimizeTwoCount", "optimizeTwoChance",
	} {
		if strings.Contains(value, removed) {
			t.Fatalf("removed player detail field %q leaked into payload: %s", removed, value)
		}
	}
}
