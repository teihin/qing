package api

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math/rand/v2"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"xuanmanager/internal/security"
)

type automationRobotItem struct {
	ID                int64      `json:"id"`
	TerminalNo        string     `json:"terminalNo"`
	Account           string     `json:"account"`
	Nickname          string     `json:"nickname"`
	Avatar            int        `json:"avatar"`
	ClubID            string     `json:"clubId"`
	ClubName          string     `json:"clubName"`
	GroupID           *int64     `json:"groupId"`
	GroupName         string     `json:"groupName"`
	StrategyID        *int64     `json:"strategyId"`
	StrategyName      string     `json:"strategyName"`
	WorkerID          *int64     `json:"workerId"`
	WorkerName        string     `json:"workerName"`
	EgressIP          string     `json:"egressIp"`
	Status            string     `json:"status"`
	DesiredStatus     string     `json:"desiredStatus"`
	RoomID            *int64     `json:"roomId"`
	SeatNo            int        `json:"seatNo"`
	Buyin             int        `json:"buyin"`
	BuyinMultiple     int        `json:"buyinMultiple"`
	RoomPi            string     `json:"roomPi"`
	Gps               string     `json:"gps"`
	PublicIP          string     `json:"publicIp"`
	IPSeenAt          *time.Time `json:"ipSeenAt"`
	Intelligence      int        `json:"intelligence"`
	GroupIntelligence int        `json:"groupIntelligence"`
	ProfitMode        string     `json:"profitMode"`
	ProfitTarget      int64      `json:"profitTarget"`
	PeriodStart       *time.Time `json:"periodStart"`
	PeriodEnd         *time.Time `json:"periodEnd"`
	PeriodNet         int64      `json:"periodNet"`
	ProfitSchedule    string     `json:"profitSchedule"`
	ScheduleState     string     `json:"scheduleState"`
	WindowNet         int64      `json:"windowNet"`
	Enabled           bool       `json:"enabled"`
	InviteCode        string     `json:"inviteCode"`
	JoinStatus        string     `json:"joinStatus"`
	JoinedAt          *time.Time `json:"joinedAt"`
	ActivatedAt       *time.Time `json:"activatedAt"`
	ActivationError   string     `json:"activationError"`
	GroupProfitMode   string     `json:"groupProfitMode"`
	GroupProfitTarget int64      `json:"groupProfitTarget"`
	GroupPeriodStart  *time.Time `json:"groupPeriodStart"`
	GroupPeriodEnd    *time.Time `json:"groupPeriodEnd"`
	Balance           int64      `json:"balance"`
	TodayRounds       int        `json:"todayRounds"`
	TodayNet          int64      `json:"todayNet"`
	LastHeartbeat     *time.Time `json:"lastHeartbeat"`
	LastError         string     `json:"lastError"`
	RiskFlag          bool       `json:"riskFlag"`
	IsDemo            bool       `json:"isDemo"`
	UpdatedAt         time.Time  `json:"updatedAt"`
	PasswordSet       bool       `json:"passwordSet"`
	PasswordUpdatedAt *time.Time `json:"passwordUpdatedAt"`
}

const automationRobotSelect = `SELECT
r.id, r.terminal_no, r.account, r.nickname, r.avatar, r.club_id, COALESCE(c.name, ''),
r.group_id, COALESCE(g.name, ''), r.strategy_id, COALESCE(st.name, ''),
r.worker_id, COALESCE(w.node_code, ''), r.egress_ip, r.status, r.desired_status,
r.room_id, r.seat_no, r.buyin, r.buyin_multiple, r.room_pi,
r.gps, r.public_ip, r.ip_seen_at,
r.intelligence, COALESCE(g.default_intelligence, 0), r.profit_mode, r.profit_target,
r.period_start, r.period_end, r.period_net, r.profit_schedule, r.schedule_state, r.window_net,
r.enabled, r.invite_code, r.join_status, r.joined_at, r.activated_at, r.activation_error,
COALESCE(g.profit_mode, ''), COALESCE(g.profit_target, 0), g.period_start, g.period_end,
r.balance, r.today_rounds, r.today_net,
r.last_heartbeat, r.last_error, r.risk_flag, r.is_demo, r.updated_at,
r.login_password <> '', r.password_updated_at
FROM mgr_automation_robot r
LEFT JOIN mgr_automation_club c ON c.club_id = r.club_id
LEFT JOIN mgr_automation_group g ON g.id = r.group_id
LEFT JOIN mgr_automation_strategy st ON st.id = r.strategy_id
LEFT JOIN mgr_automation_worker w ON w.id = r.worker_id`

func scanAutomationRobot(row rowScanner) (automationRobotItem, error) {
	var item automationRobotItem
	var groupID, strategyID, workerID, roomID sql.NullInt64
	var heartbeat, joinedAt, activatedAt, periodStart, periodEnd, groupPeriodStart, groupPeriodEnd sql.NullTime
	var riskFlag, isDemo, enabled, passwordSet int
	var passwordUpdatedAt, ipSeenAt sql.NullTime
	err := row.Scan(&item.ID, &item.TerminalNo, &item.Account, &item.Nickname, &item.Avatar, &item.ClubID, &item.ClubName,
		&groupID, &item.GroupName, &strategyID, &item.StrategyName,
		&workerID, &item.WorkerName, &item.EgressIP, &item.Status, &item.DesiredStatus,
		&roomID, &item.SeatNo, &item.Buyin, &item.BuyinMultiple, &item.RoomPi,
		&item.Gps, &item.PublicIP, &ipSeenAt,
		&item.Intelligence, &item.GroupIntelligence, &item.ProfitMode, &item.ProfitTarget,
		&periodStart, &periodEnd, &item.PeriodNet, &item.ProfitSchedule, &item.ScheduleState, &item.WindowNet,
		&enabled, &item.InviteCode, &item.JoinStatus, &joinedAt, &activatedAt, &item.ActivationError,
		&item.GroupProfitMode, &item.GroupProfitTarget, &groupPeriodStart, &groupPeriodEnd,
		&item.Balance, &item.TodayRounds, &item.TodayNet,
		&heartbeat, &item.LastError, &riskFlag, &isDemo, &item.UpdatedAt,
		&passwordSet, &passwordUpdatedAt)
	if err != nil {
		return automationRobotItem{}, err
	}
	if periodStart.Valid {
		value := periodStart.Time
		item.PeriodStart = &value
	}
	if periodEnd.Valid {
		value := periodEnd.Time
		item.PeriodEnd = &value
	}
	if joinedAt.Valid {
		value := joinedAt.Time
		item.JoinedAt = &value
	}
	if activatedAt.Valid {
		value := activatedAt.Time
		item.ActivatedAt = &value
	}
	if groupPeriodStart.Valid {
		value := groupPeriodStart.Time
		item.GroupPeriodStart = &value
	}
	if groupPeriodEnd.Valid {
		value := groupPeriodEnd.Time
		item.GroupPeriodEnd = &value
	}
	if ipSeenAt.Valid {
		value := ipSeenAt.Time
		item.IPSeenAt = &value
	}
	item.Enabled = enabled == 1
	if groupID.Valid {
		value := groupID.Int64
		item.GroupID = &value
	}
	if strategyID.Valid {
		value := strategyID.Int64
		item.StrategyID = &value
	}
	if workerID.Valid {
		value := workerID.Int64
		item.WorkerID = &value
	}
	if roomID.Valid {
		value := roomID.Int64
		item.RoomID = &value
	}
	if heartbeat.Valid {
		item.LastHeartbeat = &heartbeat.Time
	}
	item.RiskFlag = riskFlag == 1
	item.IsDemo = isDemo == 1
	item.PasswordSet = passwordSet == 1
	if passwordUpdatedAt.Valid {
		item.PasswordUpdatedAt = &passwordUpdatedAt.Time
	}
	return item, nil
}

func (s *Server) handleListAutomationRobots(w http.ResponseWriter, r *http.Request, p principal) {
	scope, err := s.automationScope(r.Context(), p)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取数据范围失败")
		return
	}
	page, size := pageParams(r)
	keyword := strings.TrimSpace(r.URL.Query().Get("keyword"))
	clubID := strings.TrimSpace(r.URL.Query().Get("clubId"))
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	enabled := strings.TrimSpace(r.URL.Query().Get("enabled"))
	assigned := strings.TrimSpace(r.URL.Query().Get("assigned"))
	groupID, _ := strconv.ParseInt(r.URL.Query().Get("groupId"), 10, 64)
	if clubID != "" && !s.automationClubOrError(w, r, scope, clubID) {
		return
	}
	conditions := []string{}
	args := []any{}
	switch {
	case clubID != "":
		conditions = append(conditions, "r.club_id = ?")
		args = append(args, clubID)
	case assigned == "0":
		conditions = append(conditions, "r.club_id = ''")
	case assigned == "1":
		conditions = append(conditions, "r.club_id <> ''")
		scopeSQL, scopeArgs := scopeClause("r.club_id", scope)
		conditions = append(conditions, scopeSQL)
		args = append(args, scopeArgs...)
	case scope.All:
		conditions = append(conditions, "1 = 1")
	default:
		scopeSQL, scopeArgs := scopeClause("r.club_id", scope)
		conditions = append(conditions, "(r.club_id = '' OR "+scopeSQL+")")
		args = append(args, scopeArgs...)
	}
	if keyword != "" {
		conditions = append(conditions, "(r.terminal_no LIKE ? OR r.account LIKE ? OR r.nickname LIKE ? OR CAST(r.room_id AS CHAR) LIKE ?)")
		like := "%" + keyword + "%"
		args = append(args, like, like, like, like)
	}
	if status != "" {
		conditions = append(conditions, "r.status = ?")
		args = append(args, status)
	}
	if enabled == "1" || enabled == "0" {
		conditions = append(conditions, "r.enabled = ?")
		args = append(args, enabled)
	}
	if groupID > 0 {
		conditions = append(conditions, "r.group_id = ?")
		args = append(args, groupID)
	}
	where := strings.Join(conditions, " AND ")
	var total int64
	if err := s.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM mgr_automation_robot r WHERE "+where, args...).Scan(&total); err != nil {
		s.logger.Error("count automation robots", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取终端数量失败")
		return
	}
	queryArgs := append(append([]any{}, args...), size, (page-1)*size)
	rows, err := s.db.QueryContext(r.Context(), automationRobotSelect+` WHERE `+where+` ORDER BY FIELD(r.status, 'faulted', 'playing', 'seated', 'paused', 'idle', 'created', 'offline', 'stopped'), r.id LIMIT ? OFFSET ?`, queryArgs...)
	if err != nil {
		s.logger.Error("list automation robots", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取终端失败")
		return
	}
	defer rows.Close()
	items := []automationRobotItem{}
	for rows.Next() {
		item, err := scanAutomationRobot(rows)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取终端数据失败")
			return
		}
		items = append(items, item)
	}
	writeData(w, http.StatusOK, map[string]any{"items": items, "page": page, "pageSize": size, "total": total})
}

func (s *Server) handleGetAutomationRobot(w http.ResponseWriter, r *http.Request, p principal) {
	id, ok := parsePositivePathID(w, r, "id", "终端 ID 不正确")
	if !ok {
		return
	}
	scope, err := s.automationScope(r.Context(), p)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取数据范围失败")
		return
	}
	row := s.db.QueryRowContext(r.Context(), automationRobotSelect+" WHERE r.id = ?", id)
	robot, err := scanAutomationRobot(row)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "ROBOT_NOT_FOUND", "没有找到这个机器人终端")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取终端失败")
		return
	}
	if !s.automationClubOrError(w, r, scope, robot.ClubID) {
		return
	}
	var config string
	if robot.StrategyID != nil {
		_ = s.db.QueryRowContext(r.Context(), "SELECT COALESCE(config_json, '{}') FROM mgr_automation_strategy WHERE id = ?", *robot.StrategyID).Scan(&config)
	}
	sessions, _ := s.queryAutomationSessions(r, scope, robot.ClubID, id, "", 20, 0)
	logs, _ := s.queryAutomationRobotLogs(r.Context(), id)
	writeData(w, http.StatusOK, map[string]any{
		"robot": robot, "strategyConfig": config, "sessions": sessions, "logs": logs,
	})
}

type automationRobotCreateRequest struct {
	Account       string `json:"account"`
	Nickname      string `json:"nickname"`
	ClubID        string `json:"clubId"`
	GroupID       int64  `json:"groupId"`
	StrategyID    int64  `json:"strategyId"`
	WorkerID      int64  `json:"workerId"`
	EgressIP      string `json:"egressIp"`
	BuyinMultiple int    `json:"buyinMultiple"`
	Intelligence  int    `json:"intelligence"`
	ProfitMode    string `json:"profitMode"`
	ProfitTarget  int64  `json:"profitTarget"`
	PeriodStart   string `json:"periodStart"`
	PeriodEnd     string `json:"periodEnd"`
	InviteCode    string `json:"inviteCode"`
	Enabled       *bool  `json:"enabled"`
}

// 默认带入按房间最低带入的倍数配置，避免写死固定金额。
func validRobotBuyinMultiple(value int) bool {
	return value >= 1 && value <= 10
}

// normalizeRoomPi 把「1/3」「底皮1/3」统一成房间列表下发的写法「底皮1/3」。
func normalizeRoomPi(raw string) (string, bool) {
	text := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(raw), "底皮"))
	parts := strings.SplitN(text, "/", 2)
	if len(parts) != 2 {
		return "", false
	}
	left, leftErr := strconv.ParseFloat(strings.TrimSpace(parts[0]), 64)
	right, rightErr := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
	if leftErr != nil || rightErr != nil || left <= 0 || right <= 0 {
		return "", false
	}
	return "底皮" + strconv.FormatFloat(left, 'f', -1, 64) + "/" + strconv.FormatFloat(right, 'f', -1, 64), true
}

// normalizeRoomPiList 校验机器人只进的底皮档位：逗号分隔，空串表示不限。
func normalizeRoomPiList(raw string) (string, string) {
	seen := map[string]bool{}
	values := []string{}
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		value, ok := normalizeRoomPi(part)
		if !ok {
			return "", "底皮档位格式不正确，应写成「底皮1/3」这样的格式"
		}
		if seen[value] {
			continue
		}
		seen[value] = true
		values = append(values, value)
	}
	if len(values) > 8 {
		return "", "最多只能选择 8 个底皮档位"
	}
	return strings.Join(values, ","), ""
}

func (s *Server) automationRobotInviteCode(ctx context.Context, clubID, provided string) (string, string) {
	provided = strings.TrimSpace(provided)
	if provided == "" {
		if err := s.db.QueryRowContext(ctx, "SELECT invite_code FROM mgr_automation_club WHERE club_id = ?", clubID).Scan(&provided); err != nil {
			return "", "读取俱乐部邀请码失败"
		}
	}
	provided = strings.TrimSpace(provided)
	if provided == "" {
		return "", "请先在俱乐部投放配置里填写邀请码，机器人才能自动加入俱乐部"
	}
	if !isSixDigitCode(provided) {
		return "", "邀请码必须是 6 位数字"
	}
	return provided, ""
}

func (s *Server) ensureAutomationRobotQuota(ctx context.Context, clubID string, adding int) string {
	var quota, used int
	if err := s.db.QueryRowContext(ctx, `SELECT c.robot_quota,
(SELECT COUNT(*) FROM mgr_automation_robot r WHERE r.club_id = c.club_id)
FROM mgr_automation_club c WHERE c.club_id = ?`, clubID).Scan(&quota, &used); err != nil {
		return "读取俱乐部投放数量失败"
	}
	if quota > 0 && used+adding > quota {
		return fmt.Sprintf("俱乐部投放数量为 %d 台，当前已有 %d 台，本次最多还能添加 %d 台", quota, used, max(0, quota-used))
	}
	return ""
}

func (s *Server) handleCreateAutomationRobot(w http.ResponseWriter, r *http.Request, p principal) {
	var input automationRobotCreateRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Account = strings.TrimSpace(input.Account)
	input.Nickname = strings.TrimSpace(input.Nickname)
	input.EgressIP = strings.TrimSpace(input.EgressIP)
	scope, err := s.automationScope(r.Context(), p)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取数据范围失败")
		return
	}
	if input.ClubID != "" && !s.automationClubOrError(w, r, scope, input.ClubID) {
		return
	}
	if len(input.Account) < 4 || len(input.Account) > 64 {
		writeError(w, http.StatusBadRequest, "INVALID_ACCOUNT", "游戏账号必须为 4 到 64 个字符")
		return
	}
	if input.Nickname == "" || len([]rune(input.Nickname)) > 32 {
		writeError(w, http.StatusBadRequest, "INVALID_NICKNAME", "终端昵称不能为空且不能超过 32 个字符")
		return
	}
	if !validRobotBuyinMultiple(input.BuyinMultiple) {
		writeError(w, http.StatusBadRequest, "INVALID_BUYIN_MULTIPLE", "默认带入倍数必须在 1 到 10 之间，1 表示房间最低带入")
		return
	}
	if input.EgressIP != "" && net.ParseIP(input.EgressIP) == nil {
		writeError(w, http.StatusBadRequest, "INVALID_IP", "出口 IP 格式不正确")
		return
	}
	if input.Intelligence < 0 || input.Intelligence > 100 {
		writeError(w, http.StatusBadRequest, "INVALID_INTELLIGENCE", "机器人智力必须在 0 到 100 之间，0 表示跟随分组默认值")
		return
	}
	periodStart, periodEnd, profitMessage := validateAutomationProfit(input.ProfitMode, input.ProfitTarget, input.PeriodStart, input.PeriodEnd, true)
	if profitMessage != "" {
		writeError(w, http.StatusBadRequest, "INVALID_PROFIT_TARGET", profitMessage)
		return
	}
	inviteCode := ""
	joinStatus := "unassigned"
	var joinedAt any
	if input.ClubID != "" {
		var inviteMessage string
		inviteCode, inviteMessage = s.automationRobotInviteCode(r.Context(), input.ClubID, input.InviteCode)
		if inviteMessage != "" {
			writeError(w, http.StatusBadRequest, "INVALID_INVITE_CODE", inviteMessage)
			return
		}
		if message := s.ensureAutomationRobotQuota(r.Context(), input.ClubID, 1); message != "" {
			writeError(w, http.StatusConflict, "QUOTA_EXCEEDED", message)
			return
		}
		joinStatus = "joined"
		joinedAt = time.Now()
	}
	if input.GroupID > 0 {
		var exists int
		if err := s.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM mgr_automation_group WHERE id = ?", input.GroupID).Scan(&exists); err != nil || exists == 0 {
			writeError(w, http.StatusBadRequest, "GROUP_NOT_FOUND", "选择的机器人分组不存在")
			return
		}
	}
	if input.StrategyID > 0 {
		var exists int
		if err := s.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM mgr_automation_strategy WHERE id = ?", input.StrategyID).Scan(&exists); err != nil || exists == 0 {
			writeError(w, http.StatusBadRequest, "STRATEGY_NOT_FOUND", "选择的策略不存在")
			return
		}
	}
	enabled := input.Enabled == nil || *input.Enabled
	robotStatus := "idle"
	if !enabled {
		robotStatus = "stopped"
	}
	terminalNo := "T" + strconv.FormatInt(time.Now().UnixNano(), 10)
	result, err := s.db.ExecContext(r.Context(), `INSERT INTO mgr_automation_robot
(terminal_no, account, nickname, club_id, group_id, strategy_id, worker_id, egress_ip,
buyin_multiple, gps, intelligence, profit_mode, profit_target, period_start, period_end,
enabled, invite_code, join_status, joined_at,
status, desired_status, last_heartbeat, is_demo)
VALUES (?, ?, ?, ?, NULLIF(?, 0), NULLIF(?, 0), NULLIF(?, 0), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'stopped', NOW(), 0)`,
		terminalNo, input.Account, input.Nickname, input.ClubID, input.GroupID, input.StrategyID, input.WorkerID, input.EgressIP,
		input.BuyinMultiple, randomRobotGPS(), input.Intelligence, input.ProfitMode, input.ProfitTarget, nullableTime(periodStart), nullableTime(periodEnd),
		enabled, inviteCode, joinStatus, joinedAt, robotStatus)
	if err != nil {
		if duplicateKey(err) {
			writeError(w, http.StatusConflict, "ROBOT_EXISTS", "这个游戏账号已经登记为机器人终端")
			return
		}
		s.logger.Error("create automation robot", "error", err)
		writeError(w, http.StatusInternalServerError, "CREATE_ERROR", "新增机器人终端失败")
		return
	}
	id, _ := result.LastInsertId()
	message := "机器人账号已创建，可到投放管理选择投放"
	if joinStatus == "joined" {
		message = "机器人终端已创建，并通过邀请码 " + inviteCode + " 加入俱乐部"
	}
	s.audit(r.Context(), &p, "automation.robot.create", "automation_robot", strconv.FormatInt(id, 10), input, nil, input, 0, message, clientIP(r))
	writeData(w, http.StatusCreated, map[string]any{"id": id, "terminalNo": terminalNo, "message": message})
}

type automationRobotBulkRequest struct {
	GroupID       int64  `json:"groupId"`
	StrategyID    int64  `json:"strategyId"`
	Prefix        string `json:"prefix"`
	Count         int    `json:"count"`
	StartNo       int    `json:"startNo"`
	Password      string `json:"password"`
	BuyinMultiple int    `json:"buyinMultiple"`
	Intelligence  int    `json:"intelligence"`
	ProfitMode    string `json:"profitMode"`
	ProfitTarget  int64  `json:"profitTarget"`
	PeriodStart   string `json:"periodStart"`
	PeriodEnd     string `json:"periodEnd"`
	Enabled       *bool  `json:"enabled"`
}

// 机器人账号直接作为游戏登录名：前缀 + 三位序号，总长必须落在 6–16 位字母数字内。
func validRobotPrefix(value string) bool {
	if len(value) < 3 || len(value) > 13 {
		return false
	}
	for _, char := range value {
		if !(char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9') {
			return false
		}
	}
	return true
}

var (
	robotNicknameSurnames = []string{"林", "江", "沈", "顾", "苏", "陆", "叶", "秦", "楚", "唐", "宋", "韩", "萧", "云", "白", "墨", "洛", "燕", "柳", "温", "谢", "裴", "卫", "商"}
	robotNicknameMiddles  = []string{"子", "一", "少", "之", "无", "长", "若", "初", "明", "清", "远", "青", "空", "半", "寒", "孤", "野", "流", "听", "望"}
	robotNicknameLasts    = []string{"轩", "尘", "风", "月", "川", "山", "舟", "客", "君", "生", "影", "歌", "城", "野", "云", "海", "江", "天", "星", "霜", "雪", "松", "竹", "兰"}
)

func randomRobotNickname() string {
	return robotNicknameSurnames[rand.IntN(len(robotNicknameSurnames))] +
		robotNicknameMiddles[rand.IntN(len(robotNicknameMiddles))] +
		robotNicknameLasts[rand.IntN(len(robotNicknameLasts))]
}

func randomRobotAvatar() int {
	return rand.IntN(100) + 1
}

// randomRobotGPS 按老自动化的取值区间（成都一带）生成「纬度,经度」，
// 与真机上报格式一致；同一个机器人固定不变，避免每次登录都漂移。
func randomRobotGPS() string {
	lat := 30.385972 + rand.Float64()*(30.922928-30.385972)
	lng := 104.047018 + rand.Float64()*(104.213168-104.047018)
	return fmt.Sprintf("%.6f,%.6f", lat, lng)
}

// 批量创建真实游戏账号：昵称和头像随机生成，密码只写入游戏库的 MD5 字段，
// 接口响应、审计和日志都不记录明文。
func (s *Server) handleBulkCreateAutomationRobots(w http.ResponseWriter, r *http.Request, p principal) {
	var input automationRobotBulkRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Prefix = strings.TrimSpace(input.Prefix)
	if !validRobotPrefix(input.Prefix) {
		writeError(w, http.StatusBadRequest, "INVALID_PREFIX", "账号前缀必须为 3 到 13 位英文字母或数字，生成后的账号总长为 6 到 16 位")
		return
	}
	if input.Count < 1 || input.Count > 50 {
		writeError(w, http.StatusBadRequest, "INVALID_COUNT", "批量创建数量必须在 1 到 50 个之间")
		return
	}
	if input.StartNo < 1 || input.StartNo+input.Count-1 > 999 {
		writeError(w, http.StatusBadRequest, "INVALID_START_NO", "起始序号必须在 1 到 999 之间，且起始序号加数量不能超过 999")
		return
	}
	if strings.TrimSpace(input.Password) != input.Password || len([]rune(input.Password)) < 6 || len([]rune(input.Password)) > 32 {
		writeError(w, http.StatusBadRequest, "INVALID_PASSWORD", "登录密码必须为 6 到 32 个字符，首尾不能包含空格")
		return
	}
	if !validRobotBuyinMultiple(input.BuyinMultiple) {
		writeError(w, http.StatusBadRequest, "INVALID_BUYIN_MULTIPLE", "默认带入倍数必须在 1 到 10 之间，1 表示房间最低带入")
		return
	}
	if input.Intelligence < 0 || input.Intelligence > 100 {
		writeError(w, http.StatusBadRequest, "INVALID_INTELLIGENCE", "机器人智力必须在 0 到 100 之间，0 表示跟随分组默认值")
		return
	}
	periodStart, periodEnd, profitMessage := validateAutomationProfit(input.ProfitMode, input.ProfitTarget, input.PeriodStart, input.PeriodEnd, true)
	if profitMessage != "" {
		writeError(w, http.StatusBadRequest, "INVALID_PROFIT_TARGET", profitMessage)
		return
	}
	if input.GroupID > 0 {
		var exists int
		if err := s.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM mgr_automation_group WHERE id = ?", input.GroupID).Scan(&exists); err != nil || exists == 0 {
			writeError(w, http.StatusBadRequest, "GROUP_NOT_FOUND", "选择的机器人分组不存在")
			return
		}
	}
	if input.StrategyID > 0 {
		var exists int
		if err := s.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM mgr_automation_strategy WHERE id = ?", input.StrategyID).Scan(&exists); err != nil || exists == 0 {
			writeError(w, http.StatusBadRequest, "STRATEGY_NOT_FOUND", "选择的策略不存在")
			return
		}
	}
	enabled := input.Enabled == nil || *input.Enabled
	robotStatus := "idle"
	if !enabled {
		robotStatus = "stopped"
	}

	// 密码只存 AES-256-GCM 密文，心跳下发时由后端解出明文；游戏库照旧只写 MD5。
	sealedPassword, err := security.SealCredential(s.credentialKey(), input.Password)
	if err != nil {
		s.logger.Error("seal robot login password", "error", err)
		writeError(w, http.StatusInternalServerError, "SEAL_ERROR", "加密登录密码失败")
		return
	}

	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "TX_ERROR", "开始事务失败")
		return
	}
	defer tx.Rollback()

	created := make([]map[string]any, 0, input.Count)
	ids := make([]int64, 0, input.Count)
	registrations := make([]int64, 0, input.Count)
	avatars := make([]string, 0, input.Count)
	usedNicknames := make(map[string]struct{}, input.Count)
	for index := 0; index < input.Count; index++ {
		account := input.Prefix + fmt.Sprintf("%03d", input.StartNo+index)
		terminalNo := "T" + account
		existing, err := gameLoginNameExists(r.Context(), tx, account)
		if err != nil {
			s.logger.Error("check robot game account", "error", err, "account", account)
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "检查游戏账号失败")
			return
		}
		if existing {
			writeError(w, http.StatusConflict, "ACCOUNT_EXISTS", "游戏账号 "+account+" 已存在，请调整前缀或起始序号")
			return
		}
		nickname := ""
		for attempt := 0; attempt < 40 && nickname == ""; attempt++ {
			candidate := randomRobotNickname()
			if _, used := usedNicknames[candidate]; used {
				continue
			}
			taken, err := gameNicknameExists(r.Context(), tx, candidate)
			if err != nil {
				s.logger.Error("check robot nickname", "error", err, "nickname", candidate)
				writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "检查机器人昵称失败")
				return
			}
			if !taken {
				nickname = candidate
			}
		}
		if nickname == "" {
			writeError(w, http.StatusConflict, "NICKNAME_GENERATE_FAILED", "随机昵称重复次数过多，请减少本次创建数量后重试")
			return
		}
		usedNicknames[nickname] = struct{}{}
		avatar := randomRobotAvatar()
		registration, err := tx.ExecContext(r.Context(), `INSERT INTO kbedm.third_marketing_info
(date, time, upper_guuid, upper2_guuid, upper3_guuid, player_wxid, player_wxname, player_wxpwd, status, level,
 anti_theft_on, device_id, device_platform, device_version, device_bound_at, binding_revision)
VALUES (CURDATE(), CURTIME(), '', '', '', ?, ?, MD5(?), '', 0, 0, '', NULL, 1, NULL, 0)`,
			account, nickname, input.Password)
		if err != nil {
			if isDuplicateKey(err) {
				writeError(w, http.StatusConflict, "ACCOUNT_EXISTS", "游戏账号 "+account+" 已存在，请调整前缀或起始序号")
				return
			}
			s.logger.Error("create robot game account", "error", err, "account", account)
			writeError(w, http.StatusInternalServerError, "CREATE_ERROR", "创建游戏账号失败")
			return
		}
		registrationID, _ := registration.LastInsertId()
		result, err := tx.ExecContext(r.Context(), `INSERT INTO mgr_automation_robot
(terminal_no, account, login_password, password_updated_at, nickname, avatar, club_id, group_id, strategy_id, egress_ip,
buyin_multiple, gps, intelligence, profit_mode, profit_target, period_start, period_end,
enabled, invite_code, join_status, joined_at,
status, desired_status, last_heartbeat, is_demo)
VALUES (?, ?, ?, NOW(), ?, ?, '', NULLIF(?, 0), NULLIF(?, 0), '',
?, ?, ?, ?, ?, ?, ?, ?, '', 'unassigned', NULL, ?, 'stopped', NOW(), 0)`,
			terminalNo, account, sealedPassword, nickname, avatar, input.GroupID, input.StrategyID,
			input.BuyinMultiple, randomRobotGPS(), input.Intelligence, input.ProfitMode, input.ProfitTarget,
			nullableTime(periodStart), nullableTime(periodEnd), enabled, robotStatus)
		if err != nil {
			if isDuplicateKey(err) {
				writeError(w, http.StatusConflict, "ROBOT_EXISTS", "账号 "+account+" 或终端编号 "+terminalNo+" 已存在，请调整前缀或起始序号")
				return
			}
			s.logger.Error("bulk create automation robots", "error", err, "account", account)
			writeError(w, http.StatusInternalServerError, "CREATE_ERROR", "批量创建机器人失败")
			return
		}
		id, _ := result.LastInsertId()
		ids = append(ids, id)
		registrations = append(registrations, registrationID)
		avatars = append(avatars, strconv.Itoa(avatar))
		created = append(created, map[string]any{"id": id, "account": account, "nickname": nickname, "avatar": avatar, "terminalNo": terminalNo})
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "TX_ERROR", "提交批量创建失败")
		return
	}
	for index, registrationID := range registrations {
		go s.applyRegistrationAvatar(registrationID, avatars[index])
	}
	message := fmt.Sprintf("已创建 %d 个游戏账号并放入机器人池，昵称和头像随机生成，可到投放管理投放", len(created))
	s.audit(r.Context(), &p, "automation.robot.bulk_create", "automation_robot", joinInt64s(ids), nil, nil,
		map[string]any{"prefix": input.Prefix, "count": len(created), "startNo": input.StartNo, "groupId": input.GroupID, "intelligence": input.Intelligence, "buyinMultiple": input.BuyinMultiple}, 0,
		message, clientIP(r))
	writeData(w, http.StatusCreated, map[string]any{"items": created, "count": len(created), "message": message})
}

type automationRobotUpdateRequest struct {
	Nickname      string `json:"nickname"`
	ClubID        string `json:"clubId"`
	GroupID       int64  `json:"groupId"`
	StrategyID    int64  `json:"strategyId"`
	WorkerID      int64  `json:"workerId"`
	EgressIP      string `json:"egressIp"`
	BuyinMultiple int    `json:"buyinMultiple"`
	RoomPi        string `json:"roomPi"`
	Intelligence  int    `json:"intelligence"`
	ProfitMode     string               `json:"profitMode"`
	ProfitTarget   int64                `json:"profitTarget"`
	PeriodStart    string               `json:"periodStart"`
	PeriodEnd      string               `json:"periodEnd"`
	ProfitSchedule []profitScheduleItem `json:"profitSchedule"`
	Enabled        *bool                `json:"enabled"`
	// LoginPassword 留空表示不改；填写时同时更新游戏库的登录密码与 Worker 用的密文。
	LoginPassword string `json:"loginPassword"`
}

func (s *Server) handleUpdateAutomationRobot(w http.ResponseWriter, r *http.Request, p principal) {
	id, ok := parsePositivePathID(w, r, "id", "终端 ID 不正确")
	if !ok {
		return
	}
	var input automationRobotUpdateRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Nickname = strings.TrimSpace(input.Nickname)
	input.EgressIP = strings.TrimSpace(input.EgressIP)
	scope, err := s.automationScope(r.Context(), p)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取数据范围失败")
		return
	}
	var currentClub, currentStatus string
	var currentRoom sql.NullInt64
	var currentEnabled bool
	var currentProfitMode, currentProfitSchedule string
	if err := s.db.QueryRowContext(r.Context(), "SELECT club_id, status, room_id, enabled, COALESCE(profit_mode, ''), COALESCE(profit_schedule, '') FROM mgr_automation_robot WHERE id = ?", id).
		Scan(&currentClub, &currentStatus, &currentRoom, &currentEnabled, &currentProfitMode, &currentProfitSchedule); err != nil {
		writeError(w, http.StatusNotFound, "ROBOT_NOT_FOUND", "没有找到这个机器人终端")
		return
	}
	if !s.automationClubOrError(w, r, scope, currentClub) {
		return
	}
	input.ClubID = currentClub
	if input.Nickname == "" || len([]rune(input.Nickname)) > 32 {
		writeError(w, http.StatusBadRequest, "INVALID_NICKNAME", "终端昵称不能为空且不能超过 32 个字符")
		return
	}
	if input.EgressIP != "" && net.ParseIP(input.EgressIP) == nil {
		writeError(w, http.StatusBadRequest, "INVALID_IP", "出口 IP 格式不正确")
		return
	}
	if !validRobotBuyinMultiple(input.BuyinMultiple) {
		writeError(w, http.StatusBadRequest, "INVALID_BUYIN_MULTIPLE", "默认带入倍数必须在 1 到 10 之间，1 表示房间最低带入")
		return
	}
	roomPi, roomPiMessage := normalizeRoomPiList(input.RoomPi)
	if roomPiMessage != "" {
		writeError(w, http.StatusBadRequest, "INVALID_ROOM_PI", roomPiMessage)
		return
	}
	if input.Intelligence < 0 || input.Intelligence > 100 {
		writeError(w, http.StatusBadRequest, "INVALID_INTELLIGENCE", "机器人智力必须在 0 到 100 之间，0 表示跟随分组默认值")
		return
	}
	// 周计划沿用每日目标的数值校验；周期日期按 daily 处理，不会误读 period 字段。
	validationMode := input.ProfitMode
	if validationMode == "schedule" {
		validationMode = "daily"
	}
	periodStart, periodEnd, profitMessage := validateAutomationProfit(validationMode, input.ProfitTarget, input.PeriodStart, input.PeriodEnd, true)
	if profitMessage != "" {
		writeError(w, http.StatusBadRequest, "INVALID_PROFIT_TARGET", profitMessage)
		return
	}
	scheduleJSON := ""
	if input.ProfitMode == "schedule" {
		scheduleJSON, profitMessage = normalizeProfitSchedule(input.ProfitSchedule)
		if profitMessage != "" {
			writeError(w, http.StatusBadRequest, "INVALID_PROFIT_SCHEDULE", profitMessage)
			return
		}
	}
	// 周计划没变就保留当前时段的净分进度；改了计划或换成别的模式才清零重来。
	resetSchedule := scheduleJSON == "" || currentProfitMode != "schedule" || currentProfitSchedule != scheduleJSON
	scheduleWindow, scheduleState := "", ""
	if scheduleJSON != "" {
		scheduleWindow, scheduleState = scheduleDeployState(scheduleJSON, time.Now())
	}
	resetFlag := 0
	if resetSchedule {
		resetFlag = 1
	}
	enabled := currentEnabled
	if input.Enabled != nil {
		enabled = *input.Enabled
	}
	if currentEnabled && !enabled && currentRoom.Valid {
		writeError(w, http.StatusConflict, "ROBOT_IN_ROOM", "终端在房间内时不能停用，请先排空或召回")
		return
	}
	nextStatus := currentStatus
	if !enabled {
		nextStatus = "stopped"
	} else if !currentEnabled && (currentStatus == "stopped" || currentStatus == "created" || currentStatus == "offline" || currentStatus == "faulted") {
		nextStatus = "idle"
	}
	if input.GroupID > 0 {
		var exists int
		if err := s.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM mgr_automation_group WHERE id = ?", input.GroupID).Scan(&exists); err != nil || exists == 0 {
			writeError(w, http.StatusBadRequest, "GROUP_NOT_FOUND", "选择的机器人分组不存在")
			return
		}
	}
	sealedPassword := ""
	if input.LoginPassword != "" {
		if strings.TrimSpace(input.LoginPassword) != input.LoginPassword ||
			len([]rune(input.LoginPassword)) < 6 || len([]rune(input.LoginPassword)) > 32 {
			writeError(w, http.StatusBadRequest, "INVALID_PASSWORD", "登录密码必须为 6 到 32 个字符，首尾不能包含空格")
			return
		}
		sealed, err := security.SealCredential(s.credentialKey(), input.LoginPassword)
		if err != nil {
			s.logger.Error("seal robot login password", "error", err)
			writeError(w, http.StatusInternalServerError, "SEAL_ERROR", "加密登录密码失败")
			return
		}
		sealedPassword = sealed
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "TX_ERROR", "开始事务失败")
		return
	}
	defer tx.Rollback()
	if sealedPassword != "" {
		var account string
		if err := tx.QueryRowContext(r.Context(), "SELECT account FROM mgr_automation_robot WHERE id = ?", id).Scan(&account); err != nil {
			writeError(w, http.StatusNotFound, "ROBOT_NOT_FOUND", "没有找到这个机器人终端")
			return
		}
		// 游戏服登录校验以 player_wxpwd 的 MD5 为准，改密码必须同步改这里。
		if _, err := tx.ExecContext(r.Context(), `UPDATE kbedm.third_marketing_info SET player_wxpwd = MD5(?) WHERE player_wxid = ?`,
			input.LoginPassword, account); err != nil {
			s.logger.Error("update robot game password", "error", err, "robotId", id)
			writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "更新游戏登录密码失败")
			return
		}
	}
	if _, err := tx.ExecContext(r.Context(), `UPDATE mgr_automation_robot
SET nickname = ?, group_id = NULLIF(?, 0), strategy_id = NULLIF(?, 0),
worker_id = NULLIF(?, 0), egress_ip = ?, buyin_multiple = ?, room_pi = ?,
intelligence = ?, profit_mode = ?, profit_target = ?, period_start = ?, period_end = ?, profit_schedule = ?,
schedule_window = CASE WHEN ? = 1 THEN ? ELSE schedule_window END,
window_net = CASE WHEN ? = 1 THEN 0 ELSE window_net END,
schedule_state = CASE WHEN ? = 1 THEN ? ELSE schedule_state END,
enabled = ?, status = ?, desired_status = CASE WHEN ? = 0 THEN 'stopped' ELSE desired_status END,
login_password = CASE WHEN ? = '' THEN login_password ELSE ? END,
password_updated_at = CASE WHEN ? = '' THEN password_updated_at ELSE NOW() END,
last_heartbeat = NOW()
WHERE id = ?`, input.Nickname, input.GroupID, input.StrategyID, input.WorkerID, input.EgressIP, input.BuyinMultiple, roomPi,
		input.Intelligence, input.ProfitMode, input.ProfitTarget, nullableTime(periodStart), nullableTime(periodEnd), scheduleJSON,
		resetFlag, scheduleWindow, resetFlag, resetFlag, scheduleState,
		enabled, nextStatus, enabled, sealedPassword, sealedPassword, sealedPassword, id); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "保存机器人终端失败")
		return
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "TX_ERROR", "提交机器人终端修改失败")
		return
	}
	s.audit(r.Context(), &p, "automation.robot.update", "automation_robot", strconv.FormatInt(id, 10), input, nil, input, 0, "机器人终端配置已更新", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"message": "机器人终端配置已保存"})
}

func (s *Server) handleDeleteAutomationRobot(w http.ResponseWriter, r *http.Request, p principal) {
	id, ok := parsePositivePathID(w, r, "id", "终端 ID 不正确")
	if !ok {
		return
	}
	var input struct {
		Confirm bool `json:"confirm"`
	}
	if r.ContentLength > 0 && !decodeJSON(w, r, &input) {
		return
	}
	if !input.Confirm {
		writeError(w, http.StatusBadRequest, "DELETE_CONFIRM_REQUIRED", "请确认删除该机器人终端")
		return
	}
	scope, err := s.automationScope(r.Context(), p)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取数据范围失败")
		return
	}
	var clubID string
	var roomID sql.NullInt64
	if err := s.db.QueryRowContext(r.Context(), "SELECT club_id, room_id FROM mgr_automation_robot WHERE id = ?", id).
		Scan(&clubID, &roomID); err != nil {
		writeError(w, http.StatusNotFound, "ROBOT_NOT_FOUND", "没有找到这个机器人终端")
		return
	}
	if !s.automationClubOrError(w, r, scope, clubID) {
		return
	}
	if roomID.Valid {
		if err := s.releaseAutomationRobotSeat(r, id, "delete", "stopped"); err != nil {
			writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "结束对局失败")
			return
		}
	}
	if _, err := s.db.ExecContext(r.Context(), "DELETE FROM mgr_automation_robot WHERE id = ?", id); err != nil {
		writeError(w, http.StatusInternalServerError, "DELETE_ERROR", "删除机器人终端失败")
		return
	}
	s.audit(r.Context(), &p, "automation.robot.delete", "automation_robot", strconv.FormatInt(id, 10), input, nil, nil, 0, "机器人记录已删除，游戏账号仍保留在游戏服", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"message": "机器人记录已删除；游戏账号仍保留在游戏服，历史对局保留"})
}

type automationRobotActionRequest struct {
	Action string `json:"action"`
}

func (s *Server) handleAutomationRobotAction(w http.ResponseWriter, r *http.Request, p principal) {
	id, ok := parsePositivePathID(w, r, "id", "终端 ID 不正确")
	if !ok {
		return
	}
	var input automationRobotActionRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	action := strings.TrimSpace(input.Action)
	if !validRobotAction(action) {
		writeError(w, http.StatusBadRequest, "INVALID_ACTION", "不支持的终端操作")
		return
	}
	scope, err := s.automationScope(r.Context(), p)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取数据范围失败")
		return
	}
	var clubID string
	if err := s.db.QueryRowContext(r.Context(), "SELECT club_id FROM mgr_automation_robot WHERE id = ?", id).Scan(&clubID); err != nil {
		writeError(w, http.StatusNotFound, "ROBOT_NOT_FOUND", "没有找到这个机器人终端")
		return
	}
	if !s.automationClubOrError(w, r, scope, clubID) {
		return
	}
	message, err := s.performAutomationRobotAction(r, id, action)
	if err != nil {
		if errors.Is(err, errAutomationRobotDisabled) {
			writeError(w, http.StatusConflict, "ROBOT_DISABLED", "该终端已停用，请先启用后再操作")
			return
		}
		if errors.Is(err, errAutomationRobotNotJoined) {
			writeError(w, http.StatusConflict, "ROBOT_NOT_JOINED", "该终端还没有加入俱乐部，请检查邀请码")
			return
		}
		if errors.Is(err, errAutomationRobotInRoom) {
			writeError(w, http.StatusConflict, "ROBOT_IN_ROOM", "机器人正在房间中，请先召回后再撤回投放")
			return
		}
		s.logger.Error("automation robot action", "error", err, "robotId", id, "action", action)
		writeError(w, http.StatusInternalServerError, "ACTION_ERROR", "终端操作失败")
		return
	}
	s.audit(r.Context(), &p, "automation.robot."+action, "automation_robot", strconv.FormatInt(id, 10), input, nil, nil, 0, message, clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"message": message})
}

var (
	errAutomationRobotDisabled  = errors.New("robot is disabled")
	errAutomationRobotNotJoined = errors.New("robot has not joined the club")
	errAutomationRobotInRoom    = errors.New("robot is in a room")
)

func validRobotAction(action string) bool {
	switch action {
	case "start", "pause", "drain", "stop", "restart", "enable", "disable", "release", "activate":
		return true
	}
	return false
}

// performAutomationRobotAction 在原始动作外面包一层：动作成功后如果这台机器人挂在 Worker 上，
// 就给节点排一条对应命令，让节点真的去启动/暂停/排空/停止终端。
func (s *Server) performAutomationRobotAction(r *http.Request, id int64, action string) (string, error) {
	workerID := s.automationRobotWorkerID(r.Context(), id)
	message, err := s.performAutomationRobotActionDirect(r, id, action)
	if err != nil {
		return message, err
	}
	if workerID > 0 && action != "activate" {
		s.enqueueRobotActionCommand(r.Context(), workerID, id, action)
		// 撤回投放会把账号从节点上摘下来，日志里要留一条「退出账号」。
		if action == "release" {
			var account, terminalNo string
			_ = s.db.QueryRowContext(r.Context(), "SELECT account, terminal_no FROM mgr_automation_robot WHERE id = ?", id).
				Scan(&account, &terminalNo)
			recordWorkerEvent(r.Context(), s.db, workerID, workerEventRobotReleased, id, terminalNo, map[string]any{
				"account":    account,
				"terminalNo": terminalNo,
				"message":    "撤回投放，收回账号 " + account,
			})
		}
	}
	return message, nil
}

func (s *Server) performAutomationRobotActionDirect(r *http.Request, id int64, action string) (string, error) {
	var status, joinStatus, scheduleState string
	var roomID sql.NullInt64
	var activatedAt sql.NullTime
	var enabled bool
	if err := s.db.QueryRowContext(r.Context(), "SELECT status, room_id, enabled, join_status, COALESCE(schedule_state, ''), activated_at FROM mgr_automation_robot WHERE id = ?", id).
		Scan(&status, &roomID, &enabled, &joinStatus, &scheduleState, &activatedAt); err != nil {
		return "", err
	}
	switch action {
	case "activate":
		if activatedAt.Valid {
			return "账号已经激活过，不需要再登录", nil
		}
		if _, err := s.db.ExecContext(r.Context(), `UPDATE mgr_automation_robot
SET activation_attempts = 0, activation_attempted_at = NULL, activation_error = '', last_error = ''
WHERE id = ? AND activated_at IS NULL`, id); err != nil {
			return "", err
		}
		return "已重新排队激活，节点空闲时会自动登录一次", nil
	case "release":
		if joinStatus == "" || joinStatus == "unassigned" {
			return "机器人当前未投放", nil
		}
		if roomID.Valid {
			return "", errAutomationRobotInRoom
		}
		if _, err := s.db.ExecContext(r.Context(), `UPDATE mgr_automation_robot
SET club_id = '', invite_code = '', join_status = 'unassigned', joined_at = NULL, worker_id = NULL,
status = 'idle', desired_status = 'stopped', schedule_window = '', window_net = 0, schedule_state = '',
last_heartbeat = NOW() WHERE id = ?`, id); err != nil {
			return "", err
		}
		if err := s.refreshAutomationWorkerLoad(r.Context()); err != nil {
			s.logger.Error("refresh worker load after release", "error", err, "robot", id)
		}
		return "已撤回投放，账号保留在机器人池", nil
	case "enable":
		if joinStatus == "failed" || joinStatus == "pending" {
			return "", errAutomationRobotNotJoined
		}
		if enabled {
			return "终端已经是启用状态", nil
		}
		nextStatus := "idle"
		if roomID.Valid {
			nextStatus = "seated"
		}
		if _, err := s.db.ExecContext(r.Context(), `UPDATE mgr_automation_robot
SET enabled = 1, status = ?, desired_status = 'running', last_error = '', last_heartbeat = NOW() WHERE id = ?`, nextStatus, id); err != nil {
			return "", err
		}
		return "终端已启用", nil
	case "disable":
		if !enabled {
			return "终端已经是停用状态", nil
		}
		if roomID.Valid {
			if err := s.releaseAutomationRobotSeat(r, id, "disable", "stopped"); err != nil {
				return "", err
			}
		}
		if _, err := s.db.ExecContext(r.Context(), `UPDATE mgr_automation_robot
SET enabled = 0, status = 'stopped', desired_status = 'stopped', last_heartbeat = NOW() WHERE id = ?`, id); err != nil {
			return "", err
		}
		return "终端已停用，不再参与调度", nil
	}
	if !enabled {
		switch action {
		case "start", "pause", "restart":
			return "", errAutomationRobotDisabled
		}
	}
	switch action {
	case "start":
		if scheduleState == "released" {
			return "当前不在周计划时段，到点会自动分配 Worker 上机", nil
		}
		nextStatus := "idle"
		if roomID.Valid {
			nextStatus = "seated"
		}
		if _, err := s.db.ExecContext(r.Context(), `UPDATE mgr_automation_robot
SET status = ?, desired_status = 'running', last_error = '', last_heartbeat = NOW() WHERE id = ?`, nextStatus, id); err != nil {
			return "", err
		}
		return "终端已启动，等待调度进房", nil
	case "pause":
		if _, err := s.db.ExecContext(r.Context(), `UPDATE mgr_automation_robot
SET status = 'paused', desired_status = 'paused', last_heartbeat = NOW() WHERE id = ?`, id); err != nil {
			return "", err
		}
		return "终端已暂停，不再开新局", nil
	case "drain":
		if err := s.releaseAutomationRobotSeat(r, id, "drain", "stopped"); err != nil {
			return "", err
		}
		return "终端已排空并停止", nil
	case "stop":
		if err := s.releaseAutomationRobotSeat(r, id, "stop", "stopped"); err != nil {
			return "", err
		}
		if _, err := s.db.ExecContext(r.Context(), "UPDATE mgr_automation_robot SET desired_status = 'stopped' WHERE id = ?", id); err != nil {
			return "", err
		}
		return "终端已停止", nil
	case "restart":
		nextStatus := "idle"
		if roomID.Valid {
			nextStatus = "seated"
		}
		if _, err := s.db.ExecContext(r.Context(), `UPDATE mgr_automation_robot
SET status = ?, desired_status = 'running', last_error = '', last_heartbeat = NOW() WHERE id = ?`, nextStatus, id); err != nil {
			return "", err
		}
		return "终端连接已重启", nil
	}
	return "", errors.New("unsupported action")
}

type automationRobotBatchRequest struct {
	IDs    []int64 `json:"ids"`
	Action string  `json:"action"`
	Reason string  `json:"reason"`
}

type automationRobotBatchResult struct {
	ID         int64  `json:"id"`
	TerminalNo string `json:"terminalNo"`
	OK         bool   `json:"ok"`
	Message    string `json:"message"`
}

func (s *Server) handleAutomationRobotBatch(w http.ResponseWriter, r *http.Request, p principal) {
	var input automationRobotBatchRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	action := strings.TrimSpace(input.Action)
	if !validRobotAction(action) {
		writeError(w, http.StatusBadRequest, "INVALID_ACTION", "不支持的批量操作")
		return
	}
	if len(input.IDs) == 0 || len(input.IDs) > 100 {
		writeError(w, http.StatusBadRequest, "INVALID_IDS", "批量操作需要选择 1 到 100 个终端")
		return
	}
	scope, err := s.automationScope(r.Context(), p)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取数据范围失败")
		return
	}
	if (action == "stop" || action == "drain") && len(input.IDs) > 10 && r.URL.Query().Get("approval") != "1" {
		reason := strings.TrimSpace(input.Reason)
		if reason == "" {
			writeError(w, http.StatusBadRequest, "APPROVAL_REASON_REQUIRED", "批量停止或排空超过 10 台需要填写操作原因，审批人需要了解处理背景")
			return
		}
		id, err := s.createAutomationApproval(r.Context(), p, "robot.batch_"+action, "robot",
			joinInt64s(input.IDs), map[string]any{"ids": input.IDs}, reason)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "APPROVAL_ERROR", "创建审批单失败")
			return
		}
		actionName := "停止"
		if action == "drain" {
			actionName = "排空"
		}
		writeData(w, http.StatusAccepted, map[string]any{
			"approvalRequired": true, "approvalId": id,
			"message": fmt.Sprintf("批量%s超过 10 台，已转为审批单，请到任务中心审批", actionName),
		})
		return
	}
	results := make([]automationRobotBatchResult, 0, len(input.IDs))
	succeeded, failed := 0, 0
	for _, id := range input.IDs {
		item := automationRobotBatchResult{ID: id}
		var terminalNo, clubID string
		if err := s.db.QueryRowContext(r.Context(), "SELECT terminal_no, club_id FROM mgr_automation_robot WHERE id = ?", id).
			Scan(&terminalNo, &clubID); err != nil {
			item.Message = "终端不存在"
			failed++
			results = append(results, item)
			continue
		}
		item.TerminalNo = terminalNo
		if !scope.Allows(clubID) {
			item.Message = "超出当前角色的俱乐部范围"
			failed++
			results = append(results, item)
			continue
		}
		message, err := s.performAutomationRobotAction(r, id, action)
		if err != nil {
			item.Message = "操作失败"
			failed++
		} else {
			item.OK = true
			item.Message = message
			succeeded++
		}
		results = append(results, item)
	}
	s.audit(r.Context(), &p, "automation.robot.batch_"+action, "automation_robot", joinInt64s(input.IDs),
		input, nil, map[string]any{"succeeded": succeeded, "failed": failed}, 0,
		fmt.Sprintf("批量%s：成功 %d 台，失败 %d 台", action, succeeded, failed), clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"results": results, "succeeded": succeeded, "failed": failed})
}

func joinInt64s(values []int64) string {
	parts := make([]string, 0, len(values))
	for _, value := range values {
		parts = append(parts, strconv.FormatInt(value, 10))
	}
	if len(parts) > 20 {
		parts = parts[:20]
	}
	return strings.Join(parts, ",")
}

func (s *Server) createAutomationApproval(ctx context.Context, p principal, action, targetType, targetID string, params any, reason string) (int64, error) {
	result, err := s.db.ExecContext(ctx, `INSERT INTO mgr_automation_approval
(action, target_type, target_id, params_json, reason, status, requester_id, requester_name, is_demo)
VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, 0)`,
		action, targetType, targetID, marshalAutomationParams(params), reason, p.ID, automationOperator(p))
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

func (s *Server) queryAutomationRobotLogs(ctx context.Context, id int64) ([]map[string]any, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT action, result_message, operator_name, created_at
FROM mgr_audit_log WHERE target_type = 'automation_robot' AND target_id = ?
ORDER BY id DESC LIMIT 30`, strconv.FormatInt(id, 10))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var action, message, operator string
		var createdAt time.Time
		if err := rows.Scan(&action, &message, &operator, &createdAt); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{"action": action, "message": message, "operator": operator, "createdAt": createdAt})
	}
	return items, rows.Err()
}

func (s *Server) queryAutomationGroups(r *http.Request) ([]automationGroupItem, error) {
	rows, err := s.db.QueryContext(r.Context(), `SELECT g.id, g.name, g.club_id, COALESCE(c.name, ''),
g.strategy_id, COALESCE(st.name, ''), g.target_seated, g.max_robots, g.tier_pref, g.duration_pref,
g.buyin_ratio, g.default_intelligence, g.profit_mode, g.profit_target, g.period_start, g.period_end,
g.status, g.notes,
(SELECT COUNT(*) FROM mgr_automation_robot t WHERE t.group_id = g.id),
(SELECT COUNT(*) FROM mgr_automation_robot t WHERE t.group_id = g.id AND t.status IN ('seated','playing','paused')),
g.updated_at
FROM mgr_automation_group g
LEFT JOIN mgr_automation_club c ON c.club_id = g.club_id
LEFT JOIN mgr_automation_strategy st ON st.id = g.strategy_id
ORDER BY g.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []automationGroupItem{}
	for rows.Next() {
		var item automationGroupItem
		var strategyID sql.NullInt64
		var periodStart, periodEnd sql.NullTime
		if err := rows.Scan(&item.ID, &item.Name, &item.ClubID, &item.ClubName,
			&strategyID, &item.StrategyName, &item.TargetSeated, &item.MaxRobots, &item.TierPref,
			&item.DurationPref, &item.BuyinRatio, &item.Intelligence, &item.ProfitMode, &item.ProfitTarget,
			&periodStart, &periodEnd, &item.Status, &item.Notes,
			&item.RobotCount, &item.SeatedCount, &item.UpdatedAt); err != nil {
			return nil, err
		}
		if strategyID.Valid {
			value := strategyID.Int64
			item.StrategyID = &value
		}
		if periodStart.Valid {
			value := periodStart.Time
			item.PeriodStart = &value
		}
		if periodEnd.Valid {
			value := periodEnd.Time
			item.PeriodEnd = &value
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Server) handleListAutomationGroups(w http.ResponseWriter, r *http.Request, p principal) {
	items, err := s.queryAutomationGroups(r)
	if err != nil {
		s.logger.Error("list automation groups", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取自动化组失败")
		return
	}
	writeData(w, http.StatusOK, map[string]any{"items": items})
}

type automationGroupRequest struct {
	Name         string `json:"name"`
	ClubID       string `json:"clubId"`
	StrategyID   int64  `json:"strategyId"`
	TargetSeated int    `json:"targetSeated"`
	MaxRobots    int    `json:"maxRobots"`
	TierPref     string `json:"tierPref"`
	DurationPref string `json:"durationPref"`
	BuyinRatio   int    `json:"buyinRatio"`
	Intelligence int    `json:"defaultIntelligence"`
	ProfitMode   string `json:"profitMode"`
	ProfitTarget int64  `json:"profitTarget"`
	PeriodStart  string `json:"periodStart"`
	PeriodEnd    string `json:"periodEnd"`
	Status       string `json:"status"`
	Notes        string `json:"notes"`
}

func validAutomationProfitMode(value string, allowInherit bool) bool {
	switch value {
	case "daily", "period", "none":
		return true
	case "":
		return allowInherit
	}
	return false
}

var automationPeriodLocation = time.FixedZone("Asia/Shanghai", 8*60*60)

func parseAutomationPeriodDate(value string) (sql.NullTime, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return sql.NullTime{}, true
	}
	parsed, err := time.ParseInLocation("2006-01-02", value, automationPeriodLocation)
	if err != nil {
		return sql.NullTime{}, false
	}
	return sql.NullTime{Time: parsed, Valid: true}, true
}

func nullableTime(value sql.NullTime) any {
	if !value.Valid {
		return nil
	}
	return value.Time
}

func normalizeAutomationPeriod(mode, start, end string) (sql.NullTime, sql.NullTime, string) {
	if mode != "period" {
		return sql.NullTime{}, sql.NullTime{}, ""
	}
	startDate, ok := parseAutomationPeriodDate(start)
	if !ok {
		return sql.NullTime{}, sql.NullTime{}, "周期开始日期格式不正确"
	}
	endDate, ok := parseAutomationPeriodDate(end)
	if !ok {
		return sql.NullTime{}, sql.NullTime{}, "周期结束日期格式不正确"
	}
	if !startDate.Valid || !endDate.Valid {
		return sql.NullTime{}, sql.NullTime{}, "按周期设置输赢目标时必须选择开始和结束日期"
	}
	if endDate.Time.Before(startDate.Time) {
		return sql.NullTime{}, sql.NullTime{}, "周期结束日期不能早于开始日期"
	}
	return startDate, endDate, ""
}

func validateAutomationProfit(mode string, target int64, start, end string, allowInherit bool) (sql.NullTime, sql.NullTime, string) {
	if !validAutomationProfitMode(mode, allowInherit) {
		return sql.NullTime{}, sql.NullTime{}, "输赢目标周期不正确"
	}
	if target < -1000000000 || target > 1000000000 {
		return sql.NullTime{}, sql.NullTime{}, "输赢目标数值超出范围"
	}
	return normalizeAutomationPeriod(mode, start, end)
}

func (s *Server) validateAutomationGroup(w http.ResponseWriter, r *http.Request, p principal, input *automationGroupRequest) bool {
	input.Name = strings.TrimSpace(input.Name)
	input.TierPref = strings.TrimSpace(input.TierPref)
	input.DurationPref = strings.TrimSpace(input.DurationPref)
	input.Notes = strings.TrimSpace(input.Notes)
	input.ClubID = ""
	if input.Name == "" || len([]rune(input.Name)) > 64 {
		writeError(w, http.StatusBadRequest, "INVALID_NAME", "组名称不能为空且不能超过 64 个字符")
		return false
	}
	if input.TargetSeated < 0 || input.TargetSeated > 500 || input.MaxRobots < 0 || input.MaxRobots > 500 {
		writeError(w, http.StatusBadRequest, "INVALID_CAPACITY", "目标在座和终端上限必须在 0 到 500 之间")
		return false
	}
	if input.BuyinRatio < 0 || input.BuyinRatio > 100 {
		writeError(w, http.StatusBadRequest, "INVALID_RATIO", "带入比例必须在 0 到 100 之间")
		return false
	}
	if input.Intelligence < 0 || input.Intelligence > 100 {
		writeError(w, http.StatusBadRequest, "INVALID_INTELLIGENCE", "组默认智力必须在 0 到 100 之间")
		return false
	}
	if _, _, message := validateAutomationProfit(input.ProfitMode, input.ProfitTarget, input.PeriodStart, input.PeriodEnd, false); message != "" {
		writeError(w, http.StatusBadRequest, "INVALID_PROFIT_TARGET", message)
		return false
	}
	if input.Status != "enabled" && input.Status != "disabled" {
		writeError(w, http.StatusBadRequest, "INVALID_STATUS", "组状态不正确")
		return false
	}
	if input.StrategyID > 0 {
		var exists int
		if err := s.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM mgr_automation_strategy WHERE id = ?", input.StrategyID).Scan(&exists); err != nil || exists == 0 {
			writeError(w, http.StatusBadRequest, "STRATEGY_NOT_FOUND", "选择的策略不存在")
			return false
		}
	}
	return true
}

func (s *Server) handleCreateAutomationGroup(w http.ResponseWriter, r *http.Request, p principal) {
	var input automationGroupRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if !s.validateAutomationGroup(w, r, p, &input) {
		return
	}
	periodStart, periodEnd, _ := normalizeAutomationPeriod(input.ProfitMode, input.PeriodStart, input.PeriodEnd)
	result, err := s.db.ExecContext(r.Context(), `INSERT INTO mgr_automation_group
(name, club_id, strategy_id, target_seated, max_robots, tier_pref, duration_pref, buyin_ratio,
default_intelligence, profit_mode, profit_target, period_start, period_end, status, notes, is_demo)
VALUES (?, ?, NULLIF(?, 0), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
		input.Name, input.ClubID, input.StrategyID, input.TargetSeated, input.MaxRobots,
		input.TierPref, input.DurationPref, input.BuyinRatio, input.Intelligence,
		input.ProfitMode, input.ProfitTarget, nullableTime(periodStart), nullableTime(periodEnd),
		input.Status, input.Notes)
	if err != nil {
		s.logger.Error("create automation group", "error", err)
		writeError(w, http.StatusInternalServerError, "CREATE_ERROR", "创建自动化组失败")
		return
	}
	id, _ := result.LastInsertId()
	s.audit(r.Context(), &p, "automation.group.create", "automation_group", strconv.FormatInt(id, 10), input, nil, input, 0, "自动化组已创建", clientIP(r))
	writeData(w, http.StatusCreated, map[string]any{"id": id, "message": "自动化组已创建"})
}

func (s *Server) handleUpdateAutomationGroup(w http.ResponseWriter, r *http.Request, p principal) {
	id, ok := parsePositivePathID(w, r, "id", "组 ID 不正确")
	if !ok {
		return
	}
	var input automationGroupRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if !s.validateAutomationGroup(w, r, p, &input) {
		return
	}
	var before automationGroupRequest
	var strategyID sql.NullInt64
	var beforeStart, beforeEnd sql.NullTime
	if err := s.db.QueryRowContext(r.Context(), `SELECT name, club_id, strategy_id, target_seated, max_robots,
tier_pref, duration_pref, buyin_ratio, default_intelligence, profit_mode, profit_target, period_start, period_end,
status, notes FROM mgr_automation_group WHERE id = ?`, id).
		Scan(&before.Name, &before.ClubID, &strategyID, &before.TargetSeated, &before.MaxRobots,
			&before.TierPref, &before.DurationPref, &before.BuyinRatio, &before.Intelligence,
			&before.ProfitMode, &before.ProfitTarget, &beforeStart, &beforeEnd,
			&before.Status, &before.Notes); err != nil {
		writeError(w, http.StatusNotFound, "GROUP_NOT_FOUND", "没有找到这个自动化组")
		return
	}
	if strategyID.Valid {
		before.StrategyID = strategyID.Int64
	}
	if beforeStart.Valid {
		before.PeriodStart = beforeStart.Time.Format("2006-01-02")
	}
	if beforeEnd.Valid {
		before.PeriodEnd = beforeEnd.Time.Format("2006-01-02")
	}
	periodStart, periodEnd, _ := normalizeAutomationPeriod(input.ProfitMode, input.PeriodStart, input.PeriodEnd)
	if _, err := s.db.ExecContext(r.Context(), `UPDATE mgr_automation_group
SET name = ?, club_id = ?, strategy_id = NULLIF(?, 0), target_seated = ?, max_robots = ?,
tier_pref = ?, duration_pref = ?, buyin_ratio = ?, default_intelligence = ?, profit_mode = ?,
profit_target = ?, period_start = ?, period_end = ?, status = ?, notes = ? WHERE id = ?`,
		input.Name, input.ClubID, input.StrategyID, input.TargetSeated, input.MaxRobots,
		input.TierPref, input.DurationPref, input.BuyinRatio, input.Intelligence,
		input.ProfitMode, input.ProfitTarget, nullableTime(periodStart), nullableTime(periodEnd),
		input.Status, input.Notes, id); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "保存自动化组失败")
		return
	}
	s.audit(r.Context(), &p, "automation.group.update", "automation_group", strconv.FormatInt(id, 10), input, before, input, 0, "自动化组已更新", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"message": "自动化组已保存"})
}

// handleDeleteAutomationGroup 删除自动化组。组里有机器人时必须带 moveToGroupId（0 = 不分组），
// 先在同一事务里把机器人搬走再删组；不搬就直接拒绝，避免机器人挂在不存在的组上。
func (s *Server) handleDeleteAutomationGroup(w http.ResponseWriter, r *http.Request, p principal) {
	id, ok := parsePositivePathID(w, r, "id", "组 ID 不正确")
	if !ok {
		return
	}
	moveTo := int64(0)
	moveProvided := false
	if raw := strings.TrimSpace(r.URL.Query().Get("moveToGroupId")); raw != "" {
		value, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || value < 0 {
			writeError(w, http.StatusBadRequest, "INVALID_MOVE_TARGET", "接收机器人的分组不正确")
			return
		}
		moveTo, moveProvided = value, true
		if moveTo == id {
			writeError(w, http.StatusBadRequest, "INVALID_MOVE_TARGET", "不能把机器人转移到正在删除的分组")
			return
		}
		if moveTo > 0 {
			var exists int
			if err := s.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM mgr_automation_group WHERE id = ?", moveTo).Scan(&exists); err != nil || exists == 0 {
				writeError(w, http.StatusBadRequest, "MOVE_TARGET_NOT_FOUND", "接收机器人的分组不存在，请刷新后重试")
				return
			}
		}
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "TX_ERROR", "开始事务失败")
		return
	}
	defer tx.Rollback()
	var exists int
	if err := tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM mgr_automation_group WHERE id = ?", id).Scan(&exists); err != nil || exists == 0 {
		writeError(w, http.StatusNotFound, "GROUP_NOT_FOUND", "没有找到这个自动化组")
		return
	}
	var robotCount int
	if err := tx.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM mgr_automation_robot WHERE group_id = ?", id).Scan(&robotCount); err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取组内机器人失败")
		return
	}
	if robotCount > 0 && !moveProvided {
		writeError(w, http.StatusConflict, "GROUP_NOT_EMPTY", fmt.Sprintf("该组还有 %d 台机器人，删除时请选择把它们移到其他分组或不分组", robotCount))
		return
	}
	var moved int64
	if robotCount > 0 {
		target := sql.NullInt64{}
		if moveTo > 0 {
			target = sql.NullInt64{Int64: moveTo, Valid: true}
		}
		result, err := tx.ExecContext(r.Context(), "UPDATE mgr_automation_robot SET group_id = ? WHERE group_id = ?", target, id)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "DELETE_ERROR", "转移组内机器人失败")
			return
		}
		moved, _ = result.RowsAffected()
	}
	if _, err := tx.ExecContext(r.Context(), "DELETE FROM mgr_automation_group WHERE id = ?", id); err != nil {
		writeError(w, http.StatusInternalServerError, "DELETE_ERROR", "删除自动化组失败")
		return
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "TX_ERROR", "提交事务失败")
		return
	}
	message := "自动化组已删除"
	switch {
	case moved > 0 && moveTo > 0:
		message = fmt.Sprintf("已把 %d 台机器人移到其他分组，自动化组已删除", moved)
	case moved > 0:
		message = fmt.Sprintf("已把 %d 台机器人改为不分组，自动化组已删除", moved)
	}
	s.audit(r.Context(), &p, "automation.group.delete", "automation_group", strconv.FormatInt(id, 10), nil, nil, nil, 0, message, clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"message": message})
}
