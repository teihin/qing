package api

import "testing"

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
