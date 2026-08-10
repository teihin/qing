package api

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestParseTransactionFilters(t *testing.T) {
	r := httptest.NewRequest("GET", "/api/game/transactions?playerId=292989&category=item&direction=out&optionType=%E6%B6%88%E8%B4%B9&keyword=needle&startDate=2026-08-01&endDate=2026-08-09", nil)
	filters, err := parseTransactionFilters(r)
	if err != nil {
		t.Fatalf("parse filters: %v", err)
	}
	if filters.PlayerID != "292989" || filters.Category != "item" || filters.Direction != "out" || filters.OptionType != "消费" {
		t.Fatalf("unexpected filters: %#v", filters)
	}
	where, args := buildTransactionWhere(filters)
	if strings.Contains(where, filters.PlayerID) || strings.Contains(where, filters.Keyword) {
		t.Fatalf("query values must not be interpolated: %s", where)
	}
	if !strings.Contains(where, "w.user_guuid = ?") || !strings.Contains(where, "ROUND(w.new_money - w.old_money, 2) < 0") || len(args) != 11 {
		t.Fatalf("unexpected where clause or args: %s %#v", where, args)
	}
}

func TestMatchBalanceAdjustmentAuditsAddsMaintenanceReason(t *testing.T) {
	createdAt := time.Date(2026, 8, 10, 8, 14, 36, 0, time.Local)
	items := []transactionItem{{
		ID: 943, OccurredAt: "2026-08-10 08:14:36", OptionType: "补分",
		OldBalance: 2000, NewBalance: 3000, Change: 1000,
	}}
	audits := []balanceAdjustmentAuditRecord{{
		OperatorName: "admin999", CreatedAt: createdAt,
		Request: balanceAdjustmentAuditRequest{Action: "add", Amount: 1000, Reason: "客服核对后补发金币", WorkOrder: "BFXM2026081008143631ab31"},
		Before:  balanceAdjustmentAuditSnapshot{Balance: 2000}, After: balanceAdjustmentAuditSnapshot{Balance: 3000},
	}}

	matchBalanceAdjustmentAudits(items, audits)
	if items[0].MaintenanceReason != "客服核对后补发金币" || items[0].MaintenanceOperator != "admin999" || items[0].MaintenanceWorkOrder == "" {
		t.Fatalf("maintenance fields were not attached: %#v", items[0])
	}
}

func TestMatchBalanceAdjustmentAuditsDoesNotAttachUnrelatedAudit(t *testing.T) {
	items := []transactionItem{{ID: 1, OccurredAt: "2026-08-10 08:14:36", OldBalance: 2000, NewBalance: 3000, Change: 1000}}
	audits := []balanceAdjustmentAuditRecord{{
		OperatorName: "admin999", CreatedAt: time.Date(2026, 8, 10, 8, 14, 36, 0, time.Local),
		Request: balanceAdjustmentAuditRequest{Action: "subtract", Reason: "不应关联"},
		Before:  balanceAdjustmentAuditSnapshot{Balance: 2000}, After: balanceAdjustmentAuditSnapshot{Balance: 3000},
	}}
	matchBalanceAdjustmentAudits(items, audits)
	if items[0].MaintenanceReason != "" {
		t.Fatalf("unrelated audit was attached: %#v", items[0])
	}
}

func TestParseTransactionFiltersRejectsInvalidValues(t *testing.T) {
	for _, target := range []string{
		"/api/game/transactions",
		"/api/game/transactions?playerId=../123",
		"/api/game/transactions?playerId=292989&category=unknown",
		"/api/game/transactions?playerId=292989&direction=up",
		"/api/game/transactions?playerId=292989&startDate=2026/08/01",
		"/api/game/transactions?playerId=292989&startDate=2026-08-09&endDate=2026-08-01",
	} {
		r := httptest.NewRequest("GET", target, nil)
		if _, err := parseTransactionFilters(r); err == nil {
			t.Fatalf("expected invalid filters for %s", target)
		}
	}
}

func TestTransactionCategorySQLOrder(t *testing.T) {
	item := strings.Index(transactionCategorySQL, transactionItemCondition)
	game := strings.Index(transactionCategorySQL, transactionGameCondition)
	consumption := strings.Index(transactionCategorySQL, transactionConsumptionCondition)
	if item < 0 || game < 0 || consumption < 0 || !(item < game && game < consumption) {
		t.Fatalf("item classification must run before general consumption: %s", transactionCategorySQL)
	}
}
