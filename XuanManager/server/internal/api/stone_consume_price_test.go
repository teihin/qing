package api

import (
	"strings"
	"testing"
)

func TestValidateStoneConsumePriceFillsMissingItems(t *testing.T) {
	values, err := validateStoneConsumePriceInput([]stoneConsumePriceItemState{
		{Code: "看数据", Stone: 3},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if values["看数据"] != 3 {
		t.Fatalf("看数据 = %d, want 3", values["看数据"])
	}
	// 未提交的项必须按默认值补齐，不能被写成 0。
	for _, item := range stoneConsumePriceCatalog {
		if item.Code == "看数据" {
			continue
		}
		if values[item.Code] != item.Default {
			t.Fatalf("%s = %d, want default %d", item.Code, values[item.Code], item.Default)
		}
	}
}

func TestValidateStoneConsumePriceRejectsUnknownAndOutOfRange(t *testing.T) {
	if _, err := validateStoneConsumePriceInput([]stoneConsumePriceItemState{{Code: "不存在的项", Stone: 1}}); err == nil {
		t.Fatal("unknown code must be rejected")
	}
	if _, err := validateStoneConsumePriceInput([]stoneConsumePriceItemState{{Code: "看数据", Stone: -1}}); err == nil {
		t.Fatal("negative stone must be rejected")
	}
	if _, err := validateStoneConsumePriceInput([]stoneConsumePriceItemState{{Code: "看数据", Stone: stoneConsumePriceMax + 1}}); err == nil {
		t.Fatal("over max stone must be rejected")
	}
	if _, err := validateStoneConsumePriceInput(nil); err == nil {
		t.Fatal("empty payload must be rejected")
	}
}

func TestValidateStoneConsumePriceIgnoresRetiredItems(t *testing.T) {
	values, err := validateStoneConsumePriceInput([]stoneConsumePriceItemState{
		{Code: "看数据", Stone: 2},
		{Code: "购买VIP月卡", Stone: 99},
	})
	if err != nil {
		t.Fatalf("retired item must not break saving: %v", err)
	}
	if values["看数据"] != 2 {
		t.Fatalf("看数据 = %d, want 2", values["看数据"])
	}
	if _, ok := values["购买VIP月卡"]; ok {
		t.Fatal("retired item must not be written back")
	}
}

func TestStoneConsumePriceCatalogExcludesRetired(t *testing.T) {
	for _, item := range stoneConsumePriceCatalog {
		if stoneConsumePriceRetired[item.Code] {
			t.Fatalf("catalog still contains retired item: %s", item.Code)
		}
	}
}

func TestCompareStoneConsumePrice(t *testing.T) {
	if mismatch := compareStoneConsumePrice(map[string]int{"看数据": 1}, map[string]int{"看数据": 1}); mismatch != "" {
		t.Fatalf("unexpected mismatch: %s", mismatch)
	}
	mismatch := compareStoneConsumePrice(map[string]int{"看数据": 1}, map[string]int{"看数据": 2})
	if !strings.Contains(mismatch, "看数据") {
		t.Fatalf("mismatch should mention the item, got %q", mismatch)
	}
}

func TestStoneConsumePriceCatalogHasNoDuplicateCode(t *testing.T) {
	seen := map[string]bool{}
	for _, item := range stoneConsumePriceCatalog {
		if item.Code == "" {
			t.Fatal("catalog item has empty code")
		}
		if seen[item.Code] {
			t.Fatalf("duplicate code: %s", item.Code)
		}
		seen[item.Code] = true
		if item.Default < 0 || item.Default > stoneConsumePriceMax {
			t.Fatalf("%s default out of range: %d", item.Code, item.Default)
		}
	}
}
