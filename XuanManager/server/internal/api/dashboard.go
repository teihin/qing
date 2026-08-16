package api

import (
	"context"
	"database/sql"
	"net/http"
	"strings"
	"time"
)

var dashboardLocation = time.FixedZone("Asia/Shanghai", 8*60*60)

type auditItem struct {
	ID            int64     `json:"id"`
	OperatorName  string    `json:"operatorName"`
	Action        string    `json:"action"`
	TargetType    string    `json:"targetType"`
	TargetID      string    `json:"targetId"`
	ResultCode    int       `json:"resultCode"`
	ResultMessage string    `json:"resultMessage"`
	IP            string    `json:"ip"`
	CreatedAt     time.Time `json:"createdAt"`
}

type dashboardGameMetrics struct {
	Available            bool      `json:"available"`
	Message              string    `json:"message,omitempty"`
	TotalPlayers         int64     `json:"totalPlayers"`
	TodayNewPlayers      int64     `json:"todayNewPlayers"`
	TodayLoggedInPlayers int64     `json:"todayLoggedInPlayers"`
	CollectedAt          time.Time `json:"collectedAt"`
}

type liveDashboardGameMetrics struct {
	TotalPlayers         int64
	TodayNewPlayers      int64
	TodayLoggedInPlayers int64
	CollectedAt          time.Time
}

const dashboardGameMetricsQuery = `SELECT
  (SELECT COUNT(*) FROM tbl_Account),
  (SELECT COUNT(*) FROM tbl_Account
   WHERE sm_reg_time >= CURDATE() AND sm_reg_time < DATE_ADD(CURDATE(), INTERVAL 1 DAY)),
  (SELECT COUNT(*) FROM kbe_accountinfos
   WHERE lasttime >= ? AND lasttime < ?)`

func (s *Server) handleDashboard(w http.ResponseWriter, r *http.Request, p principal) {
	canSeeSuper := canSeeProtectedRootFlag(p)
	var userCount, enabledUserCount, roleCount, moduleCount, todayAuditCount int64
	err := s.db.QueryRowContext(r.Context(), `SELECT
(SELECT COUNT(*) FROM mgr_user WHERE (? = 1 OR username <> 'admin999')),
(SELECT COUNT(*) FROM mgr_user WHERE status = 'enabled' AND (? = 1 OR username <> 'admin999')),
(SELECT COUNT(*) FROM mgr_role WHERE status = 'enabled'),
(SELECT COUNT(*) FROM mgr_module WHERE status = 'enabled'),
(SELECT COUNT(*) FROM mgr_audit_log audit_row
 WHERE audit_row.created_at >= CURDATE() AND (? = 1 OR `+nonRootAuditVisibilitySQL+`))`,
		canSeeSuper, canSeeSuper, canSeeSuper).Scan(
		&userCount, &enabledUserCount, &roleCount, &moduleCount, &todayAuditCount,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取工作台数据失败")
		return
	}
	recent, err := s.queryAudits(r, p, "", 1, 8)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取最近操作失败")
		return
	}
	gameMetrics := s.dashboardGameMetrics(r.Context())
	writeData(w, http.StatusOK, map[string]any{
		"userCount": userCount, "enabledUserCount": enabledUserCount,
		"roleCount": roleCount, "moduleCount": moduleCount, "todayAuditCount": todayAuditCount,
		"recentAudits": recent, "gameMetrics": gameMetrics,
	})
}

func (s *Server) dashboardGameMetrics(ctx context.Context) dashboardGameMetrics {
	live, err := queryLiveDashboardGameMetrics(ctx, s.gameDB, time.Now())
	if err != nil {
		s.logger.Warn("read dashboard game metrics failed", "error", err)
		return dashboardGameMetrics{Available: false, Message: "游戏统计暂时无法读取，请稍后刷新"}
	}
	return dashboardGameMetrics{
		Available:            true,
		TotalPlayers:         live.TotalPlayers,
		TodayNewPlayers:      live.TodayNewPlayers,
		TodayLoggedInPlayers: live.TodayLoggedInPlayers,
		CollectedAt:          live.CollectedAt,
	}
}

func queryLiveDashboardGameMetrics(ctx context.Context, gameDB *sql.DB, now time.Time) (liveDashboardGameMetrics, error) {
	localNow, dayStart, dayEnd := dashboardBusinessPeriod(now)
	metrics := liveDashboardGameMetrics{
		CollectedAt: localNow,
	}
	err := gameDB.QueryRowContext(ctx, dashboardGameMetricsQuery,
		dayStart.Unix(), dayEnd.Unix(),
	).Scan(&metrics.TotalPlayers, &metrics.TodayNewPlayers, &metrics.TodayLoggedInPlayers)
	return metrics, err
}

func dashboardBusinessPeriod(now time.Time) (time.Time, time.Time, time.Time) {
	localNow := now.In(dashboardLocation)
	dayStart := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), 0, 0, 0, 0, dashboardLocation).UTC()
	return localNow, dayStart, dayStart.Add(24 * time.Hour)
}

func (s *Server) handleAuditList(w http.ResponseWriter, r *http.Request, p principal) {
	page, size := pageParams(r)
	keyword := strings.TrimSpace(r.URL.Query().Get("keyword"))
	like := "%" + keyword + "%"
	var total int64
	if err := s.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM mgr_audit_log audit_row
WHERE (? = 1 OR `+nonRootAuditVisibilitySQL+`)
  AND (? = '' OR audit_row.operator_name LIKE ? OR audit_row.action LIKE ? OR audit_row.target_id LIKE ?)`,
		canSeeProtectedRootFlag(p), keyword, like, like, like).Scan(&total); err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取审计数量失败")
		return
	}
	items, err := s.queryAudits(r, p, keyword, page, size)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取审计记录失败")
		return
	}
	writeData(w, http.StatusOK, map[string]any{"items": items, "page": page, "pageSize": size, "total": total})
}

func (s *Server) queryAudits(r *http.Request, p principal, keyword string, page, size int) ([]auditItem, error) {
	like := "%" + keyword + "%"
	rows, err := s.db.QueryContext(r.Context(), `SELECT
id, operator_name, action, target_type, target_id, result_code, result_message, ip, created_at
FROM mgr_audit_log audit_row
WHERE (? = 1 OR `+nonRootAuditVisibilitySQL+`)
  AND (? = '' OR audit_row.operator_name LIKE ? OR audit_row.action LIKE ? OR audit_row.target_id LIKE ?)
ORDER BY audit_row.id DESC LIMIT ? OFFSET ?`, canSeeProtectedRootFlag(p), keyword, like, like, like, size, (page-1)*size)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []auditItem{}
	for rows.Next() {
		var item auditItem
		if err := rows.Scan(&item.ID, &item.OperatorName, &item.Action, &item.TargetType, &item.TargetID,
			&item.ResultCode, &item.ResultMessage, &item.IP, &item.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
