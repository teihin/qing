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

// 通道业务内核（2026-11-25）
//
// HTTP 接口和 WebSocket 长连接共用这一份实现：HTTP 处理器只负责解码请求、
// 把错误翻译成状态码；WS 处理器只负责收发帧。业务口径只有一处，不会两套跑偏。
//
// 错误统一用 agentChannelError 描述，「HTTP 状态码 + 业务码」两边都能用：
// HTTP 直接写响应，WS 回一条 {type:"error", code, message} 并记日志。

type agentChannelError struct {
	Status  int
	Code    string
	Message string
}

func (e *agentChannelError) Error() string { return e.Code + ": " + e.Message }

func agentChannelFail(status int, code, message string) *agentChannelError {
	return &agentChannelError{Status: status, Code: code, Message: message}
}

// applyAgentHeartbeat 续租 + 补分配 + 返回权威指派清单。
// observedIP 是服务端看到的连接来源 IP（HTTP 取 RemoteAddr，WS 取连接对端）。
func (s *Server) applyAgentHeartbeat(ctx context.Context, agent agentIdentity, input agentHeartbeatRequest, observedIP string) (map[string]any, error) {
	setClauses := []string{
		"last_heartbeat = NOW()",
		"lease_expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND)",
		"status = IF(status = 'disabled', 'disabled', IF(status = 'draining', 'draining', 'online'))",
		"cpu_pct = ?",
		"mem_pct = ?",
	}
	args := []any{agentLeaseTTLSeconds, clampInt(input.CPUPct, 0, 100, 0), clampInt(input.MemPct, 0, 100, 0)}
	if input.Capacity > 0 {
		setClauses = append(setClauses, "max_robots = ?")
		args = append(args, clampInt(input.Capacity, 1, 200, agent.MaxRobots))
	}
	if version := clipText(strings.TrimSpace(input.Version), 32); version != "" {
		setClauses = append(setClauses, "version = ?")
		args = append(args, version)
	}
	if cidr := clipText(strings.TrimSpace(input.EgressCIDR), 64); cidr != "" {
		setClauses = append(setClauses, "egress_cidr = ?")
		args = append(args, cidr)
	}
	if input.LastEventSeq > 0 {
		setClauses = append(setClauses, "last_event_seq = GREATEST(last_event_seq, ?)")
		args = append(args, input.LastEventSeq)
	}
	args = append(args, agent.WorkerID)
	if _, err := s.db.ExecContext(ctx, "UPDATE mgr_automation_worker SET "+strings.Join(setClauses, ", ")+" WHERE id = ?", args...); err != nil {
		s.logger.Error("agent heartbeat", "error", err, "workerId", agent.WorkerID)
		return nil, err
	}
	// 节点从离线恢复：把它下面的终端从「离线」状态放回空闲，等待重新调度。
	if agent.Status == "offline" {
		if _, err := s.db.ExecContext(ctx, `UPDATE mgr_automation_robot
SET status = 'idle', last_error = '' WHERE worker_id = ? AND status = 'offline'`, agent.WorkerID); err != nil {
			s.logger.Error("agent heartbeat revive robots", "error", err, "workerId", agent.WorkerID)
		}
	}
	var status string
	var pending int
	_ = s.db.QueryRowContext(ctx, "SELECT status FROM mgr_automation_worker WHERE id = ?", agent.WorkerID).Scan(&status)
	_ = s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM mgr_automation_worker_command
WHERE worker_id = ? AND status = 'PENDING'`, agent.WorkerID).Scan(&pending)
	// 这个节点还有空位、全局又有等着上节点的账号，就顺手补分配一次。
	// 必须先分配再取指派清单，新分到的终端才会出现在本次回包里，节点当拍就能拉起来。
	if status == "online" {
		if countWaitingRobots(ctx, s.db) > 0 {
			if assigned := assignWaitingRobotsToWorker(ctx, s.db, s.logger, agent.WorkerID); assigned > 0 {
				s.logger.Info("worker auto assigned robots on heartbeat", "workerId", agent.WorkerID, "assigned", assigned)
			}
		}
		// 还有空位就补一次激活：新账号要在投放前完成首次登录。
		if assigned := assignActivationRobotsToWorker(ctx, s.db, s.logger, agent.WorkerID); assigned > 0 {
			s.logger.Info("worker auto assigned activation robots on heartbeat", "workerId", agent.WorkerID, "assigned", assigned)
		}
	}
	s.resetRobotNetPeriods(ctx)
	assignments, err := s.queryAgentAssignments(ctx, agent.WorkerID)
	if err != nil {
		s.logger.Error("agent heartbeat assignments", "error", err, "workerId", agent.WorkerID)
		assignments = []agentAssignment{}
	}
	// 游戏服看到的是连接来源 IP：这里把它记到机器人上，用来核对出口是否按预期。
	// 真机同样由服务端观察 IP，客户端本身无法伪造该字段。
	if ip := clipText(observedIP, 64); ip != "" {
		if _, err := s.db.ExecContext(ctx, `UPDATE mgr_automation_robot
SET public_ip = ?, ip_seen_at = NOW()
WHERE worker_id = ? AND (public_ip <> ? OR ip_seen_at IS NULL)`, ip, agent.WorkerID, ip); err != nil {
			s.logger.Error("agent heartbeat robot ip", "error", err, "workerId", agent.WorkerID)
		}
	}
	return map[string]any{
		"status":            status,
		"pendingCommands":   pending,
		"heartbeatInterval": agentHeartbeatSeconds,
		"leaseExpiresAt":    time.Now().Add(agentLeaseTTLSeconds * time.Second).UTC().Format(time.RFC3339),
		"serverTime":        time.Now().UTC().Format(time.RFC3339),
		"assignments":       assignments,
	}, nil
}

// claimAgentCommands 取走该节点的待执行命令并标记 DELIVERED（HTTP 拉取与 WS 推送共用）。
func (s *Server) claimAgentCommands(ctx context.Context, workerID, cursor int64, limit int) ([]agentCommandItem, int64, error) {
	// 过期未下发的直接作废，避免节点长时间离线后突然收到一堆旧命令。
	_, _ = s.db.ExecContext(ctx, `UPDATE mgr_automation_worker_command SET status = 'EXPIRED', finished_at = NOW()
WHERE worker_id = ? AND status = 'PENDING' AND expires_at IS NOT NULL AND expires_at < NOW()`, workerID)

	rows, err := s.db.QueryContext(ctx, `SELECT c.id, c.command_no, c.command_type, c.robot_id,
COALESCE(r.terminal_no, ''), c.params_json, c.expires_at, c.attempts
FROM mgr_automation_worker_command c
LEFT JOIN mgr_automation_robot r ON r.id = c.robot_id
WHERE c.worker_id = ? AND c.status = 'PENDING' AND c.id > ?
ORDER BY c.id LIMIT ?`, workerID, cursor, limit)
	if err != nil {
		s.logger.Error("agent pull commands", "error", err, "workerId", workerID)
		return nil, cursor, err
	}
	type pending struct {
		id   int64
		item agentCommandItem
	}
	list := []pending{}
	for rows.Next() {
		var row pending
		var robotID sql.NullInt64
		var params sql.NullString
		var expires sql.NullTime
		if err := rows.Scan(&row.id, &row.item.CommandNo, &row.item.Type, &robotID,
			&row.item.TerminalNo, &params, &expires, &row.item.Attempts); err != nil {
			rows.Close()
			s.logger.Error("agent pull commands scan", "error", err)
			return nil, cursor, err
		}
		if robotID.Valid {
			value := robotID.Int64
			row.item.RobotID = &value
		}
		if params.Valid && strings.TrimSpace(params.String) != "" {
			row.item.Params = json.RawMessage(params.String)
		} else {
			row.item.Params = json.RawMessage("{}")
		}
		if expires.Valid {
			value := expires.Time
			row.item.ExpiresAt = &value
		}
		row.item.Label = agentCommandTypes[row.item.Type]
		list = append(list, row)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, cursor, err
	}
	nextCursor := cursor
	items := make([]agentCommandItem, 0, len(list))
	for _, row := range list {
		items = append(items, row.item)
		nextCursor = row.id
	}
	if len(list) > 0 {
		ids := make([]any, 0, len(list))
		for _, row := range list {
			ids = append(ids, row.id)
		}
		if _, err := s.db.ExecContext(ctx, `UPDATE mgr_automation_worker_command
SET status = 'DELIVERED', delivered_at = NOW(), attempts = attempts + 1
WHERE id IN (`+placeholders(len(ids))+`) AND status = 'PENDING'`, ids...); err != nil {
			s.logger.Error("agent mark delivered", "error", err, "workerId", workerID)
		}
	}
	return items, nextCursor, nil
}

// applyAgentAck 处理三段回执；状态机非法跃迁返回 409。
func (s *Server) applyAgentAck(ctx context.Context, agent agentIdentity, commandNo string, input agentAckRequest) (map[string]any, *agentChannelError) {
	commandNo = strings.TrimSpace(commandNo)
	if commandNo == "" {
		return nil, agentChannelFail(http.StatusBadRequest, "INVALID_COMMAND", "命令编号不能为空")
	}
	nextStatus := strings.ToUpper(strings.TrimSpace(input.Status))
	if !agentAckStatuses[nextStatus] {
		return nil, agentChannelFail(http.StatusBadRequest, "INVALID_STATUS", "命令状态只能是 ACCEPTED/RUNNING/COMPLETED/REJECTED")
	}
	var commandID int64
	var current string
	var robotID sql.NullInt64
	err := s.db.QueryRowContext(ctx, `SELECT id, status, robot_id FROM mgr_automation_worker_command
WHERE worker_id = ? AND command_no = ?`, agent.WorkerID, commandNo).Scan(&commandID, &current, &robotID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, agentChannelFail(http.StatusNotFound, "COMMAND_NOT_FOUND", "没有找到这条命令")
	}
	if err != nil {
		s.logger.Error("agent ack lookup", "error", err)
		return nil, agentChannelFail(http.StatusInternalServerError, "QUERY_ERROR", "读取命令失败")
	}
	if current == nextStatus {
		return map[string]any{"commandNo": commandNo, "status": current, "message": "状态已同步"}, nil
	}
	allowed := false
	for _, candidate := range agentAckTransitions[current] {
		if candidate == nextStatus {
			allowed = true
			break
		}
	}
	if !allowed {
		return nil, agentChannelFail(http.StatusConflict, "INVALID_TRANSITION",
			fmt.Sprintf("命令当前状态 %s 不能变成 %s", current, nextStatus))
	}
	setClauses := []string{"status = ?", "ack_at = NOW()"}
	args := []any{nextStatus}
	if nextStatus == "COMPLETED" || nextStatus == "REJECTED" {
		setClauses = append(setClauses, "finished_at = NOW()")
	}
	if len(input.Result) > 0 && string(input.Result) != "null" {
		setClauses = append(setClauses, "result_json = ?")
		args = append(args, clipText(string(input.Result), 4000))
	}
	if code := clipText(strings.TrimSpace(input.ErrorCode), 64); code != "" {
		setClauses = append(setClauses, "error_code = ?")
		args = append(args, code)
	}
	if message := clipText(strings.TrimSpace(input.ErrorMessage), 255); message != "" {
		setClauses = append(setClauses, "error_message = ?")
		args = append(args, message)
	}
	args = append(args, commandID)
	if _, err := s.db.ExecContext(ctx, "UPDATE mgr_automation_worker_command SET "+strings.Join(setClauses, ", ")+" WHERE id = ?", args...); err != nil {
		s.logger.Error("agent ack update", "error", err, "commandNo", commandNo)
		return nil, agentChannelFail(http.StatusInternalServerError, "UPDATE_ERROR", "写入命令回执失败")
	}
	// 终端类命令失败时把原因写回机器人，界面上能直接看到卡在哪。
	if nextStatus == "REJECTED" && robotID.Valid {
		message := clipText(strings.TrimSpace(input.ErrorMessage), 255)
		if message == "" {
			message = "节点拒绝了命令"
		}
		_, _ = s.db.ExecContext(ctx, "UPDATE mgr_automation_robot SET last_error = ? WHERE id = ?", message, robotID.Int64)
	}
	agentStreams.notifyChange("workers", map[string]any{"workerId": agent.WorkerID})
	if robotID.Valid {
		agentStreams.notifyChange("robots", map[string]any{"robotId": robotID.Int64})
	}
	return map[string]any{"commandNo": commandNo, "status": nextStatus}, nil
}

// syncRobotFundAlert 余额不足时在告警中心开单；同一台机器人只保留一条未处理的，
// 重复上报只刷新时间与原因，避免刷屏。
func (s *Server) syncRobotFundAlert(ctx context.Context, robotID int64, detail string) {
	target := strconv.FormatInt(robotID, 10)
	var alertID int64
	err := s.db.QueryRowContext(ctx, `SELECT id FROM mgr_automation_alert
WHERE category = 'robot_fund' AND target_type = 'robot' AND target_id = ? AND status = 'open'
ORDER BY id DESC LIMIT 1`, target).Scan(&alertID)
	if err == nil {
		_, _ = s.db.ExecContext(ctx, `UPDATE mgr_automation_alert SET last_seen = NOW(), detail = ? WHERE id = ?`,
			clipText(detail, 512), alertID)
		return
	}
	if !errors.Is(err, sql.ErrNoRows) {
		s.logger.Error("read robot fund alert", "error", err, "robotId", robotID)
		return
	}
	title := "机器人余额不足"
	var account string
	if scanErr := s.db.QueryRowContext(ctx, "SELECT account FROM mgr_automation_robot WHERE id = ?", robotID).Scan(&account); scanErr == nil && strings.TrimSpace(account) != "" {
		title = account + " 余额不足"
	}
	if _, err := s.db.ExecContext(ctx, `INSERT INTO mgr_automation_alert
(level, category, target_type, target_id, title, detail, status, is_demo)
VALUES ('P2', 'robot_fund', 'robot', ?, ?, ?, 'open', 0)`,
		target, clipText(title, 128), clipText(detail, 512)); err != nil {
		s.logger.Error("create robot fund alert", "error", err, "robotId", robotID)
		return
	}
	agentStreams.notifyChange("alerts", map[string]any{"robotId": robotID})
}

// resolveRobotFundAlert 补分到位后关掉这台机器人的余额不足告警。
func (s *Server) resolveRobotFundAlert(ctx context.Context, robotID int64) {
	target := strconv.FormatInt(robotID, 10)
	result, err := s.db.ExecContext(ctx, `UPDATE mgr_automation_alert
SET status = 'resolved', resolved_at = NOW(), last_seen = NOW()
WHERE category = 'robot_fund' AND target_type = 'robot' AND target_id = ? AND status = 'open'`, target)
	if err != nil {
		s.logger.Error("resolve robot fund alert", "error", err, "robotId", robotID)
		return
	}
	if affected, _ := result.RowsAffected(); affected > 0 {
		agentStreams.notifyChange("alerts", map[string]any{"robotId": robotID})
	}
}

// applyAgentEvents 批量写入事件（事件 ID 幂等），并收敛机器人状态。
func (s *Server) applyAgentEvents(ctx context.Context, agent agentIdentity, events []agentEventItem) (map[string]any, *agentChannelError) {
	if len(events) == 0 {
		return map[string]any{"accepted": 0, "duplicated": 0, "skipped": 0}, nil
	}
	if len(events) > agentMaxBatchEvents {
		return nil, agentChannelFail(http.StatusBadRequest, "BATCH_TOO_LARGE", fmt.Sprintf("单批最多上报 %d 条事件", agentMaxBatchEvents))
	}
	accepted, duplicated, skipped := 0, 0, 0
	maxSeq := int64(0)
	for index, event := range events {
		eventID := clipText(strings.TrimSpace(event.EventID), 64)
		if eventID == "" {
			s.logger.Warn("agent event without id", "workerId", agent.WorkerID, "index", index+1)
			skipped++
			continue
		}
		eventType := strings.TrimSpace(event.Type)
		if !agentEventTypes[eventType] {
			// 单条类型不认就跳过，不连累同一批里的其它事件（新旧版本混跑时很常见）。
			s.logger.Warn("agent event unsupported type", "workerId", agent.WorkerID, "eventType", eventType)
			skipped++
			continue
		}
		robotID := s.resolveAgentRobotID(ctx, agent.WorkerID, event)
		var payload any
		if len(event.Payload) > 0 && string(event.Payload) != "null" {
			payload = clipText(string(event.Payload), 8000)
		}
		var occurred any
		if value := strings.TrimSpace(event.OccurredAt); value != "" {
			if parsed, err := time.Parse(time.RFC3339, value); err == nil {
				occurred = parsed
			} else if parsed, err := time.Parse("2006-01-02 15:04:05", value); err == nil {
				occurred = parsed
			}
		}
		result, err := s.db.ExecContext(ctx, `INSERT IGNORE INTO mgr_automation_worker_event
(worker_id, event_id, robot_id, terminal_no, event_type, sequence, room_id, round_id,
 strategy_version, command_no, payload_json, occurred_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			agent.WorkerID, eventID, nullableID(robotID), clipText(strings.TrimSpace(event.TerminalNo), 32),
			eventType, event.Sequence, nullableID(event.RoomID), clipText(strings.TrimSpace(event.RoundID), 64),
			event.StrategyVersion, clipText(strings.TrimSpace(event.CommandNo), 40), payload, occurred)
		if err != nil {
			s.logger.Error("agent event insert", "error", err, "workerId", agent.WorkerID, "eventId", eventID)
			return nil, agentChannelFail(http.StatusInternalServerError, "EVENT_ERROR", "写入事件失败")
		}
		affected, _ := result.RowsAffected()
		if affected == 0 {
			duplicated++
			continue
		}
		accepted++
		if event.Sequence > maxSeq {
			maxSeq = event.Sequence
		}
		if robotID > 0 {
			s.applyAgentEventToRobot(ctx, robotID, eventType, event.Payload)
		}
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE mgr_automation_worker
SET last_event_seq = GREATEST(last_event_seq, ?), last_event_at = NOW() WHERE id = ?`, maxSeq, agent.WorkerID); err != nil {
		s.logger.Error("agent event seq", "error", err, "workerId", agent.WorkerID)
	}
	// 一批事件只推一次通知（页面自己防抖重拉），避免逐条刷 SSE。
	if accepted > 0 {
		agentStreams.notifyChange("robots", map[string]any{"workerId": agent.WorkerID})
		agentStreams.notifyChange("events", map[string]any{"workerId": agent.WorkerID})
	}
	return map[string]any{"accepted": accepted, "duplicated": duplicated, "skipped": skipped}, nil
}
