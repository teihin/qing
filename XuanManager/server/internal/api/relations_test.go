package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParsePlayerFiltersIPCode(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/game/players?ipCode=43Ypq1", nil)
	filters, err := parsePlayerFilters(request)
	if err != nil {
		t.Fatalf("parsePlayerFilters: %v", err)
	}
	if filters.IPAddress != "221.236.103.129" {
		t.Fatalf("IPAddress = %q, want 221.236.103.129", filters.IPAddress)
	}
	where, args := buildPlayerWhere(filters, true)
	if !strings.Contains(where, "a.sm_ip = ?") {
		t.Fatalf("where = %q, want sm_ip clause", where)
	}
	if len(args) == 0 || args[len(args)-1] != "221.236.103.129" {
		t.Fatalf("args = %#v, want trailing IP", args)
	}
}

func TestParsePlayerFiltersRejectsInvalidIPCode(t *testing.T) {
	for _, code := range []string{"43Ypq", "43Ypq12", "43Yp-1", "zzzzzz"} {
		request := httptest.NewRequest(http.MethodGet, "/api/game/players?ipCode="+code, nil)
		if _, err := parsePlayerFilters(request); err == nil {
			t.Fatalf("ipCode %q accepted", code)
		}
	}
}

func TestChunkRelationValues(t *testing.T) {
	parts := chunkRelationValues([]int{1, 2, 3, 4, 5}, 2)
	if len(parts) != 3 || len(parts[0]) != 2 || len(parts[1]) != 2 || len(parts[2]) != 1 {
		t.Fatalf("unexpected chunks: %#v", parts)
	}
	if got := chunkRelationValues([]int{}, 10); len(got) != 0 {
		t.Fatalf("empty chunks = %#v", got)
	}
}

func TestSortPlayerIDsByRelations(t *testing.T) {
	relations := map[string][]playerRelation{
		"100001": {{PlayerID: "200001"}},
		"100002": {{PlayerID: "200002"}, {PlayerID: "200003"}},
	}
	ids := []string{"100003", "100002", "100001"}
	sortPlayerIDsByRelations(ids, relations, "desc")
	if ids[0] != "100002" || ids[1] != "100001" || ids[2] != "100003" {
		t.Fatalf("desc order = %#v", ids)
	}
	sortPlayerIDsByRelations(ids, relations, "asc")
	if ids[0] != "100003" || ids[1] != "100001" || ids[2] != "100002" {
		t.Fatalf("asc order = %#v", ids)
	}
}

func TestPlayerIDPage(t *testing.T) {
	ids := []string{"1", "2", "3", "4", "5"}
	if got := playerIDPage(ids, 2, 2); len(got) != 2 || got[0] != "3" || got[1] != "4" {
		t.Fatalf("page 2 = %#v", got)
	}
	if got := playerIDPage(ids, 9, 2); len(got) != 0 {
		t.Fatalf("out of range = %#v", got)
	}
}
