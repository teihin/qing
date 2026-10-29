package api

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

type automationClubItem struct {
	ClubID       string    `json:"clubId"`
	Name         string    `json:"name"`
	Mode         int       `json:"mode"`
	MemberCount  int       `json:"memberCount"`
	UnionName    string    `json:"unionName"`
	RobotQuota   int       `json:"robotQuota"`
	SeatRatio    int       `json:"seatRatio"`
	MaxPerRoom   int       `json:"maxPerRoom"`
	InviteCode   string    `json:"inviteCode"`
	Status       string    `json:"status"`
	Notes        string    `json:"notes"`
	RoomCount    int       `json:"roomCount"`
	Capacity     int       `json:"capacity"`
	Seated       int       `json:"seated"`
	RobotCount   int       `json:"robotCount"`
	EnabledCount int       `json:"enabledCount"`
	RobotSeated  int       `json:"robotSeated"`
	OnlineCount  int       `json:"onlineCount"`
	TargetSeated int       `json:"targetSeated"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type automationRoomItem struct {
	RoomID       int64     `json:"roomId"`
	ClubID       string    `json:"clubId"`
	ClubName     string    `json:"clubName"`
	RoomName     string    `json:"roomName"`
	Tier         string    `json:"tier"`
	BaseScore    int       `json:"baseScore"`
	DurationMin  int       `json:"durationMin"`
	Status       string    `json:"status"`
	Seated       int       `json:"seated"`
	MaxSeats     int       `json:"maxSeats"`
	Observers    int       `json:"observers"`
	RemainingMin int       `json:"remainingMin"`
	Robots       int       `json:"robots"`
	Humans       int       `json:"humans"`
	CapturedAt   time.Time `json:"capturedAt"`
}

type automationGroupItem struct {
	ID           int64      `json:"id"`
	Name         string     `json:"name"`
	ClubID       string     `json:"clubId"`
	ClubName     string     `json:"clubName"`
	StrategyID   *int64     `json:"strategyId"`
	StrategyName string     `json:"strategyName"`
	TargetSeated int        `json:"targetSeated"`
	MaxRobots    int        `json:"maxRobots"`
	TierPref     string     `json:"tierPref"`
	DurationPref string     `json:"durationPref"`
	BuyinRatio   int        `json:"buyinRatio"`
	Intelligence int        `json:"defaultIntelligence"`
	ProfitMode   string     `json:"profitMode"`
	ProfitTarget int64      `json:"profitTarget"`
	PeriodStart  *time.Time `json:"periodStart"`
	PeriodEnd    *time.Time `json:"periodEnd"`
	Status       string     `json:"status"`
	Notes        string     `json:"notes"`
	RobotCount   int        `json:"robotCount"`
	SeatedCount  int        `json:"seatedCount"`
	UpdatedAt    time.Time  `json:"updatedAt"`
}

const automationClubSelect = `SELECT
c.club_id, c.name, c.mode, c.member_count, c.union_name, c.robot_quota, c.seat_ratio,
c.max_per_room, c.invite_code, c.status, c.notes,
(SELECT COUNT(*) FROM mgr_automation_room_snapshot r WHERE r.club_id = c.club_id),
(SELECT COALESCE(SUM(r.max_seats), 0) FROM mgr_automation_room_snapshot r WHERE r.club_id = c.club_id),
(SELECT COALESCE(SUM(r.seated), 0) FROM mgr_automation_room_snapshot r WHERE r.club_id = c.club_id),
(SELECT COUNT(*) FROM mgr_automation_robot t WHERE t.club_id = c.club_id),
(SELECT COUNT(*) FROM mgr_automation_robot t WHERE t.club_id = c.club_id AND t.enabled = 1),
(SELECT COUNT(*) FROM mgr_automation_robot t WHERE t.club_id = c.club_id AND t.room_id IS NOT NULL),
(SELECT COUNT(*) FROM mgr_automation_robot t WHERE t.club_id = c.club_id AND t.status IN ('idle','entering','seated','playing','paused','draining')),
(SELECT COALESCE(SUM(g.target_seated), 0) FROM mgr_automation_group g WHERE g.club_id = c.club_id AND g.status = 'enabled'),
c.updated_at
FROM mgr_automation_club c`

func (s *Server) handleListAutomationClubs(w http.ResponseWriter, r *http.Request, p principal) {
	scope, err := s.automationScope(r.Context(), p)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取数据范围失败")
		return
	}
	page, size := pageParams(r)
	keyword := strings.TrimSpace(r.URL.Query().Get("keyword"))
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	conditions := []string{}
	args := []any{}
	scopeSQL, scopeArgs := scopeClause("c.club_id", scope)
	conditions = append(conditions, scopeSQL)
	args = append(args, scopeArgs...)
	if keyword != "" {
		conditions = append(conditions, "(c.club_id LIKE ? OR c.name LIKE ?)")
		args = append(args, "%"+keyword+"%", "%"+keyword+"%")
	}
	if status == "enabled" || status == "disabled" {
		conditions = append(conditions, "c.status = ?")
		args = append(args, status)
	}
	where := strings.Join(conditions, " AND ")
	var total int64
	if err := s.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM mgr_automation_club c WHERE "+where, args...).Scan(&total); err != nil {
		s.logger.Error("count automation clubs", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取俱乐部数量失败")
		return
	}
	queryArgs := append(append([]any{}, args...), size, (page-1)*size)
	rows, err := s.db.QueryContext(r.Context(), automationClubSelect+` WHERE `+where+` ORDER BY c.club_id LIMIT ? OFFSET ?`, queryArgs...)
	if err != nil {
		s.logger.Error("list automation clubs", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取俱乐部失败")
		return
	}
	defer rows.Close()
	items := []automationClubItem{}
	for rows.Next() {
		item, err := scanAutomationClub(rows)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取俱乐部数据失败")
			return
		}
		items = append(items, item)
	}
	writeData(w, http.StatusOK, map[string]any{"items": items, "page": page, "pageSize": size, "total": total})
}

func scanAutomationClub(row rowScanner) (automationClubItem, error) {
	var item automationClubItem
	err := row.Scan(&item.ClubID, &item.Name, &item.Mode, &item.MemberCount, &item.UnionName,
		&item.RobotQuota, &item.SeatRatio, &item.MaxPerRoom, &item.InviteCode, &item.Status, &item.Notes,
		&item.RoomCount, &item.Capacity, &item.Seated, &item.RobotCount, &item.EnabledCount, &item.RobotSeated, &item.OnlineCount,
		&item.TargetSeated, &item.UpdatedAt)
	return item, err
}

func (s *Server) handleGetAutomationClub(w http.ResponseWriter, r *http.Request, p principal) {
	clubID := r.PathValue("clubId")
	scope, err := s.automationScope(r.Context(), p)
	if err != nil || !s.automationClubOrError(w, r, scope, clubID) {
		return
	}
	row := s.db.QueryRowContext(r.Context(), automationClubSelect+" WHERE c.club_id = ?", clubID)
	club, err := scanAutomationClub(row)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "CLUB_NOT_FOUND", "没有找到这个自动化俱乐部")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取俱乐部失败")
		return
	}
	rooms, err := s.queryAutomationRooms(r, scope, clubID, "", "", 1, 100)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取俱乐部房间失败")
		return
	}
	groups, err := s.queryAutomationGroups(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取俱乐部自动化组失败")
		return
	}
	writeData(w, http.StatusOK, map[string]any{"club": club, "rooms": rooms, "groups": groups})
}

type automationClubUpdateRequest struct {
	RobotQuota int    `json:"robotQuota"`
	SeatRatio  int    `json:"seatRatio"`
	MaxPerRoom int    `json:"maxPerRoom"`
	InviteCode string `json:"inviteCode"`
	Status     string `json:"status"`
	Notes      string `json:"notes"`
}

func (s *Server) handleUpdateAutomationClub(w http.ResponseWriter, r *http.Request, p principal) {
	clubID := r.PathValue("clubId")
	scope, err := s.automationScope(r.Context(), p)
	if err != nil || !s.automationClubOrError(w, r, scope, clubID) {
		return
	}
	var input automationClubUpdateRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Notes = strings.TrimSpace(input.Notes)
	input.InviteCode = strings.TrimSpace(input.InviteCode)
	if input.RobotQuota < 0 || input.RobotQuota > 500 {
		writeError(w, http.StatusBadRequest, "INVALID_QUOTA", "投放数量必须在 0 到 500 之间")
		return
	}
	if input.SeatRatio < 0 || input.SeatRatio > 100 {
		writeError(w, http.StatusBadRequest, "INVALID_SEAT_RATIO", "占座比例必须在 0 到 100 之间")
		return
	}
	if input.MaxPerRoom < 1 || input.MaxPerRoom > 8 {
		writeError(w, http.StatusBadRequest, "INVALID_MAX_PER_ROOM", "每个房间最多进入的机器人数必须在 1 到 8 之间")
		return
	}
	if input.InviteCode != "" && !isSixDigitCode(input.InviteCode) {
		writeError(w, http.StatusBadRequest, "INVALID_INVITE_CODE", "邀请码必须是 6 位数字")
		return
	}
	if input.Status != "enabled" && input.Status != "disabled" {
		writeError(w, http.StatusBadRequest, "INVALID_STATUS", "俱乐部接入状态不正确")
		return
	}
	if len([]rune(input.Notes)) > 120 {
		writeError(w, http.StatusBadRequest, "INVALID_NOTES", "备注不能超过 120 个字符")
		return
	}
	var before automationClubUpdateRequest
	if err := s.db.QueryRowContext(r.Context(), "SELECT robot_quota, seat_ratio, max_per_room, invite_code, status, notes FROM mgr_automation_club WHERE club_id = ?", clubID).
		Scan(&before.RobotQuota, &before.SeatRatio, &before.MaxPerRoom, &before.InviteCode, &before.Status, &before.Notes); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "CLUB_NOT_FOUND", "没有找到这个自动化俱乐部")
			return
		}
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取俱乐部失败")
		return
	}
	var robotCount int
	if err := s.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM mgr_automation_robot WHERE club_id = ?", clubID).Scan(&robotCount); err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取俱乐部机器人数量失败")
		return
	}
	if input.RobotQuota < robotCount {
		writeError(w, http.StatusConflict, "QUOTA_BELOW_USAGE", fmt.Sprintf("俱乐部当前已有 %d 台机器人，投放数量不能低于这个值", robotCount))
		return
	}
	if _, err := s.db.ExecContext(r.Context(), `UPDATE mgr_automation_club
SET robot_quota = ?, seat_ratio = ?, max_per_room = ?, invite_code = ?, status = ?, notes = ? WHERE club_id = ?`,
		input.RobotQuota, input.SeatRatio, input.MaxPerRoom, input.InviteCode, input.Status, input.Notes, clubID); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "保存俱乐部投放配置失败")
		return
	}
	s.audit(r.Context(), &p, "automation.club.update", "automation_club", clubID, input, before, input, 0, "俱乐部接入配置已更新", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"message": "俱乐部接入配置已保存"})
}

func (s *Server) handleRefreshAutomationClub(w http.ResponseWriter, r *http.Request, p principal) {
	clubID := r.PathValue("clubId")
	scope, err := s.automationScope(r.Context(), p)
	if err != nil || !s.automationClubOrError(w, r, scope, clubID) {
		return
	}
	result, err := s.db.ExecContext(r.Context(), `UPDATE mgr_automation_room_snapshot
SET captured_at = NOW(), remaining_min = GREATEST(remaining_min, 1) WHERE club_id = ?`, clubID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "刷新房间池失败")
		return
	}
	affected, _ := result.RowsAffected()
	s.audit(r.Context(), &p, "automation.club.refresh", "automation_club", clubID, nil, nil, map[string]any{"rooms": affected}, 0, "已刷新俱乐部房间池快照", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"rooms": affected, "refreshedAt": time.Now(), "message": fmt.Sprintf("已刷新 %d 个房间快照", affected)})
}

func (s *Server) queryAutomationRooms(r *http.Request, scope automationScope, clubID, tier, status string, page, size int) ([]automationRoomItem, error) {
	conditions := []string{}
	args := []any{}
	scopeSQL, scopeArgs := scopeClause("r.club_id", scope)
	conditions = append(conditions, scopeSQL)
	args = append(args, scopeArgs...)
	if clubID != "" {
		conditions = append(conditions, "r.club_id = ?")
		args = append(args, clubID)
	}
	if tier != "" {
		conditions = append(conditions, "r.tier = ?")
		args = append(args, tier)
	}
	if status != "" {
		conditions = append(conditions, "r.status = ?")
		args = append(args, status)
	}
	queryArgs := append(append([]any{}, args...), size, (page-1)*size)
	rows, err := s.db.QueryContext(r.Context(), `SELECT r.room_id, r.club_id, c.name, r.room_name, r.tier, r.base_score,
r.duration_min, r.status, r.seated, r.max_seats, r.observers, r.remaining_min, r.captured_at,
(SELECT COUNT(*) FROM mgr_automation_robot t WHERE t.room_id = r.room_id AND t.status IN ('seated','playing','paused'))
FROM mgr_automation_room_snapshot r
LEFT JOIN mgr_automation_club c ON c.club_id = r.club_id
WHERE `+strings.Join(conditions, " AND ")+`
ORDER BY r.club_id, r.room_id LIMIT ? OFFSET ?`, queryArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []automationRoomItem{}
	for rows.Next() {
		var item automationRoomItem
		var clubName sql.NullString
		if err := rows.Scan(&item.RoomID, &item.ClubID, &clubName, &item.RoomName, &item.Tier, &item.BaseScore,
			&item.DurationMin, &item.Status, &item.Seated, &item.MaxSeats, &item.Observers, &item.RemainingMin,
			&item.CapturedAt, &item.Robots); err != nil {
			return nil, err
		}
		item.ClubName = clubName.String
		item.Humans = item.Seated - item.Robots
		if item.Humans < 0 {
			item.Humans = 0
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Server) handleListAutomationRooms(w http.ResponseWriter, r *http.Request, p principal) {
	scope, err := s.automationScope(r.Context(), p)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取数据范围失败")
		return
	}
	page, size := pageParams(r)
	if size > 100 {
		size = 100
	}
	clubID := strings.TrimSpace(r.URL.Query().Get("clubId"))
	if clubID != "" && !s.automationClubOrError(w, r, scope, clubID) {
		return
	}
	tier := strings.TrimSpace(r.URL.Query().Get("tier"))
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	hasSeat := r.URL.Query().Get("hasSeat") == "1"
	items, err := s.queryAutomationRooms(r, scope, clubID, tier, status, page, size)
	if err != nil {
		s.logger.Error("list automation rooms", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取房间池失败")
		return
	}
	conditions := []string{}
	countArgs := []any{}
	scopeSQL, scopeArgs := scopeClause("club_id", scope)
	conditions = append(conditions, scopeSQL)
	countArgs = append(countArgs, scopeArgs...)
	if clubID != "" {
		conditions = append(conditions, "club_id = ?")
		countArgs = append(countArgs, clubID)
	}
	if tier != "" {
		conditions = append(conditions, "tier = ?")
		countArgs = append(countArgs, tier)
	}
	if status != "" {
		conditions = append(conditions, "status = ?")
		countArgs = append(countArgs, status)
	}
	if hasSeat {
		conditions = append(conditions, "seated < max_seats")
	}
	var total int64
	if err := s.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM mgr_automation_room_snapshot WHERE "+strings.Join(conditions, " AND "), countArgs...).Scan(&total); err != nil {
		s.logger.Error("count automation rooms", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取房间数量失败")
		return
	}
	if hasSeat {
		filtered := items[:0]
		for _, item := range items {
			if item.Seated < item.MaxSeats {
				filtered = append(filtered, item)
			}
		}
		items = filtered
	}
	writeData(w, http.StatusOK, map[string]any{"items": items, "page": page, "pageSize": size, "total": total})
}

type automationAssignRequest struct {
	RobotID int64 `json:"robotId"`
	SeatNo  int   `json:"seatNo"`
}

func (s *Server) handleAssignAutomationRoom(w http.ResponseWriter, r *http.Request, p principal) {
	roomID, ok := parsePositivePathID(w, r, "roomId", "房间号不正确")
	if !ok {
		return
	}
	var input automationAssignRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if input.RobotID <= 0 {
		writeError(w, http.StatusBadRequest, "INVALID_ROBOT", "请选择要指派的机器人终端")
		return
	}
	scope, err := s.automationScope(r.Context(), p)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取数据范围失败")
		return
	}
	var clubID, roomStatus string
	var seated, maxSeats int
	if err := s.db.QueryRowContext(r.Context(), `SELECT club_id, status, seated, max_seats
FROM mgr_automation_room_snapshot WHERE room_id = ?`, roomID).Scan(&clubID, &roomStatus, &seated, &maxSeats); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "ROOM_NOT_FOUND", "没有找到这个俱乐部房间")
			return
		}
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取房间失败")
		return
	}
	if !s.automationClubOrError(w, r, scope, clubID) {
		return
	}
	if seated >= maxSeats {
		writeError(w, http.StatusConflict, "ROOM_FULL", "该房间已经满座，不能继续指派")
		return
	}
	var maxPerRoom int
	if err := s.db.QueryRowContext(r.Context(), "SELECT max_per_room FROM mgr_automation_club WHERE club_id = ?", clubID).Scan(&maxPerRoom); err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取俱乐部投放配置失败")
		return
	}
	var roomRobots int
	if err := s.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM mgr_automation_robot WHERE room_id = ?", roomID).Scan(&roomRobots); err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取房间机器人数量失败")
		return
	}
	if maxPerRoom > 0 && roomRobots >= maxPerRoom {
		writeError(w, http.StatusConflict, "ROOM_ROBOT_LIMIT", fmt.Sprintf("该房间按投放配置最多进入 %d 台机器人，请换房或调整每房上限", maxPerRoom))
		return
	}
	var robotClub, robotStatus string
	var robotRoom sql.NullInt64
	var robotEnabled bool
	if err := s.db.QueryRowContext(r.Context(), "SELECT club_id, status, room_id, enabled FROM mgr_automation_robot WHERE id = ?", input.RobotID).
		Scan(&robotClub, &robotStatus, &robotRoom, &robotEnabled); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "ROBOT_NOT_FOUND", "没有找到这个机器人终端")
			return
		}
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取机器人终端失败")
		return
	}
	if !robotEnabled {
		writeError(w, http.StatusConflict, "ROBOT_DISABLED", "该终端已停用，请先启用")
		return
	}
	if !s.automationClubOrError(w, r, scope, robotClub) {
		return
	}
	if robotClub != clubID {
		writeError(w, http.StatusBadRequest, "CLUB_MISMATCH", "终端与房间不属于同一个俱乐部，当前只允许本俱乐部房间")
		return
	}
	if robotRoom.Valid {
		writeError(w, http.StatusConflict, "ROBOT_ALREADY_SEATED", "该终端已经在房间内，请先召回")
		return
	}
	if robotStatus != "idle" && robotStatus != "paused" && robotStatus != "stopped" && robotStatus != "created" {
		writeError(w, http.StatusConflict, "ROBOT_NOT_ASSIGNABLE", "当前状态的终端不能指派进房")
		return
	}
	seatNo := input.SeatNo
	if seatNo <= 0 || seatNo > maxSeats {
		used := map[int]bool{}
		rows, err := s.db.QueryContext(r.Context(), `SELECT seat_no FROM mgr_automation_robot
WHERE room_id = ? AND status IN ('seated','playing','paused') AND seat_no > 0`, roomID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取座位失败")
			return
		}
		for rows.Next() {
			var value int
			if err := rows.Scan(&value); err == nil {
				used[value] = true
			}
		}
		rows.Close()
		seatNo = 0
		for candidate := 1; candidate <= maxSeats; candidate++ {
			if !used[candidate] {
				seatNo = candidate
				break
			}
		}
		if seatNo == 0 {
			writeError(w, http.StatusConflict, "ROOM_FULL", "该房间没有可用座位")
			return
		}
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "TX_ERROR", "开始事务失败")
		return
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(r.Context(), `UPDATE mgr_automation_robot
SET room_id = ?, seat_no = ?, status = 'seated', desired_status = 'running',
buyin = CASE WHEN buyin <= 0 THEN 100 ELSE buyin END, last_heartbeat = NOW(), last_error = ''
WHERE id = ?`, roomID, seatNo, input.RobotID); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "指派终端失败")
		return
	}
	if _, err := tx.ExecContext(r.Context(), "UPDATE mgr_automation_room_snapshot SET seated = seated + 1 WHERE room_id = ?", roomID); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "更新房间人数失败")
		return
	}
	result, err := tx.ExecContext(r.Context(), `INSERT INTO mgr_automation_session
(robot_id, club_id, room_id, seat_no, started_at, buyin, is_demo)
SELECT id, club_id, ?, ?, NOW(), buyin, is_demo FROM mgr_automation_robot WHERE id = ?`, roomID, seatNo, input.RobotID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "创建对局会话失败")
		return
	}
	sessionID, _ := result.LastInsertId()
	_, _ = tx.ExecContext(r.Context(), `INSERT INTO mgr_automation_session_event (session_id, event_at, event_type, detail)
VALUES (?, NOW(), 'seated', ?)`, sessionID, fmt.Sprintf("已进入 %d 房，%d 号座", roomID, seatNo))
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "TX_ERROR", "提交指派失败")
		return
	}
	s.audit(r.Context(), &p, "automation.room.assign", "automation_room", strconv.FormatInt(roomID, 10),
		map[string]any{"robotId": input.RobotID, "seatNo": seatNo}, nil, map[string]any{"roomId": roomID, "seatNo": seatNo}, 0, "机器人已指派进房", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"message": fmt.Sprintf("终端已进入 %d 房 %d 号座", roomID, seatNo)})
}

func (s *Server) handleRecallAutomationRoom(w http.ResponseWriter, r *http.Request, p principal) {
	roomID, ok := parsePositivePathID(w, r, "roomId", "房间号不正确")
	if !ok {
		return
	}
	var input automationAssignRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if input.RobotID <= 0 {
		writeError(w, http.StatusBadRequest, "INVALID_ROBOT", "请选择要召回的机器人终端")
		return
	}
	scope, err := s.automationScope(r.Context(), p)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取数据范围失败")
		return
	}
	var clubID string
	var currentRoom sql.NullInt64
	if err := s.db.QueryRowContext(r.Context(), "SELECT club_id, room_id FROM mgr_automation_robot WHERE id = ?", input.RobotID).
		Scan(&clubID, &currentRoom); err != nil {
		writeError(w, http.StatusNotFound, "ROBOT_NOT_FOUND", "没有找到这个机器人终端")
		return
	}
	if !s.automationClubOrError(w, r, scope, clubID) {
		return
	}
	if !currentRoom.Valid || currentRoom.Int64 != roomID {
		writeError(w, http.StatusConflict, "ROBOT_NOT_IN_ROOM", "该终端当前不在这个房间")
		return
	}
	if err := s.releaseAutomationRobotSeat(r, input.RobotID, "recall", "idle"); err != nil {
		s.logger.Error("recall automation robot", "error", err, "robotId", input.RobotID)
		writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "召回终端失败")
		return
	}
	s.audit(r.Context(), &p, "automation.room.recall", "automation_room", strconv.FormatInt(roomID, 10),
		map[string]any{"robotId": input.RobotID}, nil, map[string]any{"roomId": roomID}, 0, "机器人已从房间召回", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"message": "终端已召回并回到空闲状态"})
}

func (s *Server) releaseAutomationRobotSeat(r *http.Request, robotID int64, reason, nextStatus string) error {
	var roomID sql.NullInt64
	if err := s.db.QueryRowContext(r.Context(), "SELECT room_id FROM mgr_automation_robot WHERE id = ?", robotID).Scan(&roomID); err != nil {
		return err
	}
	var sessionID sql.NullInt64
	_ = s.db.QueryRowContext(r.Context(), `SELECT id FROM mgr_automation_session
WHERE robot_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1`, robotID).Scan(&sessionID)
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if sessionID.Valid {
		if _, err := tx.ExecContext(r.Context(), `UPDATE mgr_automation_session
SET ended_at = NOW(), end_reason = ? WHERE id = ?`, reason, sessionID.Int64); err != nil {
			return err
		}
		_, _ = tx.ExecContext(r.Context(), `INSERT INTO mgr_automation_session_event (session_id, event_at, event_type, detail)
VALUES (?, NOW(), 'left', ?)`, sessionID.Int64, "已离房，原因："+reason)
	}
	if roomID.Valid {
		if _, err := tx.ExecContext(r.Context(), `UPDATE mgr_automation_room_snapshot
SET seated = GREATEST(seated - 1, 0) WHERE room_id = ?`, roomID.Int64); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(r.Context(), `UPDATE mgr_automation_robot
SET room_id = NULL, seat_no = 0, status = ?, last_heartbeat = NOW(),
desired_status = CASE WHEN ? = 'stopped' THEN 'stopped' ELSE desired_status END
WHERE id = ?`, nextStatus, nextStatus, robotID); err != nil {
		return err
	}
	return tx.Commit()
}

type automationScopeUserItem struct {
	UserID      int64    `json:"userId"`
	Username    string   `json:"username"`
	DisplayName string   `json:"displayName"`
	RoleName    string   `json:"roleName"`
	IsSuper     bool     `json:"isSuper"`
	ClubIDs     []string `json:"clubIds"`
}

func (s *Server) handleListAutomationScopes(w http.ResponseWriter, r *http.Request, p principal) {
	if !p.Can("automation.scope.manage") {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "当前角色没有维护数据范围的权限")
		return
	}
	rows, err := s.db.QueryContext(r.Context(), `SELECT u.id, u.username, u.display_name, r.name, u.is_super
FROM mgr_user u JOIN mgr_role r ON r.id = u.role_id
WHERE (? = 1 OR u.username <> 'admin999')
ORDER BY u.id`, canSeeProtectedRootFlag(p))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取后台用户失败")
		return
	}
	defer rows.Close()
	items := []automationScopeUserItem{}
	index := map[int64]int{}
	for rows.Next() {
		var item automationScopeUserItem
		if err := rows.Scan(&item.UserID, &item.Username, &item.DisplayName, &item.RoleName, &item.IsSuper); err != nil {
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取后台用户失败")
			return
		}
		item.ClubIDs = []string{}
		index[item.UserID] = len(items)
		items = append(items, item)
	}
	rows.Close()
	scopeRows, err := s.db.QueryContext(r.Context(), "SELECT user_id, club_id FROM mgr_automation_scope ORDER BY user_id, club_id")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取数据范围失败")
		return
	}
	defer scopeRows.Close()
	for scopeRows.Next() {
		var userID int64
		var clubID string
		if err := scopeRows.Scan(&userID, &clubID); err != nil {
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取数据范围失败")
			return
		}
		if position, ok := index[userID]; ok {
			items[position].ClubIDs = append(items[position].ClubIDs, clubID)
		}
	}
	clubRows, err := s.db.QueryContext(r.Context(), "SELECT club_id, name FROM mgr_automation_club ORDER BY club_id")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取俱乐部列表失败")
		return
	}
	defer clubRows.Close()
	clubs := []map[string]string{}
	for clubRows.Next() {
		var clubID, name string
		if err := clubRows.Scan(&clubID, &name); err != nil {
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取俱乐部列表失败")
			return
		}
		clubs = append(clubs, map[string]string{"clubId": clubID, "name": name})
	}
	writeData(w, http.StatusOK, map[string]any{"items": items, "clubs": clubs})
}

type automationScopeUpdateRequest struct {
	ClubIDs []string `json:"clubIds"`
}

func (s *Server) handleUpdateAutomationScope(w http.ResponseWriter, r *http.Request, p principal) {
	if !p.Can("automation.scope.manage") {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "当前角色没有维护数据范围的权限")
		return
	}
	userID, ok := parsePositivePathID(w, r, "userId", "用户 ID 不正确")
	if !ok {
		return
	}
	var input automationScopeUpdateRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	seen := map[string]bool{}
	clubIDs := []string{}
	for _, clubID := range input.ClubIDs {
		clubID = strings.TrimSpace(clubID)
		if !validClubID(clubID) {
			writeError(w, http.StatusBadRequest, "INVALID_CLUB_ID", "俱乐部 ID 必须是 6 位数字")
			return
		}
		if seen[clubID] {
			continue
		}
		var exists int
		if err := s.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM mgr_automation_club WHERE club_id = ?", clubID).Scan(&exists); err != nil || exists == 0 {
			writeError(w, http.StatusBadRequest, "CLUB_NOT_FOUND", "选择的俱乐部不存在")
			return
		}
		seen[clubID] = true
		clubIDs = append(clubIDs, clubID)
	}
	var username string
	if err := s.db.QueryRowContext(r.Context(), "SELECT username FROM mgr_user WHERE id = ?", userID).Scan(&username); err != nil {
		writeError(w, http.StatusNotFound, "USER_NOT_FOUND", "后台用户不存在")
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "TX_ERROR", "开始事务失败")
		return
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(r.Context(), "DELETE FROM mgr_automation_scope WHERE user_id = ?", userID); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "保存数据范围失败")
		return
	}
	for _, clubID := range clubIDs {
		if _, err := tx.ExecContext(r.Context(), "INSERT INTO mgr_automation_scope (user_id, club_id) VALUES (?, ?)", userID, clubID); err != nil {
			writeError(w, http.StatusInternalServerError, "UPDATE_ERROR", "保存数据范围失败")
			return
		}
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "TX_ERROR", "提交数据范围失败")
		return
	}
	s.audit(r.Context(), &p, "automation.scope.update", "mgr_user", strconv.FormatInt(userID, 10),
		map[string]any{"clubIds": clubIDs}, nil, map[string]any{"username": username, "clubIds": clubIDs}, 0, "已更新俱乐部数据范围", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"message": "数据范围已保存"})
}

type automationDeployRequest struct {
	RobotIDs     []int64              `json:"robotIds"`
	GroupIDs     []int64              `json:"groupIds"`
	StrategyID   int64                `json:"strategyId"`
	ProfitMode   string               `json:"profitMode"`
	ProfitTarget int64                `json:"profitTarget"`
	PeriodStart  string               `json:"periodStart"`
	PeriodEnd    string               `json:"periodEnd"`
	ProfitSchedule []profitScheduleItem `json:"profitSchedule"`
	RoomPi       string               `json:"roomPi"`
}

type deployAPIError struct {
	Status  int
	Code    string
	Message string
}

type deployOutcome struct {
	Count      int
	InviteCode string
	RobotIDs   []int64
	Message    string
}

func (s *Server) handleDeployAutomationRobots(w http.ResponseWriter, r *http.Request, p principal) {
	clubID := r.PathValue("clubId")
	scope, err := s.automationScope(r.Context(), p)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取数据范围失败")
		return
	}
	if !s.automationClubOrError(w, r, scope, clubID) {
		return
	}
	var input automationDeployRequest
	if !decodeJSON(w, r, &input) {
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
	writeData(w, http.StatusOK, map[string]any{
		"count": outcome.Count, "clubId": clubID, "inviteCode": outcome.InviteCode,
		"joinPending": len(outcome.RobotIDs), "message": outcome.Message,
	})
}

// performAutomationDeploy 把机器人池里的账号投放到指定俱乐部，投放后由 startAutomationJoins 负责真实入会。
// 策略与输赢目标属于「投放配置」：strategyID > 0 时给这批机器人绑策略；
// profitMode 非空时同时写入输赢目标（每日 / 一段时间），为空表示沿用机器人原有设置。
// roomPi 是这批机器人只进的底皮档位，空串表示不限。
func (s *Server) performAutomationDeploy(r *http.Request, clubID string, robotIDs, groupIDs []int64, strategyID int64, profitMode string, profitTarget int64, periodStart, periodEnd string, profitSchedule []profitScheduleItem, roomPi string) (deployOutcome, *deployAPIError) {
	// 投放必须指定一套策略和输赢目标：这两项决定机器人怎么跑、跑到什么程度停，不能"沿用"。
	if strategyID <= 0 {
		return deployOutcome{}, &deployAPIError{http.StatusBadRequest, "STRATEGY_REQUIRED", "投放必须选择一个策略"}
	}
	var strategyStatus string
	if err := s.db.QueryRowContext(r.Context(), "SELECT status FROM mgr_automation_strategy WHERE id = ?", strategyID).
		Scan(&strategyStatus); err != nil {
		return deployOutcome{}, &deployAPIError{http.StatusBadRequest, "STRATEGY_NOT_FOUND", "选择的策略不存在，请刷新后重试"}
	}
	if strategyStatus == "disabled" {
		return deployOutcome{}, &deployAPIError{http.StatusBadRequest, "STRATEGY_DISABLED", "选择的策略已停用，不能用于投放"}
	}
	profitMode = strings.TrimSpace(profitMode)
	if profitMode == "" {
		return deployOutcome{}, &deployAPIError{http.StatusBadRequest, "PROFIT_MODE_REQUIRED", "投放必须选择输赢目标"}
	}
	if profitMode != "daily" && profitMode != "period" && profitMode != "none" && profitMode != "schedule" {
		return deployOutcome{}, &deployAPIError{http.StatusBadRequest, "INVALID_PROFIT_MODE", "输赢目标模式不正确"}
	}
	var inviteCode, clubStatus string
	var quota int
	if err := s.db.QueryRowContext(r.Context(), "SELECT invite_code, robot_quota, status FROM mgr_automation_club WHERE club_id = ?", clubID).
		Scan(&inviteCode, &quota, &clubStatus); err != nil {
		return deployOutcome{}, &deployAPIError{http.StatusNotFound, "CLUB_NOT_FOUND", "没有找到这个俱乐部"}
	}
	if clubStatus != "enabled" {
		return deployOutcome{}, &deployAPIError{http.StatusConflict, "CLUB_DISABLED", "俱乐部当前已停用，不能投放机器人"}
	}
	inviteCode = strings.TrimSpace(inviteCode)
	if !isSixDigitCode(inviteCode) {
		return deployOutcome{}, &deployAPIError{http.StatusBadRequest, "INVALID_INVITE_CODE", "请先给这个俱乐部设置 6 位数字邀请码"}
	}
	idSet := map[int64]bool{}
	for _, id := range robotIDs {
		if id > 0 {
			idSet[id] = true
		}
	}
	for _, groupID := range groupIDs {
		if groupID <= 0 {
			continue
		}
		rows, err := s.db.QueryContext(r.Context(), "SELECT id FROM mgr_automation_robot WHERE group_id = ? AND club_id = '' AND enabled = 1", groupID)
		if err != nil {
			return deployOutcome{}, &deployAPIError{http.StatusInternalServerError, "QUERY_ERROR", "读取分组机器人失败"}
		}
		for rows.Next() {
			var id int64
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return deployOutcome{}, &deployAPIError{http.StatusInternalServerError, "QUERY_ERROR", "读取分组机器人失败"}
			}
			idSet[id] = true
		}
		rows.Close()
	}
	if len(idSet) == 0 {
		return deployOutcome{}, &deployAPIError{http.StatusBadRequest, "NOTHING_TO_DEPLOY", "请选择要投放的机器人或分组"}
	}
	ids := make([]int64, 0, len(idSet))
	for id := range idSet {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	args := make([]any, 0, len(ids))
	for _, id := range ids {
		args = append(args, id)
	}
	rows, err := s.db.QueryContext(r.Context(), `SELECT id, terminal_no, club_id, room_id, enabled
FROM mgr_automation_robot WHERE id IN (`+placeholders(len(ids))+`)`, args...)
	if err != nil {
		return deployOutcome{}, &deployAPIError{http.StatusInternalServerError, "QUERY_ERROR", "读取机器人失败"}
	}
	defer rows.Close()
	found := map[int64]bool{}
	for rows.Next() {
		var id int64
		var terminalNo, robotClub string
		var roomID sql.NullInt64
		var enabled bool
		if err := rows.Scan(&id, &terminalNo, &robotClub, &roomID, &enabled); err != nil {
			return deployOutcome{}, &deployAPIError{http.StatusInternalServerError, "QUERY_ERROR", "读取机器人失败"}
		}
		found[id] = true
		if robotClub != "" {
			return deployOutcome{}, &deployAPIError{http.StatusConflict, "ROBOT_ALREADY_DEPLOYED", fmt.Sprintf("机器人 %s 已投放到俱乐部 %s，请先撤回", terminalNo, robotClub)}
		}
		if !enabled {
			return deployOutcome{}, &deployAPIError{http.StatusConflict, "ROBOT_DISABLED", fmt.Sprintf("机器人 %s 已停用，请先启用", terminalNo)}
		}
		if roomID.Valid {
			return deployOutcome{}, &deployAPIError{http.StatusConflict, "ROBOT_IN_ROOM", fmt.Sprintf("机器人 %s 正在房间中，不能投放", terminalNo)}
		}
	}
	if len(found) != len(ids) {
		return deployOutcome{}, &deployAPIError{http.StatusNotFound, "ROBOT_NOT_FOUND", "部分机器人不存在，请刷新后重试"}
	}
	strategyName := ""
	if strategyID > 0 {
		if err := s.db.QueryRowContext(r.Context(), "SELECT name FROM mgr_automation_strategy WHERE id = ?", strategyID).Scan(&strategyName); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return deployOutcome{}, &deployAPIError{http.StatusBadRequest, "STRATEGY_NOT_FOUND", "选择的策略不存在，请刷新后重试"}
			}
			return deployOutcome{}, &deployAPIError{http.StatusInternalServerError, "QUERY_ERROR", "读取策略失败"}
		}
	}
	// 周计划沿用每日目标的数值校验：金额范围一致，只是累计口径换成时段。
	validationMode := profitMode
	if validationMode == "schedule" {
		validationMode = "daily"
	}
	periodStartTime, periodEndTime, profitMessage := validateAutomationProfit(validationMode, profitTarget, periodStart, periodEnd, false)
	if profitMessage != "" {
		return deployOutcome{}, &deployAPIError{http.StatusBadRequest, "INVALID_PROFIT_TARGET", profitMessage}
	}
	scheduleJSON, scheduleMessage := "", ""
	if profitMode == "schedule" {
		scheduleJSON, scheduleMessage = normalizeProfitSchedule(profitSchedule)
		if scheduleMessage != "" {
			return deployOutcome{}, &deployAPIError{http.StatusBadRequest, "INVALID_PROFIT_SCHEDULE", scheduleMessage}
		}
	}
	if profitMode == "none" {
		profitTarget = 0
	}
	roomPi, roomPiMessage := normalizeRoomPiList(roomPi)
	if roomPiMessage != "" {
		return deployOutcome{}, &deployAPIError{http.StatusBadRequest, "INVALID_ROOM_PI", roomPiMessage}
	}
	var used int
	if err := s.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM mgr_automation_robot WHERE club_id = ?", clubID).Scan(&used); err != nil {
		return deployOutcome{}, &deployAPIError{http.StatusInternalServerError, "QUERY_ERROR", "读取已投放数量失败"}
	}
	if quota > 0 && used+len(ids) > quota {
		return deployOutcome{}, &deployAPIError{http.StatusConflict, "QUOTA_EXCEEDED", fmt.Sprintf("俱乐部投放数量为 %d 台，当前已有 %d 台，本次最多还能投放 %d 台", quota, used, max(0, quota-used))}
	}
	setClauses := []string{"club_id = ?", "invite_code = ?", "join_status = 'pending'", "joined_at = NULL",
		"status = 'idle'", "desired_status = 'stopped'", "last_error = ''", "last_heartbeat = NOW()", "room_pi = ?"}
	updateArgs := []any{clubID, inviteCode, roomPi}
	if strategyID > 0 {
		setClauses = append(setClauses, "strategy_id = ?")
		updateArgs = append(updateArgs, strategyID)
	}
	if profitMode != "" {
		// 周计划要顺带重置时段净分，并按当前时间决定投放后是直接上机还是先挂牌等时段。
		scheduleWindow, scheduleState := scheduleDeployState(scheduleJSON, time.Now())
		setClauses = append(setClauses, "profit_mode = ?", "profit_target = ?", "period_start = ?", "period_end = ?",
			"profit_schedule = ?", "schedule_window = ?", "window_net = 0", "schedule_state = ?")
		updateArgs = append(updateArgs, profitMode, profitTarget, nullableTime(periodStartTime), nullableTime(periodEndTime),
			scheduleJSON, scheduleWindow, scheduleState)
	}
	updateArgs = append(updateArgs, args...)
	result, err := s.db.ExecContext(r.Context(), `UPDATE mgr_automation_robot SET `+strings.Join(setClauses, ", ")+`
WHERE id IN (`+placeholders(len(ids))+`) AND club_id = ''`, updateArgs...)
	if err != nil {
		s.logger.Error("deploy automation robots", "error", err)
		return deployOutcome{}, &deployAPIError{http.StatusInternalServerError, "DEPLOY_ERROR", "投放机器人失败"}
	}
	affected, _ := result.RowsAffected()
	message := fmt.Sprintf("已把 %d 台机器人投放到俱乐部 %s，正在用邀请码 %s 自动加入", affected, clubID, inviteCode)
	if strategyName != "" {
		message += "，策略：" + strategyName
	}
	if profitMode != "" {
		message += "，" + profitSummaryText(profitMode, profitTarget)
	}
	if roomPi != "" {
		message += "，只进 " + strings.ReplaceAll(roomPi, ",", "、") + " 的房间"
	}
	return deployOutcome{Count: int(affected), InviteCode: inviteCode, RobotIDs: ids, Message: message}, nil
}

func profitSummaryText(mode string, target int64) string {
	if mode == "period" {
		return fmt.Sprintf("周期输赢目标 %d", target)
	}
	return fmt.Sprintf("每日输赢目标 %d", target)
}
