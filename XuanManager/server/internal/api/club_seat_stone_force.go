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

// 「强制带入钻石」按俱乐部/联盟维护，存储与暗抽同构，走游戏端哈希表：
//
//	kbedm.usr_hash_info.hash_key = "强制入座扣钻_俱乐部_<clubId>"
//	hash_content = "1" / "0"
//
// 缺行一律按关闭处理（后台默认关闭）。客户端用「查询_哈希_信息」读取后把创建规则里的
// 「同步带入钻石」默认打开并锁死；游戏服在创建玩法与建房两处做强校验，客户端只是表现层。
// 联盟开关写联盟总群主俱乐部的同一个 key，与「暗抽_俱乐部_<ownerClubId>」的约定一致。
const (
	clubSeatStoneForceKeyPrefix = "强制入座扣钻_俱乐部_"
	clubSeatStoneForceAudit     = "game.club.seat_stone_force.update"
	unionSeatStoneForceAudit    = "game.union.seat_stone_force.update"
	seatStoneForceMaxNote       = 120
)

var seatStoneForceMutationMu sync.Mutex

type seatStoneForceState struct {
	Scope       string `json:"scope"`
	TargetID    string `json:"targetId"`
	OwnerClubID string `json:"ownerClubId,omitempty"`
	Enabled     bool   `json:"enabled"`
	Verified    bool   `json:"verified"`
	Message     string `json:"message"`
}

type updateSeatStoneForceRequest struct {
	Enabled         *bool  `json:"enabled"`
	ExpectedEnabled *bool  `json:"expectedEnabled"`
	Note            string `json:"note"`
	Confirm         bool   `json:"confirm"`
}

func clubSeatStoneForceKey(clubID string) string {
	return clubSeatStoneForceKeyPrefix + strings.TrimSpace(clubID)
}

// readClubSeatStoneForce 取某个俱乐部的强制开关；同 key 多行时以最新 id 为准。
func (s *Server) readClubSeatStoneForce(ctx context.Context, clubID string) (bool, error) {
	enabled, _, err := s.readBoolHashSetting(ctx, clubSeatStoneForceKey(clubID))
	return enabled, err
}

// readClubSeatStoneForces 批量读取，供俱乐部/联盟列表一次查完。
func (s *Server) readClubSeatStoneForces(ctx context.Context, clubIDs []string) (map[string]bool, error) {
	return s.readBoolHashSettings(ctx, clubSeatStoneForceKeyPrefix, clubIDs)
}

func (s *Server) writeClubSeatStoneForce(ctx context.Context, clubID string, enabled bool) (bool, error) {
	return s.writeBoolHashSetting(ctx, clubSeatStoneForceKey(clubID), enabled)
}

func validateSeatStoneForceRequest(input updateSeatStoneForceRequest) (bool, bool, string, error) {
	if input.Enabled == nil || input.ExpectedEnabled == nil {
		return false, false, "", errors.New("请提交目标状态和页面当前状态")
	}
	if !input.Confirm {
		return false, false, "", errors.New("请确认本次操作会强制该俱乐部/联盟的开房规则同步带入钻石")
	}
	note := strings.TrimSpace(input.Note)
	if utf8.RuneCountInString(note) < 2 {
		return false, false, "", errors.New("原因至少 2 个字")
	}
	if utf8.RuneCountInString(note) > seatStoneForceMaxNote {
		return false, false, "", fmt.Errorf("原因最多 %d 个字", seatStoneForceMaxNote)
	}
	return *input.Enabled, *input.ExpectedEnabled, note, nil
}

func seatStoneForceMessage(scope string, enabled bool) string {
	who := "该俱乐部"
	if scope == "union" {
		who = "该联盟总群主俱乐部"
	}
	if enabled {
		return "已对" + who + "开启强制开房带钻石"
	}
	return "已取消" + who + "的强制开房带钻石"
}

func (s *Server) handleSetClubSeatStoneForce(w http.ResponseWriter, r *http.Request, p principal) {
	clubID, err := normalizeClubID(r.PathValue("clubId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_CLUB_ID", err.Error())
		return
	}
	var input updateSeatStoneForceRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	target, expected, note, err := validateSeatStoneForceRequest(input)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_SEAT_STONE_FORCE", err.Error())
		return
	}

	seatStoneForceMutationMu.Lock()
	defer seatStoneForceMutationMu.Unlock()

	ctx := r.Context()
	var exists, unionID string
	if err := s.db.QueryRowContext(ctx,
		`SELECT club_guuid, COALESCE(union_id, '') FROM kbedm.club_guuid_info WHERE club_guuid = ? LIMIT 1`,
		clubID).Scan(&exists, &unionID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "CLUB_NOT_FOUND", "没有找到这个俱乐部")
			return
		}
		s.logger.Error("read club before seat stone force", "error", err, "clubId", clubID)
		writeError(w, http.StatusInternalServerError, "SEAT_STONE_FORCE_QUERY_FAILED", "读取俱乐部失败")
		return
	}
	if strings.TrimSpace(unionID) != "" {
		writeError(w, http.StatusBadRequest, "CLUB_IN_UNION", "该俱乐部已入盟，请在联盟管理里设置强制带入钻石")
		return
	}

	current, err := s.readClubSeatStoneForce(ctx, clubID)
	if err != nil {
		s.logger.Error("read club seat stone force", "error", err, "clubId", clubID)
		writeError(w, http.StatusInternalServerError, "SEAT_STONE_FORCE_QUERY_FAILED", "读取强制带入钻石开关失败")
		return
	}
	if current != expected {
		writeError(w, http.StatusConflict, "SEAT_STONE_FORCE_CONFLICT", "开关已被其他操作修改，请刷新后重试")
		return
	}
	if current == target {
		writeError(w, http.StatusBadRequest, "SEAT_STONE_FORCE_UNCHANGED", "开关没有变化")
		return
	}

	requestAudit := map[string]any{
		"enabled":   target,
		"note":      note,
		"configKey": clubSeatStoneForceKey(clubID),
	}
	beforeAudit := map[string]any{"enabled": current}
	after, writeErr := s.writeClubSeatStoneForce(ctx, clubID, target)
	if writeErr != nil {
		s.logger.Error("write club seat stone force", "error", writeErr, "clubId", clubID)
		s.audit(ctx, &p, clubSeatStoneForceAudit, "game_club", clubID,
			requestAudit, beforeAudit, nil, http.StatusInternalServerError, "保存强制带入钻石失败："+writeErr.Error(), clientIP(r))
		writeError(w, http.StatusInternalServerError, "SEAT_STONE_FORCE_UPDATE_FAILED", "保存失败，请刷新后重试")
		return
	}

	message := seatStoneForceMessage("club", after)
	s.audit(ctx, &p, clubSeatStoneForceAudit, "game_club", clubID,
		requestAudit, beforeAudit, map[string]any{"enabled": after}, 0, message, clientIP(r))
	writeData(w, http.StatusOK, seatStoneForceState{
		Scope:    "club",
		TargetID: clubID,
		Enabled:  after,
		Verified: true,
		Message:  message,
	})
}

func (s *Server) handleSetUnionSeatStoneForce(w http.ResponseWriter, r *http.Request, p principal) {
	unionID, err := normalizeUnionID(r.PathValue("unionId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_UNION_ID", err.Error())
		return
	}
	var input updateSeatStoneForceRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	target, expected, note, err := validateSeatStoneForceRequest(input)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_SEAT_STONE_FORCE", err.Error())
		return
	}

	seatStoneForceMutationMu.Lock()
	defer seatStoneForceMutationMu.Unlock()

	ctx := r.Context()
	var ownerClubID string
	if err := s.db.QueryRowContext(ctx,
		`SELECT COALESCE(club_guuid, '') FROM kbedm.club_union_info
WHERE union_id = ? AND status <> 'init' LIMIT 1`, unionID).Scan(&ownerClubID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "UNION_NOT_FOUND", "没有找到这个联盟")
			return
		}
		s.logger.Error("read union before seat stone force", "error", err, "unionId", unionID)
		writeError(w, http.StatusInternalServerError, "SEAT_STONE_FORCE_QUERY_FAILED", "读取联盟失败")
		return
	}
	ownerClubID = strings.TrimSpace(ownerClubID)
	if ownerClubID == "" {
		writeError(w, http.StatusBadRequest, "UNION_OWNER_CLUB_MISSING", "该联盟没有总群主俱乐部，无法设置强制带入钻石")
		return
	}

	current, err := s.readClubSeatStoneForce(ctx, ownerClubID)
	if err != nil {
		s.logger.Error("read union seat stone force", "error", err, "unionId", unionID, "ownerClubId", ownerClubID)
		writeError(w, http.StatusInternalServerError, "SEAT_STONE_FORCE_QUERY_FAILED", "读取强制带入钻石开关失败")
		return
	}
	if current != expected {
		writeError(w, http.StatusConflict, "SEAT_STONE_FORCE_CONFLICT", "开关已被其他操作修改，请刷新后重试")
		return
	}
	if current == target {
		writeError(w, http.StatusBadRequest, "SEAT_STONE_FORCE_UNCHANGED", "开关没有变化")
		return
	}

	requestAudit := map[string]any{
		"enabled":     target,
		"note":        note,
		"configKey":   clubSeatStoneForceKey(ownerClubID),
		"ownerClubId": ownerClubID,
	}
	beforeAudit := map[string]any{"enabled": current}
	after, writeErr := s.writeClubSeatStoneForce(ctx, ownerClubID, target)
	if writeErr != nil {
		s.logger.Error("write union seat stone force", "error", writeErr, "unionId", unionID, "ownerClubId", ownerClubID)
		s.audit(ctx, &p, unionSeatStoneForceAudit, "game_union", unionID,
			requestAudit, beforeAudit, nil, http.StatusInternalServerError, "保存强制带入钻石失败："+writeErr.Error(), clientIP(r))
		writeError(w, http.StatusInternalServerError, "SEAT_STONE_FORCE_UPDATE_FAILED", "保存失败，请刷新后重试")
		return
	}

	message := seatStoneForceMessage("union", after)
	s.audit(ctx, &p, unionSeatStoneForceAudit, "game_union", unionID,
		requestAudit, beforeAudit, map[string]any{"enabled": after, "ownerClubId": ownerClubID}, 0, message, clientIP(r))
	writeData(w, http.StatusOK, seatStoneForceState{
		Scope:       "union",
		TargetID:    unionID,
		OwnerClubID: ownerClubID,
		Enabled:     after,
		Verified:    true,
		Message:     message,
	})
}
