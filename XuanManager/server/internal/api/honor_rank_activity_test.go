package api

import (
	"testing"
	"time"
)

func TestHonorRankActivityPhase(t *testing.T) {
	now := time.Date(2026, 11, 15, 12, 0, 0, 0, honorRankBeijingLocation)
	cases := []struct {
		name                        string
		state, startDate, startTime string
		endDate, endTime            string
		want                        string
	}{
		{"未开始", honorRankActivityOn, "2026-11-16", "00:00:00", "2026-11-20", "23:59:59", honorRankPhasePending},
		{"进行中", honorRankActivityOn, "2026-11-15", "00:00:00", "2026-11-16", "23:59:59", honorRankPhaseRunning},
		{"已过期", honorRankActivityOn, "2026-11-10", "00:00:00", "2026-11-14", "23:59:59", honorRankPhaseFinished},
		{"已结束优先", honorRankActivityClosed, "2026-11-10", "00:00:00", "2026-11-14", "23:59:59", honorRankPhaseClosed},
	}
	for _, item := range cases {
		got := honorRankActivityPhase(item.state, item.startDate, item.startTime, item.endDate, item.endTime, now)
		if got != item.want {
			t.Fatalf("%s: got %q want %q", item.name, got, item.want)
		}
	}
}

func TestHonorRankActivityTitle(t *testing.T) {
	got := honorRankActivityTitle("union", "第一联盟", "196102", "2026-11-20", "2026-11-30")
	if got != "联盟·第一联盟 2026-11-20 至 2026-11-30" {
		t.Fatalf("unexpected title: %q", got)
	}
	// 名称为空时退回 ID，不能出现空的「俱乐部· 」。
	got = honorRankActivityTitle("club", "", "775447", "", "")
	if got != "俱乐部·775447 排行榜" {
		t.Fatalf("unexpected fallback title: %q", got)
	}
}

func TestHonorRankRewardAt(t *testing.T) {
	boards := []updateHonorRankBoard{
		{RankType: "play", On: true, Rewards: []updateHonorRankReward{
			{Dipi: "1皮", List: "100,50,20"},
			{Dipi: "2皮", List: ""},
		}},
		{RankType: "score", On: true, Rewards: []updateHonorRankReward{{Dipi: "", List: "1000,500"}}},
	}
	if got := honorRankRewardAt(boards, "play", "1皮", 2); got != "50" {
		t.Fatalf("play 2nd reward: %q", got)
	}
	if got := honorRankRewardAt(boards, "play", "1皮", 4); got != "" {
		t.Fatalf("超出名次应为空，got %q", got)
	}
	if got := honorRankRewardAt(boards, "score", "", 1); got != "1000" {
		t.Fatalf("score 1st reward: %q", got)
	}
	if got := honorRankRewardAt(boards, "bonus", "", 1); got != "" {
		t.Fatalf("未配置的榜奖励应为空，got %q", got)
	}
}

func TestHonorRankMemberCondition(t *testing.T) {
	condition, args := honorRankMemberCondition([]string{"111", "222"})
	if len(args) != 4 {
		t.Fatalf("每个俱乐部两个参数，got %d", len(args))
	}
	if condition == "" || condition == "1 = 0" {
		t.Fatalf("unexpected condition: %q", condition)
	}
	empty, emptyArgs := honorRankMemberCondition(nil)
	if empty != "1 = 0" || len(emptyArgs) != 0 {
		t.Fatalf("空俱乐部集合必须不可命中，got %q", empty)
	}
}

func TestHonorRankActivityMatchesGame(t *testing.T) {
	item := honorRankActivity{
		ScopeType: "union", ScopeID: "196102", ActivityOn: true,
		StartDate: "2026-11-20", StartTime: "00:00:00", EndDate: "2026-11-30", EndTime: "23:59:59",
	}
	game := honorRankState{Rows: normalizeHonorRankRows(nil)}
	for index := range game.Rows {
		game.Rows[index].ActivityOn = true
		game.Rows[index].StartDate = "2026-11-20"
		game.Rows[index].StartTime = "00:00:00"
		game.Rows[index].EndDate = "2026-11-30"
		game.Rows[index].EndTime = "23:59:59"
	}
	if !honorRankActivityMatchesGame(item, game) {
		t.Fatal("配置一致时应判定为已同步")
	}
	game.Rows[2].EndTime = "23:00:00"
	if honorRankActivityMatchesGame(item, game) {
		t.Fatal("结束时间不同必须判定为未同步")
	}
	game.Rows[2].EndTime = "23:59:59"
	game.Rows[0].ActivityOn = false
	if honorRankActivityMatchesGame(item, game) {
		t.Fatal("开关不同必须判定为未同步")
	}
	if honorRankActivityMatchesGame(item, honorRankState{}) {
		t.Fatal("游戏服无配置时不能判定为已同步")
	}
}
