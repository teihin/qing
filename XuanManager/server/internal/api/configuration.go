package api

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const systemAnnouncementKey = "系统公告"

type gameAnnouncementState struct {
	Content       string     `json:"content"`
	Configured    bool       `json:"configured"`
	ContentLength int        `json:"contentLength"`
	Format        string     `json:"format"`
	LastUpdatedBy string     `json:"lastUpdatedBy"`
	LastUpdatedAt *time.Time `json:"lastUpdatedAt"`
	StorageKey    string     `json:"storageKey"`
	Encoding      string     `json:"encoding"`
	DuplicateRows int        `json:"duplicateRows"`
}

type updateGameAnnouncementRequest struct {
	Content string `json:"content"`
}

type sendGameNotificationRequest struct {
	Content string `json:"content"`
	Confirm bool   `json:"confirm"`
}

type gameNotificationHistoryItem struct {
	ID            int64     `json:"id"`
	Content       string    `json:"content"`
	OperatorName  string    `json:"operatorName"`
	Status        string    `json:"status"`
	ResultMessage string    `json:"resultMessage"`
	CreatedAt     time.Time `json:"createdAt"`
}

type storedAnnouncementRow struct {
	ID      int64
	Content string
}

func (s *Server) handleGetGameAnnouncement(w http.ResponseWriter, r *http.Request, p principal) {
	state, err := s.queryGameAnnouncement(r.Context(), p)
	if err != nil {
		s.logger.Error("read game announcement", "error", err)
		writeError(w, http.StatusInternalServerError, "ANNOUNCEMENT_QUERY_FAILED", "读取游戏公告失败")
		return
	}
	writeData(w, http.StatusOK, state)
}

func (s *Server) handleUpdateGameAnnouncement(w http.ResponseWriter, r *http.Request, p principal) {
	var input updateGameAnnouncementRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	content := normalizeAnnouncementContent(input.Content)
	if err := validateConfigurationText(content, 0, 4000, true, "公告内容"); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_ANNOUNCEMENT", err.Error())
		return
	}
	encoded := encodeClientBase64(content)
	beforeRows, err := s.loadStoredAnnouncementRows(r.Context())
	if err != nil {
		s.audit(r.Context(), &p, "game.announcement.update", "usr_hash_info", systemAnnouncementKey,
			map[string]any{"content": content}, nil, nil, 500, "读取原公告失败", clientIP(r))
		writeError(w, http.StatusInternalServerError, "ANNOUNCEMENT_UPDATE_FAILED", "保存游戏公告失败")
		return
	}
	beforeEncoded := ""
	if len(beforeRows) > 0 {
		beforeEncoded = beforeRows[0].Content
	}
	beforeContent, err := decodeClientBase64(beforeEncoded)
	if err != nil {
		s.logger.Error("decode existing game announcement", "error", err)
		writeError(w, http.StatusInternalServerError, "ANNOUNCEMENT_ENCODING_ERROR", "现有公告编码异常，已停止覆盖")
		return
	}

	insertedID := int64(0)
	if len(beforeRows) == 0 {
		var result sql.Result
		result, err = s.db.ExecContext(r.Context(), `INSERT INTO kbedm.usr_hash_info (hash_key, hash_content) VALUES (?, ?)`, systemAnnouncementKey, encoded)
		if err == nil {
			insertedID, err = result.LastInsertId()
		}
	} else {
		_, err = s.db.ExecContext(r.Context(), `UPDATE kbedm.usr_hash_info SET hash_content = ? WHERE hash_key = ?`, encoded, systemAnnouncementKey)
	}
	if err != nil {
		s.logger.Error("write game announcement", "error", err)
		restoreErr := s.restoreStoredAnnouncementRows(r.Context(), beforeRows, insertedID)
		if restoreErr != nil {
			s.logger.Error("restore game announcement after write failure", "error", restoreErr)
		}
		s.audit(r.Context(), &p, "game.announcement.update", "usr_hash_info", systemAnnouncementKey,
			map[string]any{"content": content}, map[string]any{"content": beforeContent}, nil, 500, "写入游戏公告失败", clientIP(r))
		writeError(w, http.StatusInternalServerError, "ANNOUNCEMENT_UPDATE_FAILED", "保存游戏公告失败")
		return
	}

	storedRows, verifyErr := s.loadStoredAnnouncementRows(r.Context())
	verified := verifyErr == nil && len(storedRows) > 0
	for _, row := range storedRows {
		if row.Content != encoded {
			verified = false
			break
		}
	}
	if !verified {
		restoreErr := s.restoreStoredAnnouncementRows(r.Context(), beforeRows, insertedID)
		s.logger.Error("verify game announcement", "error", verifyErr, "storedRows", len(storedRows), "restoreError", restoreErr)
		resultMessage := "公告写入校验失败，原内容已恢复"
		if restoreErr != nil {
			resultMessage = "公告写入校验失败，恢复原内容也失败，请立即人工检查"
		}
		s.audit(r.Context(), &p, "game.announcement.update", "usr_hash_info", systemAnnouncementKey,
			map[string]any{"content": content}, map[string]any{"content": beforeContent}, nil, 500, resultMessage, clientIP(r))
		writeError(w, http.StatusInternalServerError, "ANNOUNCEMENT_VERIFY_FAILED", resultMessage)
		return
	}

	now := time.Now()
	s.audit(r.Context(), &p, "game.announcement.update", "usr_hash_info", systemAnnouncementKey,
		map[string]any{"content": content}, map[string]any{"content": beforeContent},
		map[string]any{"content": content, "configured": content != ""}, 0, "游戏公告已保存并校验", clientIP(r))
	writeData(w, http.StatusOK, gameAnnouncementState{
		Content: content, Configured: content != "", ContentLength: utf8.RuneCountInString(content),
		Format:        "plain-text-preserved-v1",
		LastUpdatedBy: p.Username, LastUpdatedAt: &now, StorageKey: systemAnnouncementKey,
		Encoding: "client-base64", DuplicateRows: max(0, len(storedRows)-1),
	})
}

func (s *Server) loadStoredAnnouncementRows(ctx context.Context) ([]storedAnnouncementRow, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, COALESCE(hash_content, '')
FROM kbedm.usr_hash_info WHERE hash_key = ? ORDER BY id`, systemAnnouncementKey)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []storedAnnouncementRow{}
	for rows.Next() {
		var row storedAnnouncementRow
		if err := rows.Scan(&row.ID, &row.Content); err != nil {
			return nil, err
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

func (s *Server) restoreStoredAnnouncementRows(ctx context.Context, beforeRows []storedAnnouncementRow, insertedID int64) error {
	if len(beforeRows) == 0 {
		if insertedID <= 0 {
			return nil
		}
		_, err := s.db.ExecContext(ctx, `DELETE FROM kbedm.usr_hash_info WHERE id = ? AND hash_key = ?`, insertedID, systemAnnouncementKey)
		return err
	}
	var restoreErrors []error
	for _, row := range beforeRows {
		if _, err := s.db.ExecContext(ctx, `UPDATE kbedm.usr_hash_info SET hash_content = ? WHERE id = ? AND hash_key = ?`, row.Content, row.ID, systemAnnouncementKey); err != nil {
			restoreErrors = append(restoreErrors, err)
		}
	}
	return errors.Join(restoreErrors...)
}

func (s *Server) queryGameAnnouncement(ctx context.Context, p principal) (gameAnnouncementState, error) {
	state := gameAnnouncementState{StorageKey: systemAnnouncementKey, Encoding: "client-base64"}
	rows, err := s.db.QueryContext(ctx, `SELECT COALESCE(hash_content, '')
FROM kbedm.usr_hash_info WHERE hash_key = ? ORDER BY id`, systemAnnouncementKey)
	if err != nil {
		return state, err
	}
	defer rows.Close()
	stored := ""
	count := 0
	for rows.Next() {
		var value string
		if err := rows.Scan(&value); err != nil {
			return state, err
		}
		if count == 0 {
			stored = value
		}
		count++
	}
	if err := rows.Err(); err != nil {
		return state, err
	}
	content, err := decodeClientBase64(stored)
	if err != nil {
		return state, err
	}
	content = normalizeAnnouncementContent(content)
	state.Content = content
	state.Configured = content != ""
	state.ContentLength = utf8.RuneCountInString(content)
	state.DuplicateRows = max(0, count-1)
	state.Format = "plain-text-preserved-v1"

	updatedBy, updatedAt, err := s.latestAuditAttribution(ctx, "game.announcement.update", p)
	if err != nil {
		return state, err
	}
	state.LastUpdatedBy = updatedBy
	state.LastUpdatedAt = updatedAt
	return state, nil
}

// normalizeAnnouncementContent only unifies platform line endings. It deliberately
// preserves visible whitespace, empty lines and indentation so the Cocos Label can
// render the same plain-text layout that an operator authored in XuanManager.
func normalizeAnnouncementContent(value string) string {
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.ReplaceAll(value, "\r", "\n")
	if strings.TrimSpace(value) == "" {
		return ""
	}
	return value
}

func (s *Server) handleSendGameNotification(w http.ResponseWriter, r *http.Request, p principal) {
	var input sendGameNotificationRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if !input.Confirm {
		writeError(w, http.StatusBadRequest, "NOTIFICATION_CONFIRM_REQUIRED", "请确认本通知将发送给全部在线玩家")
		return
	}
	content := normalizeNotificationContent(input.Content)
	if err := validateConfigurationText(content, 1, 500, false, "通知内容"); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_NOTIFICATION", err.Error())
		return
	}
	operationContext := gameOperationContext("notice")
	requestAudit := map[string]any{"content": content, "audience": "all_online", "context": operationContext}
	result, err := s.callGameCommand(r.Context(), "通知_所有玩家_信息", map[string]any{
		"system_content": notificationSystemContent(content),
		"context":        operationContext,
	})
	if err != nil {
		s.logger.Error("send game notification", "error", err, "context", operationContext)
		s.audit(r.Context(), &p, "game.notification.send", "game_players", "all_online", requestAudit,
			nil, nil, 502, "调用游戏通知服务失败", clientIP(r))
		writeError(w, http.StatusBadGateway, "GAME_NOTIFICATION_UNAVAILABLE", "游戏通知服务暂不可用")
		return
	}
	if result.RetCode != 512 && result.RetCode != 1280 {
		s.audit(r.Context(), &p, "game.notification.send", "game_players", "all_online", requestAudit,
			nil, map[string]any{"status": "failed", "retCode": result.RetCode}, result.RetCode, "游戏服务拒绝发送通知", clientIP(r))
		writeError(w, http.StatusBadGateway, "GAME_NOTIFICATION_REJECTED", "游戏服务未接受本次通知")
		return
	}
	status := "sent"
	message := "全服通知发送请求已处理"
	if result.RetCode == 1280 {
		status = "accepted"
		message = "游戏服务已接收通知，正在异步处理"
	}
	s.audit(r.Context(), &p, "game.notification.send", "game_players", "all_online", requestAudit,
		nil, map[string]any{"status": status, "retCode": result.RetCode}, 0, message, clientIP(r))
	writeData(w, http.StatusOK, map[string]any{
		"content": content, "audience": "all_online", "status": status,
		"message": message, "context": operationContext,
	})
}

func (s *Server) handleListGameNotifications(w http.ResponseWriter, r *http.Request, p principal) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit < 1 {
		limit = 20
	}
	if limit > 50 {
		limit = 50
	}
	rows, err := s.db.QueryContext(r.Context(), `SELECT id, operator_name, COALESCE(request_json, ''), COALESCE(after_json, ''),
result_code, result_message, created_at
FROM mgr_audit_log audit_row
WHERE audit_row.action = 'game.notification.send'
  AND (? = 1 OR `+nonRootAuditVisibilitySQL+`)
ORDER BY audit_row.id DESC LIMIT ?`, canSeeProtectedRootFlag(p), limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "NOTIFICATION_HISTORY_FAILED", "读取通知记录失败")
		return
	}
	defer rows.Close()
	items := []gameNotificationHistoryItem{}
	for rows.Next() {
		var item gameNotificationHistoryItem
		var requestJSON, afterJSON string
		var resultCode int
		if err := rows.Scan(&item.ID, &item.OperatorName, &requestJSON, &afterJSON, &resultCode, &item.ResultMessage, &item.CreatedAt); err != nil {
			writeError(w, http.StatusInternalServerError, "NOTIFICATION_HISTORY_FAILED", "读取通知记录失败")
			return
		}
		var requestData struct {
			Content string `json:"content"`
		}
		var afterData struct {
			Status string `json:"status"`
		}
		_ = json.Unmarshal([]byte(requestJSON), &requestData)
		_ = json.Unmarshal([]byte(afterJSON), &afterData)
		item.Content = requestData.Content
		item.Status = afterData.Status
		if item.Status == "" {
			if resultCode == 0 {
				item.Status = "sent"
			} else {
				item.Status = "failed"
			}
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "NOTIFICATION_HISTORY_FAILED", "读取通知记录失败")
		return
	}
	writeData(w, http.StatusOK, map[string]any{"items": items})
}

func validateConfigurationText(value string, minLength, maxLength int, allowLines bool, label string) error {
	length := utf8.RuneCountInString(value)
	if length < minLength || length > maxLength {
		if minLength == 0 {
			return fmt.Errorf("%s最多 %d 个字符", label, maxLength)
		}
		return fmt.Errorf("%s长度必须为 %d 到 %d 个字符", label, minLength, maxLength)
	}
	for _, char := range value {
		if unicode.IsControl(char) && !(allowLines && (char == '\n' || char == '\r' || char == '\t')) {
			return fmt.Errorf("%s不能包含控制字符", label)
		}
	}
	return nil
}

func normalizeNotificationContent(value string) string {
	value = strings.ReplaceAll(value, ",", "，")
	return strings.Join(strings.Fields(value), " ")
}

func encodeClientBase64(value string) string {
	const hexadecimal = "0123456789ABCDEF"
	var encoded strings.Builder
	for _, char := range []byte(value) {
		if isEncodeURIComponentSafe(char) {
			encoded.WriteByte(char)
		} else {
			encoded.WriteByte('%')
			encoded.WriteByte(hexadecimal[char>>4])
			encoded.WriteByte(hexadecimal[char&15])
		}
	}
	return base64.StdEncoding.EncodeToString([]byte(encoded.String()))
}

func decodeClientBase64(value string) (string, error) {
	if value == "" {
		return "", nil
	}
	decoded, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		return "", fmt.Errorf("decode base64: %w", err)
	}
	return decodeURIComponent(string(decoded))
}

func isEncodeURIComponentSafe(value byte) bool {
	return value >= 'A' && value <= 'Z' || value >= 'a' && value <= 'z' || value >= '0' && value <= '9' ||
		strings.ContainsRune("-_.!~*'()", rune(value))
}

func decodeURIComponent(value string) (string, error) {
	var decoded strings.Builder
	for index := 0; index < len(value); index++ {
		if value[index] != '%' {
			decoded.WriteByte(value[index])
			continue
		}
		if index+2 >= len(value) {
			return "", errors.New("invalid percent encoding")
		}
		parsed, err := strconv.ParseUint(value[index+1:index+3], 16, 8)
		if err != nil {
			return "", errors.New("invalid percent encoding")
		}
		decoded.WriteByte(byte(parsed))
		index += 2
	}
	if !utf8.ValidString(decoded.String()) {
		return "", errors.New("invalid UTF-8 announcement")
	}
	return decoded.String(), nil
}
