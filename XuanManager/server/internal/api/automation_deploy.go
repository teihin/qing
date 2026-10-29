package api

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

// 投放管理以俱乐部为单位：先列出已经投放了机器人的俱乐部，再进详情看组、策略、房间、状态和输赢。
// 投放时用邀请码定位俱乐部，并把账号加入该俱乐部。

type deployClubItem struct {
	ClubID       string     `json:"clubId"`
	Name         string     `json:"name"`
	InviteCode   string     `json:"inviteCode"`
	Status       string     `json:"status"`
	RobotQuota   int        `json:"robotQuota"`
	MaxPerRoom   int        `json:"maxPerRoom"`
	RobotCount   int        `json:"robotCount"`
	EnabledCount int        `json:"enabledCount"`
	SeatedCount  int        `json:"seatedCount"`
	GroupCount   int        `json:"groupCount"`
	JoinedCount  int        `json:"joinedCount"`
	PendingCount int        `json:"pendingCount"`
	FailedCount  int        `json:"failedCount"`
	TodayRounds  int        `json:"todayRounds"`
	TodayNet     int64      `json:"todayNet"`
	Since        *time.Time `json:"since"`
	// 投放只是把账号放进俱乐部；真正跑起来还要挂到某个 Worker 节点上执行。
	// 这三个字段用来在界面上讲清楚"当前卡在哪一步"。
	WorkerAssigned int `json:"workerAssigned"`
	WorkerWaiting  int `json:"workerWaiting"`
	WorkersOnline  int `json:"workersOnline"`
}

type deployGroupItem struct {
	ID               int64  `json:"id"`
	Name             string `json:"name"`
	StrategyName     string `json:"strategyName"`
	DefaultIntensity int    `json:"defaultIntelligence"`
	ProfitMode       string `json:"profitMode"`
	ProfitTarget     int64  `json:"profitTarget"`
	RobotCount       int    `json:"robotCount"`
	SeatedCount      int    `json:"seatedCount"`
	TodayRounds      int    `json:"todayRounds"`
	TodayNet         int64  `json:"todayNet"`
}

type deployRobotItem struct {
	ID           int64      `json:"id"`
	TerminalNo   string     `json:"terminalNo"`
	Account      string     `json:"account"`
	Nickname     string     `json:"nickname"`
	Avatar       int        `json:"avatar"`
	GroupName    string     `json:"groupName"`
	StrategyName string     `json:"strategyName"`
	Intelligence int        `json:"intelligence"`
	RoomID       *int64     `json:"roomId"`
	SeatNo       int        `json:"seatNo"`
	Status       string     `json:"status"`
	Enabled      bool       `json:"enabled"`
	JoinStatus   string     `json:"joinStatus"`
	InviteCode   string     `json:"inviteCode"`
	JoinedAt     *time.Time `json:"joinedAt"`
	LastError    string     `json:"lastError"`
	TodayRounds  int        `json:"todayRounds"`
	TodayNet     int64      `json:"todayNet"`
	PeriodNet    int64      `json:"periodNet"`
	Buyin        int        `json:"buyin"`
	RoomPi       string     `json:"roomPi"`
	// 周计划：非空表示这台机器人按周时段跑，界面上直接展示人话。
	ProfitSchedule string `json:"profitSchedule"`
	ScheduleState  string `json:"scheduleState"`
	WorkerID     *int64     `json:"workerId"`
	WorkerName   string     `json:"workerName"`
	DispatchNote string     `json:"dispatchNote"` // 当前卡在哪个环节，直接给界面显示
}

type deployHistory struct {
	Sessions     int        `json:"sessions"`
	Rounds       int        `json:"rounds"`
	Net          int64      `json:"net"`
	Since        *time.Time `json:"since"`
	LastActiveAt *time.Time `json:"lastActiveAt"`
}

type deployClubDetail struct {
	Club       deployClubItem    `json:"club"`
	Groups     []deployGroupItem `json:"groups"`
	Robots     []deployRobotItem `json:"robots"`
	Strategies []deployStrategy  `json:"strategies"`
	History    deployHistory     `json:"history"`
}

type deployStrategy struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	RobotCount int    `json:"robotCount"`
}

type deployLookup struct {
	ClubID     string `json:"clubId"`
	Name       string `json:"name"`
	InviteCode string `json:"inviteCode"`
	Status     string `json:"status"`
	RobotQuota int    `json:"robotQuota"`
	RobotCount int    `json:"robotCount"`
	MaxPerRoom int    `json:"maxPerRoom"`
	Remaining  int    `json:"remaining"`
}

type deployRequest struct {
	InviteCode     string               `json:"inviteCode"`
	RobotIDs       []int64              `json:"robotIds"`
	GroupIDs       []int64              `json:"groupIds"`
	StrategyID     int64                `json:"strategyId"`
	ProfitMode     string               `json:"profitMode"`
	ProfitTarget   int64                `json:"profitTarget"`
	PeriodStart    string               `json:"periodStart"`
	PeriodEnd      string               `json:"periodEnd"`
	ProfitSchedule []profitScheduleItem `json:"profitSchedule"`
	// RoomPi 是这批机器人只进的底皮档位（逗号分隔），空串表示不限。
	RoomPi string `json:"roomPi"`
}

func (s *Server) registerAutomationDeployRoutes() {
	s.mux.Handle("GET /api/automation/deploy/clubs", s.authorized("automation.deploy.view", false, s.handleListDeployClubs))
	s.mux.Handle("GET /api/automation/deploy/clubs/{clubId}", s.authorized("automation.deploy.view", false, s.handleGetDeployClub))
	s.mux.Handle("GET /api/automation/deploy/lookup", s.authorized("automation.deploy.manage", false, s.handleLookupDeployClub))
	s.mux.Handle("POST /api/automation/deploy", s.authorized("automation.deploy.manage", true, s.handleDeployByInvite))
	s.mux.Handle("POST /api/automation/robots/{id}/join", s.authorized("automation.deploy.manage", true, s.handleJoinAutomationRobot))
	s.mux.Handle("POST /api/automation/deploy/clubs/{clubId}/dispatch", s.authorized("automation.deploy.manage", true, s.handleDispatchAutomationClub))
}

// deployDispatchNote 把「投放之后还差哪一步」翻成一句话，直接给界面显示。
func deployDispatchNote(item deployRobotItem) string {
	switch {
	case item.JoinStatus == "pending":
		return "等待加入俱乐部"
	case item.JoinStatus == "failed":
		return "加入俱乐部失败，可重试"
	case item.JoinStatus == "unassigned" || item.JoinStatus == "":
		return "未投放"
	case !item.Enabled:
		return "已停用，不参与调度"
	case item.JoinStatus == "joined" && item.WorkerID == nil && item.ScheduleState == "released":
		return "不在周计划时段，已让出 Worker"
	case item.WorkerID == nil:
		return "等待分配 Worker"
	default:
		return "已分配 Worker"
	}
}

// assignAutomationWorkers 给俱乐部里「已入会 + 已启用 + 还没挂节点」的机器人分配 Worker。
// 只挑在线（租约有效）、没排空、还有容量的节点，按剩余容量从多到少填。
// 返回 (本次分配台数, 仍等待台数, error)。
func (s *Server) assignAutomationWorkers(ctx context.Context, clubID string) (int, int, error) {
	type workerSlot struct {
		id   int64
		free int
	}
	rows, err := s.db.QueryContext(ctx, `SELECT w.id, w.max_robots - w.robot_count
FROM mgr_automation_worker w
WHERE `+automationWorkerOnlineSQL+`
  AND w.robot_count < w.max_robots
ORDER BY (w.max_robots - w.robot_count) DESC, w.id`)
	if err != nil {
		return 0, 0, err
	}
	slots := []*workerSlot{}
	for rows.Next() {
		slot := &workerSlot{}
		if err := rows.Scan(&slot.id, &slot.free); err != nil {
			rows.Close()
			return 0, 0, err
		}
		if slot.free > 0 {
			slots = append(slots, slot)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, 0, err
	}

	type waitingRobot struct {
		id         int64
		account    string
		terminalNo string
	}
	pending, err := s.db.QueryContext(ctx, `SELECT id, account, terminal_no FROM mgr_automation_robot
WHERE club_id = ? AND worker_id IS NULL AND enabled = 1 AND join_status = 'joined'
  AND COALESCE(schedule_state, '') <> 'released'
ORDER BY id`, clubID)
	if err != nil {
		return 0, 0, err
	}
	waiting := []waitingRobot{}
	for pending.Next() {
		var item waitingRobot
		if err := pending.Scan(&item.id, &item.account, &item.terminalNo); err != nil {
			pending.Close()
			return 0, 0, err
		}
		waiting = append(waiting, item)
	}
	pending.Close()
	if err := pending.Err(); err != nil {
		return 0, 0, err
	}
	if len(waiting) == 0 {
		return 0, 0, s.refreshAutomationWorkerLoad(ctx)
	}

	assigned := 0
	slotIndex := 0
	for _, robot := range waiting {
		for slotIndex < len(slots) && slots[slotIndex].free <= 0 {
			slotIndex++
		}
		if slotIndex >= len(slots) {
			break
		}
		slot := slots[slotIndex]
		result, err := s.db.ExecContext(ctx, `UPDATE mgr_automation_robot
SET worker_id = ?, status = 'idle', desired_status = 'running', schedule_state = '', last_error = '', last_heartbeat = NOW()
WHERE id = ? AND worker_id IS NULL`, slot.id, robot.id)
		if err != nil {
			return assigned, len(waiting) - assigned, err
		}
		if affected, _ := result.RowsAffected(); affected == 0 {
			continue // 被别的节点先抢走了（心跳/巡检也会分配）
		}
		slot.free--
		assigned++
		recordWorkerEvent(ctx, s.db, slot.id, workerEventRobotAssigned, robot.id, robot.terminalNo, map[string]any{
			"account":    robot.account,
			"terminalNo": robot.terminalNo,
			"clubId":     clubID,
			"message":    "分配账号 " + robot.account + "（投放时自动分配）",
		})
	}
	if assigned > 0 {
		if err := s.refreshAutomationWorkerLoad(ctx); err != nil {
			return assigned, len(waiting) - assigned, err
		}
	}
	return assigned, len(waiting) - assigned, nil
}

// refreshAutomationWorkerLoad 用机器人表重算每个节点的 robot_count，避免加减法漂移。
func (s *Server) refreshAutomationWorkerLoad(ctx context.Context) error {
	refreshWorkerLoad(ctx, s.db)
	return nil
}

func (s *Server) countOnlineWorkers(ctx context.Context) int {
	var count int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM mgr_automation_worker w
WHERE `+automationWorkerOnlineSQL).Scan(&count); err != nil {
		return 0
	}
	return count
}

// handleDispatchAutomationClub 手动触发一次节点分配（页面上的「重新分配」按钮）。
func (s *Server) handleDispatchAutomationClub(w http.ResponseWriter, r *http.Request, p principal) {
	clubID := r.PathValue("clubId")
	scope, err := s.automationScope(r.Context(), p)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取数据范围失败")
		return
	}
	if !s.automationClubOrError(w, r, scope, clubID) {
		return
	}
	assigned, waiting, err := s.assignAutomationWorkers(r.Context(), clubID)
	if err != nil {
		s.logger.Error("dispatch automation club", "error", err, "clubId", clubID)
		writeError(w, http.StatusInternalServerError, "DISPATCH_ERROR", "分配 Worker 失败")
		return
	}
	online := s.countOnlineWorkers(r.Context())
	message := ""
	switch {
	case assigned > 0:
		message = fmt.Sprintf("已给 %d 台机器人分配 Worker", assigned)
	case waiting == 0:
		message = "所有机器人都有 Worker 了"
	case online == 0:
		message = fmt.Sprintf("当前没有在线 Worker 节点，%d 台机器人等待分配", waiting)
	default:
		message = fmt.Sprintf("%d 台机器人等待分配，在线节点容量已满", waiting)
	}
	s.audit(r.Context(), &p, "automation.deploy.dispatch", "automation_club", clubID, nil, nil,
		map[string]any{"assigned": assigned, "waiting": waiting, "workersOnline": online}, 0, message, clientIP(r))
	writeData(w, http.StatusOK, map[string]any{
		"assigned": assigned, "waiting": waiting, "workersOnline": online, "message": message,
	})
}

func (s *Server) handleListDeployClubs(w http.ResponseWriter, r *http.Request, p principal) {
	scope, err := s.automationScope(r.Context(), p)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取数据范围失败")
		return
	}
	keyword := strings.TrimSpace(r.URL.Query().Get("keyword"))
	scopeSQL, scopeArgs := scopeClause("c.club_id", scope)
	conditions := []string{scopeSQL, "r.club_id <> ''"}
	args := append([]any{}, scopeArgs...)
	if keyword != "" {
		conditions = append(conditions, "(c.club_id LIKE ? OR c.name LIKE ? OR c.invite_code LIKE ?)")
		like := "%" + keyword + "%"
		args = append(args, like, like, like)
	}
	rows, err := s.db.QueryContext(r.Context(), `SELECT
c.club_id, c.name, c.invite_code, c.status, c.robot_quota, c.max_per_room,
COUNT(r.id),
COALESCE(SUM(r.enabled = 1), 0),
COALESCE(SUM(r.room_id IS NOT NULL), 0),
COUNT(DISTINCT r.group_id),
COALESCE(SUM(r.join_status = 'joined'), 0),
COALESCE(SUM(r.join_status = 'pending'), 0),
COALESCE(SUM(r.join_status = 'failed'), 0),
COALESCE(SUM(r.today_rounds), 0),
COALESCE(SUM(r.today_net), 0),
MIN(r.joined_at),
COALESCE(SUM(r.worker_id IS NOT NULL), 0),
COALESCE(SUM(r.join_status = 'joined' AND r.worker_id IS NULL AND r.enabled = 1
  AND COALESCE(r.schedule_state, '') <> 'released'), 0),
(SELECT COUNT(*) FROM mgr_automation_worker w WHERE `+automationWorkerOnlineSQL+`)
FROM mgr_automation_club c
JOIN mgr_automation_robot r ON r.club_id = c.club_id
WHERE `+strings.Join(conditions, " AND ")+`
GROUP BY c.club_id, c.name, c.invite_code, c.status, c.robot_quota, c.max_per_room
ORDER BY COUNT(r.id) DESC, c.club_id`, args...)
	if err != nil {
		s.logger.Error("list deploy clubs", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取已投放俱乐部失败")
		return
	}
	defer rows.Close()
	items := []deployClubItem{}
	for rows.Next() {
		var item deployClubItem
		var since sql.NullTime
		if err := rows.Scan(&item.ClubID, &item.Name, &item.InviteCode, &item.Status, &item.RobotQuota, &item.MaxPerRoom,
			&item.RobotCount, &item.EnabledCount, &item.SeatedCount, &item.GroupCount,
			&item.JoinedCount, &item.PendingCount, &item.FailedCount,
			&item.TodayRounds, &item.TodayNet, &since,
			&item.WorkerAssigned, &item.WorkerWaiting, &item.WorkersOnline); err != nil {
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取已投放俱乐部失败")
			return
		}
		if since.Valid {
			item.Since = &since.Time
		}
		items = append(items, item)
	}
	writeData(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleGetDeployClub(w http.ResponseWriter, r *http.Request, p principal) {
	clubID := r.PathValue("clubId")
	scope, err := s.automationScope(r.Context(), p)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取数据范围失败")
		return
	}
	if !s.automationClubOrError(w, r, scope, clubID) {
		return
	}
	detail := deployClubDetail{Groups: []deployGroupItem{}, Robots: []deployRobotItem{}, Strategies: []deployStrategy{}}
	var club deployClubItem
	var since sql.NullTime
	err = s.db.QueryRowContext(r.Context(), `SELECT c.club_id, c.name, c.invite_code, c.status, c.robot_quota, c.max_per_room,
(SELECT COUNT(*) FROM mgr_automation_robot r WHERE r.club_id = c.club_id),
(SELECT COUNT(*) FROM mgr_automation_robot r WHERE r.club_id = c.club_id AND r.enabled = 1),
(SELECT COUNT(*) FROM mgr_automation_robot r WHERE r.club_id = c.club_id AND r.room_id IS NOT NULL),
(SELECT COUNT(DISTINCT r.group_id) FROM mgr_automation_robot r WHERE r.club_id = c.club_id),
(SELECT COUNT(*) FROM mgr_automation_robot r WHERE r.club_id = c.club_id AND r.join_status = 'joined'),
(SELECT COUNT(*) FROM mgr_automation_robot r WHERE r.club_id = c.club_id AND r.join_status = 'pending'),
(SELECT COUNT(*) FROM mgr_automation_robot r WHERE r.club_id = c.club_id AND r.join_status = 'failed'),
(SELECT COALESCE(SUM(r.today_rounds), 0) FROM mgr_automation_robot r WHERE r.club_id = c.club_id),
(SELECT COALESCE(SUM(r.today_net), 0) FROM mgr_automation_robot r WHERE r.club_id = c.club_id),
(SELECT MIN(r.joined_at) FROM mgr_automation_robot r WHERE r.club_id = c.club_id),
(SELECT COUNT(*) FROM mgr_automation_robot r WHERE r.club_id = c.club_id AND r.worker_id IS NOT NULL),
(SELECT COUNT(*) FROM mgr_automation_robot r WHERE r.club_id = c.club_id AND r.join_status = 'joined' AND r.worker_id IS NULL AND r.enabled = 1
  AND COALESCE(r.schedule_state, '') <> 'released'),
(SELECT COUNT(*) FROM mgr_automation_worker w WHERE `+automationWorkerOnlineSQL+`)
FROM mgr_automation_club c WHERE c.club_id = ?`, clubID).
		Scan(&club.ClubID, &club.Name, &club.InviteCode, &club.Status, &club.RobotQuota, &club.MaxPerRoom,
			&club.RobotCount, &club.EnabledCount, &club.SeatedCount, &club.GroupCount,
			&club.JoinedCount, &club.PendingCount, &club.FailedCount,
			&club.TodayRounds, &club.TodayNet, &since,
			&club.WorkerAssigned, &club.WorkerWaiting, &club.WorkersOnline)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "CLUB_NOT_FOUND", "没有找到这个自动化俱乐部")
		return
	}
	if err != nil {
		s.logger.Error("get deploy club", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取俱乐部投放详情失败")
		return
	}
	if since.Valid {
		club.Since = &since.Time
	}
	detail.Club = club

	if err := s.queryDeployGroups(r.Context(), clubID, &detail); err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取俱乐部机器人组失败")
		return
	}
	if err := s.queryDeployRobots(r.Context(), clubID, &detail); err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取俱乐部机器人失败")
		return
	}
	if err := s.queryDeployHistory(r.Context(), clubID, &detail); err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取投放历史失败")
		return
	}
	writeData(w, http.StatusOK, detail)
}

func (s *Server) queryDeployGroups(ctx context.Context, clubID string, detail *deployClubDetail) error {
	rows, err := s.db.QueryContext(ctx, `SELECT g.id, g.name, COALESCE(st.name, ''), g.default_intelligence,
g.profit_mode, g.profit_target,
COUNT(r.id), COALESCE(SUM(r.room_id IS NOT NULL), 0),
COALESCE(SUM(r.today_rounds), 0), COALESCE(SUM(r.today_net), 0)
FROM mgr_automation_group g
JOIN mgr_automation_robot r ON r.group_id = g.id AND r.club_id = ?
LEFT JOIN mgr_automation_strategy st ON st.id = g.strategy_id
GROUP BY g.id, g.name, st.name, g.default_intelligence, g.profit_mode, g.profit_target
ORDER BY COUNT(r.id) DESC, g.id`, clubID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var item deployGroupItem
		if err := rows.Scan(&item.ID, &item.Name, &item.StrategyName, &item.DefaultIntensity,
			&item.ProfitMode, &item.ProfitTarget, &item.RobotCount, &item.SeatedCount,
			&item.TodayRounds, &item.TodayNet); err != nil {
			return err
		}
		detail.Groups = append(detail.Groups, item)
	}
	return rows.Err()
}

func (s *Server) queryDeployRobots(ctx context.Context, clubID string, detail *deployClubDetail) error {
	rows, err := s.db.QueryContext(ctx, `SELECT r.id, r.terminal_no, r.account, r.nickname, r.avatar,
COALESCE(g.name, ''), COALESCE(rs.name, gs.name, ''),
COALESCE(NULLIF(r.intelligence, 0), g.default_intelligence, 0),
r.room_id, r.seat_no, r.status, r.enabled, r.join_status, r.invite_code, r.joined_at, r.last_error,
r.today_rounds, r.today_net, r.period_net, r.buyin, r.room_pi,
r.profit_schedule, r.schedule_state,
r.worker_id, COALESCE(w.node_code, '')
FROM mgr_automation_robot r
LEFT JOIN mgr_automation_group g ON g.id = r.group_id
LEFT JOIN mgr_automation_strategy rs ON rs.id = r.strategy_id
LEFT JOIN mgr_automation_strategy gs ON gs.id = g.strategy_id
LEFT JOIN mgr_automation_worker w ON w.id = r.worker_id
WHERE r.club_id = ?
ORDER BY r.id`, clubID)
	if err != nil {
		return err
	}
	defer rows.Close()
	strategyCount := map[string]*deployStrategy{}
	order := []string{}
	for rows.Next() {
		var item deployRobotItem
		var roomID sql.NullInt64
		var joinedAt sql.NullTime
		var workerID sql.NullInt64
		if err := rows.Scan(&item.ID, &item.TerminalNo, &item.Account, &item.Nickname, &item.Avatar,
			&item.GroupName, &item.StrategyName, &item.Intelligence,
			&roomID, &item.SeatNo, &item.Status, &item.Enabled, &item.JoinStatus, &item.InviteCode, &joinedAt, &item.LastError,
			&item.TodayRounds, &item.TodayNet, &item.PeriodNet, &item.Buyin, &item.RoomPi,
			&item.ProfitSchedule, &item.ScheduleState,
			&workerID, &item.WorkerName); err != nil {
			return err
		}
		if workerID.Valid {
			value := workerID.Int64
			item.WorkerID = &value
		}
		item.DispatchNote = deployDispatchNote(item)
		if roomID.Valid {
			value := roomID.Int64
			item.RoomID = &value
		}
		if joinedAt.Valid {
			value := joinedAt.Time
			item.JoinedAt = &value
		}
		detail.Robots = append(detail.Robots, item)
		name := strings.TrimSpace(item.StrategyName)
		if name == "" {
			name = "未绑定策略"
		}
		if existing, found := strategyCount[name]; found {
			existing.RobotCount++
		} else {
			strategyCount[name] = &deployStrategy{ID: name, Name: name, RobotCount: 1}
			order = append(order, name)
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	sort.Slice(order, func(i, j int) bool {
		return strategyCount[order[i]].RobotCount > strategyCount[order[j]].RobotCount
	})
	for _, name := range order {
		detail.Strategies = append(detail.Strategies, *strategyCount[name])
	}
	return nil
}

func (s *Server) queryDeployHistory(ctx context.Context, clubID string, detail *deployClubDetail) error {
	var sessions, rounds int
	var net int64
	var since, last sql.NullTime
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*), COALESCE(SUM(rounds), 0), COALESCE(SUM(net_win), 0),
MIN(started_at), MAX(started_at)
FROM mgr_automation_session WHERE club_id = ?`, clubID).Scan(&sessions, &rounds, &net, &since, &last)
	if err != nil {
		return err
	}
	detail.History = deployHistory{Sessions: sessions, Rounds: rounds, Net: net}
	if since.Valid {
		detail.History.Since = &since.Time
	}
	if last.Valid {
		detail.History.LastActiveAt = &last.Time
	}
	return nil
}

func (s *Server) handleLookupDeployClub(w http.ResponseWriter, r *http.Request, p principal) {
	code := strings.TrimSpace(r.URL.Query().Get("inviteCode"))
	if !isSixDigitCode(code) {
		writeError(w, http.StatusBadRequest, "INVALID_INVITE_CODE", "邀请码必须是 6 位数字")
		return
	}
	scope, err := s.automationScope(r.Context(), p)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取数据范围失败")
		return
	}
	clubID, message, err := s.resolveDeployClub(r.Context(), code)
	if err != nil {
		s.logger.Error("lookup deploy club", "error", err, "inviteCode", code)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "按邀请码查询俱乐部失败")
		return
	}
	if message != "" {
		writeError(w, http.StatusNotFound, "CLUB_NOT_FOUND", message)
		return
	}
	if !scope.Allows(clubID) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "没有这个俱乐部的投放权限")
		return
	}
	var item deployLookup
	err = s.db.QueryRowContext(r.Context(), `SELECT c.club_id, c.name, c.status, c.robot_quota, c.max_per_room,
(SELECT COUNT(*) FROM mgr_automation_robot r WHERE r.club_id = c.club_id)
FROM mgr_automation_club c WHERE c.club_id = ?`, clubID).
		Scan(&item.ClubID, &item.Name, &item.Status, &item.RobotQuota, &item.MaxPerRoom, &item.RobotCount)
	if err != nil {
		s.logger.Error("lookup deploy club row", "error", err, "clubId", clubID)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "按邀请码查询俱乐部失败")
		return
	}
	item.InviteCode = code
	if item.RobotQuota > 0 {
		item.Remaining = max(0, item.RobotQuota-item.RobotCount)
	}
	writeData(w, http.StatusOK, item)
}

// resolveDeployClub 把玩家在游戏里看到的「俱乐部邀请码」解析成俱乐部 ID。
// 游戏库 club_invite_code_info 才是真实码（每个码带归属代理），解析成功后顺手登记进
// mgr_automation_club，投放配置与统计仍然落在后台表里。游戏库查不到时回退到后台自配的码。
func (s *Server) resolveDeployClub(ctx context.Context, code string) (string, string, error) {
	invite, err := s.gameClubByInviteCode(ctx, code)
	if err != nil {
		return "", "", err
	}
	if invite == nil {
		return s.automationClubByInviteCode(ctx, code)
	}
	switch {
	case strings.TrimSpace(invite.ClubID) == "":
		return "", "这个邀请码还没有被俱乐部使用，请让俱乐部重新生成邀请码", nil
	case invite.CodeStatus != "used":
		return "", "这个邀请码已失效，请让俱乐部重新生成邀请码", nil
	case invite.ClubStatus != "" && invite.ClubStatus != "used":
		return "", "这个邀请码所属的俱乐部已解散或不可用", nil
	}
	name := strings.TrimSpace(invite.ClubName)
	if name == "" {
		name = invite.ClubID
	}
	if err := s.ensureAutomationClub(ctx, invite.ClubID, name, code); err != nil {
		return "", "", err
	}
	return invite.ClubID, "", nil
}

type gameClubInvite struct {
	InviteCode string
	ClubID     string
	ClubName   string
	AgentID    string
	CodeStatus string
	ClubStatus string
}

// gameClubByInviteCode 用游戏里显示的邀请码反查俱乐部：club_invite_code_info → club_guuid_info。
func (s *Server) gameClubByInviteCode(ctx context.Context, code string) (*gameClubInvite, error) {
	var item gameClubInvite
	err := s.db.QueryRowContext(ctx, `SELECT i.invite_code, i.club_guuid, COALESCE(c.club_name, ''),
i.user_guuid, i.status, COALESCE(c.club_status, '')
FROM kbedm.club_invite_code_info i
LEFT JOIN kbedm.club_guuid_info c ON c.club_guuid = i.club_guuid
WHERE i.invite_code = ? LIMIT 1`, code).
		Scan(&item.InviteCode, &item.ClubID, &item.ClubName, &item.AgentID, &item.CodeStatus, &item.ClubStatus)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &item, nil
}

// ensureAutomationClub 把游戏里的俱乐部登记到后台表；已存在时只刷新名称与邀请码，
// 不动投放数量、每房上限、启停这些后台配置。
func (s *Server) ensureAutomationClub(ctx context.Context, clubID, name, inviteCode string) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO mgr_automation_club
(club_id, name, robot_quota, seat_ratio, max_per_room, invite_code, status, is_demo)
VALUES (?, ?, 20, 50, 2, ?, 'enabled', 0)
ON DUPLICATE KEY UPDATE name = VALUES(name), invite_code = VALUES(invite_code)`, clubID, name, inviteCode)
	return err
}

func (s *Server) handleDeployByInvite(w http.ResponseWriter, r *http.Request, p principal) {
	var input deployRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	code := strings.TrimSpace(input.InviteCode)
	if !isSixDigitCode(code) {
		writeError(w, http.StatusBadRequest, "INVALID_INVITE_CODE", "邀请码必须是 6 位数字")
		return
	}
	scope, err := s.automationScope(r.Context(), p)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取数据范围失败")
		return
	}
	clubID, message, err := s.resolveDeployClub(r.Context(), code)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "按邀请码查询俱乐部失败")
		return
	}
	if message != "" {
		writeError(w, http.StatusNotFound, "CLUB_NOT_FOUND", message)
		return
	}
	if !scope.Allows(clubID) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "没有这个俱乐部的投放权限")
		return
	}
	outcome, apiErr := s.performAutomationDeploy(r, clubID, input.RobotIDs, input.GroupIDs, input.StrategyID,
		input.ProfitMode, input.ProfitTarget, input.PeriodStart, input.PeriodEnd, input.ProfitSchedule, input.RoomPi)
	if apiErr != nil {
		writeError(w, apiErr.Status, apiErr.Code, apiErr.Message)
		return
	}
	s.audit(r.Context(), &p, "automation.robot.deploy", "automation_club", clubID, input, nil,
		map[string]any{"count": outcome.Count, "inviteCode": outcome.InviteCode}, 0, outcome.Message, clientIP(r))
	s.startAutomationJoins(clubID, outcome.RobotIDs, outcome.InviteCode)
	// 投放只是把账号放进俱乐部，真正跑起来要挂 Worker；这里先把能分配的分配掉，并把"还差什么"告诉前端。
	_, waiting, dispatchErr := s.assignAutomationWorkers(r.Context(), clubID)
	if dispatchErr != nil {
		s.logger.Error("dispatch after deploy", "error", dispatchErr, "clubId", clubID)
	}
	online := s.countOnlineWorkers(r.Context())
	finalMessage := outcome.Message
	switch {
	case online == 0:
		finalMessage += "；当前没有在线 Worker 节点，入会完成后会停在「等待分配 Worker」"
	case waiting > 0:
		finalMessage += fmt.Sprintf("；还有 %d 台等待分配 Worker（在线节点容量不足）", waiting)
	}
	writeData(w, http.StatusOK, map[string]any{
		"count": outcome.Count, "clubId": clubID, "inviteCode": outcome.InviteCode,
		"joinPending": len(outcome.RobotIDs), "message": finalMessage,
		"workerWaiting": waiting, "workersOnline": online,
	})
}

func (s *Server) automationClubByInviteCode(ctx context.Context, code string) (string, string, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT club_id FROM mgr_automation_club WHERE invite_code = ?", code)
	if err != nil {
		return "", "", err
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return "", "", err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return "", "", err
	}
	if len(ids) == 0 {
		return "", "没有俱乐部使用这个邀请码，请核对后重试", nil
	}
	if len(ids) > 1 {
		return "", "多个俱乐部使用了同一个邀请码，请先到俱乐部接入里改成唯一邀请码", nil
	}
	return ids[0], "", nil
}

// startAutomationJoins 把刚投放的账号自动加入俱乐部：调用游戏服 添加_俱乐部_玩家，
// 成功后 join_status=joined，失败保留原因供页面重试。
func (s *Server) startAutomationJoins(clubID string, robotIDs []int64, inviteCode string) {
	if len(robotIDs) == 0 {
		return
	}
	ids := append([]int64{}, robotIDs...)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		for _, id := range ids {
			s.joinAutomationRobotToClub(ctx, id, clubID, inviteCode)
		}
	}()
}

func (s *Server) joinAutomationRobotToClub(ctx context.Context, robotID int64, clubID, inviteCode string) {
	var account string
	if err := s.db.QueryRowContext(ctx, "SELECT account FROM mgr_automation_robot WHERE id = ?", robotID).Scan(&account); err != nil {
		s.logger.Error("join robot club: read account", "error", err, "robot", robotID)
		return
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE mgr_automation_robot
SET join_status = 'pending', invite_code = ?, joined_at = NULL, last_error = '' WHERE id = ?`, inviteCode, robotID); err != nil {
		s.logger.Error("join robot club: mark pending", "error", err, "robot", robotID)
		return
	}
	result, err := s.callGameCommand(ctx, "添加_俱乐部_玩家", map[string]any{
		"club_id": clubID,
		"user_id": account,
		"context": "automation-join",
	})
	if err != nil {
		s.markAutomationJoinFailed(ctx, robotID, "调用游戏服加入俱乐部失败："+err.Error())
		return
	}
	if result.RetCode != 512 && result.RetCode != 1280 {
		s.markAutomationJoinFailed(ctx, robotID, fmt.Sprintf("游戏服返回 ret_code %d", result.RetCode))
		return
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE mgr_automation_robot
SET join_status = 'joined', joined_at = NOW(), last_error = '' WHERE id = ?`, robotID); err != nil {
		s.logger.Error("join robot club: mark joined", "error", err, "robot", robotID)
		return
	}
	// 入会成功后立刻尝试挂 Worker：没有可用节点时保持"等待分配"，界面能看到卡在哪一步。
	if _, _, err := s.assignAutomationWorkers(ctx, clubID); err != nil {
		s.logger.Error("join robot club: assign worker", "error", err, "robot", robotID)
	}
}

func (s *Server) markAutomationJoinFailed(ctx context.Context, robotID int64, message string) {
	if _, err := s.db.ExecContext(ctx, "UPDATE mgr_automation_robot SET join_status = 'failed', last_error = ? WHERE id = ?", message, robotID); err != nil {
		s.logger.Error("join robot club: mark failed", "error", err, "robot", robotID)
	}
}

func (s *Server) handleJoinAutomationRobot(w http.ResponseWriter, r *http.Request, p principal) {
	id, ok := parsePositivePathID(w, r, "id", "机器人 ID 不正确")
	if !ok {
		return
	}
	var clubID, inviteCode, joinStatus string
	err := s.db.QueryRowContext(r.Context(), "SELECT club_id, invite_code, join_status FROM mgr_automation_robot WHERE id = ?", id).
		Scan(&clubID, &inviteCode, &joinStatus)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "ROBOT_NOT_FOUND", "没有找到这个机器人")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取机器人失败")
		return
	}
	if clubID == "" {
		writeError(w, http.StatusConflict, "ROBOT_NOT_DEPLOYED", "机器人还没有投放到俱乐部")
		return
	}
	if joinStatus == "joined" {
		writeData(w, http.StatusOK, map[string]any{"message": "机器人已经在俱乐部里", "joinStatus": joinStatus})
		return
	}
	s.joinAutomationRobotToClub(r.Context(), id, clubID, inviteCode)
	var next string
	if err := s.db.QueryRowContext(r.Context(), "SELECT join_status FROM mgr_automation_robot WHERE id = ?", id).Scan(&next); err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取加入状态失败")
		return
	}
	if next == "joined" {
		writeData(w, http.StatusOK, map[string]any{"message": "已加入俱乐部", "joinStatus": next})
		return
	}
	var lastError string
	_ = s.db.QueryRowContext(r.Context(), "SELECT last_error FROM mgr_automation_robot WHERE id = ?", id).Scan(&lastError)
	writeError(w, http.StatusBadGateway, "JOIN_FAILED", strings.TrimSpace(lastError)+"；请稍后重试或到游戏里手动加入")
}

func joinInt64List(values []int64) string {
	parts := make([]string, 0, len(values))
	for _, value := range values {
		parts = append(parts, strconv.FormatInt(value, 10))
	}
	return strings.Join(parts, ",")
}
