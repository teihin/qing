package api

import (
	"context"
	"database/sql"
	"log/slog"
	"time"
)

const (
	// 激活失败后冷却这么久再排下一次，避免密码错之类的账号一直占节点。
	activationRetryInterval = 60 * time.Second
	// 自动重试上限：超过之后停在「未激活 · 需要人工处理」，可在机器人管理里手动重新排队。
	activationMaxAttempts = 10
	// 登录成功后回查游戏库的次数与间隔：实体落库可能比 LoginSucceeded 慢一拍。
	activationVerifyTries = 6
	activationVerifyGap   = 2 * time.Second
)

// markActivatedGameAccounts 把游戏库里已经有账号行的机器人直接标成已激活。
// 覆盖三种情况：人工用真客户端登录过、外部工具建过号、以及上次激活成功后没来得及写值。
func markActivatedGameAccounts(ctx context.Context, db *sql.DB, logger *slog.Logger) {
	if _, err := db.ExecContext(ctx, `UPDATE mgr_automation_robot r
SET r.activated_at = NOW(), r.activation_error = ''
WHERE r.activated_at IS NULL AND r.account <> ''
  AND EXISTS (SELECT 1 FROM kbedm.kbe_accountinfos k WHERE k.accountName = r.account)`); err != nil && logger != nil {
		logger.Error("mark activated robots", "error", err)
	}
}

// assignActivationRobots 全局兜底：按剩余容量给在线节点补「待激活」账号。
// 排在正常机器人分配之后：已经在跑的机器人优先拿容量，激活只是填空。
func assignActivationRobots(ctx context.Context, db *sql.DB, logger *slog.Logger) int {
	rows, err := db.QueryContext(ctx, `SELECT w.id FROM mgr_automation_worker w
WHERE `+automationWorkerOnlineSQL+`
ORDER BY (w.max_robots - w.robot_count) DESC, w.id`)
	if err != nil {
		if logger != nil {
			logger.Error("assign activation list workers", "error", err)
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
		total += assignActivationRobotsToWorker(ctx, db, logger, id)
	}
	return total
}

// assignActivationRobotsToWorker 把未激活的账号分给指定节点，只做「登录激活」。
// 节点侧靠指派里的 loginOnly 拉一个只登录的终端，客户端登录成功后自己退出。
func assignActivationRobotsToWorker(ctx context.Context, db *sql.DB, logger *slog.Logger, workerID int64) int {
	var status string
	var maxRobots, load int
	err := db.QueryRowContext(ctx, `SELECT w.status, w.max_robots,
(SELECT COUNT(*) FROM mgr_automation_robot r WHERE r.worker_id = w.id)
FROM mgr_automation_worker w WHERE w.id = ?`, workerID).Scan(&status, &maxRobots, &load)
	if err != nil {
		if logger != nil && err != sql.ErrNoRows {
			logger.Error("assign activation read worker", "error", err, "workerId", workerID)
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
	}
	rows, err := db.QueryContext(ctx, `SELECT r.id, r.account, r.terminal_no, r.club_id
FROM mgr_automation_robot r
WHERE r.worker_id IS NULL AND r.enabled = 1 AND r.activated_at IS NULL
  AND r.activation_attempts < ?
  AND (r.activation_attempted_at IS NULL OR r.activation_attempted_at < DATE_SUB(NOW(), INTERVAL ? SECOND))
ORDER BY r.id LIMIT ?`, activationMaxAttempts, int(activationRetryInterval.Seconds()), free)
	if err != nil {
		if logger != nil {
			logger.Error("assign activation query robots", "error", err, "workerId", workerID)
		}
		return 0
	}
	list := []candidate{}
	for rows.Next() {
		var item candidate
		if err := rows.Scan(&item.id, &item.account, &item.terminalNo, &item.clubID); err != nil {
			rows.Close()
			if logger != nil {
				logger.Error("assign activation scan robots", "error", err, "workerId", workerID)
			}
			return 0
		}
		list = append(list, item)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		if logger != nil {
			logger.Error("assign activation iterate robots", "error", err, "workerId", workerID)
		}
		return 0
	}

	assigned := 0
	for _, item := range list {
		result, err := db.ExecContext(ctx, `UPDATE mgr_automation_robot
SET worker_id = ?, status = 'idle', desired_status = 'running', last_error = '', last_heartbeat = NOW()
WHERE id = ? AND worker_id IS NULL AND activated_at IS NULL`, workerID, item.id)
		if err != nil {
			if logger != nil {
				logger.Error("assign activation robot", "error", err, "workerId", workerID, "robotId", item.id)
			}
			break
		}
		if affected, _ := result.RowsAffected(); affected == 0 {
			continue
		}
		assigned++
		recordWorkerEvent(ctx, db, workerID, workerEventRobotAssigned, item.id, item.terminalNo, map[string]any{
			"account":    item.account,
			"terminalNo": item.terminalNo,
			"clubId":     item.clubID,
			"purpose":    "activation",
			"message":    "分配账号 " + item.account + " 做首次登录激活",
		})
	}
	if assigned > 0 {
		refreshWorkerLoad(ctx, db)
		if logger != nil {
			logger.Info("assign activation robots to worker", "workerId", workerID, "assigned", assigned)
		}
	}
	return assigned
}

// releaseActivationWorker 把已经完成（或失败）的激活会话从节点上收回。
// 台下一次心跳拿不到这个终端，节点按 reconcile 把它停掉，不会重复登录。
func (s *Server) releaseActivationWorker(ctx context.Context, robotID int64) {
	var workerID int64
	var terminalNo, account string
	if err := s.db.QueryRowContext(ctx, `SELECT COALESCE(worker_id, 0), terminal_no, account
FROM mgr_automation_robot WHERE id = ?`, robotID).Scan(&workerID, &terminalNo, &account); err != nil {
		return
	}
	if workerID == 0 {
		return
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE mgr_automation_robot
SET worker_id = NULL, status = 'idle', desired_status = 'stopped', room_id = NULL, seat_no = 0, last_heartbeat = NOW()
WHERE id = ? AND worker_id = ?`, robotID, workerID); err != nil {
		s.logger.Error("release activation worker", "error", err, "robotId", robotID)
		return
	}
	recordWorkerEvent(ctx, s.db, workerID, workerEventRobotReleased, robotID, terminalNo, map[string]any{
		"account":    account,
		"terminalNo": terminalNo,
		"purpose":    "activation",
		"message":    "激活会话结束，收回账号 " + account,
	})
	refreshWorkerLoad(ctx, s.db)
}

// verifyAutomationActivation 在 LoginSucceeded 之后确认游戏服真的建出了账号行：
// 只认 kbedm.kbe_accountinfos 里查得到这一条，不凭事件本身下结论。
func (s *Server) verifyAutomationActivation(robotID int64) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	for attempt := 0; attempt < activationVerifyTries; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return
			case <-time.After(activationVerifyGap):
			}
		}
		var account, clubID, inviteCode, joinStatus string
		var activatedAt sql.NullTime
		err := s.db.QueryRowContext(ctx, `SELECT account, club_id, invite_code, join_status, activated_at
FROM mgr_automation_robot WHERE id = ?`, robotID).Scan(&account, &clubID, &inviteCode, &joinStatus, &activatedAt)
		if err != nil {
			return
		}
		if activatedAt.Valid {
			return
		}
		var exists bool
		if err := s.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM kbedm.kbe_accountinfos WHERE accountName = ?)`, account).Scan(&exists); err != nil {
			s.logger.Error("verify robot activation", "error", err, "robotId", robotID)
			return
		}
		if !exists {
			continue
		}
		if _, err := s.db.ExecContext(ctx, `UPDATE mgr_automation_robot
SET activated_at = NOW(), activation_error = '', activation_attempts = 0
WHERE id = ? AND activated_at IS NULL`, robotID); err != nil {
			s.logger.Error("mark robot activated", "error", err, "robotId", robotID)
			return
		}
		s.logger.Info("robot activated by first login", "robotId", robotID, "account", account)
		s.releaseActivationWorker(ctx, robotID)
		// 之前因为没账号导致入会失败的机器人：激活后立刻重试入会，省掉人工点「重试」。
		if clubID != "" && joinStatus != "joined" {
			go s.joinAutomationRobotToClub(context.Background(), robotID, clubID, inviteCode)
		}
		return
	}
	s.failAutomationActivation(ctx, robotID, "登录成功但游戏库里还没查到该账号，稍后自动重试")
}

// failAutomationActivation 记录一次激活失败并让出节点；attempts 用尽后停在这里等人工处理。
func (s *Server) failAutomationActivation(ctx context.Context, robotID int64, message string) {
	if _, err := s.db.ExecContext(ctx, `UPDATE mgr_automation_robot
SET activation_error = ?, activation_attempted_at = NOW(), activation_attempts = activation_attempts + 1
WHERE id = ? AND activated_at IS NULL`, clipText(message, 255), robotID); err != nil {
		s.logger.Error("fail robot activation", "error", err, "robotId", robotID)
		return
	}
	s.releaseActivationWorker(ctx, robotID)
}

// automationRobotNeedsActivation 判断这条事件是不是一次激活登录。
func (s *Server) automationRobotNeedsActivation(ctx context.Context, robotID int64) bool {
	var activatedAt sql.NullTime
	if err := s.db.QueryRowContext(ctx, "SELECT activated_at FROM mgr_automation_robot WHERE id = ?", robotID).Scan(&activatedAt); err != nil {
		return false
	}
	return !activatedAt.Valid
}

// sweepAutomationActivations 巡检里调用：先把手工登录过 / 已建号的补标，再给空闲节点排激活。
func sweepAutomationActivations(ctx context.Context, db *sql.DB, logger *slog.Logger) {
	markActivatedGameAccounts(ctx, db, logger)
	if assigned := assignActivationRobots(ctx, db, logger); assigned > 0 {
		logger.Info("worker janitor assigned activation robots", "assigned", assigned)
	}
}
