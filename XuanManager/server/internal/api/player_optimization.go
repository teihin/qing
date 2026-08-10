package api

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

type playerOptimizationItem struct {
	PlayerID         string `json:"playerId"`
	LoginName        string `json:"loginName"`
	Name             string `json:"name"`
	ManagerID        string `json:"managerId"`
	ManagerName      string `json:"managerName"`
	ConfiguredBy     string `json:"configuredBy"`
	ConfiguredSource string `json:"configuredSource"`
	RemainingCount   int64  `json:"remainingCount"`
	Chance           int64  `json:"chance"`
	Active           bool   `json:"active"`
	LastConfiguredAt string `json:"lastConfiguredAt"`
}

type playerOptimizationSummary struct {
	ActivePlayers  int64   `json:"activePlayers"`
	TotalRemaining int64   `json:"totalRemaining"`
	AverageChance  float64 `json:"averageChance"`
}

type playerOptimizationState struct {
	PlayerID         string `json:"playerId"`
	LoginName        string `json:"loginName"`
	Name             string `json:"name"`
	ManagerID        string `json:"managerId"`
	ManagerName      string `json:"managerName"`
	ConfiguredBy     string `json:"configuredBy"`
	ConfiguredSource string `json:"configuredSource"`
	RemainingCount   int64  `json:"remainingCount"`
	Chance           int64  `json:"chance"`
	Active           bool   `json:"active"`
	LastConfiguredAt string `json:"lastConfiguredAt"`
}

type createPlayerOptimizationRequest struct {
	PlayerID       string `json:"playerId"`
	RemainingCount int64  `json:"remainingCount"`
	Chance         int64  `json:"chance"`
	Reason         string `json:"reason"`
	Confirm        bool   `json:"confirm"`
}

type updatePlayerOptimizationRequest struct {
	RemainingCount  int64  `json:"remainingCount"`
	Chance          int64  `json:"chance"`
	Reason          string `json:"reason"`
	ExpectedManager string `json:"expectedManager"`
	ExpectedCount   int64  `json:"expectedCount"`
	ExpectedChance  int64  `json:"expectedChance"`
	Confirm         bool   `json:"confirm"`
}

type deletePlayerOptimizationRequest struct {
	Reason          string `json:"reason"`
	ExpectedManager string `json:"expectedManager"`
	ExpectedCount   int64  `json:"expectedCount"`
	ExpectedChance  int64  `json:"expectedChance"`
	Confirm         bool   `json:"confirm"`
}

type playerOptimizationConflict struct {
	code    string
	message string
}

func (e *playerOptimizationConflict) Error() string {
	return e.message
}

func (s *Server) handleListPlayerOptimizations(w http.ResponseWriter, r *http.Request, _ principal) {
	page, size := pageParams(r)
	keyword := strings.TrimSpace(r.URL.Query().Get("keyword"))
	if utf8.RuneCountInString(keyword) > 100 {
		writeError(w, http.StatusBadRequest, "INVALID_FILTER", "查询内容不能超过 100 个字符")
		return
	}
	status := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("status")))
	if status == "" {
		status = "active"
	}
	if status != "active" && status != "inactive" && status != "all" {
		writeError(w, http.StatusBadRequest, "INVALID_FILTER", "优化状态只能选择启用、未启用或全部")
		return
	}
	minChance, maxChance, err := parseOptimizationChanceRange(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_FILTER", err.Error())
		return
	}
	where, args := buildPlayerOptimizationWhere(keyword, status, minChance, maxChance)

	var total int64
	if err := s.db.QueryRowContext(r.Context(), `SELECT COUNT(*)
FROM kbedm.tbl_Account a
LEFT JOIN kbedm.kbe_accountinfos k ON k.entityDBID = a.id
LEFT JOIN kbedm.tbl_Account manager ON manager.sm_guuid = a.sm_optimize01_man
WHERE `+where, args...).Scan(&total); err != nil {
		s.logger.Error("count player optimizations", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取发牌优化玩家数量失败")
		return
	}

	queryArgs := append(append([]any{}, args...), size, (page-1)*size)
	rows, err := s.db.QueryContext(r.Context(), `SELECT
a.sm_guuid, COALESCE(k.accountName, a.sm_wxID, ''), a.sm_name,
COALESCE(a.sm_optimize01_man, ''), COALESCE(manager.sm_name, ''),
COALESCE((SELECT log.operator_name FROM mgr_audit_log log
  WHERE log.target_type = 'game_player' AND log.target_id = a.sm_guuid AND log.result_code = 0
    AND log.action IN ('game.player_optimization.create', 'game.player_optimization.update')
  ORDER BY log.id DESC LIMIT 1), ''),
a.sm_optimize01_count, a.sm_optimize01_chance,
COALESCE((SELECT DATE_FORMAT(MAX(log.created_at), '%Y-%m-%d %H:%i:%s') FROM mgr_audit_log log
  WHERE log.target_type = 'game_player' AND log.target_id = a.sm_guuid AND log.result_code = 0
    AND log.action IN ('game.player_optimization.create', 'game.player_optimization.update', 'game.player_optimization.delete')),
  (SELECT CONCAT(o.date, ' ', o.time) FROM kbedm.usr_opt_info o
    WHERE o.user_guuid = a.sm_guuid AND o.option_type = '设置'
    ORDER BY o.id DESC LIMIT 1), '')
FROM kbedm.tbl_Account a
LEFT JOIN kbedm.kbe_accountinfos k ON k.entityDBID = a.id
LEFT JOIN kbedm.tbl_Account manager ON manager.sm_guuid = a.sm_optimize01_man
WHERE `+where+`
ORDER BY (a.sm_optimize01_count > 0) DESC, a.sm_optimize01_count DESC, a.id DESC
LIMIT ? OFFSET ?`, queryArgs...)
	if err != nil {
		s.logger.Error("list player optimizations", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取发牌优化玩家列表失败")
		return
	}
	defer rows.Close()
	items := make([]playerOptimizationItem, 0, size)
	for rows.Next() {
		var item playerOptimizationItem
		if err := rows.Scan(&item.PlayerID, &item.LoginName, &item.Name, &item.ManagerID, &item.ManagerName,
			&item.ConfiguredBy, &item.RemainingCount, &item.Chance, &item.LastConfiguredAt); err != nil {
			s.logger.Error("scan player optimization", "error", err)
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取发牌优化玩家数据失败")
			return
		}
		item.Active = item.RemainingCount > 0
		item.ConfiguredSource = playerOptimizationConfiguredSource(item.ConfiguredBy, item.ManagerID)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取发牌优化玩家数据失败")
		return
	}

	var summary playerOptimizationSummary
	if err := s.db.QueryRowContext(r.Context(), `SELECT
COUNT(CASE WHEN sm_optimize01_count > 0 THEN 1 END),
COALESCE(SUM(CASE WHEN sm_optimize01_count > 0 THEN sm_optimize01_count ELSE 0 END), 0),
COALESCE(AVG(CASE WHEN sm_optimize01_count > 0 THEN sm_optimize01_chance END), 0)
FROM kbedm.tbl_Account`).Scan(&summary.ActivePlayers, &summary.TotalRemaining, &summary.AverageChance); err != nil {
		s.logger.Error("summarize player optimizations", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取发牌优化汇总失败")
		return
	}
	writeData(w, http.StatusOK, map[string]any{
		"items": items, "page": page, "pageSize": size, "total": total, "summary": summary,
	})
}

func (s *Server) handleGetPlayerOptimization(w http.ResponseWriter, r *http.Request, _ principal) {
	playerID, err := normalizeGamePlayerID(r.PathValue("playerId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PLAYER_ID", err.Error())
		return
	}
	state, err := s.readPlayerOptimizationState(r.Context(), playerID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "PLAYER_NOT_FOUND", "没有找到这个游戏玩家 ID")
		return
	}
	if err != nil {
		s.logger.Error("read player optimization", "error", err, "playerId", playerID)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取玩家发牌优化参数失败")
		return
	}
	writeData(w, http.StatusOK, state)
}

func (s *Server) handleCreatePlayerOptimization(w http.ResponseWriter, r *http.Request, p principal) {
	if !p.IsSuper {
		writeError(w, http.StatusForbidden, "SUPER_ADMIN_REQUIRED", "发牌优化属于高风险游戏参数，仅允许超级管理员新增")
		return
	}
	var input createPlayerOptimizationRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	playerID, err := normalizeGamePlayerID(input.PlayerID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PLAYER_ID", err.Error())
		return
	}
	if err := normalizeAndValidateCreateOptimizationRequest(&input); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_OPTIMIZATION", err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	before, err := s.readPlayerOptimizationState(ctx, playerID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "PLAYER_NOT_FOUND", "没有找到这个游戏玩家 ID")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取玩家发牌优化参数失败")
		return
	}
	if before.Active {
		writeError(w, http.StatusConflict, "OPTIMIZATION_ALREADY_EXISTS", "该玩家已启用发牌优化，请使用调整参数操作")
		return
	}
	managerID, managerName, err := s.readSingleBoss(ctx)
	if err != nil {
		s.logger.Error("resolve optimization manager", "error", err)
		writeError(w, http.StatusServiceUnavailable, "OPTIMIZATION_MANAGER_UNAVAILABLE", "无法唯一确定游戏 BOSS，已停止新增发牌优化")
		return
	}
	target := playerOptimizationState{
		PlayerID: playerID, LoginName: before.LoginName, Name: before.Name,
		ManagerID: managerID, ManagerName: managerName, RemainingCount: input.RemainingCount, Chance: input.Chance, Active: true,
	}
	message := fmt.Sprintf("已为玩家 %s 新增发牌优化：剩余 %d 次、概率 %d%%", playerID, target.RemainingCount, target.Chance)
	s.completePlayerOptimizationMutation(w, r, p, ctx, "game.player_optimization.create", input.Reason, before, target, message)
}

func parseOptimizationChanceRange(r *http.Request) (*int64, *int64, error) {
	parse := func(name string) (*int64, error) {
		value := strings.TrimSpace(r.URL.Query().Get(name))
		if value == "" {
			return nil, nil
		}
		parsed, err := strconv.ParseInt(value, 10, 64)
		if err != nil || parsed < 0 || parsed > 100 {
			return nil, errors.New("概率范围必须是 0 到 100 的整数")
		}
		return &parsed, nil
	}
	minimum, err := parse("minChance")
	if err != nil {
		return nil, nil, err
	}
	maximum, err := parse("maxChance")
	if err != nil {
		return nil, nil, err
	}
	if minimum != nil && maximum != nil && *minimum > *maximum {
		return nil, nil, errors.New("最低概率不能大于最高概率")
	}
	return minimum, maximum, nil
}

func buildPlayerOptimizationWhere(keyword, status string, minChance, maxChance *int64) (string, []any) {
	clauses := []string{"1=1"}
	args := []any{}
	switch status {
	case "active":
		clauses = append(clauses, "a.sm_optimize01_count > 0")
	case "inactive":
		clauses = append(clauses, "a.sm_optimize01_count <= 0")
	}
	if keyword != "" {
		like := "%" + keyword + "%"
		clauses = append(clauses, `(a.sm_guuid = ? OR a.sm_wxID = ? OR k.accountName = ? OR a.sm_name LIKE ? OR a.sm_optimize01_man = ? OR manager.sm_name LIKE ?
OR EXISTS (SELECT 1 FROM mgr_audit_log operator_log
  WHERE operator_log.target_type = 'game_player' AND operator_log.target_id = a.sm_guuid AND operator_log.result_code = 0
    AND operator_log.action IN ('game.player_optimization.create', 'game.player_optimization.update')
    AND operator_log.operator_name LIKE ?))`)
		args = append(args, keyword, keyword, keyword, like, keyword, like, like)
	}
	if minChance != nil {
		clauses = append(clauses, "a.sm_optimize01_chance >= ?")
		args = append(args, *minChance)
	}
	if maxChance != nil {
		clauses = append(clauses, "a.sm_optimize01_chance <= ?")
		args = append(args, *maxChance)
	}
	return strings.Join(clauses, " AND "), args
}

func (s *Server) handleUpdatePlayerOptimization(w http.ResponseWriter, r *http.Request, p principal) {
	if !p.IsSuper {
		writeError(w, http.StatusForbidden, "SUPER_ADMIN_REQUIRED", "发牌优化属于高风险游戏参数，仅允许超级管理员修改")
		return
	}
	playerID, err := normalizeGamePlayerID(r.PathValue("playerId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PLAYER_ID", err.Error())
		return
	}
	var input updatePlayerOptimizationRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if err := normalizeAndValidateOptimizationRequest(&input); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_OPTIMIZATION", err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	before, err := s.readPlayerOptimizationState(ctx, playerID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "PLAYER_NOT_FOUND", "没有找到这个游戏玩家 ID")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取玩家发牌优化参数失败")
		return
	}
	if !before.Active {
		writeError(w, http.StatusConflict, "OPTIMIZATION_NOT_FOUND", "该玩家尚未启用发牌优化，请使用新增操作")
		return
	}
	if before.ManagerID != strings.TrimSpace(input.ExpectedManager) || before.RemainingCount != input.ExpectedCount || before.Chance != input.ExpectedChance {
		writeError(w, http.StatusConflict, "OPTIMIZATION_CHANGED", "玩家发牌优化参数已变化，请刷新列表后重新操作")
		return
	}
	managerID, managerName, err := s.readSingleBoss(ctx)
	if err != nil {
		s.logger.Error("resolve optimization manager", "error", err)
		writeError(w, http.StatusServiceUnavailable, "OPTIMIZATION_MANAGER_UNAVAILABLE", "无法唯一确定游戏 BOSS，已停止修改发牌优化")
		return
	}
	target := playerOptimizationState{
		PlayerID: playerID, LoginName: before.LoginName, Name: before.Name,
		ManagerID: managerID, ManagerName: managerName, RemainingCount: input.RemainingCount, Chance: input.Chance, Active: true,
	}
	if optimizationStateMatches(before, target) {
		writeError(w, http.StatusBadRequest, "OPTIMIZATION_UNCHANGED", "发牌优化参数没有变化")
		return
	}

	message := fmt.Sprintf("玩家 %s 的发牌优化已调整为剩余 %d 次、概率 %d%%", playerID, target.RemainingCount, target.Chance)
	s.completePlayerOptimizationMutation(w, r, p, ctx, "game.player_optimization.update", input.Reason, before, target, message)
}

func normalizeAndValidateOptimizationRequest(input *updatePlayerOptimizationRequest) error {
	if err := validateActiveOptimizationValues(input.RemainingCount, input.Chance); err != nil {
		return err
	}
	if !input.Confirm {
		return errors.New("请确认本次操作会改变玩家发牌优化参数")
	}
	if input.ExpectedCount < 0 || input.ExpectedChance < 0 || input.ExpectedChance > 100 {
		return errors.New("页面基准参数不正确，请刷新后重试")
	}
	return nil
}

func normalizeAndValidateCreateOptimizationRequest(input *createPlayerOptimizationRequest) error {
	if err := validateActiveOptimizationValues(input.RemainingCount, input.Chance); err != nil {
		return err
	}
	if strings.TrimSpace(input.Reason) != "" {
		if err := normalizeOptimizationReason(&input.Reason); err != nil {
			return err
		}
	} else {
		input.Reason = ""
	}
	if !input.Confirm {
		return errors.New("请确认新增发牌优化会影响玩家牌局结果")
	}
	return nil
}

func validateActiveOptimizationValues(remainingCount, chance int64) error {
	if remainingCount < 1 || remainingCount > 1000000 {
		return errors.New("剩余次数必须是 1 到 1,000,000 的整数")
	}
	if chance < 1 || chance > 100 {
		return errors.New("触发概率必须是 1% 到 100% 的整数")
	}
	return nil
}

func normalizeOptimizationReason(reason *string) error {
	*reason = strings.Join(strings.Fields(strings.TrimSpace(*reason)), " ")
	if utf8.RuneCountInString(*reason) < 2 || utf8.RuneCountInString(*reason) > 120 {
		return errors.New("操作原因必须填写 2 到 120 个字符")
	}
	for _, char := range *reason {
		if unicode.IsControl(char) {
			return errors.New("操作原因不能包含控制字符")
		}
	}
	return nil
}

func (s *Server) handleDeletePlayerOptimization(w http.ResponseWriter, r *http.Request, p principal) {
	if !p.IsSuper {
		writeError(w, http.StatusForbidden, "SUPER_ADMIN_REQUIRED", "发牌优化属于高风险游戏参数，仅允许超级管理员删除")
		return
	}
	playerID, err := normalizeGamePlayerID(r.PathValue("playerId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PLAYER_ID", err.Error())
		return
	}
	var input deletePlayerOptimizationRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.Reason) != "" {
		if err := normalizeOptimizationReason(&input.Reason); err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_OPTIMIZATION", err.Error())
			return
		}
	} else {
		input.Reason = ""
	}
	if !input.Confirm {
		writeError(w, http.StatusBadRequest, "OPTIMIZATION_CONFIRM_REQUIRED", "请确认删除会立即停用该玩家的发牌优化")
		return
	}
	if input.ExpectedCount < 1 || input.ExpectedChance < 1 || input.ExpectedChance > 100 {
		writeError(w, http.StatusBadRequest, "INVALID_OPTIMIZATION", "页面基准参数不正确，请刷新后重试")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	before, err := s.readPlayerOptimizationState(ctx, playerID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "PLAYER_NOT_FOUND", "没有找到这个游戏玩家 ID")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取玩家发牌优化参数失败")
		return
	}
	if !before.Active {
		writeError(w, http.StatusConflict, "OPTIMIZATION_NOT_FOUND", "该玩家没有可删除的发牌优化")
		return
	}
	if before.ManagerID != strings.TrimSpace(input.ExpectedManager) || before.RemainingCount != input.ExpectedCount || before.Chance != input.ExpectedChance {
		writeError(w, http.StatusConflict, "OPTIMIZATION_CHANGED", "玩家发牌优化参数已变化，请刷新列表后重新操作")
		return
	}
	target := playerOptimizationState{PlayerID: playerID, LoginName: before.LoginName, Name: before.Name}
	message := fmt.Sprintf("已删除玩家 %s 的发牌优化", playerID)
	s.completePlayerOptimizationMutation(w, r, p, ctx, "game.player_optimization.delete", input.Reason, before, target, message)
}

func (s *Server) completePlayerOptimizationMutation(w http.ResponseWriter, r *http.Request, p principal, ctx context.Context, action, reason string, before, target playerOptimizationState, message string) {
	requestAudit := map[string]any{
		"playerId": target.PlayerID, "remainingCount": target.RemainingCount, "chance": target.Chance,
		"writeMode": "direct-database-transaction",
	}
	if strings.TrimSpace(reason) != "" {
		requestAudit["reason"] = strings.TrimSpace(reason)
	}
	lockedBefore, after, err := s.writePlayerOptimizationTransaction(ctx, action, before, target)
	if err != nil {
		var conflict *playerOptimizationConflict
		if errors.As(err, &conflict) {
			writeError(w, http.StatusConflict, conflict.code, conflict.message)
			return
		}
		s.logger.Error("write player optimization transaction", "action", action, "error", err, "playerId", target.PlayerID)
		resultMessage := "发牌优化数据库事务未完成，参数没有修改"
		s.audit(ctx, &p, action, "game_player", target.PlayerID, requestAudit, before, nil, 500, resultMessage, clientIP(r))
		writeError(w, http.StatusInternalServerError, "OPTIMIZATION_UPDATE_FAILED", resultMessage+"；请刷新后重试")
		return
	}
	s.audit(ctx, &p, action, "game_player", target.PlayerID, requestAudit, lockedBefore, after, 0, message, clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"player": after, "message": message})
}

func (s *Server) readPlayerOptimizationState(ctx context.Context, playerID string) (playerOptimizationState, error) {
	var state playerOptimizationState
	err := s.db.QueryRowContext(ctx, `SELECT
a.sm_guuid, COALESCE(k.accountName, a.sm_wxID, ''), a.sm_name,
COALESCE(a.sm_optimize01_man, ''), COALESCE(manager.sm_name, ''),
COALESCE((SELECT log.operator_name FROM mgr_audit_log log
  WHERE log.target_type = 'game_player' AND log.target_id = a.sm_guuid AND log.result_code = 0
    AND log.action IN ('game.player_optimization.create', 'game.player_optimization.update')
  ORDER BY log.id DESC LIMIT 1), ''),
a.sm_optimize01_count, a.sm_optimize01_chance,
COALESCE((SELECT DATE_FORMAT(MAX(log.created_at), '%Y-%m-%d %H:%i:%s') FROM mgr_audit_log log
  WHERE log.target_type = 'game_player' AND log.target_id = a.sm_guuid AND log.result_code = 0
    AND log.action IN ('game.player_optimization.create', 'game.player_optimization.update', 'game.player_optimization.delete')),
  (SELECT CONCAT(o.date, ' ', o.time) FROM kbedm.usr_opt_info o
    WHERE o.user_guuid = a.sm_guuid AND o.option_type = '设置'
    ORDER BY o.id DESC LIMIT 1), '')
FROM kbedm.tbl_Account a
LEFT JOIN kbedm.kbe_accountinfos k ON k.entityDBID = a.id
	LEFT JOIN kbedm.tbl_Account manager ON manager.sm_guuid = a.sm_optimize01_man
WHERE a.sm_guuid = ? LIMIT 1`, playerID).Scan(
		&state.PlayerID, &state.LoginName, &state.Name, &state.ManagerID, &state.ManagerName,
		&state.ConfiguredBy, &state.RemainingCount, &state.Chance, &state.LastConfiguredAt,
	)
	state.Active = state.RemainingCount > 0
	state.ConfiguredSource = playerOptimizationConfiguredSource(state.ConfiguredBy, state.ManagerID)
	return state, err
}

func playerOptimizationConfiguredSource(configuredBy, managerID string) string {
	if strings.TrimSpace(configuredBy) != "" {
		return "admin"
	}
	if strings.TrimSpace(managerID) != "" {
		return "game"
	}
	return ""
}

func (s *Server) readSingleBoss(ctx context.Context) (string, string, error) {
	var count int64
	var playerID, name string
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*), COALESCE(MAX(sm_guuid), ''), COALESCE(MAX(sm_name), '')
FROM kbedm.tbl_Account WHERE sm_role LIKE '%老板%'`).Scan(&count, &playerID, &name)
	if err != nil {
		return "", "", err
	}
	if count != 1 || playerID == "" {
		return "", "", fmt.Errorf("expected one boss, found %d", count)
	}
	return playerID, name, nil
}

func (s *Server) writePlayerOptimizationTransaction(ctx context.Context, action string, expected, target playerOptimizationState) (playerOptimizationState, playerOptimizationState, error) {
	if s.gameDB == nil {
		return expected, playerOptimizationState{}, errors.New("game database connection is not configured")
	}
	tx, err := s.gameDB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return expected, playerOptimizationState{}, err
	}
	defer tx.Rollback()

	lockedBefore := expected
	err = tx.QueryRowContext(ctx, `SELECT COALESCE(sm_optimize01_man, ''), sm_optimize01_count, sm_optimize01_chance
FROM kbedm.tbl_Account WHERE sm_guuid = ? LIMIT 1 FOR UPDATE`, target.PlayerID).Scan(
		&lockedBefore.ManagerID, &lockedBefore.RemainingCount, &lockedBefore.Chance,
	)
	if err != nil {
		return expected, playerOptimizationState{}, err
	}
	lockedBefore.Active = lockedBefore.RemainingCount > 0

	switch action {
	case "game.player_optimization.create":
		if lockedBefore.Active {
			return lockedBefore, playerOptimizationState{}, &playerOptimizationConflict{
				code: "OPTIMIZATION_ALREADY_EXISTS", message: "该玩家已启用发牌优化，请刷新列表后使用调整参数操作",
			}
		}
	case "game.player_optimization.update", "game.player_optimization.delete":
		if !lockedBefore.Active {
			return lockedBefore, playerOptimizationState{}, &playerOptimizationConflict{
				code: "OPTIMIZATION_NOT_FOUND", message: "该玩家的发牌优化已不存在，请刷新列表后重试",
			}
		}
		if !optimizationStateMatches(lockedBefore, expected) {
			return lockedBefore, playerOptimizationState{}, &playerOptimizationConflict{
				code: "OPTIMIZATION_CHANGED", message: "玩家发牌优化参数已变化，请刷新列表后重新操作",
			}
		}
	default:
		return lockedBefore, playerOptimizationState{}, fmt.Errorf("unsupported optimization action %q", action)
	}

	result, err := tx.ExecContext(ctx, `UPDATE kbedm.tbl_Account
SET sm_optimize01_man = ?, sm_optimize01_count = ?, sm_optimize01_chance = ?
WHERE sm_guuid = ?`, target.ManagerID, target.RemainingCount, target.Chance, target.PlayerID)
	if err != nil {
		return lockedBefore, playerOptimizationState{}, err
	}
	if affected, err := result.RowsAffected(); err != nil || affected != 1 {
		if err != nil {
			return lockedBefore, playerOptimizationState{}, err
		}
		return lockedBefore, playerOptimizationState{}, fmt.Errorf("expected one updated player, got %d", affected)
	}

	verified := target
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(sm_optimize01_man, ''), sm_optimize01_count, sm_optimize01_chance
FROM kbedm.tbl_Account WHERE sm_guuid = ? LIMIT 1`, target.PlayerID).Scan(
		&verified.ManagerID, &verified.RemainingCount, &verified.Chance,
	); err != nil {
		return lockedBefore, playerOptimizationState{}, err
	}
	verified.Active = verified.RemainingCount > 0
	if !optimizationStateMatches(verified, target) {
		return lockedBefore, playerOptimizationState{}, errors.New("transaction readback did not match target")
	}
	if err := tx.Commit(); err != nil {
		return lockedBefore, playerOptimizationState{}, err
	}

	after, err := s.readPlayerOptimizationState(ctx, target.PlayerID)
	if err != nil {
		after = verified
		after.LastConfiguredAt = time.Now().Format("2006-01-02 15:04:05")
	}
	return lockedBefore, after, nil
}

func optimizationStateMatches(actual, expected playerOptimizationState) bool {
	return actual.ManagerID == expected.ManagerID && actual.RemainingCount == expected.RemainingCount && actual.Chance == expected.Chance
}
