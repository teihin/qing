package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Worker 节点后台管理接口：列表 / 详情 / 启停排空 / 手动下发命令 / 接入令牌。

type automationWorkerCommandItem struct {
	ID           int64      `json:"id"`
	CommandNo    string     `json:"commandNo"`
	Type         string     `json:"type"`
	Label        string     `json:"label"`
	Status       string     `json:"status"`
	RobotID      *int64     `json:"robotId"`
	TerminalNo   string     `json:"terminalNo"`
	RobotName    string     `json:"robotName"`
	Params       string     `json:"params"`
	ErrorCode    string     `json:"errorCode"`
	ErrorMessage string     `json:"errorMessage"`
	Result       string     `json:"result"`
	Attempts     int        `json:"attempts"`
	CreatedBy    string     `json:"createdBy"`
	CreatedAt    time.Time  `json:"createdAt"`
	DeliveredAt  *time.Time `json:"deliveredAt"`
	FinishedAt   *time.Time `json:"finishedAt"`
	ExpiresAt    *time.Time `json:"expiresAt"`
}

type automationWorkerEventItem struct {
	ID         int64      `json:"id"`
	EventID    string     `json:"eventId"`
	EventType  string     `json:"eventType"`
	RobotID    *int64     `json:"robotId"`
	TerminalNo string     `json:"terminalNo"`
	Sequence   int64      `json:"sequence"`
	RoomID     *int64     `json:"roomId"`
	RoundID    string     `json:"roundId"`
	CommandNo  string     `json:"commandNo"`
	Payload    string     `json:"payload"`
	OccurredAt *time.Time `json:"occurredAt"`
	ReceivedAt time.Time  `json:"receivedAt"`
}

type automationWorkerDetailItem struct {
	Worker   automationWorkerListRow       `json:"worker"`
	Robots   []automationWorkerRobot       `json:"robots"`
	Commands []automationWorkerCommandItem `json:"commands"`
	Events   []automationWorkerEventItem   `json:"events"`
}

type automationWorkerListRow struct {
	ID              int64      `json:"id"`
	NodeCode        string     `json:"nodeCode"`
	Host            string     `json:"host"`
	OS              string     `json:"os"`
	Platform        string     `json:"platform"`
	Arch            string     `json:"arch"`
	Version         string     `json:"version"`
	Status          string     `json:"status"`
	RobotCount      int        `json:"robotCount"`
	MaxRobots       int        `json:"maxRobots"`
	CPUPct          int        `json:"cpuPct"`
	MemPct          int        `json:"memPct"`
	EgressCIDR      string     `json:"egressCidr"`
	Labels          string     `json:"labels"`
	LastHeartbeat   *time.Time `json:"lastHeartbeat"`
	EnrolledAt      *time.Time `json:"enrolledAt"`
	LastEventAt     *time.Time `json:"lastEventAt"`
	LastEventSeq    int64      `json:"lastEventSeq"`
	Notes           string     `json:"notes"`
	IsDemo          bool       `json:"isDemo"`
	Leased          bool       `json:"leased"`
	PendingCommands int        `json:"pendingCommands"`
	RunningCommands int        `json:"runningCommands"`
	FaultedRobots   int        `json:"faultedRobots"`
}

type automationWorkerRobot struct {
	ID         int64  `json:"id"`
	TerminalNo string `json:"terminalNo"`
	Account    string `json:"account"`
	Nickname   string `json:"nickname"`
	ClubID     string `json:"clubId"`
	ClubName   string `json:"clubName"`
	GroupName  string `json:"groupName"`
	Status     string `json:"status"`
	RoomID     *int64 `json:"roomId"`
	SeatNo     int    `json:"seatNo"`
	LastError  string `json:"lastError"`
}

// automationWorkerOnlineSQL 判断节点此刻是否在线：以租约为准（心跳每 5 秒续 20 秒），
// 巡检还没跑到时也不会把已经死掉的节点算作在线。用到时表别名必须是 w。
const automationWorkerOnlineSQL = `(w.status = 'online' AND w.lease_expires_at IS NOT NULL AND w.lease_expires_at > NOW())`

const automationWorkerListSelect = `SELECT w.id, w.node_code, w.host, w.os, w.platform, w.arch, w.version,
CASE WHEN w.status = 'online' AND (w.lease_expires_at IS NULL OR w.lease_expires_at <= NOW()) THEN 'offline' ELSE w.status END,
(SELECT COUNT(*) FROM mgr_automation_robot r WHERE r.worker_id = w.id), w.max_robots, w.cpu_pct, w.mem_pct,
w.egress_cidr, w.labels,
w.last_heartbeat, w.enrolled_at, w.last_event_at, w.last_event_seq, w.notes, w.is_demo,
(w.lease_expires_at IS NOT NULL AND w.lease_expires_at > NOW()),
(SELECT COUNT(*) FROM mgr_automation_worker_command c WHERE c.worker_id = w.id AND c.status IN ('PENDING', 'DELIVERED')),
(SELECT COUNT(*) FROM mgr_automation_worker_command c WHERE c.worker_id = w.id AND c.status IN ('ACCEPTED', 'RUNNING')),
(SELECT COUNT(*) FROM mgr_automation_robot r WHERE r.worker_id = w.id AND r.status IN ('faulted', 'offline'))
FROM mgr_automation_worker w`

func scanAutomationWorkerRow(rows interface{ Scan(...any) error }) (automationWorkerListRow, error) {
	var item automationWorkerListRow
	var heartbeat, enrolled, lastEvent sql.NullTime
	var isDemo, leased int
	err := rows.Scan(&item.ID, &item.NodeCode, &item.Host, &item.OS, &item.Platform, &item.Arch, &item.Version,
		&item.Status, &item.RobotCount, &item.MaxRobots, &item.CPUPct, &item.MemPct, &item.EgressCIDR, &item.Labels,
		&heartbeat, &enrolled, &lastEvent, &item.LastEventSeq, &item.Notes, &isDemo,
		&leased, &item.PendingCommands, &item.RunningCommands, &item.FaultedRobots)
	if err != nil {
		return automationWorkerListRow{}, err
	}
	if heartbeat.Valid {
		value := heartbeat.Time
		item.LastHeartbeat = &value
	}
	if enrolled.Valid {
		value := enrolled.Time
		item.EnrolledAt = &value
	}
	if lastEvent.Valid {
		value := lastEvent.Time
		item.LastEventAt = &value
	}
	item.IsDemo = isDemo == 1
	item.Leased = leased == 1
	return item, nil
}

func (s *Server) handleListAutomationWorkers(w http.ResponseWriter, r *http.Request, p principal) {
	keyword := strings.TrimSpace(r.URL.Query().Get("keyword"))
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	conditions := []string{"1 = 1"}
	args := []any{}
	if keyword != "" {
		conditions = append(conditions, "(w.node_code LIKE ? OR w.host LIKE ? OR w.labels LIKE ?)")
		like := "%" + keyword + "%"
		args = append(args, like, like, like)
	}
	if status != "" {
		// 用租约是否过期判定实时状态，租约超时但巡检还没跑到的节点也按离线筛选。
		conditions = append(conditions, "CASE WHEN w.status = 'online' AND (w.lease_expires_at IS NULL OR w.lease_expires_at <= NOW()) THEN 'offline' ELSE w.status END = ?")
		args = append(args, status)
	}
	query := automationWorkerListSelect + " WHERE " + strings.Join(conditions, " AND ") + " ORDER BY w.id"
	rows, err := s.db.QueryContext(r.Context(), query, args...)
	if err != nil {
		s.logger.Error("list automation workers", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取 Worker 节点失败")
		return
	}
	defer rows.Close()
	items := []automationWorkerListRow{}
	for rows.Next() {
		item, err := scanAutomationWorkerRow(rows)
		if err != nil {
			s.logger.Error("scan automation worker", "error", err)
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取 Worker 节点失败")
			return
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取 Worker 节点失败")
		return
	}
	writeData(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleGetAutomationWorker(w http.ResponseWriter, r *http.Request, p principal) {
	id, ok := parsePositivePathID(w, r, "id", "节点 ID 不正确")
	if !ok {
		return
	}
	var detail automationWorkerDetailItem
	var err error
	detail.Worker, err = scanAutomationWorkerRow(s.db.QueryRowContext(r.Context(), automationWorkerListSelect+" WHERE w.id = ?", id))
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "WORKER_NOT_FOUND", "没有找到这个 Worker 节点")
		return
	}
	if err != nil {
		s.logger.Error("get automation worker", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取 Worker 节点失败")
		return
	}
	detail.Robots = []automationWorkerRobot{}
	robotRows, err := s.db.QueryContext(r.Context(), `SELECT r.id, r.terminal_no, r.account, r.nickname,
r.club_id, COALESCE(c.name, ''), COALESCE(g.name, ''), r.status, r.room_id, r.seat_no, r.last_error
FROM mgr_automation_robot r
LEFT JOIN mgr_automation_club c ON c.club_id = r.club_id
LEFT JOIN mgr_automation_group g ON g.id = r.group_id
WHERE r.worker_id = ? ORDER BY r.id`, id)
	if err != nil {
		s.logger.Error("get automation worker robots", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取节点上的机器人失败")
		return
	}
	for robotRows.Next() {
		var item automationWorkerRobot
		var roomID sql.NullInt64
		if err := robotRows.Scan(&item.ID, &item.TerminalNo, &item.Account, &item.Nickname,
			&item.ClubID, &item.ClubName, &item.GroupName, &item.Status, &roomID, &item.SeatNo, &item.LastError); err != nil {
			robotRows.Close()
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取节点上的机器人失败")
			return
		}
		if roomID.Valid {
			value := roomID.Int64
			item.RoomID = &value
		}
		detail.Robots = append(detail.Robots, item)
	}
	robotRows.Close()

	detail.Commands, err = s.queryWorkerCommands(r.Context(), id, 50)
	if err != nil {
		s.logger.Error("get automation worker commands", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取节点命令失败")
		return
	}
	detail.Events, err = s.queryWorkerEvents(r.Context(), id, 200)
	if err != nil {
		s.logger.Error("get automation worker events", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取节点事件失败")
		return
	}
	writeData(w, http.StatusOK, detail)
}

func (s *Server) queryWorkerCommands(ctx context.Context, workerID int64, limit int) ([]automationWorkerCommandItem, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT c.id, c.command_no, c.command_type, c.status, c.robot_id,
COALESCE(r.terminal_no, ''), COALESCE(r.nickname, r.account, ''), COALESCE(c.params_json, ''),
c.error_code, c.error_message, COALESCE(c.result_json, ''), c.attempts, c.created_by,
c.created_at, c.delivered_at, c.finished_at, c.expires_at
FROM mgr_automation_worker_command c
LEFT JOIN mgr_automation_robot r ON r.id = c.robot_id
WHERE c.worker_id = ? ORDER BY c.id DESC LIMIT ?`, workerID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []automationWorkerCommandItem{}
	for rows.Next() {
		var item automationWorkerCommandItem
		var robotID sql.NullInt64
		var delivered, finished, expires sql.NullTime
		if err := rows.Scan(&item.ID, &item.CommandNo, &item.Type, &item.Status, &robotID, &item.TerminalNo,
			&item.RobotName, &item.Params, &item.ErrorCode, &item.ErrorMessage, &item.Result, &item.Attempts,
			&item.CreatedBy, &item.CreatedAt, &delivered, &finished, &expires); err != nil {
			return nil, err
		}
		if robotID.Valid {
			value := robotID.Int64
			item.RobotID = &value
		}
		if delivered.Valid {
			value := delivered.Time
			item.DeliveredAt = &value
		}
		if finished.Valid {
			value := finished.Time
			item.FinishedAt = &value
		}
		if expires.Valid {
			value := expires.Time
			item.ExpiresAt = &value
		}
		item.Label = agentCommandTypes[item.Type]
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Server) queryWorkerEvents(ctx context.Context, workerID int64, limit int) ([]automationWorkerEventItem, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT e.id, e.event_id, e.event_type, e.robot_id, e.terminal_no,
e.sequence, e.room_id, e.round_id, e.command_no, COALESCE(e.payload_json, ''), e.occurred_at, e.received_at
FROM mgr_automation_worker_event e WHERE e.worker_id = ? ORDER BY e.id DESC LIMIT ?`, workerID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []automationWorkerEventItem{}
	for rows.Next() {
		var item automationWorkerEventItem
		var robotID, roomID sql.NullInt64
		var occurred sql.NullTime
		if err := rows.Scan(&item.ID, &item.EventID, &item.EventType, &robotID, &item.TerminalNo,
			&item.Sequence, &roomID, &item.RoundID, &item.CommandNo, &item.Payload, &occurred, &item.ReceivedAt); err != nil {
			return nil, err
		}
		if robotID.Valid {
			value := robotID.Int64
			item.RobotID = &value
		}
		if roomID.Valid {
			value := roomID.Int64
			item.RoomID = &value
		}
		if occurred.Valid {
			value := occurred.Time
			item.OccurredAt = &value
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// handleListAutomationRobotEvents 给单台机器人看运行日志：
// 投放详情、机器人详情、节点详情三处都走这一条，数据来自 worker 事件流按 robot_id 过滤。
func (s *Server) handleListAutomationRobotEvents(w http.ResponseWriter, r *http.Request, p principal) {
	id, ok := parsePositivePathID(w, r, "id", "机器人 ID 不正确")
	if !ok {
		return
	}
	var clubID string
	if err := s.db.QueryRowContext(r.Context(), "SELECT club_id FROM mgr_automation_robot WHERE id = ?", id).Scan(&clubID); errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "ROBOT_NOT_FOUND", "没有找到这个机器人")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取机器人失败")
		return
	}
	scope, err := s.automationScope(r.Context(), p)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取数据范围失败")
		return
	}
	if !s.automationClubOrError(w, r, scope, clubID) {
		return
	}
	limit := 200
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if value, err := strconv.Atoi(raw); err == nil && value > 0 {
			limit = min(value, 500)
		}
	}
	items, err := s.queryRobotEvents(r.Context(), id, limit)
	if err != nil {
		s.logger.Error("list robot events", "error", err, "robotId", id)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取机器人日志失败")
		return
	}
	writeData(w, http.StatusOK, map[string]any{"items": items})
}

// handleGetAutomationRobotTable 给机器人详情返回最新牌桌快照（客户端上报的 TableState）。
func (s *Server) handleGetAutomationRobotTable(w http.ResponseWriter, r *http.Request, p principal) {
	id, ok := parsePositivePathID(w, r, "id", "机器人 ID 不正确")
	if !ok {
		return
	}
	var clubID string
	if err := s.db.QueryRowContext(r.Context(), "SELECT club_id FROM mgr_automation_robot WHERE id = ?", id).Scan(&clubID); errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "ROBOT_NOT_FOUND", "没有找到这个机器人")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取机器人失败")
		return
	}
	scope, err := s.automationScope(r.Context(), p)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取数据范围失败")
		return
	}
	if !s.automationClubOrError(w, r, scope, clubID) {
		return
	}
	var raw string
	var receivedAt time.Time
	err = s.db.QueryRowContext(r.Context(), `SELECT COALESCE(payload_json, ''), received_at
FROM mgr_automation_worker_event WHERE robot_id = ? AND event_type = 'TableState'
ORDER BY id DESC LIMIT 1`, id).Scan(&raw, &receivedAt)
	if errors.Is(err, sql.ErrNoRows) {
		writeData(w, http.StatusOK, map[string]any{"table": nil, "receivedAt": nil})
		return
	}
	if err != nil {
		s.logger.Error("get robot table", "error", err, "robotId", id)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取牌桌快照失败")
		return
	}
	var table any
	if strings.TrimSpace(raw) != "" && json.Unmarshal([]byte(raw), &table) != nil {
		table = nil
	}
	writeData(w, http.StatusOK, map[string]any{"table": table, "receivedAt": receivedAt})
}

func (s *Server) queryRobotEvents(ctx context.Context, robotID int64, limit int) ([]automationWorkerEventItem, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT e.id, e.event_id, e.event_type, e.robot_id, e.terminal_no,
e.sequence, e.room_id, e.round_id, e.command_no, COALESCE(e.payload_json, ''), e.occurred_at, e.received_at
FROM mgr_automation_worker_event e WHERE e.robot_id = ? ORDER BY e.id DESC LIMIT ?`, robotID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []automationWorkerEventItem{}
	for rows.Next() {
		var item automationWorkerEventItem
		var workerRobotID, roomID sql.NullInt64
		var occurred sql.NullTime
		if err := rows.Scan(&item.ID, &item.EventID, &item.EventType, &workerRobotID, &item.TerminalNo,
			&item.Sequence, &roomID, &item.RoundID, &item.CommandNo, &item.Payload, &occurred, &item.ReceivedAt); err != nil {
			return nil, err
		}
		if workerRobotID.Valid {
			value := workerRobotID.Int64
			item.RobotID = &value
		}
		if roomID.Valid {
			value := roomID.Int64
			item.RoomID = &value
		}
		if occurred.Valid {
			value := occurred.Time
			item.OccurredAt = &value
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Server) handleAutomationWorkerAction(w http.ResponseWriter, r *http.Request, p principal) {
	id, ok := parsePositivePathID(w, r, "id", "节点 ID 不正确")
	if !ok {
		return
	}
	var input struct {
		Action string `json:"action"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	var nodeCode, status string
	if err := s.db.QueryRowContext(r.Context(), "SELECT node_code, status FROM mgr_automation_worker WHERE id = ?", id).
		Scan(&nodeCode, &status); errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "WORKER_NOT_FOUND", "没有找到这个 Worker 节点")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取节点失败")
		return
	}
	action := strings.ToLower(strings.TrimSpace(input.Action))
	message := ""
	switch action {
	case "enable":
		if _, err := s.db.ExecContext(r.Context(), `UPDATE mgr_automation_worker
SET status = IF(lease_expires_at IS NOT NULL AND lease_expires_at > NOW(), 'online', 'offline') WHERE id = ?`, id); err != nil {
			writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "恢复节点调度失败")
			return
		}
		message = "节点已恢复调度"
	case "drain":
		if _, err := s.db.ExecContext(r.Context(), "UPDATE mgr_automation_worker SET status = 'draining' WHERE id = ?", id); err != nil {
			writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "排空节点失败")
			return
		}
		message = "节点已进入排空状态，不再接收新终端"
	case "disable":
		if _, err := s.db.ExecContext(r.Context(), `UPDATE mgr_automation_worker
SET status = 'disabled', lease_token_hash = '', lease_expires_at = NULL WHERE id = ?`, id); err != nil {
			writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "停用节点失败")
			return
		}
		message = "节点已停用并踢下线，需要重新注册才能接入"
	case "restart":
		if status == "disabled" {
			writeError(w, http.StatusConflict, "WORKER_DISABLED", "节点已停用，请先恢复调度")
			return
		}
		message = "已下发对账命令，节点会重新拉起终端"
	case "delete":
		// 先把名下的账号记下来，日志里要写清楚「谁被收回了」。
		type boundRobot struct {
			id         int64
			account    string
			terminalNo string
		}
		bound := []boundRobot{}
		if rows, err := s.db.QueryContext(r.Context(), "SELECT id, account, terminal_no FROM mgr_automation_robot WHERE worker_id = ?", id); err == nil {
			for rows.Next() {
				var item boundRobot
				if err := rows.Scan(&item.id, &item.account, &item.terminalNo); err == nil {
					bound = append(bound, item)
				}
			}
			rows.Close()
		}
		if _, err := s.db.ExecContext(r.Context(), `UPDATE mgr_automation_robot
SET worker_id = NULL, status = IF(status = 'offline', 'idle', status) WHERE worker_id = ?`, id); err != nil {
			writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "解绑节点上的机器人失败")
			return
		}
		for _, item := range bound {
			recordWorkerEvent(r.Context(), s.db, id, workerEventRobotReleased, item.id, item.terminalNo, map[string]any{
				"account":    item.account,
				"terminalNo": item.terminalNo,
				"message":    "节点删除，收回账号 " + item.account,
			})
		}
		if _, err := s.db.ExecContext(r.Context(), "DELETE FROM mgr_automation_worker WHERE id = ?", id); err != nil {
			writeError(w, http.StatusInternalServerError, "DELETE_ERROR", "删除节点失败")
			return
		}
		s.audit(r.Context(), &p, "automation.worker.delete", "automation_worker", strconv.FormatInt(id, 10), input, nil,
			map[string]any{"nodeCode": nodeCode}, 0, "已删除节点 "+nodeCode, clientIP(r))
		writeData(w, http.StatusOK, map[string]any{"message": "节点已删除，机器人已回到等待分配"})
		return
	default:
		writeError(w, http.StatusBadRequest, "INVALID_ACTION", "不支持的节点操作")
		return
	}
	if action == "restart" || action == "drain" || action == "enable" {
		if _, err := s.enqueueWorkerCommand(r.Context(), id, nil, "RECONCILE_STATE",
			map[string]any{"reason": action}, "", 5*time.Minute, automationOperator(p)); err != nil {
			s.logger.Error("enqueue reconcile command", "error", err, "workerId", id)
		}
	}
	s.audit(r.Context(), &p, "automation.worker."+action, "automation_worker", strconv.FormatInt(id, 10), input, nil,
		map[string]any{"nodeCode": nodeCode}, 0, message, clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"message": message})
}

func (s *Server) handleCreateAutomationWorkerCommand(w http.ResponseWriter, r *http.Request, p principal) {
	id, ok := parsePositivePathID(w, r, "id", "节点 ID 不正确")
	if !ok {
		return
	}
	var input struct {
		CommandType string         `json:"commandType"`
		RobotID     int64          `json:"robotId"`
		Params      map[string]any `json:"params"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	commandType := strings.ToUpper(strings.TrimSpace(input.CommandType))
	label, known := agentCommandTypes[commandType]
	if !known {
		writeError(w, http.StatusBadRequest, "INVALID_COMMAND", "不支持的命令类型")
		return
	}
	var status string
	if err := s.db.QueryRowContext(r.Context(), "SELECT status FROM mgr_automation_worker WHERE id = ?", id).
		Scan(&status); errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "WORKER_NOT_FOUND", "没有找到这个 Worker 节点")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取节点失败")
		return
	}
	if status == "disabled" {
		writeError(w, http.StatusConflict, "WORKER_DISABLED", "节点已停用，不能下发命令")
		return
	}
	var robotID *int64
	if input.RobotID > 0 {
		var exists int
		if err := s.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM mgr_automation_robot WHERE id = ? AND worker_id = ?", input.RobotID, id).
			Scan(&exists); err != nil || exists == 0 {
			writeError(w, http.StatusBadRequest, "ROBOT_NOT_ON_WORKER", "这台机器人不在该节点上")
			return
		}
		value := input.RobotID
		robotID = &value
	}
	commandNo, err := s.enqueueWorkerCommand(r.Context(), id, robotID, commandType, input.Params, "", 10*time.Minute, automationOperator(p))
	if err != nil {
		s.logger.Error("enqueue worker command", "error", err, "workerId", id)
		writeError(w, http.StatusInternalServerError, "COMMAND_ERROR", "下发命令失败")
		return
	}
	message := "已下发" + label
	s.audit(r.Context(), &p, "automation.worker.command", "automation_worker", strconv.FormatInt(id, 10), input, nil,
		map[string]any{"commandNo": commandNo, "commandType": commandType}, 0, message, clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"message": message, "commandNo": commandNo})
}

func (s *Server) handleGetAutomationAgentToken(w http.ResponseWriter, r *http.Request, p principal) {
	hash, err := s.agentEnrollTokenHash(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取接入令牌失败")
		return
	}
	var updatedBy string
	var updatedAt *time.Time
	_ = s.db.QueryRowContext(r.Context(), `SELECT updated_by, updated_at FROM mgr_automation_setting WHERE setting_key = ?`, agentEnrollTokenKey).
		Scan(&updatedBy, &updatedAt)
	writeData(w, http.StatusOK, map[string]any{
		"configured": hash != "",
		"updatedBy":  updatedBy,
		"updatedAt":  updatedAt,
	})
}

func (s *Server) handleRotateAutomationAgentToken(w http.ResponseWriter, r *http.Request, p principal) {
	token, err := s.rotateAgentEnrollToken(r.Context(), automationOperator(p))
	if err != nil {
		s.logger.Error("rotate agent enroll token", "error", err)
		writeError(w, http.StatusInternalServerError, "TOKEN_ERROR", "生成接入令牌失败")
		return
	}
	s.audit(r.Context(), &p, "automation.agent.token.rotate", "automation_setting", agentEnrollTokenKey, nil, nil,
		map[string]any{"rotated": true}, 0, "已轮换 Worker 接入令牌", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{
		"token":   token,
		"message": "接入令牌已生成，只显示这一次，请立刻复制保存",
	})
}

// handleClearAutomationAgentToken 关掉令牌校验，回到「任何节点都能注册」的开放模式。
func (s *Server) handleClearAutomationAgentToken(w http.ResponseWriter, r *http.Request, p principal) {
	if _, err := s.db.ExecContext(r.Context(), "DELETE FROM mgr_automation_setting WHERE setting_key = ?", agentEnrollTokenKey); err != nil {
		s.logger.Error("clear agent enroll token", "error", err)
		writeError(w, http.StatusInternalServerError, "TOKEN_ERROR", "关闭令牌校验失败")
		return
	}
	s.audit(r.Context(), &p, "automation.agent.token.clear", "automation_setting", agentEnrollTokenKey, nil, nil,
		map[string]any{"cleared": true}, 0, "已关闭 Worker 接入令牌校验（开放注册）", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"message": "已关闭令牌校验，节点不带令牌也能注册"})
}
