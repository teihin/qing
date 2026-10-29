package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"xuanmanager/internal/security"
)

// Worker 通道（/agent/v1/*）。
//
// 设计要点：
//   - 节点注册要「接入令牌」换租约，平时只带租约头；不占用后台 session/CSRF。
//   - 命令只允许固定枚举，拒绝「任意字符串命令」式远程执行。
//   - 命令有幂等键、过期时间、状态机；事件按 (worker_id, event_id) 去重，可重放。
const (
	agentEnrollTokenKey = "agent_enroll_token"
	// 心跳 5 秒、租约 20 秒（连丢 4 拍才判离线）：进程被强杀时后台也能在 20 秒内显示离线。
	// 正常退出走 /agent/v1/offline，即时置离线，不用等租约过期。
	agentLeaseTTLSeconds  = 20
	agentHeartbeatSeconds = 5
	agentMaxBatchEvents   = 200
	agentMaxCommands      = 50
	agentDefaultLimit     = 20
	agentJanitorInterval  = 5 * time.Second
	// 节点离线超过这么久，就把它的账号收回等待池，交给其它在线节点接。
	agentOfflineReleaseMinutes = 10
)

// agentCommandTypes 固定枚举：动作只影响本节点上的终端/任务。
var agentCommandTypes = map[string]string{
	"START_TERMINAL":  "启动终端",
	"PAUSE_TERMINAL":  "暂停终端",
	"DRAIN_TERMINAL":  "排空终端",
	"STOP_TERMINAL":   "停止终端",
	"START_TASK":      "启动任务",
	"PAUSE_TASK":      "暂停任务",
	"CANCEL_TASK":     "取消任务",
	"APPLY_STRATEGY":  "应用策略",
	"RECONCILE_STATE": "对账状态",
}

var agentEventTypes = map[string]bool{
	// 终端生命周期：拉起 -> 登录（成功/失败）-> 等待 -> 进房 -> 离房 -> 退出账号 -> 停止
	"TerminalStarted": true, "LoginStarted": true, "LoginSucceeded": true, "LoginFailed": true,
	"Waiting": true, "LogoutSucceeded": true, "TerminalStopped": true,
	"RoomCreated": true, "RoomJoined": true, "PlayerSeated": true, "GameReady": true,
	"GameStarted": true, "TurnStarted": true, "ActionSubmitted": true, "ActionAccepted": true,
	"ActionRejected": true, "GameSettled": true, "RoomLeft": true, "RoomClosed": true,
	// 结算下桌但人还在房间里：俱乐部模式的一轮结束，接下来会原地重新带入。
	"PlayerUnseated": true,
	"TaskCompleted":  true, "TaskFailed": true,
	// 客户端调试日志：策略决策、GPS 上报等，便于在「运行日志」里直接看到。
	"TerminalLog": true,
	// 当前牌桌快照：机器人所在房间的座位与全桌手牌。
	"TableState": true,
}

// agentAckStatuses 允许 agent 回报的状态（PENDING/DELIVERED/EXPIRED/CANCELLED 由服务端维护）。
var agentAckStatuses = map[string]bool{
	"ACCEPTED": true, "RUNNING": true, "COMPLETED": true, "REJECTED": true,
}

var agentAckTransitions = map[string][]string{
	"PENDING":   {"ACCEPTED", "REJECTED"},
	"DELIVERED": {"ACCEPTED", "REJECTED"},
	"ACCEPTED":  {"RUNNING", "COMPLETED", "REJECTED"},
	"RUNNING":   {"COMPLETED", "REJECTED"},
}

// credentialKey 返回机器人登录密码的落库密钥（由配置材料派生）。
func (s *Server) credentialKey() []byte {
	return security.DeriveCredentialKey(s.cfg.CredentialKey)
}

type agentIdentity struct {
	WorkerID  int64
	NodeCode  string
	Status    string
	MaxRobots int
}

func (s *Server) registerAutomationAgentRoutes() {
	s.mux.HandleFunc("POST /agent/v1/register", s.handleAgentRegister)
	s.mux.Handle("POST /agent/v1/heartbeat", s.agentAuthorized(s.handleAgentHeartbeat))
	s.mux.Handle("POST /agent/v1/offline", s.agentAuthorized(s.handleAgentOffline))
	s.mux.Handle("GET /agent/v1/commands", s.agentAuthorized(s.handleAgentPullCommands))
	s.mux.Handle("POST /agent/v1/commands/{commandNo}/ack", s.agentAuthorized(s.handleAgentAckCommand))
	s.mux.Handle("POST /agent/v1/events/batch", s.agentAuthorized(s.handleAgentReportEvents))
}

type agentHandlerFunc func(http.ResponseWriter, *http.Request, agentIdentity)

// agentAuthorized 用 X-Agent-Token 里的租约令牌换节点身份；租约过期即 401，
// 节点被后台停用则 403，让 agent 停止心跳之外的所有动作。
func (s *Server) agentAuthorized(next agentHandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimSpace(r.Header.Get("X-Agent-Token"))
		if token == "" || len(token) < 32 {
			writeError(w, http.StatusUnauthorized, "AGENT_UNAUTHORIZED", "缺少节点租约令牌")
			return
		}
		var agent agentIdentity
		err := s.db.QueryRowContext(r.Context(), `SELECT id, node_code, status, max_robots
FROM mgr_automation_worker
WHERE lease_token_hash = ? AND lease_expires_at IS NOT NULL AND lease_expires_at > NOW()`, security.HashToken(token)).
			Scan(&agent.WorkerID, &agent.NodeCode, &agent.Status, &agent.MaxRobots)
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusUnauthorized, "AGENT_UNAUTHORIZED", "节点租约已失效，请重新注册")
			return
		}
		if err != nil {
			s.logger.Error("agent authorize", "error", err)
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "校验节点身份失败")
			return
		}
		if agent.Status == "disabled" {
			writeError(w, http.StatusForbidden, "AGENT_DISABLED", "节点已被后台停用，请联系管理员")
			return
		}
		next(w, r, agent)
	})
}

// ---- 接入令牌（存哈希，只在生成/轮换时返回一次明文） ----

func (s *Server) agentEnrollTokenHash(ctx context.Context) (string, error) {
	var value string
	err := s.db.QueryRowContext(ctx, "SELECT setting_value FROM mgr_automation_setting WHERE setting_key = ?", agentEnrollTokenKey).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return value, nil
}

func (s *Server) rotateAgentEnrollToken(ctx context.Context, operator string) (string, error) {
	token, err := security.NewToken()
	if err != nil {
		return "", err
	}
	if _, err := s.db.ExecContext(ctx, `INSERT INTO mgr_automation_setting (setting_key, setting_value, updated_by)
VALUES (?, ?, ?)
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
		agentEnrollTokenKey, security.HashToken(token), operator); err != nil {
		return "", err
	}
	return token, nil
}

// ---- 注册 ----

type agentRegisterRequest struct {
	WorkerCode  string `json:"workerCode"`
	Platform    string `json:"platform"`
	Arch        string `json:"arch"`
	Version     string `json:"version"`
	Capacity    int    `json:"capacity"`
	Labels      string `json:"labels"`
	EnrollToken string `json:"enrollToken"`
}

func (s *Server) handleAgentRegister(w http.ResponseWriter, r *http.Request) {
	var input agentRegisterRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	code := strings.TrimSpace(input.WorkerCode)
	if !validAgentWorkerCode(code) {
		writeError(w, http.StatusBadRequest, "INVALID_WORKER_CODE", "节点编号必须是 3-32 位字母、数字、下划线或短横线")
		return
	}
	// 接入令牌是可选的：后台配了令牌就必须配对（防公网乱注册）；没配就是开放注册，
	// 方便先跑通链路，之后再在「Worker 节点」页生成令牌把口子关上。
	expected, err := s.agentEnrollTokenHash(r.Context())
	if err != nil {
		s.logger.Error("read agent enroll token", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取接入令牌失败")
		return
	}
	provided := strings.TrimSpace(input.EnrollToken)
	if expected != "" && !security.EqualTokenHash(provided, expected) {
		writeError(w, http.StatusUnauthorized, "AGENT_ENROLL_REJECTED", "接入令牌不正确（后台已启用令牌校验）")
		return
	}
	capacity := clampInt(input.Capacity, 1, 200, 20)
	lease, err := security.NewToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "TOKEN_ERROR", "生成节点租约失败")
		return
	}
	platform := clipText(strings.TrimSpace(input.Platform), 32)
	arch := clipText(strings.TrimSpace(input.Arch), 32)
	version := clipText(strings.TrimSpace(input.Version), 32)
	labels := clipText(strings.TrimSpace(input.Labels), 255)
	host := clipText(clientIP(r), 128)
	osName := platform
	if osName == "" {
		osName = "unknown"
	}
	if _, err := s.db.ExecContext(r.Context(), `INSERT INTO mgr_automation_worker
(node_code, host, os, platform, arch, version, status, robot_count, max_robots, egress_cidr, labels,
 lease_token_hash, lease_expires_at, enrolled_at, last_heartbeat, is_demo)
VALUES (?, ?, ?, ?, ?, ?, 'online', 0, ?, '', ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND), NOW(), NOW(), 0)
ON DUPLICATE KEY UPDATE
  host = VALUES(host), os = VALUES(os), platform = VALUES(platform), arch = VALUES(arch),
  version = VALUES(version), max_robots = VALUES(max_robots), labels = VALUES(labels),
  lease_token_hash = VALUES(lease_token_hash), lease_expires_at = VALUES(lease_expires_at),
  enrolled_at = NOW(), last_heartbeat = NOW(),
  status = IF(status = 'disabled', 'disabled', IF(status = 'draining', 'draining', 'online'))`,
		code, host, osName, platform, arch, version, capacity, labels,
		security.HashToken(lease), agentLeaseTTLSeconds); err != nil {
		s.logger.Error("agent register", "error", err)
		writeError(w, http.StatusInternalServerError, "REGISTER_ERROR", "节点注册失败")
		return
	}
	var workerID int64
	var status string
	if err := s.db.QueryRowContext(r.Context(), "SELECT id, status FROM mgr_automation_worker WHERE node_code = ?", code).
		Scan(&workerID, &status); err != nil {
		s.logger.Error("agent register lookup", "error", err)
		writeError(w, http.StatusInternalServerError, "REGISTER_ERROR", "节点注册失败")
		return
	}
	s.logger.Info("agent registered", "worker", code, "workerId", workerID, "platform", platform,
		"capacity", capacity, "tokenChecked", expected != "")
	// 重新注册说明节点又起来了：把上次掉线被判离线的终端放回空闲，等心跳重新指派。
	// 停用节点不动，避免绕过后台的停用状态。
	if status != "disabled" {
		if _, err := s.db.ExecContext(r.Context(), `UPDATE mgr_automation_robot
SET status = 'idle', last_error = '' WHERE worker_id = ? AND status = 'offline'`, workerID); err != nil {
			s.logger.Error("agent register revive robots", "error", err, "workerId", workerID)
		}
	}
	if expected == "" {
		s.logger.Warn("agent registered without enroll token (open mode)", "worker", code, "ip", clientIP(r))
	}
	s.audit(r.Context(), nil, "automation.worker.register", "automation_worker", strconv.FormatInt(workerID, 10),
		map[string]any{"workerCode": code, "platform": platform, "arch": arch, "version": version, "capacity": capacity},
		nil, map[string]any{"status": status, "tokenChecked": expected != ""}, 0, "节点注册成功（"+code+"）", clientIP(r))
	recordWorkerEvent(r.Context(), s.db, workerID, workerEventOnline, 0, "", map[string]any{
		"workerCode": code, "platform": platform, "arch": arch, "version": version, "capacity": capacity,
		"message": "节点上线（容量 " + strconv.Itoa(capacity) + "）",
	})
	// 节点刚起来就把「等待分配」的账号补进来，不用等人工点「重新分配」。
	if assigned := assignWaitingRobotsToWorker(r.Context(), s.db, s.logger, workerID); assigned > 0 {
		s.logger.Info("worker auto assigned robots on register", "workerId", workerID, "assigned", assigned)
	}
	writeData(w, http.StatusOK, map[string]any{
		"workerId":          workerID,
		"workerCode":        code,
		"status":            status,
		"leaseToken":        lease,
		"leaseExpiresAt":    time.Now().Add(agentLeaseTTLSeconds * time.Second).UTC().Format(time.RFC3339),
		"heartbeatInterval": agentHeartbeatSeconds,
		"serverTime":        time.Now().UTC().Format(time.RFC3339),
	})
}

func validAgentWorkerCode(value string) bool {
	if len(value) < 3 || len(value) > 32 {
		return false
	}
	for _, char := range value {
		switch {
		case char >= 'a' && char <= 'z', char >= 'A' && char <= 'Z', char >= '0' && char <= '9', char == '-', char == '_':
		default:
			return false
		}
	}
	return true
}

// ---- 心跳 ----

type agentHeartbeatRequest struct {
	Version         string `json:"version"`
	CPUPct          int    `json:"cpuPct"`
	MemPct          int    `json:"memPct"`
	ActiveTerminals int    `json:"activeTerminals"`
	ActiveTasks     int    `json:"activeTasks"`
	LastEventSeq    int64  `json:"lastEventSeq"`
	Capacity        int    `json:"capacity"`
	EgressCIDR      string `json:"egressCidr"`
}

func (s *Server) handleAgentHeartbeat(w http.ResponseWriter, r *http.Request, agent agentIdentity) {
	var input agentHeartbeatRequest
	if !decodeJSON(w, r, &input) {
		return
	}
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
	if _, err := s.db.ExecContext(r.Context(), "UPDATE mgr_automation_worker SET "+strings.Join(setClauses, ", ")+" WHERE id = ?", args...); err != nil {
		s.logger.Error("agent heartbeat", "error", err, "workerId", agent.WorkerID)
		writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "心跳写入失败")
		return
	}
	// 节点从离线恢复：把它下面的终端从「离线」状态放回空闲，等待重新调度。
	if agent.Status == "offline" {
		if _, err := s.db.ExecContext(r.Context(), `UPDATE mgr_automation_robot
SET status = 'idle', last_error = '' WHERE worker_id = ? AND status = 'offline'`, agent.WorkerID); err != nil {
			s.logger.Error("agent heartbeat revive robots", "error", err, "workerId", agent.WorkerID)
		}
	}
	var status string
	var pending int
	_ = s.db.QueryRowContext(r.Context(), "SELECT status FROM mgr_automation_worker WHERE id = ?", agent.WorkerID).Scan(&status)
	_ = s.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM mgr_automation_worker_command
WHERE worker_id = ? AND status = 'PENDING'`, agent.WorkerID).Scan(&pending)
	// 这个节点还有空位、全局又有等着上节点的账号，就顺手补分配一次。
	// 必须先分配再取指派清单，新分到的终端才会出现在本次心跳的回包里，节点下一拍就能拉起来。
	if status == "online" {
		if countWaitingRobots(r.Context(), s.db) > 0 {
			if assigned := assignWaitingRobotsToWorker(r.Context(), s.db, s.logger, agent.WorkerID); assigned > 0 {
				s.logger.Info("worker auto assigned robots on heartbeat", "workerId", agent.WorkerID, "assigned", assigned)
			}
		}
	}
	s.resetRobotNetPeriods(r.Context())
	assignments, err := s.queryAgentAssignments(r.Context(), agent.WorkerID)
	if err != nil {
		s.logger.Error("agent heartbeat assignments", "error", err, "workerId", agent.WorkerID)
		assignments = []agentAssignment{}
	}
	// 游戏服看到的是连接来源 IP：心跳这里把它记到机器人上，用来核对出口是否按预期。
	// 真机同样由服务端观察 IP，客户端本身无法伪造该字段。
	if observedIP := clipText(clientIP(r), 64); observedIP != "" {
		if _, err := s.db.ExecContext(r.Context(), `UPDATE mgr_automation_robot
SET public_ip = ?, ip_seen_at = NOW()
WHERE worker_id = ? AND (public_ip <> ? OR ip_seen_at IS NULL)`, observedIP, agent.WorkerID, observedIP); err != nil {
			s.logger.Error("agent heartbeat robot ip", "error", err, "workerId", agent.WorkerID)
		}
	}
	writeData(w, http.StatusOK, map[string]any{
		"status":            status,
		"pendingCommands":   pending,
		"heartbeatInterval": agentHeartbeatSeconds,
		"leaseExpiresAt":    time.Now().Add(agentLeaseTTLSeconds * time.Second).UTC().Format(time.RFC3339),
		"serverTime":        time.Now().UTC().Format(time.RFC3339),
		"assignments":       assignments,
	})
}

// handleAgentOffline 由 agent 在正常退出/被关闭前调用：立刻置离线并清租约，
// 后台列表和调度都不用再等租约过期。被强杀时没有这一步，靠租约超时兜底。
func (s *Server) handleAgentOffline(w http.ResponseWriter, r *http.Request, agent agentIdentity) {
	var input struct {
		Reason string `json:"reason"`
	}
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&input)
	}
	reason := clipText(strings.TrimSpace(input.Reason), 120)
	if reason == "" {
		reason = "节点主动退出"
	}
	var robots int
	_ = s.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM mgr_automation_robot WHERE worker_id = ?", agent.WorkerID).Scan(&robots)
	if _, err := s.db.ExecContext(r.Context(), `UPDATE mgr_automation_worker
SET status = IF(status = 'disabled', 'disabled', 'offline'), lease_token_hash = '', lease_expires_at = NULL
WHERE id = ?`, agent.WorkerID); err != nil {
		s.logger.Error("agent offline", "error", err, "workerId", agent.WorkerID)
		writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "下线状态写入失败")
		return
	}
	if _, err := s.db.ExecContext(r.Context(), `UPDATE mgr_automation_robot
SET status = 'offline', last_error = CONCAT('节点已下线：', ?)
WHERE worker_id = ? AND status NOT IN ('offline', 'stopped')`, reason, agent.WorkerID); err != nil {
		s.logger.Error("agent offline robots", "error", err, "workerId", agent.WorkerID)
	}
	recordWorkerEvent(r.Context(), s.db, agent.WorkerID, workerEventOffline, 0, "", map[string]any{
		"robots":  robots,
		"reason":  reason,
		"message": "节点主动下线（" + reason + "）",
	})
	s.logger.Info("agent offline", "workerId", agent.WorkerID, "node", agent.NodeCode, "reason", reason)
	writeData(w, http.StatusOK, map[string]any{"status": "offline"})
}

// agentAssignment 是节点「应该跑哪些终端」的权威清单：agent 用它拉起/收敛本地进程。
// 密码只在这条带租约的节点通道下发，后台列表与日志都不回显。
type agentAssignment struct {
	RobotID      int64  `json:"robotId"`
	TerminalNo   string `json:"terminalNo"`
	Account      string `json:"account"`
	Password     string `json:"password"`
	Nickname     string `json:"nickname"`
	ClubID       string `json:"clubId"`
	InviteCode   string `json:"inviteCode"`
	GroupName    string `json:"groupName"`
	StrategyName string `json:"strategyName"`
	// 绑定策略的运行参数原文（JSON）：节点据此注入客户端的 XUAN_* 环境变量与热更新。
	StrategyConfig json.RawMessage `json:"strategyConfig,omitempty"`
	BuyinMultiple  int             `json:"buyinMultiple"`
	RoomPi         string          `json:"roomPi"`
	Intelligence   int             `json:"intelligence"`
	DesiredStatus  string          `json:"desiredStatus"`
	Status         string          `json:"status"`
	JoinStatus     string          `json:"joinStatus"`
	Enabled        bool            `json:"enabled"`
	// 真机身份：GPS 由客户端登录后上报；输赢目标与当前净分决定这一局该赢还是该输。
	Gps          string     `json:"gps"`
	ProfitMode   string     `json:"profitMode"`
	ProfitTarget int64      `json:"profitTarget"`
	PeriodStart  *time.Time `json:"periodStart"`
	PeriodEnd    *time.Time `json:"periodEnd"`
	TodayNet     int64      `json:"todayNet"`
	PeriodNet    int64      `json:"periodNet"`
}

// applyStrategyConfig 把机器人绑定的策略合并进指派：策略里非 0 / 非空的值覆盖机器人自身配置，
// 0 / 空表示沿用机器人（或分组）的设置。原文一并下发，节点用它注入客户端环境变量。
func applyStrategyConfig(item *agentAssignment, raw string) {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "{}" || !json.Valid([]byte(raw)) {
		return
	}
	var cfg automationStrategyConfig
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return
	}
	if cfg.BuyinMultiple > 0 {
		item.BuyinMultiple = cfg.BuyinMultiple
	}
	// 其余字段（打牌阈值、跑法节奏）节点不需要理解，原样下发给客户端解析。
	item.StrategyConfig = json.RawMessage(raw)
}

func (s *Server) queryAgentAssignments(ctx context.Context, workerID int64) ([]agentAssignment, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT r.id, r.terminal_no, r.account, r.login_password, r.nickname,
r.club_id, r.invite_code, COALESCE(g.name, ''), COALESCE(st.name, ''),
r.buyin_multiple, r.room_pi, r.gps, r.intelligence, r.desired_status, r.status, r.join_status, r.enabled,
COALESCE(NULLIF(r.profit_mode, ''), COALESCE(g.profit_mode, '')),
COALESCE(NULLIF(r.profit_target, 0), COALESCE(g.profit_target, 0)),
COALESCE(r.period_start, g.period_start), COALESCE(r.period_end, g.period_end),
-- 周计划按「本时段净分」控输赢；其它模式还是今日净分。
CASE WHEN r.profit_mode = 'schedule' THEN r.window_net ELSE r.today_net END,
r.period_net,
CASE WHEN st.status IN ('gray', 'enabled') THEN COALESCE(st.config_json, '') ELSE '' END
FROM mgr_automation_robot r
LEFT JOIN mgr_automation_group g ON g.id = r.group_id
LEFT JOIN mgr_automation_strategy st ON st.id = r.strategy_id
WHERE r.worker_id = ? ORDER BY r.id LIMIT 200`, workerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	key := s.credentialKey()
	items := []agentAssignment{}
	backfillGPS := map[int64]string{}
	for rows.Next() {
		var item agentAssignment
		var enabledRaw int
		var sealedPassword string
		var strategyConfigRaw string
		var periodStart, periodEnd sql.NullTime
		if err := rows.Scan(&item.RobotID, &item.TerminalNo, &item.Account, &sealedPassword, &item.Nickname,
			&item.ClubID, &item.InviteCode, &item.GroupName, &item.StrategyName,
			&item.BuyinMultiple, &item.RoomPi, &item.Gps, &item.Intelligence, &item.DesiredStatus, &item.Status, &item.JoinStatus, &enabledRaw,
			&item.ProfitMode, &item.ProfitTarget, &periodStart, &periodEnd, &item.TodayNet, &item.PeriodNet,
			&strategyConfigRaw); err != nil {
			return nil, err
		}
		applyStrategyConfig(&item, strategyConfigRaw)
		item.Enabled = enabledRaw == 1
		if periodStart.Valid {
			value := periodStart.Time
			item.PeriodStart = &value
		}
		if periodEnd.Valid {
			value := periodEnd.Time
			item.PeriodEnd = &value
		}
		// 老数据没有 GPS：这里补一个并落库，保证同一机器人后续始终用同一个位置。
		if strings.TrimSpace(item.Gps) == "" {
			item.Gps = randomRobotGPS()
			backfillGPS[item.RobotID] = item.Gps
		}
		if sealedPassword != "" {
			// 新数据是明文，直接下发；老数据还是 "v1:" 开头的密文，顺手解一下，解不开就当明文用。
			if strings.HasPrefix(sealedPassword, "v1:") {
				plain, err := security.OpenCredential(key, sealedPassword)
				if err != nil {
					s.logger.Warn("robot password decrypt failed", "robotId", item.RobotID, "error", err)
				} else {
					item.Password = plain
				}
			} else {
				item.Password = sealedPassword
			}
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for robotID, gps := range backfillGPS {
		_, _ = s.db.ExecContext(ctx, "UPDATE mgr_automation_robot SET gps = ? WHERE id = ? AND gps = ''", gps, robotID)
	}
	return items, nil
}

// resetRobotNetPeriods 懒重置净分归属：跨天清 today_net，新周期清 period_net。
// 没有常驻定时任务，心跳（10 秒一次）是最稳的触发点；条件不满足时更新 0 行。
func (s *Server) resetRobotNetPeriods(ctx context.Context) {
	if _, err := s.db.ExecContext(ctx, `UPDATE mgr_automation_robot
SET today_net_date = CURDATE() WHERE today_net_date IS NULL`); err != nil {
		s.logger.Error("init robot daily net date", "error", err)
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE mgr_automation_robot
SET today_net = 0, today_rounds = 0, today_net_date = CURDATE()
WHERE today_net_date <> CURDATE()`); err != nil {
		s.logger.Error("reset robot daily net", "error", err)
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE mgr_automation_robot
SET period_net_start = DATE(period_start) WHERE period_start IS NOT NULL AND period_net_start IS NULL`); err != nil {
		s.logger.Error("init robot period net date", "error", err)
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE mgr_automation_robot
SET period_net = 0, period_net_start = DATE(period_start)
WHERE period_start IS NOT NULL AND period_net_start <> DATE(period_start)`); err != nil {
		s.logger.Error("reset robot period net", "error", err)
	}
}

// ---- 拉取命令 ----

type agentCommandItem struct {
	CommandNo  string          `json:"commandNo"`
	Type       string          `json:"commandType"`
	Label      string          `json:"label"`
	RobotID    *int64          `json:"robotId"`
	TerminalNo string          `json:"terminalNo"`
	Params     json.RawMessage `json:"params"`
	ExpiresAt  *time.Time      `json:"expiresAt"`
	Attempts   int             `json:"attempts"`
}

func (s *Server) handleAgentPullCommands(w http.ResponseWriter, r *http.Request, agent agentIdentity) {
	cursor, _ := strconv.ParseInt(strings.TrimSpace(r.URL.Query().Get("cursor")), 10, 64)
	limit := agentDefaultLimit
	if value, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && value > 0 {
		limit = clampInt(value, 1, agentMaxCommands, agentDefaultLimit)
	}
	// 过期未下发的直接作废，避免节点长时间离线后突然收到一堆旧命令。
	_, _ = s.db.ExecContext(r.Context(), `UPDATE mgr_automation_worker_command SET status = 'EXPIRED', finished_at = NOW()
WHERE worker_id = ? AND status = 'PENDING' AND expires_at IS NOT NULL AND expires_at < NOW()`, agent.WorkerID)

	rows, err := s.db.QueryContext(r.Context(), `SELECT c.id, c.command_no, c.command_type, c.robot_id,
COALESCE(r.terminal_no, ''), c.params_json, c.expires_at, c.attempts
FROM mgr_automation_worker_command c
LEFT JOIN mgr_automation_robot r ON r.id = c.robot_id
WHERE c.worker_id = ? AND c.status = 'PENDING' AND c.id > ?
ORDER BY c.id LIMIT ?`, agent.WorkerID, cursor, limit)
	if err != nil {
		s.logger.Error("agent pull commands", "error", err, "workerId", agent.WorkerID)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取命令失败")
		return
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
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取命令失败")
			return
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
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取命令失败")
		return
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
		if _, err := s.db.ExecContext(r.Context(), `UPDATE mgr_automation_worker_command
SET status = 'DELIVERED', delivered_at = NOW(), attempts = attempts + 1
WHERE id IN (`+placeholders(len(ids))+`) AND status = 'PENDING'`, ids...); err != nil {
			s.logger.Error("agent mark delivered", "error", err, "workerId", agent.WorkerID)
		}
	}
	writeData(w, http.StatusOK, map[string]any{"items": items, "cursor": nextCursor})
}

// ---- 命令回执 ----

type agentAckRequest struct {
	Status       string          `json:"status"`
	Result       json.RawMessage `json:"result"`
	ErrorCode    string          `json:"errorCode"`
	ErrorMessage string          `json:"errorMessage"`
}

func (s *Server) handleAgentAckCommand(w http.ResponseWriter, r *http.Request, agent agentIdentity) {
	commandNo := strings.TrimSpace(r.PathValue("commandNo"))
	if commandNo == "" {
		writeError(w, http.StatusBadRequest, "INVALID_COMMAND", "命令编号不能为空")
		return
	}
	var input agentAckRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	nextStatus := strings.ToUpper(strings.TrimSpace(input.Status))
	if !agentAckStatuses[nextStatus] {
		writeError(w, http.StatusBadRequest, "INVALID_STATUS", "命令状态只能是 ACCEPTED/RUNNING/COMPLETED/REJECTED")
		return
	}
	var commandID int64
	var current string
	var robotID sql.NullInt64
	err := s.db.QueryRowContext(r.Context(), `SELECT id, status, robot_id FROM mgr_automation_worker_command
WHERE worker_id = ? AND command_no = ?`, agent.WorkerID, commandNo).Scan(&commandID, &current, &robotID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "COMMAND_NOT_FOUND", "没有找到这条命令")
		return
	}
	if err != nil {
		s.logger.Error("agent ack lookup", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取命令失败")
		return
	}
	if current == nextStatus {
		writeData(w, http.StatusOK, map[string]any{"commandNo": commandNo, "status": current, "message": "状态已同步"})
		return
	}
	allowed := false
	for _, candidate := range agentAckTransitions[current] {
		if candidate == nextStatus {
			allowed = true
			break
		}
	}
	if !allowed {
		writeError(w, http.StatusConflict, "INVALID_TRANSITION",
			fmt.Sprintf("命令当前状态 %s 不能变成 %s", current, nextStatus))
		return
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
	if _, err := s.db.ExecContext(r.Context(), "UPDATE mgr_automation_worker_command SET "+strings.Join(setClauses, ", ")+" WHERE id = ?", args...); err != nil {
		s.logger.Error("agent ack update", "error", err, "commandNo", commandNo)
		writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "写入命令回执失败")
		return
	}
	// 终端类命令失败时把原因写回机器人，界面上能直接看到卡在哪。
	if nextStatus == "REJECTED" && robotID.Valid {
		message := clipText(strings.TrimSpace(input.ErrorMessage), 255)
		if message == "" {
			message = "节点拒绝了命令"
		}
		_, _ = s.db.ExecContext(r.Context(), "UPDATE mgr_automation_robot SET last_error = ? WHERE id = ?", message, robotID.Int64)
	}
	writeData(w, http.StatusOK, map[string]any{"commandNo": commandNo, "status": nextStatus})
}

// ---- 事件上报 ----

type agentEventItem struct {
	EventID         string          `json:"eventId"`
	TerminalNo      string          `json:"terminalNo"`
	RobotID         int64           `json:"robotId"`
	Type            string          `json:"eventType"`
	Sequence        int64           `json:"sequence"`
	RoomID          int64           `json:"roomId"`
	RoundID         string          `json:"roundId"`
	StrategyVersion int             `json:"strategyVersion"`
	CommandNo       string          `json:"commandNo"`
	OccurredAt      string          `json:"occurredAt"`
	Payload         json.RawMessage `json:"payload"`
}

type agentEventsRequest struct {
	Events []agentEventItem `json:"events"`
}

func (s *Server) handleAgentReportEvents(w http.ResponseWriter, r *http.Request, agent agentIdentity) {
	var input agentEventsRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if len(input.Events) == 0 {
		writeData(w, http.StatusOK, map[string]any{"accepted": 0, "duplicated": 0, "skipped": 0})
		return
	}
	if len(input.Events) > agentMaxBatchEvents {
		writeError(w, http.StatusBadRequest, "BATCH_TOO_LARGE", fmt.Sprintf("单批最多上报 %d 条事件", agentMaxBatchEvents))
		return
	}
	accepted, duplicated, skipped := 0, 0, 0
	maxSeq := int64(0)
	for index, event := range input.Events {
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
		robotID := s.resolveAgentRobotID(r.Context(), agent.WorkerID, event)
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
		result, err := s.db.ExecContext(r.Context(), `INSERT IGNORE INTO mgr_automation_worker_event
(worker_id, event_id, robot_id, terminal_no, event_type, sequence, room_id, round_id,
 strategy_version, command_no, payload_json, occurred_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			agent.WorkerID, eventID, nullableID(robotID), clipText(strings.TrimSpace(event.TerminalNo), 32),
			eventType, event.Sequence, nullableID(event.RoomID), clipText(strings.TrimSpace(event.RoundID), 64),
			event.StrategyVersion, clipText(strings.TrimSpace(event.CommandNo), 40), payload, occurred)
		if err != nil {
			s.logger.Error("agent event insert", "error", err, "workerId", agent.WorkerID, "eventId", eventID)
			writeError(w, http.StatusInternalServerError, "EVENT_ERROR", "写入事件失败")
			return
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
			s.applyAgentEventToRobot(r.Context(), robotID, eventType, event.Payload)
		}
	}
	if _, err := s.db.ExecContext(r.Context(), `UPDATE mgr_automation_worker
SET last_event_seq = GREATEST(last_event_seq, ?), last_event_at = NOW() WHERE id = ?`, maxSeq, agent.WorkerID); err != nil {
		s.logger.Error("agent event seq", "error", err, "workerId", agent.WorkerID)
	}
	writeData(w, http.StatusOK, map[string]any{"accepted": accepted, "duplicated": duplicated, "skipped": skipped})
}

func (s *Server) resolveAgentRobotID(ctx context.Context, workerID int64, event agentEventItem) int64 {
	if event.RobotID > 0 {
		var id int64
		if err := s.db.QueryRowContext(ctx, `SELECT id FROM mgr_automation_robot
WHERE id = ? AND worker_id = ?`, event.RobotID, workerID).Scan(&id); err == nil {
			return id
		}
	}
	terminalNo := strings.TrimSpace(event.TerminalNo)
	if terminalNo == "" {
		return 0
	}
	var id int64
	if err := s.db.QueryRowContext(ctx, `SELECT id FROM mgr_automation_robot
WHERE terminal_no = ? AND worker_id = ?`, terminalNo, workerID).Scan(&id); err == nil {
		return id
	}
	return 0
}

// applyAgentEventToRobot 只做保守的状态收敛：座位/房间/今日与周期净分。
// 其它字段（余额等）以节点上报为准，后台不重复推算。
func (s *Server) applyAgentEventToRobot(ctx context.Context, robotID int64, eventType string, payload json.RawMessage) {
	var data struct {
		SeatNo int   `json:"seatNo"`
		Net    int64 `json:"net"`
		Delta  int64 `json:"delta"`
		RoomID int64 `json:"roomId"`
	}
	if len(payload) > 0 {
		_ = json.Unmarshal(payload, &data)
	}
	switch eventType {
	case "TerminalStarted", "LoginStarted":
		_, _ = s.db.ExecContext(ctx, `UPDATE mgr_automation_robot
SET status = 'entering', last_error = '', last_heartbeat = NOW() WHERE id = ?`, robotID)
	case "LoginFailed":
		message := "登录失败"
		var failure struct {
			Message string `json:"message"`
			Reason  string `json:"reason"`
		}
		if len(payload) > 0 {
			if err := json.Unmarshal(payload, &failure); err == nil {
				switch {
				case strings.TrimSpace(failure.Message) != "":
					message = failure.Message
				case strings.TrimSpace(failure.Reason) != "":
					message = failure.Reason
				}
			}
		}
		_, _ = s.db.ExecContext(ctx, `UPDATE mgr_automation_robot
SET status = 'faulted', last_error = ?, last_heartbeat = NOW() WHERE id = ?`, clipText(message, 255), robotID)
	case "LoginSucceeded":
		_, _ = s.db.ExecContext(ctx, `UPDATE mgr_automation_robot
SET status = 'idle', last_error = '', last_heartbeat = NOW() WHERE id = ?`, robotID)
	case "Waiting":
		_, _ = s.db.ExecContext(ctx, `UPDATE mgr_automation_robot
SET status = IF(status IN ('seated', 'playing'), status, 'idle'), last_heartbeat = NOW() WHERE id = ?`, robotID)
	case "LogoutSucceeded":
		_, _ = s.db.ExecContext(ctx, `UPDATE mgr_automation_robot
SET status = 'idle', room_id = NULL, seat_no = 0, last_heartbeat = NOW() WHERE id = ?`, robotID)
	case "RoomJoined", "PlayerSeated", "GameReady":
		if data.RoomID > 0 {
			_, _ = s.db.ExecContext(ctx, `UPDATE mgr_automation_robot
SET status = 'seated', room_id = ?, seat_no = ?, last_heartbeat = NOW() WHERE id = ?`,
				data.RoomID, data.SeatNo, robotID)
			return
		}
		_, _ = s.db.ExecContext(ctx, "UPDATE mgr_automation_robot SET status = 'seated', last_heartbeat = NOW() WHERE id = ?", robotID)
	case "GameStarted", "TurnStarted":
		_, _ = s.db.ExecContext(ctx, "UPDATE mgr_automation_robot SET status = 'playing', last_heartbeat = NOW() WHERE id = ?", robotID)
	case "GameSettled":
		delta := data.Delta
		if delta == 0 {
			delta = data.Net
		}
		_, _ = s.db.ExecContext(ctx, `UPDATE mgr_automation_robot
SET today_rounds = today_rounds + 1, today_net = today_net + ?, period_net = period_net + ?,
    window_net = window_net + ?, balance = balance + ?, last_heartbeat = NOW()
WHERE id = ?`, delta, delta, delta, delta, robotID)
	case "PlayerUnseated":
		// 房间没结束，只是这一轮结算下桌：保留 room_id（人还在房里），座位号清掉等重新带入。
		_, _ = s.db.ExecContext(ctx, `UPDATE mgr_automation_robot
SET status = 'idle', seat_no = 0, last_heartbeat = NOW() WHERE id = ?`, robotID)
	case "RoomLeft", "RoomClosed":
		_, _ = s.db.ExecContext(ctx, `UPDATE mgr_automation_robot
SET status = 'idle', room_id = NULL, seat_no = 0, last_heartbeat = NOW() WHERE id = ?`, robotID)
	case "TaskFailed":
		message := "节点上报任务失败"
		var failure struct {
			Message string `json:"message"`
		}
		if len(payload) > 0 {
			if err := json.Unmarshal(payload, &failure); err == nil && strings.TrimSpace(failure.Message) != "" {
				message = clipText(strings.TrimSpace(failure.Message), 255)
			}
		}
		_, _ = s.db.ExecContext(ctx, "UPDATE mgr_automation_robot SET last_error = ? WHERE id = ?", message, robotID)
	}
}

// ---- 公共小工具 ----

func nullableID(value int64) any {
	if value <= 0 {
		return nil
	}
	return value
}

func clampInt(value, min, max, fallback int) int {
	if value == 0 {
		return fallback
	}
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func clipText(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	return value[:limit]
}

// enqueueWorkerCommand 把动作写进队列；同一 idemKey 只入队一次（重复点击不会打两次）。
func (s *Server) enqueueWorkerCommand(ctx context.Context, workerID int64, robotID *int64, commandType string,
	params map[string]any, idemKey string, ttl time.Duration, createdBy string) (string, error) {
	if _, ok := agentCommandTypes[commandType]; !ok {
		return "", fmt.Errorf("unsupported command type %s", commandType)
	}
	token, err := security.NewToken()
	if err != nil {
		return "", err
	}
	commandNo := "WC" + token[:18]
	var payload any
	if len(params) > 0 {
		encoded, err := json.Marshal(params)
		if err != nil {
			return "", err
		}
		payload = string(encoded)
	}
	var robot any
	if robotID != nil && *robotID > 0 {
		robot = *robotID
	}
	var idem any
	if strings.TrimSpace(idemKey) != "" {
		idem = clipText(idemKey, 64)
	}
	result, err := s.db.ExecContext(ctx, `INSERT IGNORE INTO mgr_automation_worker_command
(command_no, worker_id, robot_id, command_type, params_json, status, idem_key, expires_at, created_by)
VALUES (?, ?, ?, ?, ?, 'PENDING', ?, DATE_ADD(NOW(), INTERVAL ? SECOND), ?)`,
		commandNo, workerID, robot, commandType, payload, idem, int(ttl.Seconds()), clipText(createdBy, 64))
	if err != nil {
		return "", err
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		var existing string
		if err := s.db.QueryRowContext(ctx, "SELECT command_no FROM mgr_automation_worker_command WHERE idem_key = ?", idem).Scan(&existing); err == nil {
			return existing, nil
		}
	}
	return commandNo, nil
}

// RunAutomationWorkerJanitor 后台巡检：心跳断掉的节点置离线、超时命令回收。
// 与状态相关的判定全用数据库时间（NOW()），避免容器与库的时钟差。
func RunAutomationWorkerJanitor(ctx context.Context, db *sql.DB, logger *slog.Logger) {
	ticker := time.NewTicker(agentJanitorInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			SweepAutomationWorkers(ctx, db, logger)
		}
	}
}

func SweepAutomationWorkers(ctx context.Context, db *sql.DB, logger *slog.Logger) {
	// 先把这一轮要判离线的节点记下来：等下要给各自的日志里补一条「节点离线」。
	offlineIDs := []int64{}
	if rows, err := db.QueryContext(ctx, `SELECT id FROM mgr_automation_worker
WHERE status = 'online' AND (last_heartbeat IS NULL OR last_heartbeat < DATE_SUB(NOW(), INTERVAL ? SECOND))`,
		agentLeaseTTLSeconds); err == nil {
		for rows.Next() {
			var id int64
			if err := rows.Scan(&id); err == nil {
				offlineIDs = append(offlineIDs, id)
			}
		}
		rows.Close()
	}
	result, err := db.ExecContext(ctx, `UPDATE mgr_automation_worker
SET status = 'offline', lease_token_hash = '', lease_expires_at = NULL
WHERE status = 'online' AND (last_heartbeat IS NULL OR last_heartbeat < DATE_SUB(NOW(), INTERVAL ? SECOND))`,
		agentLeaseTTLSeconds)
	if err != nil {
		logger.Error("worker janitor offline", "error", err)
		return
	}
	if affected, _ := result.RowsAffected(); affected > 0 {
		logger.Info("worker janitor marked offline", "count", affected)
		if _, err := db.ExecContext(ctx, `UPDATE mgr_automation_robot r
JOIN mgr_automation_worker w ON w.id = r.worker_id
SET r.status = 'offline', r.last_error = 'Worker 节点心跳中断'
WHERE w.status = 'offline' AND r.status NOT IN ('offline', 'stopped')`); err != nil {
			logger.Error("worker janitor mark robots offline", "error", err)
		}
		for _, id := range offlineIDs {
			var robots int
			_ = db.QueryRowContext(ctx, "SELECT COUNT(*) FROM mgr_automation_robot WHERE worker_id = ?", id).Scan(&robots)
			recordWorkerEvent(ctx, db, id, workerEventOffline, 0, "", map[string]any{
				"robots":  robots,
				"message": "心跳超时，节点判离线（连带 " + strconv.Itoa(robots) + " 个终端掉线）",
			})
		}
	}
	// 离线太久的节点：把它名下的账号收回等待池，好让其它在线节点接走，
	// 否则节点挂了这些机器人就永远卡在「已分配"上。
	type releasedRobot struct {
		workerID   int64
		robotID    int64
		account    string
		terminalNo string
	}
	released := []releasedRobot{}
	if rows, err := db.QueryContext(ctx, `SELECT r.worker_id, r.id, r.account, r.terminal_no
FROM mgr_automation_robot r JOIN mgr_automation_worker w ON w.id = r.worker_id
WHERE w.status = 'offline'
  AND (w.last_heartbeat IS NULL OR w.last_heartbeat < DATE_SUB(NOW(), INTERVAL ? MINUTE))
  AND r.join_status = 'joined' AND r.enabled = 1`, agentOfflineReleaseMinutes); err == nil {
		for rows.Next() {
			var item releasedRobot
			if err := rows.Scan(&item.workerID, &item.robotID, &item.account, &item.terminalNo); err == nil {
				released = append(released, item)
			}
		}
		rows.Close()
	}
	for _, item := range released {
		if _, err := db.ExecContext(ctx, `UPDATE mgr_automation_robot
SET worker_id = NULL, status = 'idle', room_id = NULL, seat_no = 0, last_heartbeat = NOW()
WHERE id = ? AND worker_id = ?`, item.robotID, item.workerID); err != nil {
			logger.Error("worker janitor release robot", "error", err, "robotId", item.robotID)
			continue
		}
		recordWorkerEvent(ctx, db, item.workerID, workerEventRobotReleased, item.robotID, item.terminalNo, map[string]any{
			"account":    item.account,
			"terminalNo": item.terminalNo,
			"message":    "节点离线过久，收回账号 " + item.account + "（回到等待分配）",
		})
	}
	if len(released) > 0 {
		logger.Info("worker janitor released robots of long offline worker", "count", len(released))
		refreshWorkerLoad(ctx, db)
	}
	// 过了有效期还没下发的直接作废。
	if _, err := db.ExecContext(ctx, `UPDATE mgr_automation_worker_command
SET status = 'EXPIRED', finished_at = NOW()
WHERE status IN ('PENDING', 'DELIVERED') AND expires_at IS NOT NULL AND expires_at < NOW()`); err != nil {
		logger.Error("worker janitor expire commands", "error", err)
	}
	// 已下发但两分钟没回执：退回队列重发（最多 3 次）。
	if _, err := db.ExecContext(ctx, `UPDATE mgr_automation_worker_command
SET status = 'PENDING', delivered_at = NULL
WHERE status = 'DELIVERED' AND delivered_at < DATE_SUB(NOW(), INTERVAL 120 SECOND) AND attempts < 3`); err != nil {
		logger.Error("worker janitor requeue commands", "error", err)
	}
	// 重发满 3 次仍无回执：作废，避免无限重试。
	if _, err := db.ExecContext(ctx, `UPDATE mgr_automation_worker_command
SET status = 'EXPIRED', finished_at = NOW()
WHERE status = 'DELIVERED' AND attempts >= 3 AND delivered_at < DATE_SUB(NOW(), INTERVAL 120 SECOND)`); err != nil {
		logger.Error("worker janitor expire stuck commands", "error", err)
	}
	// 先按周计划收敛（该排空的排空、该让出的让出、该恢复的解除挂牌），再统一分配。
	SweepAutomationSchedules(ctx, db, logger)
	// 兜底分配：新投放的机器人、刚空出来的容量，都在这里自动落位。
	if assigned := assignWaitingRobots(ctx, db, logger); assigned > 0 {
		logger.Info("worker janitor assigned waiting robots", "assigned", assigned)
	}
}

// robotActionCommands 把后台的终端动作映射成节点命令（固定枚举，不给「任意命令」的口子）。
var robotActionCommands = map[string]string{
	"start":   "START_TERMINAL",
	"restart": "START_TERMINAL",
	"enable":  "START_TERMINAL",
	"pause":   "PAUSE_TERMINAL",
	"drain":   "DRAIN_TERMINAL",
	"stop":    "STOP_TERMINAL",
	"disable": "STOP_TERMINAL",
	"release": "STOP_TERMINAL",
}

func (s *Server) automationRobotWorkerID(ctx context.Context, robotID int64) int64 {
	var workerID sql.NullInt64
	if err := s.db.QueryRowContext(ctx, "SELECT worker_id FROM mgr_automation_robot WHERE id = ?", robotID).Scan(&workerID); err != nil {
		return 0
	}
	if !workerID.Valid {
		return 0
	}
	return workerID.Int64
}

// enqueueRobotActionCommand 幂等键带 30 秒时间片：连点两次只发一条，隔一会儿再点会重新下发。
func (s *Server) enqueueRobotActionCommand(ctx context.Context, workerID, robotID int64, action string) {
	commandType, ok := robotActionCommands[action]
	if !ok {
		return
	}
	var terminalNo string
	_ = s.db.QueryRowContext(ctx, "SELECT terminal_no FROM mgr_automation_robot WHERE id = ?", robotID).Scan(&terminalNo)
	idem := fmt.Sprintf("robot:%d:%s:%d", robotID, action, time.Now().Unix()/30)
	commandNo, err := s.enqueueWorkerCommand(ctx, workerID, &robotID, commandType,
		map[string]any{"action": action, "terminalNo": terminalNo}, idem, 10*time.Minute, "robot-action")
	if err != nil {
		s.logger.Error("enqueue robot action command", "error", err, "workerId", workerID, "robotId", robotID, "action", action)
		return
	}
	s.logger.Info("robot action command enqueued", "commandNo", commandNo, "workerId", workerID, "robotId", robotID, "commandType", commandType)
}
