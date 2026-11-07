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
