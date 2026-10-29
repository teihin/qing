package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"sort"
	"strconv"
	"strings"
	"time"
)

// 周计划：输赢目标按「周一到周日 + 每天多个时段」跑。
// 时段内照常分配 Worker 并按时段净分控制输赢；时段结束先排空（打完手里这一局），
// 离房后把 Worker 位置让出来，等下个时段开始再重新分配。

// profitScheduleItem 是接口层与落库共用的时段结构，weekday 1=周一 … 7=周日。
type profitScheduleItem struct {
	Weekday int    `json:"weekday"`
	Start   string `json:"start"`
	End     string `json:"end"`
}

// profitWindow 是解析后的时段：分钟数便于比较，原文用于回写与日志。
type profitWindow struct {
	weekday   int
	startMin  int
	endMin    int
	startText string
}

const maxProfitWindows = 28

func clockMinutes(value string) (int, bool) {
	parts := strings.Split(strings.TrimSpace(value), ":")
	if len(parts) != 2 {
		return 0, false
	}
	hour, err := strconv.Atoi(parts[0])
	if err != nil || hour < 0 || hour > 23 {
		return 0, false
	}
	minute, err := strconv.Atoi(parts[1])
	if err != nil || minute < 0 || minute > 59 {
		return 0, false
	}
	return hour*60 + minute, true
}

func clockText(minutes int) string {
	return fmt.Sprintf("%02d:%02d", minutes/60, minutes%60)
}

// normalizeProfitSchedule 校验并归一化周计划，返回可落库的 JSON。
// 返回的 message 非空表示校验失败，调用方直接回给前端。
func normalizeProfitSchedule(items []profitScheduleItem) (string, string) {
	if len(items) == 0 {
		return "", "按周时段跑至少要有勾选一个时段"
	}
	if len(items) > maxProfitWindows {
		return "", fmt.Sprintf("时段最多保存 %d 段", maxProfitWindows)
	}
	windows := make([]profitWindow, 0, len(items))
	seen := map[string]bool{}
	for _, item := range items {
		if item.Weekday < 1 || item.Weekday > 7 {
			return "", "时段的星期不正确"
		}
		start, ok := clockMinutes(item.Start)
		if !ok {
			return "", "时段的开始时间格式不正确"
		}
		end, ok := clockMinutes(item.End)
		if !ok {
			return "", "时段的结束时间格式不正确"
		}
		if start == end {
			return "", "时段的开始和结束时间不能相同"
		}
		key := fmt.Sprintf("%d-%d-%d", item.Weekday, start, end)
		if seen[key] {
			continue
		}
		seen[key] = true
		windows = append(windows, profitWindow{
			weekday:   item.Weekday,
			startMin:  start,
			endMin:    end,
			startText: clockText(start),
		})
	}
	sort.Slice(windows, func(i, j int) bool {
		if windows[i].weekday != windows[j].weekday {
			return windows[i].weekday < windows[j].weekday
		}
		return windows[i].startMin < windows[j].startMin
	})
	normalized := make([]profitScheduleItem, 0, len(windows))
	for _, window := range windows {
		normalized = append(normalized, profitScheduleItem{
			Weekday: window.weekday,
			Start:   window.startText,
			End:     clockText(window.endMin),
		})
	}
	encoded, err := json.Marshal(normalized)
	if err != nil {
		return "", "周计划格式不正确"
	}
	if len(encoded) > 1000 {
		return "", "周计划时段太多，保存不下"
	}
	return string(encoded), ""
}

// parseProfitSchedule 把落库的 JSON 解析成时段列表；坏数据按空计划处理，不让巡检报错。
func parseProfitSchedule(raw string) []profitWindow {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var items []profitScheduleItem
	if err := json.Unmarshal([]byte(raw), &items); err != nil {
		return nil
	}
	windows := make([]profitWindow, 0, len(items))
	for _, item := range items {
		if item.Weekday < 1 || item.Weekday > 7 {
			continue
		}
		start, ok := clockMinutes(item.Start)
		if !ok {
			continue
		}
		end, ok := clockMinutes(item.End)
		if !ok || start == end {
			continue
		}
		windows = append(windows, profitWindow{
			weekday:   item.Weekday,
			startMin:  start,
			endMin:    end,
			startText: clockText(start),
		})
	}
	return windows
}

func isoWeekday(day time.Time) int {
	weekday := int(day.Weekday())
	if weekday == 0 {
		return 7
	}
	return weekday
}

func windowKey(day time.Time, window profitWindow) string {
	return day.Format("2006-01-02") + " " + window.startText
}

// scheduleWindowAt 返回 now 所在时段的键；不在任何时段时返回空串。
// 时段按开始那天归属：跨零点的 22:00-02:00 在次日凌晨仍算前一天那一段。
func scheduleWindowAt(windows []profitWindow, now time.Time) (string, bool) {
	if len(windows) == 0 {
		return "", false
	}
	now = now.In(automationPeriodLocation)
	day := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, automationPeriodLocation)
	minute := now.Hour()*60 + now.Minute()
	yesterday := day.AddDate(0, 0, -1)
	for _, window := range windows {
		if window.endMin > window.startMin {
			if isoWeekday(day) == window.weekday && minute >= window.startMin && minute < window.endMin {
				return windowKey(day, window), true
			}
			continue
		}
		if isoWeekday(day) == window.weekday && minute >= window.startMin {
			return windowKey(day, window), true
		}
		if isoWeekday(yesterday) == window.weekday && minute < window.endMin {
			return windowKey(yesterday, window), true
		}
	}
	return "", false
}

// scheduleText 是给界面看的人话：周一 12:00-18:00、周三 22:00-02:00（次日）。
func scheduleText(raw string) string {
	windows := parseProfitSchedule(raw)
	if len(windows) == 0 {
		return ""
	}
	names := [...]string{"", "周一", "周二", "周三", "周四", "周五", "周六", "周日"}
	parts := make([]string, 0, len(windows))
	for _, window := range windows {
		end := clockText(window.endMin)
		if window.endMin <= window.startMin {
			end += "（次日）"
		}
		parts = append(parts, names[window.weekday]+" "+window.startText+"-"+end)
	}
	return strings.Join(parts, "，")
}

// scheduleDeployState 按当前时间给出投放时要写入的 (schedule_window, schedule_state)：
// 正处在时段里就正常上机；不在时段里先挂牌 released，等巡检到点再分配 Worker。
func scheduleDeployState(raw string, now time.Time) (string, string) {
	windows := parseProfitSchedule(raw)
	if len(windows) == 0 {
		return "", ""
	}
	if key, active := scheduleWindowAt(windows, now); active {
		return key, ""
	}
	return "", "released"
}

type scheduledRobot struct {
	id         int64
	account    string
	terminalNo string
	windows    []profitWindow
	windowKey  string
	state      string
	workerID   sql.NullInt64
	roomID     sql.NullInt64
	status     string
}

// SweepAutomationSchedules 按周计划收敛机器人：时段内恢复分配，时段结束排空并让出 Worker。
// 每 5 秒跟着巡检跑一次；所有时间都用 automationPeriodLocation（东八区）。
func SweepAutomationSchedules(ctx context.Context, db *sql.DB, logger *slog.Logger) {
	now := time.Now().In(automationPeriodLocation)
	rows, err := db.QueryContext(ctx, `SELECT id, account, terminal_no, profit_schedule, schedule_window,
schedule_state, worker_id, room_id, status
FROM mgr_automation_robot
WHERE profit_mode = 'schedule' AND profit_schedule <> ''
  AND enabled = 1 AND join_status = 'joined' AND club_id <> ''`)
	if err != nil {
		logger.Error("schedule sweep query", "error", err)
		return
	}
	list := []scheduledRobot{}
	for rows.Next() {
		var item scheduledRobot
		var raw string
		var windowKey, state string
		if err := rows.Scan(&item.id, &item.account, &item.terminalNo, &raw, &windowKey,
			&state, &item.workerID, &item.roomID, &item.status); err != nil {
			rows.Close()
			logger.Error("schedule sweep scan", "error", err)
			return
		}
		item.windows = parseProfitSchedule(raw)
		if len(item.windows) == 0 {
			continue
		}
		item.windowKey = windowKey
		item.state = state
		list = append(list, item)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		logger.Error("schedule sweep iterate", "error", err)
		return
	}
	if len(list) == 0 {
		return
	}
	for _, item := range list {
		if ctx.Err() != nil {
			return
		}
		key, active := scheduleWindowAt(item.windows, now)
		if active {
			if item.windowKey != key {
				if _, err := db.ExecContext(ctx, `UPDATE mgr_automation_robot
SET schedule_window = ?, window_net = 0 WHERE id = ?`, key, item.id); err != nil {
					logger.Error("schedule reset window net", "error", err, "robotId", item.id)
					continue
				}
			}
			// 只有被巡检让出过的机器人才自动复位，手动停止的不在时段开始时强行拉起。
			if !item.workerID.Valid && item.state == "released" {
				if _, err := db.ExecContext(ctx, `UPDATE mgr_automation_robot
SET schedule_state = '' WHERE id = ?`, item.id); err != nil {
					logger.Error("schedule resume robot", "error", err, "robotId", item.id)
				}
			}
			continue
		}
		if item.windowKey != "" {
			if _, err := db.ExecContext(ctx, `UPDATE mgr_automation_robot
SET schedule_window = '' WHERE id = ?`, item.id); err != nil {
				logger.Error("schedule clear window", "error", err, "robotId", item.id)
			}
		}
		if item.workerID.Valid {
			// 还在房里：先排空，客户端打完当前一局才会离房。
			if item.roomID.Valid || item.status == "seated" || item.status == "playing" {
				if _, err := db.ExecContext(ctx, `UPDATE mgr_automation_robot
SET desired_status = 'draining', schedule_state = 'released' WHERE id = ?`, item.id); err != nil {
					logger.Error("schedule drain robot", "error", err, "robotId", item.id)
				}
				continue
			}
			if _, err := db.ExecContext(ctx, `UPDATE mgr_automation_robot
SET worker_id = NULL, status = 'idle', room_id = NULL, seat_no = 0,
    desired_status = 'stopped', schedule_state = 'released', last_heartbeat = NOW()
WHERE id = ? AND worker_id = ?`, item.id, item.workerID.Int64); err != nil {
				logger.Error("schedule release robot", "error", err, "robotId", item.id)
				continue
			}
			recordWorkerEvent(ctx, db, item.workerID.Int64, workerEventRobotReleased, item.id, item.terminalNo, map[string]any{
				"account":    item.account,
				"terminalNo": item.terminalNo,
				"message":    "不在周计划时段，账号 " + item.account + " 让出节点",
			})
			refreshWorkerLoad(ctx, db)
			continue
		}
		if item.state != "released" {
			if _, err := db.ExecContext(ctx, `UPDATE mgr_automation_robot
SET schedule_state = 'released', desired_status = 'stopped' WHERE id = ?`, item.id); err != nil {
				logger.Error("schedule park robot", "error", err, "robotId", item.id)
			}
		}
	}
}
