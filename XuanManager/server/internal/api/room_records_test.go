package api

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParseRoundPlayerRemark(t *testing.T) {
	item := roomRecordRoundPlayer{}
	parseRoundPlayerRemark("开牌@[[2, 4], [1, 7], [0, 10], [3, 9]]@下注:47@ @芒果:-3@本局剩余芒果:9@庄家@[[0, 10], [3, 9], [2, 4], [1, 7]]@10@3@没赔", &item)
	if item.State != "开牌" || item.Role != "庄家" || item.BetScore != 47 || item.MangoScore != -3 || item.RemainingMango != 9 {
		t.Fatalf("unexpected parsed fields: %#v", item)
	}
	if len(item.Cards) != 4 || item.Cards[0].Suit != 2 || item.Cards[0].Rank != 4 || len(item.DealtCards) != 4 {
		t.Fatalf("unexpected cards: %#v %#v", item.Cards, item.DealtCards)
	}
	if item.RevealFlags != "10" || item.PoolScore != 3 || item.Compensation != "没赔" {
		t.Fatalf("unexpected extension fields: %#v", item)
	}
}

func TestParseRoundPlayerRemarkToleratesMalformedCards(t *testing.T) {
	item := roomRecordRoundPlayer{}
	parseRoundPlayerRemark("弃牌@not-json@下注:6@ @芒果:0@ @闲家@[[3, 8], [4, 1]]@00@0@没赔", &item)
	if len(item.Cards) != 0 || len(item.DealtCards) != 2 || item.BetScore != 6 {
		t.Fatalf("unexpected malformed result: %#v", item)
	}
}

func TestValidRoomRecordID(t *testing.T) {
	for _, value := range []string{"112859", "1", "18446744073709551615"} {
		if !validRoomRecordID(value) {
			t.Fatalf("expected valid room id: %s", value)
		}
	}
	for _, value := range []string{"", "0", "../112859", "room-1", "房间"} {
		if validRoomRecordID(value) {
			t.Fatalf("expected invalid room id: %s", value)
		}
	}
}

func TestScoreResult(t *testing.T) {
	if scoreResult(1) != "win" || scoreResult(-1) != "loss" || scoreResult(0) != "draw" {
		t.Fatal("unexpected score result")
	}
}

func TestScoreMismatch(t *testing.T) {
	if scoreMismatch(10, 10.001) || !scoreMismatch(-133, -250) {
		t.Fatal("unexpected score mismatch result")
	}
}

func TestIsDijiuKingRule(t *testing.T) {
	if !isDijiuKingRule("地方") || !isDijiuKingRule("开启地九王") || isDijiuKingRule("标准") || isDijiuKingRule("") {
		t.Fatal("unexpected dijiu king rule result")
	}
}

func TestResolvedRoomScorePrefersSettlement(t *testing.T) {
	score, source := resolvedRoomScore(-250, 250, 117, true)
	if score != -133 || source != "settlement" {
		t.Fatalf("unexpected settlement score: %v %s", score, source)
	}
	score, source = resolvedRoomScore(95, 50, 0, false)
	if score != 95 || source != "record" {
		t.Fatalf("unexpected recorded score: %v %s", score, source)
	}
}

func TestParseRoomRecordListFilters(t *testing.T) {
	request := httptest.NewRequest("GET", "/api/game/room-records?keyword=112859&dateFrom=2026-08-01&dateTo=2026-08-09", nil)
	filters, err := parseRoomRecordListFilters(request)
	if err != nil || filters.Keyword != "112859" || filters.DateFrom != "2026-08-01" || filters.DateTo != "2026-08-09" {
		t.Fatalf("unexpected filters: %#v %v", filters, err)
	}
	request = httptest.NewRequest("GET", "/api/game/room-records?dateFrom=2026-08-09&dateTo=2026-08-01", nil)
	if _, err := parseRoomRecordListFilters(request); err == nil {
		t.Fatal("expected invalid date range")
	}
}

func TestBuildRoomRecordListWhere(t *testing.T) {
	where, args := buildRoomRecordListWhere(roomRecordListFilters{Keyword: "测试", DateFrom: "2026-08-01", DateTo: "2026-08-09"})
	if !strings.Contains(where, "EXISTS") || !strings.Contains(where, "t.date >= ?") || len(args) != 6 {
		t.Fatalf("unexpected room list where: %s %#v", where, args)
	}
}
