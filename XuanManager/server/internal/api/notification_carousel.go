package api

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"xuanmanager/internal/config"
)

const (
	minCarouselInterval = 10
	maxCarouselInterval = 24 * 60 * 60
	maxCarouselItems    = 50
)

type notificationCarouselItem struct {
	ID        int64  `json:"id"`
	Content   string `json:"content"`
	SortOrder int    `json:"sortOrder"`
}

type notificationCarouselState struct {
	Enabled         bool                       `json:"enabled"`
	IntervalSeconds int                        `json:"intervalSeconds"`
	StartAt         *time.Time                 `json:"startAt"`
	LoopCount       int                        `json:"loopCount"`
	CompletedLoops  int                        `json:"completedLoops"`
	Items           []notificationCarouselItem `json:"items"`
	LastSentItemID  *int64                     `json:"lastSentItemId"`
	LastSentAt      *time.Time                 `json:"lastSentAt"`
	LastStatus      string                     `json:"lastStatus"`
	LastMessage     string                     `json:"lastMessage"`
	LastUpdatedBy   string                     `json:"lastUpdatedBy"`
	LastUpdatedAt   *time.Time                 `json:"lastUpdatedAt"`
}

type updateNotificationCarouselRequest struct {
	Enabled         bool   `json:"enabled"`
	IntervalSeconds int    `json:"intervalSeconds"`
	StartAt         string `json:"startAt"`
	LoopCount       int    `json:"loopCount"`
	Confirm         bool   `json:"confirm"`
	Items           []struct {
		Content string `json:"content"`
	} `json:"items"`
}

func (s *Server) handleGetNotificationCarousel(w http.ResponseWriter, r *http.Request, p principal) {
	state, err := s.queryNotificationCarousel(r.Context(), p)
	if err != nil {
		s.logger.Error("read notification carousel", "error", err)
		writeError(w, http.StatusInternalServerError, "NOTIFICATION_CAROUSEL_QUERY_FAILED", "读取轮播公告失败")
		return
	}
	writeData(w, http.StatusOK, state)
}

func (s *Server) handleUpdateNotificationCarousel(w http.ResponseWriter, r *http.Request, p principal) {
	var input updateNotificationCarouselRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	items, err := normalizeNotificationCarouselItems(input.Items)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_NOTIFICATION_CAROUSEL", err.Error())
		return
	}
	if input.IntervalSeconds < minCarouselInterval || input.IntervalSeconds > maxCarouselInterval {
		writeError(w, http.StatusBadRequest, "INVALID_NOTIFICATION_CAROUSEL_INTERVAL", "轮播间隔必须为10秒到24小时")
		return
	}
	if input.LoopCount < 0 || input.LoopCount > 999 {
		writeError(w, http.StatusBadRequest, "INVALID_NOTIFICATION_CAROUSEL_LOOPS", "循环次数必须为0到999，0表示持续循环")
		return
	}
	var startAt *time.Time
	if strings.TrimSpace(input.StartAt) != "" {
		parsed, parseErr := time.Parse(time.RFC3339, input.StartAt)
		if parseErr != nil {
			writeError(w, http.StatusBadRequest, "INVALID_NOTIFICATION_CAROUSEL_START", "轮播开始时间格式不正确")
			return
		}
		if parsed.After(time.Now().Add(366 * 24 * time.Hour)) {
			writeError(w, http.StatusBadRequest, "INVALID_NOTIFICATION_CAROUSEL_START", "轮播开始时间不能超过一年以后")
			return
		}
		startAt = &parsed
	}
	if input.Enabled && startAt == nil {
		writeError(w, http.StatusBadRequest, "NOTIFICATION_CAROUSEL_START_REQUIRED", "启用轮播前需要设置开始时间")
		return
	}
	if input.Enabled && len(items) == 0 {
		writeError(w, http.StatusBadRequest, "EMPTY_NOTIFICATION_CAROUSEL", "启用轮播前至少需要一条公告")
		return
	}
	if input.Enabled && !input.Confirm {
		writeError(w, http.StatusBadRequest, "NOTIFICATION_CAROUSEL_CONFIRM_REQUIRED", "请确认启用后将按设定间隔向全部在线玩家循环播放")
		return
	}
	before, err := s.queryNotificationCarousel(r.Context(), p)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "NOTIFICATION_CAROUSEL_UPDATE_FAILED", "读取原轮播配置失败")
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "NOTIFICATION_CAROUSEL_UPDATE_FAILED", "保存轮播公告失败")
		return
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(r.Context(), `UPDATE mgr_notification_carousel_setting
SET enabled = ?, interval_seconds = ?, start_at = ?, loop_count = ?, completed_loops = 0, revision = revision + 1,
    last_sent_item_id = NULL, last_sent_at = NULL, last_status = '', last_message = '', updated_by = ?
WHERE id = 1`, input.Enabled, input.IntervalSeconds, startAt, input.LoopCount, p.ID); err == nil {
		_, err = tx.ExecContext(r.Context(), `DELETE FROM mgr_notification_carousel_item`)
	}
	if err == nil {
		for index, item := range items {
			if _, err = tx.ExecContext(r.Context(), `INSERT INTO mgr_notification_carousel_item (content, sort_order) VALUES (?, ?)`, item.Content, index+1); err != nil {
				break
			}
		}
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		s.logger.Error("write notification carousel", "error", err)
		s.audit(r.Context(), &p, "game.notification.carousel.update", "mgr_notification_carousel", "1", input, before, nil, 500, "保存轮播公告失败", clientIP(r))
		writeError(w, http.StatusInternalServerError, "NOTIFICATION_CAROUSEL_UPDATE_FAILED", "保存轮播公告失败")
		return
	}
	s.audit(r.Context(), &p, "game.notification.carousel.update", "mgr_notification_carousel", "1",
		map[string]any{"enabled": input.Enabled, "intervalSeconds": input.IntervalSeconds, "startAt": startAt, "loopCount": input.LoopCount, "itemCount": len(items)}, before, nil, 0, "轮播公告配置已保存", clientIP(r))
	after, err := s.queryNotificationCarousel(r.Context(), p)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "NOTIFICATION_CAROUSEL_READBACK_FAILED", "轮播公告已保存，但回读失败")
		return
	}
	writeData(w, http.StatusOK, after)
}

func normalizeNotificationCarouselItems(input []struct {
	Content string `json:"content"`
}) ([]notificationCarouselItem, error) {
	if len(input) > maxCarouselItems {
		return nil, fmt.Errorf("轮播公告最多配置%d条", maxCarouselItems)
	}
	items := make([]notificationCarouselItem, 0, len(input))
	seen := map[string]bool{}
	for index, raw := range input {
		content := normalizeNotificationContent(raw.Content)
		if content == "" {
			return nil, fmt.Errorf("第%d条轮播公告不能为空", index+1)
		}
		if utf8.RuneCountInString(content) > 500 {
			return nil, fmt.Errorf("第%d条轮播公告不能超过500个字符", index+1)
		}
		if seen[content] {
			return nil, fmt.Errorf("第%d条轮播公告与前面的内容重复", index+1)
		}
		seen[content] = true
		items = append(items, notificationCarouselItem{Content: content, SortOrder: index + 1})
	}
	return items, nil
}

func (s *Server) queryNotificationCarousel(ctx context.Context, p principal) (notificationCarouselState, error) {
	state := notificationCarouselState{IntervalSeconds: 60, Items: []notificationCarouselItem{}}
	var enabled bool
	var lastSentID sql.NullInt64
	var startAt, lastSentAt sql.NullTime
	err := s.db.QueryRowContext(ctx, `SELECT enabled, interval_seconds, start_at, loop_count, completed_loops, last_sent_item_id, last_sent_at,
COALESCE(last_status, ''), COALESCE(last_message, '')
FROM mgr_notification_carousel_setting WHERE id = 1`).Scan(
		&enabled, &state.IntervalSeconds, &startAt, &state.LoopCount, &state.CompletedLoops, &lastSentID, &lastSentAt, &state.LastStatus, &state.LastMessage)
	if err != nil {
		return state, err
	}
	state.Enabled = enabled
	if startAt.Valid {
		value := startAt.Time
		state.StartAt = &value
	}
	if lastSentID.Valid {
		value := lastSentID.Int64
		state.LastSentItemID = &value
	}
	if lastSentAt.Valid {
		value := lastSentAt.Time
		state.LastSentAt = &value
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, content, sort_order FROM mgr_notification_carousel_item ORDER BY sort_order, id`)
	if err != nil {
		return state, err
	}
	defer rows.Close()
	for rows.Next() {
		var item notificationCarouselItem
		if err := rows.Scan(&item.ID, &item.Content, &item.SortOrder); err != nil {
			return state, err
		}
		state.Items = append(state.Items, item)
	}
	if err := rows.Err(); err != nil {
		return state, err
	}
	updatedBy, auditUpdatedAt, err := s.latestAuditAttribution(ctx, "game.notification.carousel.update", p)
	if err != nil {
		return state, err
	}
	state.LastUpdatedBy = updatedBy
	if auditUpdatedAt != nil {
		state.LastUpdatedAt = auditUpdatedAt
	}
	return state, nil
}

// RunNotificationCarouselWorker is enabled only on the formal 8891 process.
// Candidate and local services keep XUAN_NOTIFICATION_CAROUSEL_WORKER=false so
// verification can never broadcast a configured carousel to real players.
func RunNotificationCarouselWorker(ctx context.Context, db *sql.DB, cfg config.Config, logger *slog.Logger) {
	worker := &Server{db: db, cfg: cfg, logger: logger, gameHTTPClient: &http.Client{Timeout: 8 * time.Second}}
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	logger.Info("notification carousel worker started")
	for {
		select {
		case <-ctx.Done():
			logger.Info("notification carousel worker stopped")
			return
		case <-ticker.C:
			worker.runNotificationCarouselTick(ctx)
		}
	}
}

func (s *Server) runNotificationCarouselTick(ctx context.Context) {
	var enabled bool
	var intervalSeconds, loopCount, completedLoops int
	var revision int64
	var startAt sql.NullTime
	var lastSentID sql.NullInt64
	var lastSentAt sql.NullTime
	if err := s.db.QueryRowContext(ctx, `SELECT enabled, interval_seconds, start_at, loop_count, completed_loops, revision, last_sent_item_id, last_sent_at
FROM mgr_notification_carousel_setting WHERE id = 1`).Scan(&enabled, &intervalSeconds, &startAt, &loopCount, &completedLoops, &revision, &lastSentID, &lastSentAt); err != nil {
		s.logger.Error("read notification carousel worker state", "error", err)
		return
	}
	if !enabled {
		return
	}
	now := time.Now()
	if startAt.Valid && now.Before(startAt.Time) {
		return
	}
	if loopCount > 0 && completedLoops >= loopCount {
		_, _ = s.db.ExecContext(ctx, `UPDATE mgr_notification_carousel_setting
SET enabled = 0, last_status = 'completed', last_message = '已完成设定循环次数'
WHERE id = 1 AND revision = ?`, revision)
		return
	}
	if lastSentAt.Valid && now.Before(lastSentAt.Time.Add(time.Duration(intervalSeconds)*time.Second)) {
		return
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, content, sort_order FROM mgr_notification_carousel_item ORDER BY sort_order, id`)
	if err != nil {
		s.logger.Error("read notification carousel items", "error", err)
		return
	}
	items := []notificationCarouselItem{}
	for rows.Next() {
		var item notificationCarouselItem
		if err := rows.Scan(&item.ID, &item.Content, &item.SortOrder); err != nil {
			rows.Close()
			return
		}
		items = append(items, item)
	}
	rows.Close()
	if len(items) == 0 {
		return
	}
	item := nextNotificationCarouselItem(items, lastSentID)
	isLastItem := item.ID == items[len(items)-1].ID
	operationContext := gameOperationContext("carousel")
	result, sendErr := s.callGameCommand(ctx, "通知_所有玩家_信息", map[string]any{
		"system_content": notificationSystemContent(item.Content),
		"context":        operationContext,
	})
	status := "sent"
	message := "轮播公告已发送"
	var sentItemID any = item.ID
	nextCompletedLoops := completedLoops
	if sendErr != nil || (result.RetCode != 512 && result.RetCode != 1280) {
		status = "failed"
		message = "轮播公告发送失败，稍后按原顺序重试"
		sentItemID = nil
		if sendErr != nil {
			s.logger.Error("send notification carousel", "error", sendErr, "itemId", item.ID)
		} else {
			s.logger.Error("game service rejected notification carousel", "retCode", result.RetCode, "itemId", item.ID)
		}
	} else if result.RetCode == 1280 {
		status = "accepted"
		message = "游戏服务已接收轮播公告"
	}
	if status != "failed" && isLastItem {
		nextCompletedLoops++
		if loopCount > 0 && nextCompletedLoops >= loopCount {
			status = "completed"
			message = "已完成设定循环次数，轮播自动停止"
		}
	}
	_, err = s.db.ExecContext(ctx, `UPDATE mgr_notification_carousel_setting
SET last_sent_item_id = COALESCE(?, last_sent_item_id), last_sent_at = ?, completed_loops = ?,
    enabled = CASE WHEN ? = 'completed' THEN 0 ELSE enabled END, last_status = ?, last_message = ?
WHERE id = 1 AND enabled = 1 AND revision = ?`, sentItemID, now, nextCompletedLoops, status, status, message, revision)
	if err != nil {
		s.logger.Error("update notification carousel result", "error", err)
	}
}

func nextNotificationCarouselItem(items []notificationCarouselItem, lastSentID sql.NullInt64) notificationCarouselItem {
	if lastSentID.Valid {
		for index, item := range items {
			if item.ID == lastSentID.Int64 {
				return items[(index+1)%len(items)]
			}
		}
	}
	return items[0]
}

func notificationSystemContent(content string) string {
	return ",,,," + strings.TrimSpace(content)
}
