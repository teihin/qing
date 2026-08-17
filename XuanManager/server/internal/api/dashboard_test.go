package api

import (
	"strings"
	"testing"
	"time"
)

func TestDashboardNewPlayersUseDatabaseRegistrationDate(t *testing.T) {
	if !strings.Contains(dashboardGameMetricsQuery, "sm_reg_time >= ?") ||
		!strings.Contains(dashboardGameMetricsQuery, "sm_reg_time < ?") {
		t.Fatal("new player metric must use explicit Beijing calendar boundaries")
	}
	if strings.Contains(dashboardGameMetricsQuery, "CURDATE()") {
		t.Fatal("new player metric must not depend on the MySQL server UTC calendar day")
	}
}

func TestDashboardBusinessPeriodUsesChinaOperatingDay(t *testing.T) {
	now := time.Date(2026, 8, 10, 16, 19, 38, 0, time.UTC)
	local, start, end := dashboardBusinessPeriod(now)
	if got := local.Format("2006-01-02 15"); got != "2026-08-11 00" {
		t.Fatalf("unexpected local time %s", got)
	}
	if got := start.Format(time.RFC3339); got != "2026-08-10T16:00:00Z" {
		t.Fatalf("unexpected UTC day start %s", got)
	}
	if end.Sub(start) != 24*time.Hour {
		t.Fatalf("unexpected day duration %s", end.Sub(start))
	}
}
