package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"
)

// 节点日志里的「系统事件」——由后台自己产生，不依赖节点上报。
// 节点侧的终端事件（登录、进房、结算…）走 /agent/v1/events，两边共用一套命名。
//
// 事件类型长度受 mgr_automation_worker_event.event_type（VARCHAR(32)）限制。
const (
	workerEventOnline        = "WorkerOnline"  // 节点上线（注册成功）
	workerEventOffline       = "WorkerOffline" // 节点掉线（心跳超时被巡检判离线）
	workerEventRobotAssigned = "RobotAssigned" // 后台把一台机器人（账号）分配到这个节点
	workerEventRobotReleased = "RobotReleased" // 后台把账号从节点上收回
)

// recordWorkerEvent 写一条系统事件进节点日志。
// event_id 用 sys-<纳秒>-<robotId> 保证唯一（表上是 uk_worker_event(worker_id,event_id)），
// sequence 恒 0，前端据此显示「系统」而不是序号。
func recordWorkerEvent(ctx context.Context, db *sql.DB, workerID int64, eventType string, robotID int64, terminalNo string, payload map[string]any) {
	if workerID <= 0 {
		return
	}
	var raw any
	if len(payload) > 0 {
		if encoded, err := json.Marshal(payload); err == nil {
			raw = string(encoded)
		}
	}
	eventID := fmt.Sprintf("sys-%d-%d", time.Now().UnixNano(), robotID)
	if _, err := db.ExecContext(ctx, `INSERT IGNORE INTO mgr_automation_worker_event
(worker_id, event_id, robot_id, terminal_no, event_type, sequence, payload_json, occurred_at)
VALUES (?, ?, ?, ?, ?, 0, ?, NOW(3))`,
		workerID, eventID, nullableID(robotID), clipText(terminalNo, 32), eventType, raw); err != nil {
		return
	}
	_, _ = db.ExecContext(ctx, "UPDATE mgr_automation_worker SET last_event_at = NOW() WHERE id = ?", workerID)
}

// assignWaitingRobotsToWorker 把「已入会 + 已启用 + 还没挂节点」的机器人填给指定节点，
// 直到节点没空位或全局再没有等待中的机器人。返回本次分配台数。
//
// 只认 online 的节点：disabled / draining 不接新账号，offline 更不该接。
// 抢占用 `WHERE worker_id IS NULL` 兜住，多个节点同时上线也不会把同一台机器人分两次。
func assignWaitingRobotsToWorker(ctx context.Context, db *sql.DB, logger *slog.Logger, workerID int64) int {
	var status string
	var maxRobots, load int
	err := db.QueryRowContext(ctx, `SELECT w.status, w.max_robots,
(SELECT COUNT(*) FROM mgr_automation_robot r WHERE r.worker_id = w.id)
FROM mgr_automation_worker w WHERE w.id = ?`, workerID).Scan(&status, &maxRobots, &load)
	if err != nil {
		if logger != nil && err != sql.ErrNoRows {
			logger.Error("assign robots read worker", "error", err, "workerId", workerID)
		}
		return 0
	}
	if status != "online" {
		return 0
	}
	free := maxRobots - load
	if free <= 0 {
		return 0
	}

	type candidate struct {
		id         int64
		account    string
		terminalNo string
		clubID     string
		clubName   string
	}
	rows, err := db.QueryContext(ctx, `SELECT r.id, r.account, r.terminal_no, r.club_id, COALESCE(c.name, '')
FROM mgr_automation_robot r
LEFT JOIN mgr_automation_club c ON c.club_id = r.club_id
WHERE r.worker_id IS NULL AND r.enabled = 1 AND r.join_status = 'joined'
ORDER BY r.id LIMIT ?`, free)
	if err != nil {
		if logger != nil {
			logger.Error("assign robots query waiting", "error", err, "workerId", workerID)
		}
		return 0
	}
	list := []candidate{}
	for rows.Next() {
		var item candidate
		if err := rows.Scan(&item.id, &item.account, &item.terminalNo, &item.clubID, &item.clubName); err != nil {
			rows.Close()
			if logger != nil {
				logger.Error("assign robots scan waiting", "error", err, "workerId", workerID)
			}
			return 0
		}
		list = append(list, item)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		if logger != nil {
			logger.Error("assign robots iterate waiting", "error", err, "workerId", workerID)
		}
		return 0
	}

	assigned := 0
	for _, item := range list {
		result, err := db.ExecContext(ctx, `UPDATE mgr_automation_robot
SET worker_id = ?, status = 'idle', desired_status = 'running', last_error = '', last_heartbeat = NOW()
WHERE id = ? AND worker_id IS NULL`, workerID, item.id)
		if err != nil {
			if logger != nil {
				logger.Error("assign robot update", "error", err, "workerId", workerID, "robotId", item.id)
			}
			break
		}
		if affected, _ := result.RowsAffected(); affected == 0 {
			continue // 被别的节点先抢走了
		}
		assigned++
		recordWorkerEvent(ctx, db, workerID, workerEventRobotAssigned, item.id, item.terminalNo, map[string]any{
			"account":    item.account,
			"terminalNo": item.terminalNo,
			"clubId":     item.clubID,
			"clubName":   item.clubName,
			"message":    "分配账号 " + item.account,
		})
	}
	if assigned > 0 {
		refreshWorkerLoad(ctx, db)
		if logger != nil {
			logger.Info("assign robots to worker", "workerId", workerID, "assigned", assigned)
		}
	}
	return assigned
}

// assignWaitingRobots 全局兜底：按剩余容量从多到少，把所有在线节点喂一遍。
// 巡检每 5 秒跑一次，保证「后投放的机器人」和「刚空出来的容量」都能自动落位。
func assignWaitingRobots(ctx context.Context, db *sql.DB, logger *slog.Logger) int {
	rows, err := db.QueryContext(ctx, `SELECT w.id FROM mgr_automation_worker w
WHERE `+automationWorkerOnlineSQL+`
ORDER BY (w.max_robots - w.robot_count) DESC, w.id`)
	if err != nil {
		if logger != nil {
			logger.Error("assign robots list workers", "error", err)
		}
		return 0
	}
	ids := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0
		}
		ids = append(ids, id)
	}
	rows.Close()
	total := 0
	for _, id := range ids {
		if ctx.Err() != nil {
			return total
		}
		total += assignWaitingRobotsToWorker(ctx, db, logger, id)
	}
	return total
}

// countWaitingRobots 判断还有没有「等着上节点」的机器人，心跳里先用它挡一道，
// 免得每 10 秒都去扫一遍机器人表。
func countWaitingRobots(ctx context.Context, db *sql.DB) int {
	var count int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM mgr_automation_robot
WHERE worker_id IS NULL AND enabled = 1 AND join_status = 'joined'`).Scan(&count); err != nil {
		return 0
	}
	return count
}

// refreshWorkerLoad 用机器人表重算每个节点的 robot_count，避免加减法漂移。
func refreshWorkerLoad(ctx context.Context, db *sql.DB) {
	_, _ = db.ExecContext(ctx, `UPDATE mgr_automation_worker w
SET robot_count = (SELECT COUNT(*) FROM mgr_automation_robot r WHERE r.worker_id = w.id)`)
}
