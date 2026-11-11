package api

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"unicode/utf8"
)

// 暗抽总开关按俱乐部维护，存游戏端哈希表：
//
//	kbedm.usr_hash_info.hash_key = "暗抽_俱乐部_<clubId>"
//	hash_content = "1" / "0"
//
// 客户端用「查询_哈希_信息」读；后台不能通过 /hall/command 调 Account 命令，
// 所以这里直接读写 kbedm.usr_hash_info。usr_hash_info 线上是 MyISAM 且没有
// 唯一索引，写失败只能按原 id 逐行恢复，不能依赖事务回滚。
const (
	clubDarkSettingKeyPrefix = "暗抽_俱乐部_"
	clubDarkSettingAudit     = "game.club.dark_setting.update"
	unionDarkSettingAudit    = "game.union.dark_setting.update"
	clubDarkSettingMaxNote   = 120
)

var darkSettingMutationMu sync.Mutex

type darkSettingState struct {
	Scope       string `json:"scope"`
	TargetID    string `json:"targetId"`
	OwnerClubID string `json:"ownerClubId,omitempty"`
	Enabled     bool   `json:"enabled"`
	Verified    bool   `json:"verified"`
	Message     string `json:"message"`
}

type updateDarkSettingRequest struct {
	Enabled         *bool  `json:"enabled"`
	ExpectedEnabled *bool  `json:"expectedEnabled"`
	Note            string `json:"note"`
	Confirm         bool   `json:"confirm"`
}

type hashSettingRow struct {
	ID      int64
	Content string
}

func clubDarkSettingKey(clubID string) string {
	return clubDarkSettingKeyPrefix + strings.TrimSpace(clubID)
}

func parseDarkSettingContent(content string) bool {
	switch strings.ToLower(strings.TrimSpace(content)) {
	case "1", "true", "on", "yes", "开", "开启":
		return true
	default:
		return false
	}
}

func darkSettingContent(enabled bool) string {
	if enabled {
		return "1"
	}
	return "0"
}

func (s *Server) loadHashSettingRows(ctx context.Context, key string) ([]hashSettingRow, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, COALESCE(hash_content, '')
FROM kbedm.usr_hash_info WHERE hash_key = ? ORDER BY id`, key)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []hashSettingRow{}
	for rows.Next() {
		var row hashSettingRow
		if err := rows.Scan(&row.ID, &row.Content); err != nil {
			return nil, err
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

// readClubDarkSetting 取某个俱乐部当前开关；同 key 多行时以最新 id 为准。
func (s *Server) readClubDarkSetting(ctx context.Context, clubID string) (bool, []hashSettingRow, error) {
	rows, err := s.loadHashSettingRows(ctx, clubDarkSettingKey(clubID))
	if err != nil {
		return false, nil, err
	}
	if len(rows) == 0 {
		return false, rows, nil
	}
	return parseDarkSettingContent(rows[len(rows)-1].Content), rows, nil
}

// readClubDarkSettings 批量读取当前页俱乐部的开关，避免逐行查库。
func (s *Server) readClubDarkSettings(ctx context.Context, clubIDs []string) (map[string]bool, error) {
	result := map[string]bool{}
	keys := make([]string, 0, len(clubIDs))
	keyToClub := map[string]string{}
	for _, clubID := range clubIDs {
		clubID = strings.TrimSpace(clubID)
		if clubID == "" {
			continue
		}
		key := clubDarkSettingKey(clubID)
		if _, exists := keyToClub[key]; exists {
			continue
		}
		keyToClub[key] = clubID
		keys = append(keys, key)
		result[clubID] = false
	}
	if len(keys) == 0 {
		return result, nil
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(keys)), ",")
	args := make([]any, len(keys))
	for index, key := range keys {
		args[index] = key
	}
	rows, err := s.db.QueryContext(ctx, `SELECT hash_key, COALESCE(hash_content, '')
FROM kbedm.usr_hash_info WHERE hash_key IN (`+placeholders+`) ORDER BY id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var key, content string
		if err := rows.Scan(&key, &content); err != nil {
			return nil, err
		}
		clubID, ok := keyToClub[key]
		if !ok {
			continue
		}
		// ORDER BY id：后出现的行覆盖前面的，等价于取最新 id。
		result[clubID] = parseDarkSettingContent(content)
	}
	return result, rows.Err()
}

// writeClubDarkSetting 写入并回读校验；失败时按写入前的行快照恢复。
func (s *Server) writeClubDarkSetting(ctx context.Context, clubID string, enabled bool) (bool, error) {
	key := clubDarkSettingKey(clubID)
	beforeRows, err := s.loadHashSettingRows(ctx, key)
	if err != nil {
		return false, err
	}
	content := darkSettingContent(enabled)
	var insertedID int64
	if len(beforeRows) == 0 {
		result, execErr := s.db.ExecContext(ctx,
			`INSERT INTO kbedm.usr_hash_info (hash_key, hash_content) VALUES (?, ?)`, key, content)
		if execErr == nil {
			insertedID, execErr = result.LastInsertId()
		}
		err = execErr
	} else {
		_, err = s.db.ExecContext(ctx,
			`UPDATE kbedm.usr_hash_info SET hash_content = ? WHERE hash_key = ?`, content, key)
	}
	if err != nil {
		if restoreErr := s.restoreHashSettingRows(ctx, key, beforeRows, insertedID); restoreErr != nil {
			return false, fmt.Errorf("%w（恢复原配置也失败：%v）", err, restoreErr)
		}
		return false, err
	}

	after, _, verifyErr := s.readClubDarkSetting(ctx, clubID)
	if verifyErr != nil {
		verifyErr = fmt.Errorf("回读失败: %w", verifyErr)
	} else if after != enabled {
		verifyErr = fmt.Errorf("回读值不一致：期望 %s，实际 %s", darkSettingContent(enabled), darkSettingContent(after))
	}
	if verifyErr != nil {
		if restoreErr := s.restoreHashSettingRows(ctx, key, beforeRows, insertedID); restoreErr != nil {
			return false, fmt.Errorf("%w（恢复原配置也失败：%v）", verifyErr, restoreErr)
		}
		return false, verifyErr
	}
	return after, nil
}

func (s *Server) restoreHashSettingRows(ctx context.Context, key string, before []hashSettingRow, insertedID int64) error {
	if insertedID > 0 {
		_, err := s.db.ExecContext(ctx,
			`DELETE FROM kbedm.usr_hash_info WHERE id = ? AND hash_key = ?`, insertedID, key)
		return err
	}
	var restoreErrors []error
	for _, row := range before {
		if _, err := s.db.ExecContext(ctx,
			`UPDATE kbedm.usr_hash_info SET hash_content = ? WHERE id = ? AND hash_key = ?`,
			row.Content, row.ID, key); err != nil {
			restoreErrors = append(restoreErrors, err)
		}
	}
	return errors.Join(restoreErrors...)
}

func normalizeDarkSettingNote(note string) (string, error) {
	note = strings.TrimSpace(note)
	if utf8.RuneCountInString(note) < 2 {
		return "", errors.New("原因至少 2 个字")
	}
	if utf8.RuneCountInString(note) > clubDarkSettingMaxNote {
		return "", fmt.Errorf("原因最多 %d 个字", clubDarkSettingMaxNote)
	}
	return note, nil
}

func validateDarkSettingRequest(input updateDarkSettingRequest) (bool, bool, string, error) {
	if input.Enabled == nil || input.ExpectedEnabled == nil {
		return false, false, "", errors.New("请提交目标状态和页面当前状态")
	}
	if !input.Confirm {
		return false, false, "", errors.New("请确认本次操作会影响该俱乐部/联盟的开房暗抽")
	}
	note, err := normalizeDarkSettingNote(input.Note)
	if err != nil {
		return false, false, "", err
	}
	return *input.Enabled, *input.ExpectedEnabled, note, nil
}

func (s *Server) handleSetClubDarkSetting(w http.ResponseWriter, r *http.Request, p principal) {
	clubID, err := normalizeClubID(r.PathValue("clubId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_CLUB_ID", err.Error())
		return
	}
	var input updateDarkSettingRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	target, expected, note, err := validateDarkSettingRequest(input)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_DARK_SETTING", err.Error())
		return
	}

	darkSettingMutationMu.Lock()
	defer darkSettingMutationMu.Unlock()

	ctx := r.Context()
	var exists, unionID string
	if err := s.db.QueryRowContext(ctx,
		`SELECT club_guuid, COALESCE(union_id, '') FROM kbedm.club_guuid_info WHERE club_guuid = ? LIMIT 1`,
		clubID).Scan(&exists, &unionID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "CLUB_NOT_FOUND", "没有找到这个俱乐部")
			return
		}
		s.logger.Error("read club before dark setting", "error", err, "clubId", clubID)
		writeError(w, http.StatusInternalServerError, "DARK_SETTING_QUERY_FAILED", "读取俱乐部失败")
		return
	}
	if strings.TrimSpace(unionID) != "" {
		writeError(w, http.StatusBadRequest, "CLUB_IN_UNION", "该俱乐部已入盟，请在联盟管理里开启暗抽")
		return
	}

	current, _, err := s.readClubDarkSetting(ctx, clubID)
	if err != nil {
		s.logger.Error("read club dark setting", "error", err, "clubId", clubID)
		writeError(w, http.StatusInternalServerError, "DARK_SETTING_QUERY_FAILED", "读取暗抽开关失败")
		return
	}
	if current != expected {
		writeError(w, http.StatusConflict, "DARK_SETTING_CONFLICT", "暗抽开关已被其他操作修改，请刷新后重试")
		return
	}
	if current == target {
		writeError(w, http.StatusBadRequest, "DARK_SETTING_UNCHANGED", "暗抽开关没有变化")
		return
	}

	requestAudit := map[string]any{
		"enabled":   target,
		"note":      note,
		"configKey": clubDarkSettingKey(clubID),
	}
	beforeAudit := map[string]any{"enabled": current}
	after, writeErr := s.writeClubDarkSetting(ctx, clubID, target)
	if writeErr != nil {
		s.logger.Error("write club dark setting", "error", writeErr, "clubId", clubID)
		s.audit(ctx, &p, clubDarkSettingAudit, "game_club", clubID,
			requestAudit, beforeAudit, nil, http.StatusInternalServerError, "保存暗抽开关失败："+writeErr.Error(), clientIP(r))
		writeError(w, http.StatusInternalServerError, "DARK_SETTING_UPDATE_FAILED", "保存暗抽开关失败，请刷新后重试")
		return
	}

	message := "已关闭该俱乐部的暗抽"
	if after {
		message = "已开启该俱乐部的暗抽"
	}
	s.audit(ctx, &p, clubDarkSettingAudit, "game_club", clubID,
		requestAudit, beforeAudit, map[string]any{"enabled": after}, 0, message, clientIP(r))
	writeData(w, http.StatusOK, darkSettingState{
		Scope:    "club",
		TargetID: clubID,
		Enabled:  after,
		Verified: true,
		Message:  message,
	})
}

func (s *Server) handleSetUnionDarkSetting(w http.ResponseWriter, r *http.Request, p principal) {
	unionID, err := normalizeUnionID(r.PathValue("unionId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_UNION_ID", err.Error())
		return
	}
	var input updateDarkSettingRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	target, expected, note, err := validateDarkSettingRequest(input)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_DARK_SETTING", err.Error())
		return
	}

	darkSettingMutationMu.Lock()
	defer darkSettingMutationMu.Unlock()

	ctx := r.Context()
	var ownerClubID string
	if err := s.db.QueryRowContext(ctx,
		`SELECT COALESCE(club_guuid, '') FROM kbedm.club_union_info
WHERE union_id = ? AND status <> 'init' LIMIT 1`, unionID).Scan(&ownerClubID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "UNION_NOT_FOUND", "没有找到这个联盟")
			return
		}
		s.logger.Error("read union before dark setting", "error", err, "unionId", unionID)
		writeError(w, http.StatusInternalServerError, "DARK_SETTING_QUERY_FAILED", "读取联盟失败")
		return
	}
	ownerClubID = strings.TrimSpace(ownerClubID)
	if ownerClubID == "" {
		writeError(w, http.StatusBadRequest, "UNION_OWNER_CLUB_MISSING", "该联盟没有总群主俱乐部，无法设置暗抽")
		return
	}

	current, _, err := s.readClubDarkSetting(ctx, ownerClubID)
	if err != nil {
		s.logger.Error("read union dark setting", "error", err, "unionId", unionID, "ownerClubId", ownerClubID)
		writeError(w, http.StatusInternalServerError, "DARK_SETTING_QUERY_FAILED", "读取暗抽开关失败")
		return
	}
	if current != expected {
		writeError(w, http.StatusConflict, "DARK_SETTING_CONFLICT", "暗抽开关已被其他操作修改，请刷新后重试")
		return
	}
	if current == target {
		writeError(w, http.StatusBadRequest, "DARK_SETTING_UNCHANGED", "暗抽开关没有变化")
		return
	}

	requestAudit := map[string]any{
		"enabled":     target,
		"note":        note,
		"configKey":   clubDarkSettingKey(ownerClubID),
		"ownerClubId": ownerClubID,
	}
	beforeAudit := map[string]any{"enabled": current}
	after, writeErr := s.writeClubDarkSetting(ctx, ownerClubID, target)
	if writeErr != nil {
		s.logger.Error("write union dark setting", "error", writeErr, "unionId", unionID, "ownerClubId", ownerClubID)
		s.audit(ctx, &p, unionDarkSettingAudit, "game_union", unionID,
			requestAudit, beforeAudit, nil, http.StatusInternalServerError, "保存暗抽开关失败："+writeErr.Error(), clientIP(r))
		writeError(w, http.StatusInternalServerError, "DARK_SETTING_UPDATE_FAILED", "保存暗抽开关失败，请刷新后重试")
		return
	}

	message := "已关闭该联盟总群主俱乐部的暗抽"
	if after {
		message = "已开启该联盟总群主俱乐部的暗抽"
	}
	s.audit(ctx, &p, unionDarkSettingAudit, "game_union", unionID,
		requestAudit, beforeAudit, map[string]any{"enabled": after, "ownerClubId": ownerClubID}, 0, message, clientIP(r))
	writeData(w, http.StatusOK, darkSettingState{
		Scope:       "union",
		TargetID:    unionID,
		OwnerClubID: ownerClubID,
		Enabled:     after,
		Verified:    true,
		Message:     message,
	})
}
