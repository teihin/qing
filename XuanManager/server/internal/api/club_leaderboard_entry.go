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

// 大厅「发现」页的排行榜入口按俱乐部放行，存游戏端哈希表：
//
//	kbedm.usr_hash_info.hash_key = "排行榜_俱乐部_<clubId>" / "排行榜_联盟_<unionId>"
//	hash_content = "1" / "0"
//
// 口径与暗抽开关一致：独立俱乐部自己设置，已入盟的俱乐部统一由联盟设置。
// 客户端用「查询_哈希_信息」读取（先按 club_id 查俱乐部信息拿到 union_id，
// 入盟则读联盟 key，否则读俱乐部 key），后台不能通过 /hall/command 调 Account 命令，
// 所以这里直接读写 kbedm.usr_hash_info。
const (
	leaderboardEntryClubKeyPrefix  = "排行榜_俱乐部_"
	leaderboardEntryUnionKeyPrefix = "排行榜_联盟_"
	leaderboardEntryClubAudit      = "game.club.leaderboard_entry.update"
	leaderboardEntryUnionAudit     = "game.union.leaderboard_entry.update"
)

var leaderboardEntryMutationMu sync.Mutex

type leaderboardEntryState struct {
	Scope    string `json:"scope"`
	TargetID string `json:"targetId"`
	Enabled  bool   `json:"enabled"`
	Verified bool   `json:"verified"`
	Message  string `json:"message"`
}

type updateLeaderboardEntryRequest struct {
	Enabled         *bool  `json:"enabled"`
	ExpectedEnabled *bool  `json:"expectedEnabled"`
	Note            string `json:"note"`
	Confirm         bool   `json:"confirm"`
}

func leaderboardEntryClubKey(clubID string) string {
	return leaderboardEntryClubKeyPrefix + strings.TrimSpace(clubID)
}

func leaderboardEntryUnionKey(unionID string) string {
	return leaderboardEntryUnionKeyPrefix + strings.TrimSpace(unionID)
}

// leaderboardEntryKeyForClub 返回某个俱乐部实际生效的配置键：入盟读联盟键，否则读俱乐部键。
func leaderboardEntryKeyForClub(clubID, unionID string) string {
	if strings.TrimSpace(unionID) != "" {
		return leaderboardEntryUnionKey(unionID)
	}
	return leaderboardEntryClubKey(clubID)
}

func leaderboardEntryContent(enabled bool) string {
	if enabled {
		return "1"
	}
	return "0"
}

// readLeaderboardEntryStates 批量读取一批 key 的开关；同 key 多行时以最新 id 为准。
// 返回的 map 只包含查询到的 key，缺失即按关闭处理。
func (s *Server) readLeaderboardEntryStates(ctx context.Context, keys []string) (map[string]bool, error) {
	result := map[string]bool{}
	unique := make([]string, 0, len(keys))
	seen := map[string]bool{}
	for _, key := range keys {
		key = strings.TrimSpace(key)
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		unique = append(unique, key)
	}
	if len(unique) == 0 {
		return result, nil
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(unique)), ",")
	args := make([]any, len(unique))
	for index, key := range unique {
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
		result[key] = parseDarkSettingContent(content)
	}
	return result, rows.Err()
}

func (s *Server) readLeaderboardEntry(ctx context.Context, key string) (bool, []hashSettingRow, error) {
	rows, err := s.loadHashSettingRows(ctx, key)
	if err != nil {
		return false, nil, err
	}
	if len(rows) == 0 {
		return false, rows, nil
	}
	return parseDarkSettingContent(rows[len(rows)-1].Content), rows, nil
}

// writeLeaderboardEntry 写入并回读校验；失败时按写入前的行快照恢复。
func (s *Server) writeLeaderboardEntry(ctx context.Context, key string, enabled bool) (bool, error) {
	beforeRows, err := s.loadHashSettingRows(ctx, key)
	if err != nil {
		return false, err
	}
	content := leaderboardEntryContent(enabled)
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

	after, _, verifyErr := s.readLeaderboardEntry(ctx, key)
	if verifyErr != nil {
		verifyErr = fmt.Errorf("回读失败: %w", verifyErr)
	} else if after != enabled {
		verifyErr = fmt.Errorf("回读值不一致：期望 %s，实际 %s", content, leaderboardEntryContent(after))
	}
	if verifyErr != nil {
		if restoreErr := s.restoreHashSettingRows(ctx, key, beforeRows, insertedID); restoreErr != nil {
			return false, fmt.Errorf("%w（恢复原配置也失败：%v）", verifyErr, restoreErr)
		}
		return false, verifyErr
	}
	return after, nil
}

func validateLeaderboardEntryRequest(input updateLeaderboardEntryRequest) (bool, bool, string, error) {
	if input.Enabled == nil || input.ExpectedEnabled == nil {
		return false, false, "", errors.New("请提交目标状态和页面当前状态")
	}
	if !input.Confirm {
		return false, false, "", errors.New("请确认本次操作会改变该俱乐部/联盟玩家的排行榜入口")
	}
	note := strings.TrimSpace(input.Note)
	if utf8.RuneCountInString(note) < 2 {
		return false, false, "", errors.New("原因至少 2 个字")
	}
	if utf8.RuneCountInString(note) > clubDarkSettingMaxNote {
		return false, false, "", fmt.Errorf("原因最多 %d 个字", clubDarkSettingMaxNote)
	}
	return *input.Enabled, *input.ExpectedEnabled, note, nil
}

func (s *Server) handleSetClubLeaderboardEntry(w http.ResponseWriter, r *http.Request, p principal) {
	clubID, err := normalizeClubID(r.PathValue("clubId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_CLUB_ID", err.Error())
		return
	}
	var input updateLeaderboardEntryRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	target, expected, note, err := validateLeaderboardEntryRequest(input)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_LEADERBOARD_ENTRY", err.Error())
		return
	}

	leaderboardEntryMutationMu.Lock()
	defer leaderboardEntryMutationMu.Unlock()

	ctx := r.Context()
	var exists, unionID string
	if err := s.db.QueryRowContext(ctx,
		`SELECT club_guuid, COALESCE(union_id, '') FROM kbedm.club_guuid_info WHERE club_guuid = ? LIMIT 1`,
		clubID).Scan(&exists, &unionID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "CLUB_NOT_FOUND", "没有找到这个俱乐部")
			return
		}
		s.logger.Error("read club before leaderboard entry", "error", err, "clubId", clubID)
		writeError(w, http.StatusInternalServerError, "LEADERBOARD_ENTRY_QUERY_FAILED", "读取俱乐部失败")
		return
	}
	if strings.TrimSpace(unionID) != "" {
		writeError(w, http.StatusBadRequest, "CLUB_IN_UNION", "该俱乐部已入盟，请在联盟管理里设置排行榜入口")
		return
	}

	key := leaderboardEntryClubKey(clubID)
	current, _, err := s.readLeaderboardEntry(ctx, key)
	if err != nil {
		s.logger.Error("read club leaderboard entry", "error", err, "clubId", clubID)
		writeError(w, http.StatusInternalServerError, "LEADERBOARD_ENTRY_QUERY_FAILED", "读取排行榜开关失败")
		return
	}
	if current != expected {
		writeError(w, http.StatusConflict, "LEADERBOARD_ENTRY_CONFLICT", "排行榜开关已被其他操作修改，请刷新后重试")
		return
	}
	if current == target {
		writeError(w, http.StatusBadRequest, "LEADERBOARD_ENTRY_UNCHANGED", "排行榜开关没有变化")
		return
	}

	requestAudit := map[string]any{"enabled": target, "note": note, "configKey": key}
	beforeAudit := map[string]any{"enabled": current}
	after, writeErr := s.writeLeaderboardEntry(ctx, key, target)
	if writeErr != nil {
		s.logger.Error("write club leaderboard entry", "error", writeErr, "clubId", clubID)
		s.audit(ctx, &p, leaderboardEntryClubAudit, "game_club", clubID,
			requestAudit, beforeAudit, nil, http.StatusInternalServerError, "保存排行榜开关失败："+writeErr.Error(), clientIP(r))
		writeError(w, http.StatusInternalServerError, "LEADERBOARD_ENTRY_UPDATE_FAILED", "保存排行榜开关失败，请刷新后重试")
		return
	}

	message := "已关闭该俱乐部的大厅排行榜入口"
	if after {
		message = "已开启该俱乐部的大厅排行榜入口"
	}
	s.audit(ctx, &p, leaderboardEntryClubAudit, "game_club", clubID,
		requestAudit, beforeAudit, map[string]any{"enabled": after}, 0, message, clientIP(r))
	writeData(w, http.StatusOK, leaderboardEntryState{
		Scope:    "club",
		TargetID: clubID,
		Enabled:  after,
		Verified: true,
		Message:  message,
	})
}

func (s *Server) handleSetUnionLeaderboardEntry(w http.ResponseWriter, r *http.Request, p principal) {
	unionID, err := normalizeUnionID(r.PathValue("unionId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_UNION_ID", err.Error())
		return
	}
	var input updateLeaderboardEntryRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	target, expected, note, err := validateLeaderboardEntryRequest(input)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_LEADERBOARD_ENTRY", err.Error())
		return
	}

	leaderboardEntryMutationMu.Lock()
	defer leaderboardEntryMutationMu.Unlock()

	ctx := r.Context()
	var exists string
	if err := s.db.QueryRowContext(ctx,
		`SELECT COALESCE(union_id, '') FROM kbedm.club_union_info
WHERE union_id = ? AND status <> 'init' LIMIT 1`, unionID).Scan(&exists); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "UNION_NOT_FOUND", "没有找到这个联盟")
			return
		}
		s.logger.Error("read union before leaderboard entry", "error", err, "unionId", unionID)
		writeError(w, http.StatusInternalServerError, "LEADERBOARD_ENTRY_QUERY_FAILED", "读取联盟失败")
		return
	}

	key := leaderboardEntryUnionKey(unionID)
	current, _, err := s.readLeaderboardEntry(ctx, key)
	if err != nil {
		s.logger.Error("read union leaderboard entry", "error", err, "unionId", unionID)
		writeError(w, http.StatusInternalServerError, "LEADERBOARD_ENTRY_QUERY_FAILED", "读取排行榜开关失败")
		return
	}
	if current != expected {
		writeError(w, http.StatusConflict, "LEADERBOARD_ENTRY_CONFLICT", "排行榜开关已被其他操作修改，请刷新后重试")
		return
	}
	if current == target {
		writeError(w, http.StatusBadRequest, "LEADERBOARD_ENTRY_UNCHANGED", "排行榜开关没有变化")
		return
	}

	requestAudit := map[string]any{"enabled": target, "note": note, "configKey": key}
	beforeAudit := map[string]any{"enabled": current}
	after, writeErr := s.writeLeaderboardEntry(ctx, key, target)
	if writeErr != nil {
		s.logger.Error("write union leaderboard entry", "error", writeErr, "unionId", unionID)
		s.audit(ctx, &p, leaderboardEntryUnionAudit, "game_union", unionID,
			requestAudit, beforeAudit, nil, http.StatusInternalServerError, "保存排行榜开关失败："+writeErr.Error(), clientIP(r))
		writeError(w, http.StatusInternalServerError, "LEADERBOARD_ENTRY_UPDATE_FAILED", "保存排行榜开关失败，请刷新后重试")
		return
	}

	message := "已关闭该联盟所有俱乐部的大厅排行榜入口"
	if after {
		message = "已开启该联盟所有俱乐部的大厅排行榜入口"
	}
	s.audit(ctx, &p, leaderboardEntryUnionAudit, "game_union", unionID,
		requestAudit, beforeAudit, map[string]any{"enabled": after}, 0, message, clientIP(r))
	writeData(w, http.StatusOK, leaderboardEntryState{
		Scope:    "union",
		TargetID: unionID,
		Enabled:  after,
		Verified: true,
		Message:  message,
	})
}
