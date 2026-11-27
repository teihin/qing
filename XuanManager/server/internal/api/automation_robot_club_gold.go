package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

// 机器人俱乐部积分上分 / 下分（2026-11-26）
//
// 口径（用户确认）：
//   - 只有**已加入俱乐部**的机器人能上分；没有俱乐部的直接拒绝。
//   - 一个机器人可能属于多个俱乐部，所以一次批量必须**指定一个俱乐部**（前端提示选择）。
//   - 改的是「该玩家在该俱乐部的积分」，也就是带入时扣的那份钱（Account.club_gold[club_id]）。
//
// 游戏服命令（见 `服务器文档整理/俱乐部后台发放奖励-后台接口文档.md`）：
//   - 上分：`异步_发放_玩家_奖励`（club_id + user_ids + gold>0，单次≤50，逐人结果，写「积分奖励」流水）
//   - 下分：`添加_俱乐部_成员_积分`（club_id + user_id + user_add_gold 负数，单人；后台 boss 豁免交易密码）
//
// 两者都是"后台操作"：不扣任何人的代理额度，也不会自动加减牌桌筹码（机器人仍需重新带入）。

type robotClubGoldResult struct {
	ID         int64  `json:"id"`
	TerminalNo string `json:"terminalNo"`
	Ok         bool   `json:"ok"`
	Message    string `json:"message"`
}

type robotClubGoldRequest struct {
	IDs     []int64 `json:"ids"`
	ClubID  string  `json:"clubId"`
	Action  string  `json:"action"`
	Amount  int64   `json:"amount"`
	Reason  string  `json:"reason"`
	Confirm bool    `json:"confirm"`
}

type robotClubGoldTarget struct {
	robotID    int64
	terminalNo string
	account    string
	playerID   string
	clubs      []string
	inClub     bool
	current    int64
	hasCurrent bool
}

// robotClubGoldOptions 是「选择上分俱乐部」下拉的一项。
type robotClubGoldOption struct {
	ClubID string `json:"clubId"`
	Name   string `json:"name"`
	Robots int    `json:"robots"`
}

func (s *Server) registerRobotClubGoldRoutes() {
	s.mux.Handle("POST /api/automation/robots/club-gold",
		s.authorized("automation.robot.operate", true, s.handleAdjustRobotClubGold))
	s.mux.Handle("GET /api/automation/robots/club-options",
		s.authorized("automation.robot.operate", false, s.handleRobotClubGoldOptions))
}

func (s *Server) handleAdjustRobotClubGold(w http.ResponseWriter, r *http.Request, p principal) {
	var input robotClubGoldRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	action := strings.TrimSpace(strings.ToLower(input.Action))
	if action != "add" && action != "subtract" {
		writeError(w, http.StatusBadRequest, "INVALID_ADJUSTMENT_ACTION", "请选择上分或下分")
		return
	}
	if len(input.IDs) == 0 || len(input.IDs) > 100 {
		writeError(w, http.StatusBadRequest, "INVALID_IDS", "批量上下分需要选择 1 到 100 个机器人")
		return
	}
	if input.Amount < 1 || input.Amount > 1000000 {
		writeError(w, http.StatusBadRequest, "INVALID_ADJUSTMENT_AMOUNT", "单次上下分必须是 1 到 1,000,000 的整数金币")
		return
	}
	clubID := strings.TrimSpace(input.ClubID)
	if clubID == "" {
		writeError(w, http.StatusBadRequest, "CLUB_REQUIRED", "请选择要给哪个俱乐部上分")
		return
	}
	reason := strings.TrimSpace(input.Reason)
	if count := utf8.RuneCountInString(reason); count < 2 || count > 120 {
		writeError(w, http.StatusBadRequest, "INVALID_ADJUSTMENT_REASON", "操作原因必须填写 2 到 120 个字符")
		return
	}
	if !input.Confirm {
		writeError(w, http.StatusBadRequest, "ADJUSTMENT_CONFIRM_REQUIRED", "请确认本次操作会直接改变机器人在俱乐部的积分")
		return
	}
	scope, err := s.automationScope(r.Context(), p)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取数据范围失败")
		return
	}
	if !scope.Allows(clubID) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "没有这个俱乐部的操作权限")
		return
	}

	targets, err := s.loadRobotClubGoldTargets(r.Context(), input.IDs, clubID)
	if err != nil {
		s.logger.Error("load robot club gold targets", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取机器人俱乐部信息失败")
		return
	}

	actionLabel := "上分"
	if action == "subtract" {
		actionLabel = "下分"
	}
	results := make([]robotClubGoldResult, 0, len(targets))
	eligible := make([]robotClubGoldTarget, 0, len(targets))
	for _, target := range targets {
		switch {
		case strings.TrimSpace(target.playerID) == "":
			results = append(results, robotClubGoldResult{ID: target.robotID, TerminalNo: target.terminalNo,
				Message: "账号还没在游戏里登录过，没有用户ID，不能上下分"})
		case !target.inClub:
			results = append(results, robotClubGoldResult{ID: target.robotID, TerminalNo: target.terminalNo,
				Message: "未加入俱乐部 " + clubID + "，已跳过"})
		default:
			eligible = append(eligible, target)
		}
	}

	workOrder := gameOperationContext("club-gold")
	if len(eligible) > 0 {
		if action == "add" {
			results = append(results, s.grantRobotClubGold(r.Context(), eligible, clubID, input.Amount, workOrder)...)
		} else {
			results = append(results, s.deductRobotClubGold(r.Context(), eligible, clubID, input.Amount, workOrder)...)
		}
	}

	succeeded, failed := 0, 0
	for _, item := range results {
		if item.Ok {
			succeeded++
		} else {
			failed++
		}
	}
	s.audit(r.Context(), &p, "automation.robot.club_gold_adjust", "automation_club", clubID,
		map[string]any{"action": action, "amount": input.Amount, "ids": input.IDs, "reason": reason, "workOrder": workOrder},
		nil, map[string]any{"succeeded": succeeded, "failed": failed}, 0,
		fmt.Sprintf("%s %d 台机器人各 %d 金币：成功 %d，失败 %d", actionLabel, len(results), input.Amount, succeeded, failed),
		clientIP(r))
	if succeeded > 0 {
		agentStreams.notifyChange("robots", map[string]any{"clubId": clubID})
	}
	writeData(w, http.StatusOK, map[string]any{
		"results":   results,
		"succeeded": succeeded,
		"failed":    failed,
		"message":   fmt.Sprintf("%s完成：成功 %d 台，失败 %d 台", actionLabel, succeeded, failed),
	})
}

// handleRobotClubGoldOptions 返回这批机器人涉及的俱乐部（去重 + 台数），给前端做「选择上分俱乐部」。
func (s *Server) handleRobotClubGoldOptions(w http.ResponseWriter, r *http.Request, p principal) {
	ids := []int64{}
	for _, raw := range strings.Split(r.URL.Query().Get("ids"), ",") {
		if value, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64); err == nil && value > 0 {
			ids = append(ids, value)
		}
	}
	if len(ids) == 0 || len(ids) > 100 {
		writeError(w, http.StatusBadRequest, "INVALID_IDS", "请选择 1 到 100 个机器人")
		return
	}
	targets, err := s.loadRobotClubGoldTargets(r.Context(), ids, "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取俱乐部信息失败")
		return
	}
	counts := map[string]int{}
	order := []string{}
	for _, target := range targets {
		for _, clubID := range target.clubs {
			if _, exists := counts[clubID]; !exists {
				order = append(order, clubID)
			}
			counts[clubID]++
		}
	}
	names := map[string]string{}
	if len(order) > 0 {
		if metas, metaErr := s.readActiveClubMeta(r.Context(), order); metaErr == nil {
			for id, meta := range metas {
				names[id] = meta.Name
			}
		}
	}
	items := make([]robotClubGoldOption, 0, len(order))
	for _, clubID := range order {
		name := names[clubID]
		if strings.TrimSpace(name) == "" {
			name = clubID
		}
		items = append(items, robotClubGoldOption{ClubID: clubID, Name: name, Robots: counts[clubID]})
	}
	sort.SliceStable(items, func(i, j int) bool { return items[i].Robots > items[j].Robots })
	writeData(w, http.StatusOK, map[string]any{"items": items})
}

// loadRobotClubGoldTargets 读机器人 → 玩家ID → 该玩家加入的俱乐部与在目标俱乐部里的当前积分。
// clubID 为空时只填 clubs（给下拉用）。
func (s *Server) loadRobotClubGoldTargets(ctx context.Context, ids []int64, clubID string) ([]robotClubGoldTarget, error) {
	args := make([]any, 0, len(ids))
	for _, id := range ids {
		args = append(args, id)
	}
	rows, err := s.db.QueryContext(ctx, `SELECT r.id, r.terminal_no, r.account,
COALESCE(m.player_guuid, ''), COALESCE(a.sm_club_make, ''), COALESCE(a.sm_club_join, ''),
COALESCE(a.sm_club_manage, ''), COALESCE(a.sm_club_gold, ''), COALESCE(a.sm_club_gold2, '')
FROM mgr_automation_robot r
LEFT JOIN kbedm.third_marketing_info m ON m.player_wxid = r.account
LEFT JOIN kbedm.tbl_Account a ON a.sm_guuid = m.player_guuid
WHERE r.id IN (`+placeholders(len(args))+`)
ORDER BY r.id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	targets := make([]robotClubGoldTarget, 0, len(ids))
	for rows.Next() {
		var target robotClubGoldTarget
		var makeCol, joinCol, manageCol, gold1, gold2 string
		if err := rows.Scan(&target.robotID, &target.terminalNo, &target.account, &target.playerID,
			&makeCol, &joinCol, &manageCol, &gold1, &gold2); err != nil {
			return nil, err
		}
		goldMap := map[string]float64{}
		for id, amount := range parseUserDataClubGold(gold1) {
			goldMap[id] = amount
		}
		// club_mode=2/3 的积分在第二份里；成员关系两边都认。
		for id, amount := range parseUserDataClubGold(gold2) {
			if _, exists := goldMap[id]; !exists {
				goldMap[id] = amount
			}
		}
		clubs := clubIDsFromMembershipColumns(makeCol, joinCol, manageCol)
		for id := range goldMap {
			seen := false
			for _, existing := range clubs {
				if existing == id {
					seen = true
					break
				}
			}
			if !seen {
				clubs = append(clubs, id)
			}
		}
		target.clubs = clubs
		if clubID != "" {
			if amount, ok := goldMap[clubID]; ok {
				target.inClub = true
				target.current = int64(amount)
				target.hasCurrent = true
			} else {
				for _, id := range clubs {
					if id == clubID {
						target.inClub = true
						break
					}
				}
			}
		}
		targets = append(targets, target)
	}
	return targets, rows.Err()
}

// grantRobotClubGold 上分：用批量奖励命令，单次最多 50 人。
func (s *Server) grantRobotClubGold(ctx context.Context, targets []robotClubGoldTarget, clubID string, amount int64, workOrder string) []robotClubGoldResult {
	results := []robotClubGoldResult{}
	byPlayer := map[string]robotClubGoldTarget{}
	order := []string{}
	for _, target := range targets {
		if _, exists := byPlayer[target.playerID]; !exists {
			order = append(order, target.playerID)
		}
		byPlayer[target.playerID] = target
	}
	for start := 0; start < len(order); start += 50 {
		end := start + 50
		if end > len(order) {
			end = len(order)
		}
		batch := order[start:end]
		userIDs := make([]any, 0, len(batch))
		for _, playerID := range batch {
			userIDs = append(userIDs, playerID)
		}
		callCtx, cancel := context.WithTimeout(ctx, 25*time.Second)
		payload, err := s.callRewardCommand(callCtx, "异步_发放_玩家_奖励", map[string]any{
			"club_id": clubID, "user_ids": userIDs, "gold": amount, "context": workOrder,
		})
		cancel()
		if err != nil {
			for _, playerID := range batch {
				target := byPlayer[playerID]
				results = append(results, robotClubGoldResult{ID: target.robotID, TerminalNo: target.terminalNo,
					Message: "上分失败：" + err.Error()})
			}
			continue
		}
		success := map[string]bool{}
		for _, value := range asStringSlice(payload["success"]) {
			success[value] = true
		}
		failed := map[string]string{}
		if list, ok := payload["failed"].([]any); ok {
			for _, raw := range list {
				if item, ok := raw.(map[string]any); ok {
					failed[fmt.Sprint(item["user_guuid"])] = fmt.Sprint(item["error"])
				}
			}
		}
		for _, playerID := range batch {
			target := byPlayer[playerID]
			switch {
			case success[playerID]:
				results = append(results, robotClubGoldResult{ID: target.robotID, TerminalNo: target.terminalNo, Ok: true,
					Message: fmt.Sprintf("已上分 %d（俱乐部 %s）", amount, clubID)})
			case failed[playerID] != "":
				results = append(results, robotClubGoldResult{ID: target.robotID, TerminalNo: target.terminalNo,
					Message: "上分失败：" + failed[playerID]})
			default:
				results = append(results, robotClubGoldResult{ID: target.robotID, TerminalNo: target.terminalNo,
					Message: "上分结果未确认，请刷新俱乐部积分核对"})
			}
		}
	}
	return results
}

// deductRobotClubGold 下分：老的成员积分命令支持负数，逐台执行。
func (s *Server) deductRobotClubGold(ctx context.Context, targets []robotClubGoldTarget, clubID string, amount int64, workOrder string) []robotClubGoldResult {
	results := make([]robotClubGoldResult, 0, len(targets))
	for _, target := range targets {
		if target.hasCurrent && target.current < amount {
			results = append(results, robotClubGoldResult{ID: target.robotID, TerminalNo: target.terminalNo,
				Message: fmt.Sprintf("下分失败：当前只有 %d，不能扣 %d", target.current, amount)})
			continue
		}
		callCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		result, err := s.callGameCommand(callCtx, "添加_俱乐部_成员_积分", map[string]any{
			"club_id": clubID, "user_id": target.playerID, "user_add_gold": -amount, "context": workOrder,
		})
		cancel()
		entry := robotClubGoldResult{ID: target.robotID, TerminalNo: target.terminalNo}
		switch {
		case err != nil:
			entry.Message = "下分失败：" + err.Error()
		case result.RetCode == 512 || result.RetCode == 1280:
			// 这条老命令是「无即时响应」的：512 是当场成功，1280 是已受理但没回最终结果。
			// 两者都要回读余额确认，不能凭返回码就报成功。
			after, ok := s.readRobotClubGold(ctx, target.playerID, clubID)
			switch {
			case ok && target.hasCurrent && after == target.current-amount:
				entry.Ok = true
				entry.Message = fmt.Sprintf("已下分 %d（俱乐部 %s）", amount, clubID)
			case ok:
				entry.Ok = true
				entry.Message = fmt.Sprintf("已提交下分 %d；当前余额 %d（发起前 %d）", amount, after, target.current)
			default:
				entry.Message = "下分已提交但未能回读确认，请刷新俱乐部积分核对，切勿重复提交"
			}
		default:
			entry.Message = "下分失败：" + describeGameFailure("添加_俱乐部_成员_积分", result.RetCode, result.RetResult)
		}
		results = append(results, entry)
	}
	return results
}

// clubGoldOf 从 sm_club_gold / sm_club_gold2（JSON）里取该玩家在某个俱乐部的积分。
// club_mode=2/3 的积分在第二份里，所以两份都看。
func clubGoldOf(gold1, gold2, clubID string) int64 {
	if strings.TrimSpace(clubID) == "" {
		return 0
	}
	if amount, ok := parseUserDataClubGold(gold1)[clubID]; ok {
		return int64(amount)
	}
	if amount, ok := parseUserDataClubGold(gold2)[clubID]; ok {
		return int64(amount)
	}
	return 0
}

// readRobotClubGold 回读某玩家在指定俱乐部的当前积分（club_gold 与 club_gold2 取存在的那个）。
func (s *Server) readRobotClubGold(ctx context.Context, playerID, clubID string) (int64, bool) {
	var gold1, gold2 string
	err := s.db.QueryRowContext(ctx, `SELECT COALESCE(sm_club_gold, ''), COALESCE(sm_club_gold2, '')
FROM kbedm.tbl_Account WHERE sm_guuid = ? LIMIT 1`, playerID).Scan(&gold1, &gold2)
	if err != nil {
		return 0, false
	}
	if amount, ok := parseUserDataClubGold(gold1)[clubID]; ok {
		return int64(amount), true
	}
	if amount, ok := parseUserDataClubGold(gold2)[clubID]; ok {
		return int64(amount), true
	}
	return 0, false
}

func asStringSlice(value any) []string {
	list, ok := value.([]any)
	if !ok {
		return nil
	}
	result := make([]string, 0, len(list))
	for _, item := range list {
		text := strings.TrimSpace(fmt.Sprint(item))
		if text != "" {
			result = append(result, text)
		}
	}
	return result
}

// normalizeRobotStrategyOverride 校验机器人级的策略覆盖：允许策略里**所有**参数，
// 但只保留已知键、丢掉未知键，避免脏数据进下发链路。
func normalizeRobotStrategyOverride(raw json.RawMessage) (string, string) {
	if len(raw) == 0 || string(raw) == "null" {
		return "", ""
	}
	var input map[string]any
	if err := json.Unmarshal(raw, &input); err != nil {
		return "", "自定义参数必须是 JSON 对象"
	}
	numberKeys := map[string]bool{
		"buyinMultiple": true, "stayBuyinTimes": true, "roomAvoidMs": true,
		"sitTimeoutMs": true, "reinstateDelayMs": true, "roomRetryMs": true,
		"actionDelayMinMs": true, "actionDelayMaxMs": true, "decideTimeoutMs": true,
		"bigPairFen": true, "weakLowFen": true, "protectPairFen": true, "protectBothFen": true,
		"winStreakPause": true, "deadbandRatio": true, "addMoreChance": true,
	}
	boolKeys := map[string]bool{"allowWaitingRoom": true}
	clean := map[string]any{}
	for key, value := range input {
		switch {
		case key == "tiers":
			tiers, ok := value.(map[string]any)
			if !ok {
				return "", "安全线（tiers）格式不正确"
			}
			normalized := map[string]any{}
			for tierKey, tierValue := range tiers {
				fields, ok := tierValue.(map[string]any)
				if !ok {
					return "", "安全线（tiers）格式不正确"
				}
				row := map[string]any{}
				for _, field := range []string{"minG", "safeGen", "noAddGenMin"} {
					number, ok := fields[field].(float64)
					if !ok || number < 0 || number > 1000000 {
						return "", "安全线数值不合法"
					}
					row[field] = number
				}
				normalized[tierKey] = row
			}
			clean["tiers"] = normalized
		case boolKeys[key]:
			flag, ok := value.(bool)
			if !ok {
				return "", "参数 " + key + " 必须是布尔值"
			}
			clean[key] = flag
		case numberKeys[key]:
			number, ok := value.(float64)
			if !ok || number < 0 || number > 1000000 {
				return "", "参数 " + key + " 超出允许范围"
			}
			// 保留小数（目标死区、加注概率都是 0–1 的比例）。
			clean[key] = number
		}
	}
	if len(clean) == 0 {
		return "", ""
	}
	encoded, err := json.Marshal(clean)
	if err != nil {
		return "", "自定义参数格式不正确"
	}
	return string(encoded), ""
}
