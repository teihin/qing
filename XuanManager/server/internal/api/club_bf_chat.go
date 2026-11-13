package api

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
)

// BF 聊天（官方客服）入口改由平台后台按俱乐部控制。
//
// 存储与 ChatTool 共享同一个 webcm 库：
//   - chat_direct_bf_club  后台按俱乐部写入的开关（本文件读写）
//   - chat_direct_bf_entry 旧版按创建者账号保存的开关，只作为历史数据回退
//
// 没有俱乐部记录时回落创建者记录，再没有则默认开启。客户端只读
// GET /api/direct/bf-entry 的 visible，不再提供游戏内开关。
const (
	clubBFChatAudit = "game.club.bf_chat.update"
)

var bfChatMutationMu sync.Mutex

type bfChatState struct {
	ClubID   string `json:"clubId"`
	Enabled  bool   `json:"enabled"`
	Verified bool   `json:"verified"`
	Message  string `json:"message"`
}

type updateBFChatRequest struct {
	Enabled         *bool `json:"enabled"`
	ExpectedEnabled *bool `json:"expectedEnabled"`
	Confirm         bool  `json:"confirm"`
}

// readClubBFChatStates 批量取当前页俱乐部的 BF 入口状态，避免逐行查库。
// 返回的 map 一定包含每个传入俱乐部，默认 true。
func (s *Server) readClubBFChatStates(ctx context.Context, items []clubListItem) (map[string]bool, error) {
	result := make(map[string]bool, len(items))
	clubIDs := make([]string, 0, len(items))
	ownerIDs := make([]string, 0, len(items))
	ownerSeen := map[string]bool{}
	for _, item := range items {
		clubID := strings.TrimSpace(item.ClubID)
		if clubID == "" {
			continue
		}
		result[clubID] = true
		clubIDs = append(clubIDs, clubID)
		owner := strings.TrimSpace(item.OwnerID)
		if owner != "" && !ownerSeen[owner] {
			ownerSeen[owner] = true
			ownerIDs = append(ownerIDs, owner)
		}
	}
	if len(clubIDs) == 0 {
		return result, nil
	}

	clubStates := map[string]bool{}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(clubIDs)), ",")
	args := make([]any, len(clubIDs))
	for index, clubID := range clubIDs {
		args[index] = clubID
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT club_id, enabled FROM chat_direct_bf_club WHERE club_id IN (`+placeholders+`)`, args...)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var clubID string
		var enabled bool
		if err := rows.Scan(&clubID, &enabled); err != nil {
			rows.Close()
			return nil, err
		}
		clubStates[clubID] = enabled
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	ownerStates := map[string]bool{}
	if len(ownerIDs) > 0 {
		placeholders = strings.TrimSuffix(strings.Repeat("?,", len(ownerIDs)), ",")
		args = make([]any, len(ownerIDs))
		for index, ownerID := range ownerIDs {
			args[index] = ownerID
		}
		ownerRows, err := s.db.QueryContext(ctx,
			`SELECT guuid, enabled FROM chat_direct_bf_entry WHERE guuid IN (`+placeholders+`)`, args...)
		if err != nil {
			return nil, err
		}
		for ownerRows.Next() {
			var guuid string
			var enabled bool
			if err := ownerRows.Scan(&guuid, &enabled); err != nil {
				ownerRows.Close()
				return nil, err
			}
			ownerStates[guuid] = enabled
		}
		ownerRows.Close()
		if err := ownerRows.Err(); err != nil {
			return nil, err
		}
	}

	for _, item := range items {
		clubID := strings.TrimSpace(item.ClubID)
		if clubID == "" {
			continue
		}
		if enabled, ok := clubStates[clubID]; ok {
			result[clubID] = enabled
			continue
		}
		if enabled, ok := ownerStates[strings.TrimSpace(item.OwnerID)]; ok {
			result[clubID] = enabled
		}
	}
	return result, nil
}

// readClubBFChatState 读取单个俱乐部的有效状态，口径与批量读取一致。
func (s *Server) readClubBFChatState(ctx context.Context, clubID, ownerID string) (bool, error) {
	var enabled bool
	err := s.db.QueryRowContext(ctx,
		`SELECT enabled FROM chat_direct_bf_club WHERE club_id = ? LIMIT 1`, clubID).Scan(&enabled)
	if err == nil {
		return enabled, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return false, err
	}
	ownerID = strings.TrimSpace(ownerID)
	if ownerID == "" {
		return true, nil
	}
	err = s.db.QueryRowContext(ctx,
		`SELECT enabled FROM chat_direct_bf_entry WHERE guuid = ? LIMIT 1`, ownerID).Scan(&enabled)
	if err == nil {
		return enabled, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return false, err
	}
	return true, nil
}

// writeClubBFChat 写入俱乐部级开关并回读校验。
func (s *Server) writeClubBFChat(ctx context.Context, clubID string, enabled bool) (bool, error) {
	if _, err := s.db.ExecContext(ctx, `INSERT INTO chat_direct_bf_club (club_id, enabled, updated_at)
VALUES (?, ?, NOW())
ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), updated_at = NOW()`, clubID, enabled); err != nil {
		return false, err
	}
	var after bool
	if err := s.db.QueryRowContext(ctx,
		`SELECT enabled FROM chat_direct_bf_club WHERE club_id = ? LIMIT 1`, clubID).Scan(&after); err != nil {
		return false, fmt.Errorf("回读失败: %w", err)
	}
	if after != enabled {
		return false, fmt.Errorf("回读值不一致：期望 %t，实际 %t", enabled, after)
	}
	return after, nil
}

func validateBFChatRequest(input updateBFChatRequest) (bool, bool, error) {
	if input.Enabled == nil || input.ExpectedEnabled == nil {
		return false, false, errors.New("请提交目标状态和页面当前状态")
	}
	if !input.Confirm {
		return false, false, errors.New("请确认本次操作会影响该俱乐部的 BF 聊天入口")
	}
	return *input.Enabled, *input.ExpectedEnabled, nil
}

func (s *Server) handleSetClubBFChat(w http.ResponseWriter, r *http.Request, p principal) {
	clubID, err := normalizeClubID(r.PathValue("clubId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_CLUB_ID", err.Error())
		return
	}
	var input updateBFChatRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	target, expected, err := validateBFChatRequest(input)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BF_CHAT", err.Error())
		return
	}

	bfChatMutationMu.Lock()
	defer bfChatMutationMu.Unlock()

	ctx := r.Context()
	var exists string
	if err := s.db.QueryRowContext(ctx,
		`SELECT club_guuid FROM kbedm.club_guuid_info
WHERE club_guuid = ? AND club_status NOT IN ('init', 'del') LIMIT 1`, clubID).Scan(&exists); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "CLUB_NOT_FOUND", "没有找到这个俱乐部")
			return
		}
		s.logger.Error("read club before bf chat", "error", err, "clubId", clubID)
		writeError(w, http.StatusInternalServerError, "BF_CHAT_QUERY_FAILED", "读取俱乐部失败")
		return
	}

	owners, _, err := s.clubOwnersAndAgentCounts(ctx, []string{clubID})
	if err != nil {
		s.logger.Error("read club owner before bf chat", "error", err, "clubId", clubID)
		writeError(w, http.StatusInternalServerError, "BF_CHAT_QUERY_FAILED", "读取俱乐部群主失败")
		return
	}
	current, err := s.readClubBFChatState(ctx, clubID, owners[clubID])
	if err != nil {
		s.logger.Error("read club bf chat", "error", err, "clubId", clubID)
		writeError(w, http.StatusInternalServerError, "BF_CHAT_QUERY_FAILED", "读取 BF 聊天开关失败")
		return
	}
	if current != expected {
		writeError(w, http.StatusConflict, "BF_CHAT_CONFLICT", "BF 聊天开关已被其他操作修改，请刷新后重试")
		return
	}
	if current == target {
		writeError(w, http.StatusBadRequest, "BF_CHAT_UNCHANGED", "BF 聊天开关没有变化")
		return
	}

	requestAudit := map[string]any{"enabled": target}
	beforeAudit := map[string]any{"enabled": current}
	after, writeErr := s.writeClubBFChat(ctx, clubID, target)
	if writeErr != nil {
		s.logger.Error("write club bf chat", "error", writeErr, "clubId", clubID)
		s.audit(ctx, &p, clubBFChatAudit, "game_club", clubID,
			requestAudit, beforeAudit, nil, http.StatusInternalServerError, "保存 BF 聊天开关失败："+writeErr.Error(), clientIP(r))
		writeError(w, http.StatusInternalServerError, "BF_CHAT_UPDATE_FAILED", "保存 BF 聊天开关失败，请刷新后重试")
		return
	}

	message := "已关闭该俱乐部的 BF 聊天入口"
	if after {
		message = "已开启该俱乐部的 BF 聊天入口"
	}
	s.audit(ctx, &p, clubBFChatAudit, "game_club", clubID,
		requestAudit, beforeAudit, map[string]any{"enabled": after}, 0, message, clientIP(r))
	writeData(w, http.StatusOK, bfChatState{
		ClubID:   clubID,
		Enabled:  after,
		Verified: true,
		Message:  message,
	})
}
