package api

import (
	"testing"
	"time"
)

// 策略只管「动作与智力」：只覆盖带入倍数；进哪些房间、输赢目标归投放 / 机器人自身配置，不能被策略动。
func TestApplyStrategyConfigOnlyOverridesBuyin(t *testing.T) {
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	item := agentAssignment{
		BuyinMultiple: 2,
		RoomPi:        "底皮1/3",
		ProfitMode:    "daily",
		ProfitTarget:  1000,
		PeriodStart:   &start,
	}
	raw := `{"buyinMultiple":5,"roomPi":"底皮2/5","profitMode":"period","profitTarget":0,"bigPairFen":7}`
	applyStrategyConfig(&item, raw)

	if item.BuyinMultiple != 5 {
		t.Fatalf("buyinMultiple 应被策略覆盖为 5，实际 %d", item.BuyinMultiple)
	}
	if item.RoomPi != "底皮1/3" {
		t.Fatalf("只进底皮归投放，不应被策略覆盖，实际 %s", item.RoomPi)
	}
	if item.ProfitMode != "daily" || item.ProfitTarget != 1000 {
		t.Fatalf("输赢目标归投放，不应被策略覆盖，实际 %s / %d", item.ProfitMode, item.ProfitTarget)
	}
	if item.PeriodStart == nil || !item.PeriodStart.Equal(start) {
		t.Fatalf("周期日期归投放，不应被策略覆盖，实际 %v", item.PeriodStart)
	}
	if len(item.StrategyConfig) == 0 {
		t.Fatal("策略原文应一并下发，节点据此注入客户端环境变量")
	}
}

// 空策略 / 空 JSON 不能改动任何字段。
func TestApplyStrategyConfigIgnoresEmpty(t *testing.T) {
	for _, raw := range []string{"", "  ", "{}", "not-json"} {
		item := agentAssignment{BuyinMultiple: 3, RoomPi: "底皮1/3"}
		applyStrategyConfig(&item, raw)
		if item.BuyinMultiple != 3 || item.RoomPi != "底皮1/3" {
			t.Fatalf("策略为 %q 时不应改动机器人配置", raw)
		}
		if len(item.StrategyConfig) != 0 {
			t.Fatalf("策略为 %q 时不应下发 strategyConfig", raw)
		}
	}
}
