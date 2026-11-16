package api

import (
	"strings"
	"testing"
)

// 靓号反解的纯逻辑部分：6 位纯数字才可能命中号池，其余输入直接放行。
func TestIsPrettyCandidate(t *testing.T) {
	cases := map[string]bool{
		"888888":  true,
		"000000":  true,
		"88888":   false,
		"8888888": false,
		"88888a":  false,
		"":        false,
		" 888888": false,
		"张888888": false,
	}
	for input, want := range cases {
		if got := isPrettyCandidate(input); got != want {
			t.Fatalf("isPrettyCandidate(%q) = %v, want %v", input, got, want)
		}
	}
}

// 俱乐部列表：主搜索框填邀请码/靓号时，WHERE 里要额外带上反解出的俱乐部 ID 与玩家 ID，
// 且占位符顺序必须与 args 一致（先 LIKE 两个，再俱乐部 ID，最后玩家 ID）。
// 另一个关键约束：追加的 OR 必须留在关键字那对括号**里面**，否则会绕过 club_status 过滤，
// 把 init/del 的空壳俱乐部捞出来（2026-11-16 线上实测踩过）。
func TestBuildClubWherePrettyKeyword(t *testing.T) {
	where, args := buildClubWhere(clubFilters{
		Keyword:         "888888",
		KeywordClubID:   "535696",
		KeywordPlayerID: "580629",
	})
	if !strings.Contains(where, "c.club_guuid = ?") ||
		!strings.Contains(where, "kbedm.tbl_Account kp") {
		t.Fatalf("expected pretty keyword clauses, got %s", where)
	}
	if strings.Contains(where, ") OR c.club_guuid = ?") || strings.Contains(where, ") OR EXISTS(") {
		t.Fatalf("keyword clause is not wrapped in one pair of parentheses: %s", where)
	}
	if !strings.HasSuffix(where, ")") {
		t.Fatalf("keyword clause must close after the appended OR branches: %s", where)
	}
	want := []any{"%888888%", "%888888%", "535696", "580629"}
	if len(args) != len(want) {
		t.Fatalf("unexpected args: %#v", args)
	}
	for index := range want {
		if args[index] != want[index] {
			t.Fatalf("args[%d] = %v, want %v", index, args[index], want[index])
		}
	}
	// 没有反解结果时不能多出占位符，避免参数与条件错位。
	where, args = buildClubWhere(clubFilters{Keyword: "功能测试"})
	if strings.Contains(where, "c.club_guuid = ?") || len(args) != 2 {
		t.Fatalf("unexpected plain keyword where: %s %#v", where, args)
	}
	if !strings.HasSuffix(where, ")") {
		t.Fatalf("plain keyword clause must stay wrapped: %s", where)
	}
}

// 房间战绩：关键字是个人ID 靓号时，反解出的真实 ID 要排在前面，其余 LIKE 参数顺延。
func TestBuildRoomRecordListWherePrettyKeyword(t *testing.T) {
	where, args := buildRoomRecordListWhere(roomRecordListFilters{
		Keyword:         "888888",
		KeywordPlayerID: "580629",
	})
	if !strings.Contains(where, "x.user_guuid = ?") || len(args) != 5 {
		t.Fatalf("unexpected room record where: %s %#v", where, args)
	}
	if args[0] != "580629" || args[1] != "888888" || args[2] != "888888" {
		t.Fatalf("unexpected room record args order: %#v", args)
	}
	if args[3] != "%888888%" || args[4] != "%888888%" {
		t.Fatalf("unexpected room record like args: %#v", args)
	}
}
