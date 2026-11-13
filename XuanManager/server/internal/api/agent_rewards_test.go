package api

import (
	"math"
	"testing"
)

// 分摊是发钱的核心算法：必须保证总额恒等、结果可复现、0 权重不参与、异常输入被拒绝。
func TestSplitRewardByWeight(t *testing.T) {
	cases := []struct {
		name    string
		planned int64
		weights map[string]float64
		wantSum int64
		wantOK  bool
	}{
		{"单人拿全部", 30000, map[string]float64{"a": 5}, 30000, true},
		{"整数整除", 30000, map[string]float64{"a": 1, "b": 1, "c": 1}, 30000, true},
		{"尾差补到最大余数", 100, map[string]float64{"a": 1, "b": 1, "c": 1}, 100, true},
		{"零权重被忽略", 1000, map[string]float64{"a": 0, "b": 2, "c": -3}, 1000, true},
		{"小数点数", 30000, map[string]float64{"a": 96.4, "b": 38.2, "c": 1.6}, 30000, true},
		{"总额为 0", 0, map[string]float64{"a": 1, "b": 2}, 0, true},
		{"全零权重", 100, map[string]float64{"a": 0, "b": 0}, 0, false},
		{"空权重", 100, map[string]float64{}, 0, false},
		{"负数总额被拒绝", -1, map[string]float64{"a": 1}, 0, false},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			got, ok := splitRewardByWeight(test.planned, test.weights)
			if ok != test.wantOK {
				t.Fatalf("ok = %v, want %v", ok, test.wantOK)
			}
			if !ok {
				return
			}
			var sum int64
			for _, amount := range got {
				if amount < 0 {
					t.Fatalf("出现负数金额: %v", got)
				}
				sum += amount
			}
			if sum != test.wantSum {
				t.Fatalf("合计 = %d, want %d (%v)", sum, test.wantSum, got)
			}
		})
	}
}

// 同一份输入必须得到同一份结果，否则客服对账时无法复现。
func TestSplitRewardByWeightStable(t *testing.T) {
	weights := map[string]float64{"a": 33.3, "b": 33.3, "c": 33.4, "d": 0}
	first, ok := splitRewardByWeight(1000, weights)
	if !ok {
		t.Fatal("预期可以分摊")
	}
	for i := 0; i < 20; i++ {
		next, _ := splitRewardByWeight(1000, weights)
		for id, amount := range first {
			if next[id] != amount {
				t.Fatalf("第 %d 次结果不稳定: %s %d != %d", i, id, next[id], amount)
			}
		}
	}
}

// 占比必须合计 100.00%，且同样的输入每次结果一致，客服看到的占比才能和分摊对上。
func TestRewardSharePercents(t *testing.T) {
	cases := []struct {
		name    string
		weights map[string]float64
	}{
		{"单人", map[string]float64{"a": 5}},
		{"三人均分", map[string]float64{"a": 1, "b": 1, "c": 1}},
		{"小数点数", map[string]float64{"a": 55.87, "b": 77.61, "c": 0.03}},
		{"零权重不占份额", map[string]float64{"a": 2, "b": 0, "c": -1}},
		{"空名单", map[string]float64{}},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			got := rewardSharePercents(test.weights)
			var sum float64
			positive := 0
			for id, weight := range test.weights {
				if weight > 0 {
					positive++
				}
				if got[id] < 0 {
					t.Fatalf("%s 出现负数占比: %v", id, got[id])
				}
				sum += got[id]
			}
			want := 0.0
			if positive > 0 {
				want = 100
			}
			if math.Abs(sum-want) > 1e-9 {
				t.Fatalf("合计 = %.4f, want %.2f (%v)", sum, want, got)
			}
			for id, weight := range test.weights {
				if weight <= 0 && got[id] != 0 {
					t.Fatalf("零/负权重 %s 占比 = %v, want 0", id, got[id])
				}
			}
		})
	}
}

func TestRewardSharePercentsStable(t *testing.T) {
	weights := map[string]float64{"a": 33.3, "b": 33.3, "c": 33.4, "d": 0}
	first := rewardSharePercents(weights)
	for i := 0; i < 20; i++ {
		next := rewardSharePercents(weights)
		for id, percent := range first {
			if next[id] != percent {
				t.Fatalf("第 %d 次结果不稳定: %s %v != %v", i, id, next[id], percent)
			}
		}
	}
	if first["a"] != 33.30 || first["b"] != 33.30 || first["c"] != 33.40 {
		t.Fatalf("占比分配不符合最大余数法: %v", first)
	}
}

func TestClassifyClubRewardRole(t *testing.T) {
	cases := []struct {
		name     string
		roleText string
		owner    bool
		percent  int64
		level    int64
		want     string
	}{
		{"联盟大盟主", "大盟主", false, 100, 98, "grand"},
		{"俱乐部创建者", "老板", true, 100, 99, "leader"},
		{"创建者兼大盟主角色", "大盟主", true, 100, 99, "grand"},
		{"有截留比例的合伙人", "新玩家", false, 50, 0, "partner"},
		{"满比例的合伙人", "新玩家", false, 100, 0, "partner"},
		{"高级别合伙人", "新玩家", false, 0, 98, "partner"},
		{"被授权但无比例的代理", "新玩家", false, 0, 0, "agent"},
	}
	for _, test := range cases {
		if got := classifyClubRewardRole(test.roleText, test.owner, test.percent, test.level); got != test.want {
			t.Fatalf("%s: got %s, want %s", test.name, got, test.want)
		}
	}
}

func TestValidRewardKind(t *testing.T) {
	for _, kind := range []string{"performance", "core", "pool"} {
		if !validRewardKind(kind) {
			t.Fatalf("%s 应该是合法类型", kind)
		}
	}
	for _, kind := range []string{"", "Performance", "rebate", "all"} {
		if validRewardKind(kind) {
			t.Fatalf("%s 不应该是合法类型", kind)
		}
	}
}

// 奖池共享的比例是加在「奖池 50%」上的，不是整个奖池：100000 → 50000 → 60% = 30000。
func TestRewardPoolSuggested(t *testing.T) {
	cases := []struct {
		total   float64
		percent float64
		want    int64
	}{
		{100000, 60, 30000},
		{100000, 50, 25000},
		{100000, 100, 50000},
		{99999, 60, 30000},
		{0, 60, 0},
		{100000, 0, 0},
	}
	for _, test := range cases {
		if got := rewardPoolSuggested(test.total, test.percent); got != test.want {
			t.Fatalf("奖池 %v × %v%% = %d, want %d", test.total, test.percent, got, test.want)
		}
	}
	// 比例按 50% 算，不能等同于直接按奖池总额算。
	if rewardPoolSuggested(100000, 60) == int64(float64(100000)*0.6) {
		t.Fatal("比例基准错了：应该按奖池 50%，不能直接按整个奖池")
	}
}

// 上级扣掉下级整条线：上级 2 点、下级 1.8 点 → 上级只剩 0.2，不能重复计算。
func TestBuildRewardPerfDeductsChildren(t *testing.T) {
	members := []rewardMember{
		{AgentID: "boss", UpperID: ""},
		{AgentID: "child", UpperID: "boss"},
	}
	lines := map[string]*rewardLine{
		"boss":  {TodayContrib: 2},
		"child": {TodayContrib: 1.8},
	}
	perf := buildRewardPerfFromLines(members, lines)
	if got := perf["boss"].Net; got != 0.2 {
		t.Fatalf("上级净点数 = %v, want 0.2", got)
	}
	if got := perf["child"].Net; got != 1.8 {
		t.Fatalf("下级净点数 = %v, want 1.8", got)
	}
	if got := perf["boss"].Granted; got != 1.8 {
		t.Fatalf("上级已下发 = %v, want 1.8", got)
	}
}

// 下级没进本次名单时，也必须把它算进扣减范围，否则上级会把下级的贡献再算一遍。
func TestRewardLineTargetsIncludesUnselectedChildren(t *testing.T) {
	selected := []rewardMember{{AgentID: "boss", ClubID: "c1"}}
	all := []rewardMember{
		{AgentID: "boss", ClubID: "c1"},
		{AgentID: "child", UpperID: "boss", ClubID: "c1"},
		{AgentID: "other", ClubID: "c2"},
	}
	targets := rewardLineTargets(selected, all)
	got := map[string]bool{}
	for _, m := range targets {
		got[m.AgentID] = true
	}
	if !got["boss"] || !got["child"] {
		t.Fatalf("应该包含本人与直接下级，实际 %v", got)
	}
	if got["other"] {
		t.Fatal("无关代理不应该被查询")
	}
	if len(targets) != 2 {
		t.Fatalf("查询数量 = %d, want 2", len(targets))
	}
}

// 业绩核心共享以联盟为单位：空联盟必须被拒绝，6 位联盟码才允许进入。
func TestNormalizeRewardUnionID(t *testing.T) {
	if value, err := normalizeRewardUnionID(" 123456 "); err != nil || value != "123456" {
		t.Fatalf("合法联盟码解析失败: %q %v", value, err)
	}
	for _, raw := range []string{"", "  ", "12345", "1234567", "abcdef", "12 34"} {
		if _, err := normalizeRewardUnionID(raw); err == nil {
			t.Fatalf("非法联盟码 %q 应该被拒绝", raw)
		}
	}
}

// 游戏服回包可能是直接对象、JSON 字符串或 {"result": ...} 包裹，三种都要能解析。
func TestDecodeGameObject(t *testing.T) {
	cases := []string{
		`{"union_id":"123456","union_quota":"1000000"}`,
		`"{\"union_id\":\"123456\",\"union_quota\":\"1000000\"}"`,
		`{"result":{"union_id":"123456","union_quota":"1000000"}}`,
		`{"result":"{\"union_id\":\"123456\",\"union_quota\":\"1000000\"}"}`,
	}
	for _, raw := range cases {
		object := decodeGameObject([]byte(raw))
		if anyString(object["union_id"]) != "123456" || anyInt(object["union_quota"]) != 1000000 {
			t.Fatalf("解析失败 %s => %v", raw, object)
		}
	}
}

func TestRewardPlayerResultParsers(t *testing.T) {
	payload := map[string]any{
		"success": []any{"100001", "100002"},
		"pending": []any{"100003"},
		"failed": []any{
			map[string]any{"guuid": "100004", "error": "玩家不属于该俱乐部"},
		},
	}
	success := gameStringSet(payload["success"])
	if !success["100001"] || !success["100002"] || success["100003"] {
		t.Fatalf("success 解析不正确: %v", success)
	}
	waiting := gameStringSet(payload["pending"])
	if !waiting["100003"] || waiting["100001"] {
		t.Fatalf("pending 解析不正确: %v", waiting)
	}
	failures := gameFailureMap(payload["failed"])
	if failures["100004"] != "玩家不属于该俱乐部" {
		t.Fatalf("failed 解析不正确: %v", failures)
	}
}

// pending 是上次调用中断，必须重新核对，不能直接当成已完成。
func TestRewardTransferSettled(t *testing.T) {
	for _, status := range []string{rewardPayoutPaid, rewardPayoutWaiting, rewardPayoutMiss} {
		if !rewardTransferSettled(status) {
			t.Fatalf("%s 应该视为已结算", status)
		}
	}
	for _, status := range []string{rewardPayoutPend, rewardPayoutFailed, ""} {
		if rewardTransferSettled(status) {
			t.Fatalf("%s 不应视为已结算", status)
		}
	}
}

func TestBuildRewardChain(t *testing.T) {
	byID := map[string]rewardMember{
		"a": {AgentID: "a", Name: "A", Role: "leader"},
		"b": {AgentID: "b", Name: "B", Role: "partner", UpperID: "a"},
		"c": {AgentID: "c", Name: "C", Role: "agent", UpperID: "b"},
		"d": {AgentID: "d", Name: "D", Role: "agent", UpperID: "missing"},
	}
	chain := buildRewardChain("c", byID)
	if len(chain) != 3 || chain[0].AgentID != "a" || chain[1].AgentID != "b" || chain[2].AgentID != "c" {
		t.Fatalf("代理链应为 a→b→c，实际 %+v", chain)
	}
	if chain := buildRewardChain("d", byID); len(chain) != 1 || chain[0].AgentID != "d" {
		t.Fatalf("上级缺失时应只保留本人，实际 %+v", chain)
	}
	// 循环关系不能死循环：d 的上级 e、e 的上级 d。
	byID["d"] = rewardMember{AgentID: "d", Name: "D", Role: "agent", UpperID: "e"}
	byID["e"] = rewardMember{AgentID: "e", Name: "E", Role: "agent", UpperID: "d"}
	if chain := buildRewardChain("d", byID); len(chain) != 2 {
		t.Fatalf("循环关系应截断为 2 个节点，实际 %+v", chain)
	}
}
