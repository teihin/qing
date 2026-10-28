package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type automationScope struct {
	All   bool
	Clubs []string
}

func (s *Server) automationScope(ctx context.Context, p principal) (automationScope, error) {
	if p.IsSuper || p.Can("automation.scope.all") {
		return automationScope{All: true}, nil
	}
	rows, err := s.db.QueryContext(ctx, "SELECT club_id FROM mgr_automation_scope WHERE user_id = ? ORDER BY club_id", p.ID)
	if err != nil {
		return automationScope{}, err
	}
	defer rows.Close()
	scope := automationScope{Clubs: []string{}}
	for rows.Next() {
		var clubID string
		if err := rows.Scan(&clubID); err != nil {
			return automationScope{}, err
		}
		scope.Clubs = append(scope.Clubs, clubID)
	}
	return scope, rows.Err()
}

func (scope automationScope) Allows(clubID string) bool {
	if scope.All {
		return true
	}
	for _, item := range scope.Clubs {
		if item == clubID {
			return true
		}
	}
	return false
}

func placeholders(count int) string {
	if count <= 0 {
		return ""
	}
	return strings.TrimSuffix(strings.Repeat("?,", count), ",")
}

func scopeClause(column string, scope automationScope) (string, []any) {
	if scope.All {
		return "1 = 1", nil
	}
	if len(scope.Clubs) == 0 {
		return "1 = 0", nil
	}
	args := make([]any, 0, len(scope.Clubs))
	for _, clubID := range scope.Clubs {
		args = append(args, clubID)
	}
	return column + " IN (" + placeholders(len(args)) + ")", args
}

func alertScopeClause(scope automationScope) (string, []any) {
	if scope.All {
		return "1 = 1", nil
	}
	if len(scope.Clubs) == 0 {
		return "1 = 0", nil
	}
	args := make([]any, 0, len(scope.Clubs)*4)
	for i := 0; i < 4; i++ {
		for _, clubID := range scope.Clubs {
			args = append(args, clubID)
		}
	}
	ph := placeholders(len(scope.Clubs))
	return `(target_type = 'club' AND target_id IN (` + ph + `))
OR (target_type = 'robot' AND target_id IN (SELECT CAST(id AS CHAR) FROM mgr_automation_robot WHERE club_id IN (` + ph + `)))
OR (target_type = 'group' AND target_id IN (SELECT CAST(id AS CHAR) FROM mgr_automation_group WHERE club_id IN (` + ph + `)))
OR (target_type = 'room' AND target_id IN (SELECT CAST(room_id AS CHAR) FROM mgr_automation_room_snapshot WHERE club_id IN (` + ph + `)))`, args
}

func parsePositivePathID(w http.ResponseWriter, r *http.Request, key, message string) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue(key), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "INVALID_ID", message)
		return 0, false
	}
	return id, true
}

func validClubID(value string) bool {
	if len(value) != 6 {
		return false
	}
	for _, char := range value {
		if char < '0' || char > '9' {
			return false
		}
	}
	return true
}

func automationOperator(p principal) string {
	if p.DisplayName != "" {
		return p.DisplayName
	}
	return p.Username
}

type automationClubCard struct {
	ClubID       string `json:"clubId"`
	Name         string `json:"name"`
	Mode         int    `json:"mode"`
	RobotQuota   int    `json:"robotQuota"`
	SeatRatio    int    `json:"seatRatio"`
	Status       string `json:"status"`
	RoomCount    int    `json:"roomCount"`
	Capacity     int    `json:"capacity"`
	Seated       int    `json:"seated"`
	RobotCount   int    `json:"robotCount"`
	OnlineCount  int    `json:"onlineCount"`
	TargetSeated int    `json:"targetSeated"`
}

type automationOverviewMetrics struct {
	TotalRobots      int     `json:"totalRobots"`
	OnlineRobots     int     `json:"onlineRobots"`
	SeatedRobots     int     `json:"seatedRobots"`
	PlayingRobots    int     `json:"playingRobots"`
	FaultedRobots    int     `json:"faultedRobots"`
	Capacity         int     `json:"capacity"`
	SeatedTotal      int     `json:"seatedTotal"`
	TargetSeated     int     `json:"targetSeated"`
	TodayRounds      int64   `json:"todayRounds"`
	TodayNet         int64   `json:"todayNet"`
	OpenAlerts       int     `json:"openAlerts"`
	P0Alerts         int     `json:"p0Alerts"`
	PendingApprovals int     `json:"pendingApprovals"`
	HealthRate       float64 `json:"healthRate"`
}

type automationAlertItem struct {
	ID         int64      `json:"id"`
	Level      string     `json:"level"`
	Category   string     `json:"category"`
	TargetType string     `json:"targetType"`
	TargetID   string     `json:"targetId"`
	Title      string     `json:"title"`
	Detail     string     `json:"detail"`
	Status     string     `json:"status"`
	Assignee   string     `json:"assignee"`
	Note       string     `json:"note"`
	FirstSeen  time.Time  `json:"firstSeen"`
	LastSeen   time.Time  `json:"lastSeen"`
	ResolvedAt *time.Time `json:"resolvedAt"`
}

type automationApprovalItem struct {
	ID            int64      `json:"id"`
	Action        string     `json:"action"`
	TargetType    string     `json:"targetType"`
	TargetID      string     `json:"targetId"`
	Params        string     `json:"params"`
	Reason        string     `json:"reason"`
	Status        string     `json:"status"`
	RequesterName string     `json:"requesterName"`
	ApproverName  string     `json:"approverName"`
	CreatedAt     time.Time  `json:"createdAt"`
	DecidedAt     *time.Time `json:"decidedAt"`
}

func (s *Server) handleAutomationOverview(w http.ResponseWriter, r *http.Request, p principal) {
	scope, err := s.automationScope(r.Context(), p)
	if err != nil {
		s.logger.Error("resolve automation scope", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取数据范围失败")
		return
	}
	robotClause, robotArgs := scopeClause("club_id", scope)
	roomClause, roomArgs := scopeClause("club_id", scope)
	groupClause, groupArgs := scopeClause("club_id", scope)

	var metrics automationOverviewMetrics
	err = s.db.QueryRowContext(r.Context(), `SELECT
COUNT(*),
COALESCE(SUM(CASE WHEN status IN ('idle','entering','seated','playing','paused','draining') THEN 1 ELSE 0 END), 0),
COALESCE(SUM(CASE WHEN status IN ('seated','playing','paused') THEN 1 ELSE 0 END), 0),
COALESCE(SUM(CASE WHEN status = 'playing' THEN 1 ELSE 0 END), 0),
COALESCE(SUM(CASE WHEN status = 'faulted' THEN 1 ELSE 0 END), 0),
COALESCE(SUM(today_rounds), 0),
COALESCE(SUM(today_net), 0)
FROM mgr_automation_robot WHERE `+robotClause, robotArgs...).Scan(
		&metrics.TotalRobots, &metrics.OnlineRobots, &metrics.SeatedRobots,
		&metrics.PlayingRobots, &metrics.FaultedRobots, &metrics.TodayRounds, &metrics.TodayNet,
	)
	if err != nil {
		s.logger.Error("automation overview robots", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取终端汇总失败")
		return
	}
	if metrics.TotalRobots > 0 {
		metrics.HealthRate = float64(metrics.TotalRobots-metrics.FaultedRobots) / float64(metrics.TotalRobots) * 100
	}
	if err := s.db.QueryRowContext(r.Context(), `SELECT
COALESCE(SUM(max_seats), 0), COALESCE(SUM(seated), 0)
FROM mgr_automation_room_snapshot WHERE `+roomClause, roomArgs...).Scan(&metrics.Capacity, &metrics.SeatedTotal); err != nil {
		s.logger.Error("automation overview rooms", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取房间容量失败")
		return
	}
	if err := s.db.QueryRowContext(r.Context(), `SELECT COALESCE(SUM(target_seated), 0)
FROM mgr_automation_group WHERE status = 'enabled' AND `+groupClause, groupArgs...).Scan(&metrics.TargetSeated); err != nil {
		s.logger.Error("automation overview groups", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取目标在座失败")
		return
	}
	alertClause, alertArgs := alertScopeClause(scope)
	if err := s.db.QueryRowContext(r.Context(), `SELECT
COALESCE(SUM(CASE WHEN status IN ('open','ack') THEN 1 ELSE 0 END), 0),
COALESCE(SUM(CASE WHEN status IN ('open','ack') AND level = 'P0' THEN 1 ELSE 0 END), 0)
FROM mgr_automation_alert WHERE `+alertClause, alertArgs...).Scan(&metrics.OpenAlerts, &metrics.P0Alerts); err != nil {
		s.logger.Error("automation overview alerts", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取告警汇总失败")
		return
	}
	if scope.All {
		_ = s.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM mgr_automation_approval WHERE status = 'pending'").Scan(&metrics.PendingApprovals)
	}

	clubClause, clubArgs := scopeClause("c.club_id", scope)
	rows, err := s.db.QueryContext(r.Context(), `SELECT
c.club_id, c.name, c.mode, c.robot_quota, c.seat_ratio, c.status,
(SELECT COUNT(*) FROM mgr_automation_room_snapshot r WHERE r.club_id = c.club_id),
(SELECT COALESCE(SUM(r.max_seats), 0) FROM mgr_automation_room_snapshot r WHERE r.club_id = c.club_id),
(SELECT COALESCE(SUM(r.seated), 0) FROM mgr_automation_room_snapshot r WHERE r.club_id = c.club_id),
(SELECT COUNT(*) FROM mgr_automation_robot t WHERE t.club_id = c.club_id),
(SELECT COUNT(*) FROM mgr_automation_robot t WHERE t.club_id = c.club_id AND t.status IN ('idle','entering','seated','playing','paused','draining')),
(SELECT COALESCE(SUM(g.target_seated), 0) FROM mgr_automation_group g WHERE g.club_id = c.club_id AND g.status = 'enabled')
FROM mgr_automation_club c
WHERE `+clubClause+`
ORDER BY c.club_id`, clubArgs...)
	if err != nil {
		s.logger.Error("automation overview clubs", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取俱乐部汇总失败")
		return
	}
	clubs := []automationClubCard{}
	for rows.Next() {
		var item automationClubCard
		if err := rows.Scan(&item.ClubID, &item.Name, &item.Mode, &item.RobotQuota, &item.SeatRatio, &item.Status,
			&item.RoomCount, &item.Capacity, &item.Seated, &item.RobotCount, &item.OnlineCount, &item.TargetSeated); err != nil {
			rows.Close()
			s.logger.Error("scan automation club card", "error", err)
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取俱乐部数据失败")
			return
		}
		clubs = append(clubs, item)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取俱乐部数据失败")
		return
	}

	alerts, err := s.queryAutomationAlerts(r.Context(), scope, "", "", 6, 0)
	if err != nil {
		s.logger.Error("automation overview alerts list", "error", err)
	}
	approvals, err := s.queryAutomationApprovals(r.Context(), "", 4, 0)
	if err != nil {
		s.logger.Error("automation overview approvals", "error", err)
	}
	workers, err := s.queryAutomationWorkers(r.Context())
	if err != nil {
		s.logger.Error("automation overview workers", "error", err)
		workers = []automationWorkerItem{}
	}

	writeData(w, http.StatusOK, map[string]any{
		"metrics":     metrics,
		"clubs":       clubs,
		"alerts":      alerts,
		"approvals":   approvals,
		"workers":     workers,
		"generatedAt": time.Now(),
		"demo":        true,
	})
}

func (s *Server) queryAutomationAlerts(ctx context.Context, scope automationScope, level, status string, limit, offset int) ([]automationAlertItem, error) {
	clause, args := alertScopeClause(scope)
	conditions := []string{clause}
	if level != "" {
		conditions = append(conditions, "level = ?")
		args = append(args, level)
	}
	if status != "" {
		conditions = append(conditions, "status = ?")
		args = append(args, status)
	}
	queryArgs := append(append([]any{}, args...), limit, offset)
	rows, err := s.db.QueryContext(ctx, `SELECT id, level, category, target_type, target_id, title, detail,
status, assignee, note, first_seen, last_seen, resolved_at
FROM mgr_automation_alert
WHERE `+strings.Join(conditions, " AND ")+`
ORDER BY FIELD(level, 'P0', 'P1', 'P2'), last_seen DESC
LIMIT ? OFFSET ?`, queryArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []automationAlertItem{}
	for rows.Next() {
		item, err := scanAutomationAlert(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func scanAutomationAlert(row rowScanner) (automationAlertItem, error) {
	var item automationAlertItem
	var resolved sql.NullTime
	if err := row.Scan(&item.ID, &item.Level, &item.Category, &item.TargetType, &item.TargetID, &item.Title, &item.Detail,
		&item.Status, &item.Assignee, &item.Note, &item.FirstSeen, &item.LastSeen, &resolved); err != nil {
		return automationAlertItem{}, err
	}
	if resolved.Valid {
		item.ResolvedAt = &resolved.Time
	}
	return item, nil
}

func (s *Server) queryAutomationApprovals(ctx context.Context, status string, limit, offset int) ([]automationApprovalItem, error) {
	condition := "1 = 1"
	args := []any{}
	if status != "" {
		condition = "status = ?"
		args = append(args, status)
	}
	queryArgs := append(append([]any{}, args...), limit, offset)
	rows, err := s.db.QueryContext(ctx, `SELECT id, action, target_type, target_id, COALESCE(params_json, '{}'),
reason, status, requester_name, approver_name, created_at, decided_at
FROM mgr_automation_approval
WHERE `+condition+`
ORDER BY FIELD(status, 'pending', 'approved', 'rejected'), id DESC
LIMIT ? OFFSET ?`, queryArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []automationApprovalItem{}
	for rows.Next() {
		var item automationApprovalItem
		var decided sql.NullTime
		if err := rows.Scan(&item.ID, &item.Action, &item.TargetType, &item.TargetID, &item.Params,
			&item.Reason, &item.Status, &item.RequesterName, &item.ApproverName, &item.CreatedAt, &decided); err != nil {
			return nil, err
		}
		if decided.Valid {
			item.DecidedAt = &decided.Time
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Server) handleAutomationAudit(w http.ResponseWriter, r *http.Request, p principal) {
	page, size := pageParams(r)
	keyword := strings.TrimSpace(r.URL.Query().Get("keyword"))
	like := "%" + keyword + "%"
	condition := `(audit_row.action LIKE 'automation.%' OR audit_row.target_type LIKE 'automation%')
AND (? = 1 OR ` + nonRootAuditVisibilitySQL + `)
AND (? = '' OR audit_row.operator_name LIKE ? OR audit_row.action LIKE ? OR audit_row.target_id LIKE ?)`
	var total int64
	if err := s.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM mgr_audit_log audit_row WHERE `+condition,
		canSeeProtectedRootFlag(p), keyword, like, like, like).Scan(&total); err != nil {
		s.logger.Error("count automation audit", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取自动化审计数量失败")
		return
	}
	rows, err := s.db.QueryContext(r.Context(), `SELECT audit_row.id, audit_row.operator_name, audit_row.action,
audit_row.target_type, audit_row.target_id, audit_row.result_code, audit_row.result_message,
audit_row.ip, audit_row.created_at
FROM mgr_audit_log audit_row
WHERE `+condition+`
ORDER BY audit_row.id DESC LIMIT ? OFFSET ?`,
		canSeeProtectedRootFlag(p), keyword, like, like, like, size, (page-1)*size)
	if err != nil {
		s.logger.Error("query automation audit", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取自动化审计失败")
		return
	}
	defer rows.Close()
	items := []auditItem{}
	for rows.Next() {
		var item auditItem
		if err := rows.Scan(&item.ID, &item.OperatorName, &item.Action, &item.TargetType, &item.TargetID,
			&item.ResultCode, &item.ResultMessage, &item.IP, &item.CreatedAt); err != nil {
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取自动化审计失败")
			return
		}
		items = append(items, item)
	}
	writeData(w, http.StatusOK, map[string]any{"items": items, "page": page, "pageSize": size, "total": total})
}

func marshalAutomationParams(value any) string {
	body, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(body)
}

func decodeAutomationIDs(raw string) ([]int64, error) {
	var ids []int64
	if err := json.Unmarshal([]byte(raw), &ids); err != nil {
		return nil, err
	}
	return ids, nil
}

func (s *Server) automationClubOrError(w http.ResponseWriter, r *http.Request, scope automationScope, clubID string) bool {
	if clubID == "" {
		return true
	}
	if !validClubID(clubID) {
		writeError(w, http.StatusBadRequest, "INVALID_CLUB_ID", "俱乐部 ID 必须是 6 位数字")
		return false
	}
	if !scope.Allows(clubID) {
		writeError(w, http.StatusForbidden, "CLUB_OUT_OF_SCOPE", "当前角色没有该俱乐部的数据范围")
		return false
	}
	return true
}

func (s *Server) loadAutomationRobot(ctx context.Context, id int64) (map[string]any, error) {
	var (
		terminalNo string
		account    string
		clubID     string
		status     string
		roomID     sql.NullInt64
		err        error
	)
	err = s.db.QueryRowContext(ctx, "SELECT terminal_no, account, club_id, status, room_id FROM mgr_automation_robot WHERE id = ?", id).
		Scan(&terminalNo, &account, &clubID, &status, &roomID)
	if err != nil {
		return nil, err
	}
	result := map[string]any{
		"id": id, "terminalNo": terminalNo, "account": account,
		"clubId": clubID, "status": status,
	}
	if roomID.Valid {
		result["roomId"] = roomID.Int64
	}
	return result, nil
}

func (s *Server) studioErr(format string, args ...any) error {
	return fmt.Errorf(format, args...)
}

var errAutomationNotFound = errors.New("automation object not found")
