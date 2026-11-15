package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"xuanmanager/internal/config"
)

func sampleHonorRankReply() json.RawMessage {
	return json.RawMessage(`{
		"scope_type":"union","scope_id":"123456","club_id":"222697",
		"list":[
			{"rank_type":"play","dipi":"1皮","reward_list":["100","50","20"],
			 "activity_on":"1","start_date":"2026-11-20","start_time":"00:00","end_date":"2026-11-30","end_time":"23:59:59",
			 "update_date":"2026-11-15","update_time":"10:30:00","opter_guuid":"999999"},
			{"rank_type":"play","dipi":"2皮","reward_list":["10"],
			 "activity_on":"1","start_date":"2026-11-20","start_time":"00:00:00","end_date":"2026-11-30","end_time":"23:59:59",
			 "update_date":"2026-11-15","update_time":"10:30:00","opter_guuid":"999999"},
			{"rank_type":"score","dipi":"","reward_list":["200","100"],
			 "activity_on":"0","start_date":"2026-11-20","start_time":"00:00:00","end_date":"2026-11-30","end_time":"23:59:59",
			 "update_date":"2026-11-15","update_time":"10:31:00","opter_guuid":"999999"}
		]
	}`)
}

func decodeSample(t *testing.T) honorRankState {
	t.Helper()
	reply, err := decodeHonorRankReply(sampleHonorRankReply())
	if err != nil {
		t.Fatalf("decodeHonorRankReply: %v", err)
	}
	state := honorRankState{
		Scope:    "union",
		TargetID: "123456",
		ClubID:   reply.ClubID,
		Rows:     normalizeHonorRankRows(reply.List),
	}
	summarizeHonorRank(&state)
	return state
}

func TestNormalizeHonorRankRows(t *testing.T) {
	state := decodeSample(t)
	if len(state.Rows) != 7 {
		t.Fatalf("want 7 rows, got %d", len(state.Rows))
	}
	if state.Rows[0].RankType != "play" || state.Rows[0].Dipi != "1皮" {
		t.Fatalf("first row wrong: %+v", state.Rows[0])
	}
	if !state.Rows[0].ActivityOn || len(state.Rows[0].Rewards) != 3 {
		t.Fatalf("1皮 not parsed: %+v", state.Rows[0])
	}
	// 回包只给了 1皮/2皮 + score，其余 4 行要补空且默认关。
	if state.Rows[3].Dipi != "10皮" || state.Rows[3].ActivityOn || len(state.Rows[3].Rewards) != 0 {
		t.Fatalf("missing row not backfilled: %+v", state.Rows[3])
	}
	if state.Rows[5].RankType != "score" || state.Rows[6].RankType != "bonus" {
		t.Fatalf("tail rows wrong: %+v", state.Rows[5:])
	}
	// 时钟统一成带秒。
	if state.Rows[0].StartTime != "00:00:00" {
		t.Fatalf("clock not normalized: %q", state.Rows[0].StartTime)
	}
}

func TestSummarizeHonorRank(t *testing.T) {
	state := decodeSample(t)
	if !state.ActivityOn || !state.MixedOn {
		t.Fatalf("2/7 rows on should be partial: on=%v mixed=%v", state.ActivityOn, state.MixedOn)
	}
	if state.MixedSchedule {
		t.Fatal("identical schedule should not be mixed")
	}
	boards := map[string]honorRankBoardState{}
	for _, board := range state.Boards {
		boards[board.RankType] = board
	}
	if !boards["play"].On || !boards["play"].Mixed {
		t.Fatalf("play board should be partially on: %+v", boards["play"])
	}
	if boards["score"].On || boards["score"].Mixed || boards["bonus"].On {
		t.Fatalf("closed boards wrong: %+v", boards)
	}

	// 全空配置 = 全关，但仍要给出 3 个榜位。
	off := honorRankState{Rows: normalizeHonorRankRows(nil)}
	summarizeHonorRank(&off)
	if off.ActivityOn || off.MixedOn || off.MixedSchedule {
		t.Fatalf("empty config should be all off: %+v", off)
	}
	if len(off.Boards) != 3 {
		t.Fatalf("empty config should still expose 3 boards: %+v", off.Boards)
	}
}

func TestSummarizeHonorRankDetectsScheduleDrift(t *testing.T) {
	rows := normalizeHonorRankRows([]honorRankGameRow{
		{RankType: "play", Dipi: "1皮", ActivityOn: "1", StartDate: "2026-11-20", StartTime: "00:00:00", EndDate: "2026-11-30", EndTime: "23:59:59"},
		{RankType: "play", Dipi: "2皮", ActivityOn: "1", StartDate: "2026-11-21", StartTime: "00:00:00", EndDate: "2026-11-30", EndTime: "23:59:59"},
	})
	state := honorRankState{Rows: rows}
	summarizeHonorRank(&state)
	if !state.MixedSchedule {
		t.Fatal("different start dates should be flagged")
	}
}

func validHonorRankRequest() updateHonorRankRequest {
	return updateHonorRankRequest{
		ActivityOn: true,
		StartDate:  "2026-11-20",
		StartTime:  "00:00:00",
		EndDate:    "2026-11-30",
		EndTime:    "23:59:59",
		Boards: []updateHonorRankBoard{
			{RankType: "play", On: true, Rewards: []updateHonorRankReward{
				{Dipi: "1皮", List: " 100, 50 ,20 "},
				{Dipi: "2皮", List: "80,40"},
				{Dipi: "5皮", List: "60,30"},
				{Dipi: "10皮", List: "40,20"},
				{Dipi: "20皮", List: "20,10"},
			}},
			{RankType: "score", On: false, Rewards: []updateHonorRankReward{{Dipi: "", List: "200,100"}}},
			{RankType: "bonus", On: false, Rewards: []updateHonorRankReward{{Dipi: "", List: ""}}},
		},
		Note:    "运营开榜",
		Confirm: true,
	}
}

func TestBuildHonorRankWrites(t *testing.T) {
	input := validHonorRankRequest()
	writes, err := buildHonorRankWrites(&input)
	if err != nil {
		t.Fatalf("buildHonorRankWrites: %v", err)
	}
	if len(writes) != 7 {
		t.Fatalf("want 7 writes, got %d", len(writes))
	}
	if writes[0].Dipi != "1皮" || writes[0].RewardList != "100,50,20" || !writes[0].ActivityOn {
		t.Fatalf("play 1皮 wrong: %+v", writes[0])
	}
	if writes[1].Dipi != "2皮" || writes[1].RewardList != "80,40" || !writes[1].ActivityOn {
		t.Fatalf("play 2皮 wrong: %+v", writes[1])
	}
	if writes[4].Dipi != "20皮" || !writes[4].ActivityOn {
		t.Fatalf("play 20皮 should follow board switch: %+v", writes[4])
	}
	// 关掉的榜：行照样写，但 activity_on=0，时间保留。
	if writes[5].RankType != "score" || writes[5].ActivityOn || writes[5].RewardList != "200,100" {
		t.Fatalf("score row wrong: %+v", writes[5])
	}
	if writes[6].RankType != "bonus" || writes[6].ActivityOn {
		t.Fatalf("bonus row wrong: %+v", writes[6])
	}
	if writes[5].StartDate != "2026-11-20" || writes[5].EndTime != "23:59:59" {
		t.Fatalf("schedule must be kept on closed boards: %+v", writes[5])
	}
}

func TestBuildHonorRankWritesRequiresRewards(t *testing.T) {
	input := validHonorRankRequest()
	for index := range input.Boards {
		if input.Boards[index].RankType != "play" {
			continue
		}
		// 手数榜只配一档也允许（运营可能只开 1皮）。
		for reward := range input.Boards[index].Rewards {
			input.Boards[index].Rewards[reward].List = ""
		}
		input.Boards[index].Rewards[0].List = "100,50"
	}
	if _, err := buildHonorRankWrites(&input); err != nil {
		t.Fatalf("只配一档应该允许: %v", err)
	}
	// 整榜一个金额都没有：必须拒绝，否则会发出"有榜无奖"的活动。
	input = validHonorRankRequest()
	for index := range input.Boards {
		if input.Boards[index].RankType != "play" {
			continue
		}
		for reward := range input.Boards[index].Rewards {
			input.Boards[index].Rewards[reward].List = ""
		}
	}
	if _, err := buildHonorRankWrites(&input); err == nil {
		t.Fatal("开着的榜没有任何奖励时必须报错")
	}
	// 关榜时不要求金额。
	input.ActivityOn = false
	if _, err := buildHonorRankWrites(&input); err != nil {
		t.Fatalf("关闭活动时不该要求奖励: %v", err)
	}
}

func TestNormalizeRewardListRejectsBadInput(t *testing.T) {
	cases := []string{"100，50", "100、50", "100;50", "100,,50", "100,", "-50", "0", "12.5", "一百"}
	for _, value := range cases {
		if _, err := normalizeRewardList(value); err == nil {
			t.Fatalf("%q 应该被判为非法", value)
		}
	}
	if got, err := normalizeRewardList(" 100, 50 ,20 "); err != nil || got != "100,50,20" {
		t.Fatalf("正常输入被误判: %q %v", got, err)
	}
	if got, err := normalizeRewardList("   "); err != nil || got != "" {
		t.Fatalf("空白应按空处理: %q %v", got, err)
	}
}

func TestBuildHonorRankWritesCloseKeepsSchedule(t *testing.T) {
	input := validHonorRankRequest()
	input.ActivityOn = false
	writes, err := buildHonorRankWrites(&input)
	if err != nil {
		t.Fatalf("close should pass: %v", err)
	}
	for _, row := range writes {
		if row.ActivityOn {
			t.Fatalf("closed leaderboard must write activity_on=0: %+v", row)
		}
		if row.StartDate != "2026-11-20" {
			t.Fatalf("schedule should be preserved when closing: %+v", row)
		}
	}
}

func TestBuildHonorRankWritesRules(t *testing.T) {
	// 未确认
	input := validHonorRankRequest()
	input.Confirm = false
	if _, err := buildHonorRankWrites(&input); err == nil {
		t.Fatal("expected confirm error")
	}

	// 开启但缺时间
	input = validHonorRankRequest()
	input.EndDate = ""
	if _, err := buildHonorRankWrites(&input); err == nil {
		t.Fatal("expected time error")
	}

	// 结束早于开始（文档允许相等，只拒绝更早）
	input = validHonorRankRequest()
	input.EndDate = "2026-11-19"
	if _, err := buildHonorRankWrites(&input); err == nil {
		t.Fatal("expected order error")
	}

	// 开启但一个榜都没选
	input = validHonorRankRequest()
	for index := range input.Boards {
		input.Boards[index].On = false
	}
	if _, err := buildHonorRankWrites(&input); err == nil {
		t.Fatal("expected empty board error")
	}

	// 缺榜
	input = validHonorRankRequest()
	input.Boards = input.Boards[:2]
	if _, err := buildHonorRankWrites(&input); err == nil {
		t.Fatal("expected incomplete boards error")
	}

	// 奖励非法
	for _, bad := range []string{"100,abc", "-1,20", "100,,20", "1000001"} {
		input = validHonorRankRequest()
		input.Boards[2].Rewards[0].List = bad
		if _, err := buildHonorRankWrites(&input); err == nil {
			t.Fatalf("accepted bad rewards %q", bad)
		}
	}
}

func TestHonorRankQueryCommandEncoding(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/hall/command" || r.URL.Query().Get("header") != honorRankQueryCommand {
			t.Errorf("incorrect command URL %s", r.URL)
		}
		var params map[string]any
		if err := json.Unmarshal([]byte(r.URL.Query().Get("param")), &params); err != nil {
			t.Error(err)
		}
		if params["union_id"] != "123456" || params["club_id"] != nil {
			t.Errorf("union scope must not send club_id: %v", params)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ret_code":512,"ret_result":` + mustJSON(string(sampleHonorRankReply())) + `}`))
	}))
	defer upstream.Close()
	s := &Server{cfg: config.Config{GameAdminURL: upstream.URL}, gameHTTPClient: upstream.Client()}
	state, err := s.queryHonorRankConfig(context.Background(), "union", "123456")
	if err != nil {
		t.Fatalf("queryHonorRankConfig: %v", err)
	}
	if state.TargetID != "123456" || state.ClubID != "222697" || len(state.Rows) != 7 {
		t.Fatalf("unexpected state %+v", state)
	}
}

func TestHonorRankSetRowCommandEncoding(t *testing.T) {
	var calls int
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("header") != honorRankSetCommand {
			t.Errorf("unexpected header %s", r.URL.Query().Get("header"))
		}
		var params map[string]any
		if err := json.Unmarshal([]byte(r.URL.Query().Get("param")), &params); err != nil {
			t.Error(err)
		}
		calls++
		if params["club_id"] != "222697" || params["rank_type"] != "play" || params["play_type"] != "1皮" {
			t.Errorf("incorrect params %v", params)
		}
		if params["activity_on"] != "1" || params["start_date"] != "2026-11-20" || params["end_time"] != "23:59:59" {
			t.Errorf("activity params missing %v", params)
		}
		if params["reward_list"] != "100,50" {
			t.Errorf("reward list wrong %v", params["reward_list"])
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ret_code":512,"ret_result":{"rank_type":"play","dipi":"1皮"}}`))
	}))
	defer upstream.Close()
	s := &Server{cfg: config.Config{GameAdminURL: upstream.URL}, gameHTTPClient: upstream.Client()}
	err := s.writeHonorRankRow(context.Background(), "club", "222697", honorRankWriteRow{
		RankType: "play", Dipi: "1皮", RewardList: "100,50", ActivityOn: true,
		StartDate: "2026-11-20", StartTime: "00:00:00", EndDate: "2026-11-30", EndTime: "23:59:59",
	})
	if err != nil {
		t.Fatalf("writeHonorRankRow: %v", err)
	}
	if calls != 1 {
		t.Fatalf("want 1 call, got %d", calls)
	}
}
