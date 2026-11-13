package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// 业绩核心共享：把三类代理奖励（业绩 / 核心 / 奖池共享）的每日分配与发放集中到一个页面。
//
// 数据边界：
//   - 名单、排除、子账号、计划、明细、发放流水全部在自有 mgr_ 库，游戏库只读；
//   - 三类奖励的分配比例统一取「俱乐部业绩」报表的净次数（业绩股口径），按本次名单归一；
//   - 线数据只在「线数据」弹窗按需查询，不再参与分摊；
//   - 发放走俱乐部奖励三阶段：平台注入联盟池 → 大盟主下划盟主额度 → 盟主发成员俱乐部积分。

const (
	rewardKindPerformance = "performance"
	rewardKindCore        = "core"
	rewardKindPool        = "pool"

	rewardPlanDraft  = "draft"
	rewardPlanPaying = "paying"
	// 发放三个阶段：平台→联盟池（大盟主）、大盟主→盟主俱乐部、盟主→成员积分。
	rewardStageUnion   = "union"
	rewardStageLeader  = "leader"
	rewardStagePlayer  = "player"
	rewardPlanPaid     = "paid"
	rewardPlanPartial  = "partial"
	rewardPayoutPaid   = "paid"
	rewardPayoutFailed = "failed"
	rewardPayoutMiss   = "mismatch"
	rewardPayoutPend   = "pending"
	// 玩家在房间内，奖励已登记到内存待补，结算后自动入账。
	rewardPayoutWaiting = "waiting"
)

// 同一时刻只允许一个批次发放，避免两条请求互相覆盖余额与工单。
var rewardPayoutMu sync.Mutex

type rewardPerf struct {
	My      float64 `json:"my"`
	Granted float64 `json:"granted"`
	Net     float64 `json:"net"`
}

type rewardLine struct {
	TodayScore     int64   `json:"todayScore"`
	TotalScore     int64   `json:"totalScore"`
	TodayContrib   float64 `json:"todayContrib"`
	TotalContrib   float64 `json:"totalContrib"`
	TeamCount      int64   `json:"teamCount"`
	YesterdayScore int64   `json:"yesterdayScore"`
}

type rewardSplit struct {
	Payee     string `json:"payee"`
	PayeeName string `json:"payeeName"`
	Type      string `json:"type"` // main / sub
	Amount    int64  `json:"amount"`
}

type rewardChainNode struct {
	AgentID string `json:"agentId"`
	Name    string `json:"name"`
	Role    string `json:"role"`
}

type rewardMember struct {
	AgentID    string      `json:"agentId"`
	Name       string      `json:"name"`
	Role       string      `json:"role"`
	Level      int64       `json:"level"`
	UpperID    string      `json:"upperId"`
	ClubID     string      `json:"clubId"`
	ClubName   string      `json:"clubName"`
	UnionID    string      `json:"unionId"`
	UnionName  string      `json:"unionName"`
	Authorized bool        `json:"authorized"`
	Selected   bool        `json:"selected"`
	Source     string      `json:"source"`
	Perf       *rewardPerf `json:"perf"`
	Line       *rewardLine `json:"line"`
	// Chain 是从最高层上级到本人（含本人）的代理链，最多 16 级，用于名单里直接展示。
	Chain []rewardChainNode `json:"chain"`
	// SharePercent 是业绩股净次数在本次名单内的占比，保留两位小数，
	// 名单内有正业绩时所有行合计固定为 100.00。
	SharePercent float64       `json:"sharePercent"`
	Amount       int64         `json:"amount"`
	Splits       []rewardSplit `json:"splits"`
	Subs         []rewardSub   `json:"subs"`
	PaidAmount   int64         `json:"paidAmount"`
}

type rewardSub struct {
	SubID   string `json:"subId"`
	SubName string `json:"subName"`
	Note    string `json:"note"`
}

type rewardExcluded struct {
	AgentID  string `json:"agentId"`
	Name     string `json:"name"`
	Kind     string `json:"kind"`
	Reason   string `json:"reason"`
	Operator string `json:"operator"`
	At       string `json:"at"`
}

type rewardPlanView struct {
	Date         string `json:"date"`
	Kind         string `json:"kind"`
	PlannedTotal int64  `json:"plannedTotal"`
	Status       string `json:"status"`
	// 奖池共享专用：真实奖池数据 + 共享比例 + 自动算出的计划金额。
	// 奖池金额按「元（金币）」返回，游戏服务原始单位是分，已在这里换算。
	PoolAvailable bool    `json:"poolAvailable"`
	PoolTotal     float64 `json:"poolTotal"`
	PoolHalf      float64 `json:"poolHalf"`
	PoolPercent   float64 `json:"poolPercent"`
	PoolSuggested int64   `json:"poolSuggested"`
	// PoolSnapshot 表示上面的奖池总额取自该批次保存时的快照（历史日期），否则为当前实时奖池。
	PoolSnapshot bool `json:"poolSnapshot"`
}

type rewardTotals struct {
	Amount   int64   `json:"amount"`
	AllCount int64   `json:"allCount"`
	Count    int64   `json:"count"`
	Planned  int64   `json:"planned"`
	Diff     int64   `json:"diff"`
	Points   float64 `json:"points"`
	Excluded int64   `json:"excluded"`
	Pool     int64   `json:"pool"`
}

type rewardOverview struct {
	Plan     rewardPlanView   `json:"plan"`
	Members  []rewardMember   `json:"members"`
	Excluded []rewardExcluded `json:"excluded"`
	Totals   rewardTotals     `json:"totals"`
	Warnings []string         `json:"warnings"`
	// 上一次已发放批次里每个代理的实际金额，核心奖励手填时作参考。
	LastAmounts map[string]int64 `json:"lastAmounts"`
	LastDate    string           `json:"lastDate"`
}

func validRewardKind(kind string) bool {
	return kind == rewardKindPerformance || kind == rewardKindCore || kind == rewardKindPool
}

// normalizeRewardUnionID 业绩核心共享按联盟发放，联盟是唯一发放单位：
// 所有名单、方案、计划、发放接口都必须带合法联盟码，不能跨联盟操作。
func normalizeRewardUnionID(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", errors.New("请先选择联盟")
	}
	return normalizeUnionID(raw)
}

func rewardDate(raw string, now time.Time) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return now.In(dashboardLocation).Format("2006-01-02"), nil
	}
	date, err := time.ParseInLocation("2006-01-02", raw, dashboardLocation)
	if err != nil || date.Format("2006-01-02") != raw {
		return "", errors.New("日期格式不正确")
	}
	today := now.In(dashboardLocation)
	today = time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, dashboardLocation)
	if date.After(today) {
		return "", errors.New("不能选择未来日期")
	}
	return raw, nil
}

// rewardDayOffset 把发放批次日期换算成游戏服业绩接口的「相对今天天数」：
// 昨天 = -1、今天 = 0。业绩股按自然日结算，默认发放前一天。
func rewardDayOffset(date string, now time.Time) int {
	target, err := time.ParseInLocation("2006-01-02", date, dashboardLocation)
	if err != nil {
		return -1
	}
	today := now.In(dashboardLocation)
	today = time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, dashboardLocation)
	return int(target.Sub(today).Hours() / 24)
}

// syncRewardMembers 从游戏库只读同步代理名单。只动自有表，不写游戏库。
func (s *Server) syncRewardMembers(ctx context.Context) (int, error) {
	// 俱乐部模式：代理是俱乐部里的角色（大盟主 / 盟主 / 小盟主 / 合伙人 / 被授权的代理），
	// 名单取 club_agent_info 的在册记录，而不是平台账号表的老板-盟主层级。
	rows, err := s.gameDB.QueryContext(ctx, `SELECT ca.user_guuid,
COALESCE(NULLIF(ca.user_name,''), a.sm_name, ''),
ca.club_guuid,
COALESCE(c.club_name,''),
COALESCE(c.union_id,''),
COALESCE(u.union_name,''),
COALESCE(NULLIF(ca.upper_guuid,''),''),
COALESCE(a.sm_level,0),
COALESCE(a.sm_role,''),
(c.account_id = a.id),
COALESCE(ca.percent,0),
COALESCE(a.sm_client_prop,'') = 'True'
FROM kbedm.club_agent_info ca
JOIN kbedm.tbl_Account a ON a.sm_guuid = ca.user_guuid
LEFT JOIN kbedm.club_guuid_info c ON c.club_guuid = ca.club_guuid
LEFT JOIN kbedm.club_union_info u ON u.union_id = c.union_id AND u.status = 'used'
WHERE ca.status = 'used'
ORDER BY ca.id`)
	if err != nil {
		return 0, fmt.Errorf("读取俱乐部代理名单失败: %w", err)
	}
	type raw struct {
		id, name, club, clubName, unionID, unionName, upper string
		level                                               int64
		roleText                                            string
		isOwner                                             bool
		percent                                             int64
		authorized                                          bool
	}
	var list []raw
	seen := map[string]bool{}
	for rows.Next() {
		var item raw
		if err := rows.Scan(&item.id, &item.name, &item.club, &item.clubName, &item.unionID, &item.unionName,
			&item.upper, &item.level, &item.roleText, &item.isOwner, &item.percent, &item.authorized); err != nil {
			rows.Close()
			return 0, fmt.Errorf("解析俱乐部代理名单失败: %w", err)
		}
		if strings.TrimSpace(item.id) == "" || seen[item.id] {
			continue
		}
		seen[item.id] = true
		list = append(list, item)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	ids := make([]any, 0, len(list))
	for _, item := range list {
		role := classifyClubRewardRole(item.roleText, item.isOwner, item.percent, item.level)
		if _, err := tx.ExecContext(ctx, `INSERT INTO mgr_agent_reward_member
(agent_id, name, role, level, upper_id, club_id, club_name, union_id, union_name, authorized, source, status)
VALUES (?,?,?,?,?,?,?,?,?,?,'auto','active')
ON DUPLICATE KEY UPDATE
  name = IF(source='auto', VALUES(name), name),
  role = IF(source='auto', VALUES(role), role),
  level = IF(source='auto', VALUES(level), level),
  upper_id = IF(source='auto', VALUES(upper_id), upper_id),
  selected = IF(union_id = VALUES(union_id), selected, 0),
  club_id = VALUES(club_id),
  club_name = VALUES(club_name),
  union_id = VALUES(union_id),
  union_name = VALUES(union_name),
  authorized = VALUES(authorized),
  status = 'active'`,
			item.id, item.name, role, item.level, item.upper, item.club, item.clubName, item.unionID, item.unionName, item.authorized); err != nil {
			return 0, fmt.Errorf("写入代理名单失败: %w", err)
		}
		ids = append(ids, item.id)
	}

	// 已退出俱乐部的自动同步行标为 inactive，手工添加的行不动。
	if len(ids) > 0 {
		placeholders := strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")
		if _, err := tx.ExecContext(ctx,
			`UPDATE mgr_agent_reward_member SET status='inactive'
			 WHERE source='auto' AND status='active' AND agent_id NOT IN (`+placeholders+`)`, ids...); err != nil {
			return 0, fmt.Errorf("更新失效代理失败: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return len(list), nil
}

// classifyClubRewardRole 按俱乐部模式的身份判定角色：
//   - 大盟主：账号角色本身就是大盟主（联盟层）；
//   - 盟主：俱乐部创建者（群主）；
//   - 合伙人：有截留比例（percent > 0）的代理，或 98/99 级的高级别账号；
//   - 代理：被授权但没有分成比例的普通下线。
func classifyClubRewardRole(roleText string, isOwner bool, percent, level int64) string {
	switch {
	case strings.Contains(roleText, "大盟主"):
		return "grand"
	case isOwner:
		return "leader"
	case percent > 0 || level >= 98:
		return "partner"
	default:
		return "agent"
	}
}

// handlerRewardUnions 业绩核心共享的入口：以联盟为单位列出发放范围。
//
// 联盟来自游戏库 club_union_info，名单人数/入选人数来自后台自有的代理名单，
// 三类奖励的当日进度也按联盟各自统计，客服先选联盟再进入发放页。
func (s *Server) handlerRewardUnions(w http.ResponseWriter, r *http.Request, p principal) {
	date, err := rewardDate(r.URL.Query().Get("date"), time.Now())
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_DATE", err.Error())
		return
	}

	type unionRow struct {
		id   string
		name string
	}
	order := []string{}
	names := map[string]string{}
	rows, err := s.db.QueryContext(r.Context(), `SELECT union_id, COALESCE(NULLIF(union_name,''), union_id)
FROM kbedm.club_union_info WHERE status <> 'init' ORDER BY id DESC`)
	if err != nil {
		s.logger.Error("query reward unions", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取联盟列表失败")
		return
	}
	for rows.Next() {
		var item unionRow
		if err := rows.Scan(&item.id, &item.name); err != nil {
			rows.Close()
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "解析联盟列表失败")
			return
		}
		if _, exists := names[item.id]; exists {
			continue
		}
		names[item.id] = item.name
		order = append(order, item.id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取联盟列表失败")
		return
	}

	// 只在后台名单里出现、但游戏联盟表查不到的联盟也保留，避免历史名单失去入口。
	memberCount := map[string]int64{}
	selectedCount := map[string]int64{}
	rows, err = s.db.QueryContext(r.Context(), `SELECT union_id, MAX(union_name), COUNT(*),
COALESCE(SUM(selected=1),0)
FROM mgr_agent_reward_member
WHERE status='active' AND union_id <> ''
GROUP BY union_id`)
	if err != nil {
		s.logger.Error("count reward union members", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取联盟代理人数失败")
		return
	}
	for rows.Next() {
		var id, name string
		var total, selected int64
		if err := rows.Scan(&id, &name, &total, &selected); err != nil {
			rows.Close()
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "解析联盟代理人数失败")
			return
		}
		if _, exists := names[id]; !exists {
			if strings.TrimSpace(name) == "" {
				name = id
			}
			names[id] = name
			order = append(order, id)
		}
		memberCount[id] = total
		selectedCount[id] = selected
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取联盟代理人数失败")
		return
	}

	type planRow struct {
		planned   int64
		allocated int64
		count     int64
		status    string
	}
	plans := map[string]map[string]planRow{}
	rows, err = s.db.QueryContext(r.Context(), `SELECT p.union_id, p.kind, p.planned_total, p.status,
COALESCE(SUM(i.final_amount),0),
COALESCE(SUM(CASE WHEN i.final_amount > 0 THEN 1 ELSE 0 END),0)
FROM mgr_agent_reward_plan p
LEFT JOIN mgr_agent_reward_item i ON i.plan_id = p.id
WHERE p.reward_date = ? AND p.union_id <> ''
GROUP BY p.id, p.union_id, p.kind, p.planned_total, p.status`, date)
	if err != nil {
		s.logger.Error("query reward union plans", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取联盟奖励进度失败")
		return
	}
	for rows.Next() {
		var unionID, kind, status string
		var planned, allocated, count int64
		if err := rows.Scan(&unionID, &kind, &planned, &status, &allocated, &count); err != nil {
			rows.Close()
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "解析联盟奖励进度失败")
			return
		}
		if plans[unionID] == nil {
			plans[unionID] = map[string]planRow{}
		}
		plans[unionID][kind] = planRow{planned: planned, allocated: allocated, count: count, status: status}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取联盟奖励进度失败")
		return
	}

	items := make([]map[string]any, 0, len(order))
	for _, id := range order {
		kinds := make([]map[string]any, 0, 3)
		for _, kind := range []string{rewardKindPerformance, rewardKindCore, rewardKindPool} {
			row := plans[id][kind]
			status := row.status
			if status == "" {
				status = rewardPlanDraft
			}
			kinds = append(kinds, map[string]any{
				"kind": kind, "plannedTotal": row.planned, "allocated": row.allocated,
				"count": row.count, "status": status,
			})
		}
		items = append(items, map[string]any{
			"unionId": id, "name": names[id], "agentCount": memberCount[id],
			"selectedCount": selectedCount[id], "plans": kinds,
		})
	}

	var unassigned int64
	_ = s.db.QueryRowContext(r.Context(),
		`SELECT COUNT(*) FROM mgr_agent_reward_member WHERE status='active' AND union_id=''`).Scan(&unassigned)
	writeData(w, http.StatusOK, map[string]any{
		"date": date, "items": items, "unassigned": unassigned,
	})
}

// handlerRewardCandidates 候选池：指定联盟内的全部俱乐部代理，带 selected 标记，供「批量添加」勾选。
func (s *Server) handlerRewardCandidates(w http.ResponseWriter, r *http.Request, p principal) {
	unionID, err := normalizeRewardUnionID(r.URL.Query().Get("unionId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_UNION_ID", err.Error())
		return
	}
	clubID := strings.TrimSpace(r.URL.Query().Get("clubId"))
	keyword := strings.TrimSpace(r.URL.Query().Get("keyword"))

	rows, err := s.db.QueryContext(r.Context(), `SELECT agent_id, name, role, level, club_id, club_name,
union_id, union_name, authorized, selected
FROM mgr_agent_reward_member
WHERE status='active' AND union_id = ?
  AND (? = '' OR club_id = ?)
ORDER BY FIELD(role,'grand','leader','small_leader','partner','agent'), club_name, level DESC, id ASC`,
		unionID, clubID, clubID)
	if err != nil {
		s.logger.Error("query reward candidates", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取候选代理失败")
		return
	}
	defer rows.Close()
	items := []rewardMember{}
	for rows.Next() {
		var m rewardMember
		if err := rows.Scan(&m.AgentID, &m.Name, &m.Role, &m.Level, &m.ClubID, &m.ClubName,
			&m.UnionID, &m.UnionName, &m.Authorized, &m.Selected); err != nil {
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "解析候选代理失败")
			return
		}
		if keyword != "" && !strings.Contains(m.AgentID, keyword) && !strings.Contains(m.Name, keyword) {
			continue
		}
		items = append(items, m)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取候选代理失败")
		return
	}
	var selectedCount, total int
	if err := s.db.QueryRowContext(r.Context(),
		`SELECT COUNT(*) FROM mgr_agent_reward_member WHERE status='active' AND union_id=? AND selected=1`,
		unionID).Scan(&selectedCount); err != nil {
		s.logger.Warn("count selected reward members", "error", err)
	}
	if err := s.db.QueryRowContext(r.Context(),
		`SELECT COUNT(*) FROM mgr_agent_reward_member WHERE status='active' AND union_id=?`,
		unionID).Scan(&total); err != nil {
		s.logger.Warn("count reward candidates", "error", err)
	}
	writeData(w, http.StatusOK, map[string]any{
		"items": items, "selected": selectedCount, "total": total, "unionId": unionID,
	})
}

// handlerRewardSelect 批量把指定联盟的候选代理加入或移出本次分配名单。
func (s *Server) handlerRewardSelect(w http.ResponseWriter, r *http.Request, p principal) {
	var input struct {
		UnionID  string   `json:"unionId"`
		AgentIDs []string `json:"agentIds"`
		Selected bool     `json:"selected"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	unionID, err := normalizeRewardUnionID(input.UnionID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_UNION_ID", err.Error())
		return
	}
	if len(input.AgentIDs) == 0 {
		writeError(w, http.StatusBadRequest, "EMPTY_SELECTION", "没有选中任何代理")
		return
	}
	if len(input.AgentIDs) > 500 {
		writeError(w, http.StatusBadRequest, "TOO_MANY", "一次最多操作 500 个代理")
		return
	}
	ids := make([]any, 0, len(input.AgentIDs))
	for _, id := range input.AgentIDs {
		id = strings.TrimSpace(id)
		if !validAgentID(id) {
			writeError(w, http.StatusBadRequest, "INVALID_AGENT_ID", "代理 ID 不正确："+id)
			return
		}
		ids = append(ids, id)
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")

	// 只允许操作当前联盟的代理：跨联盟 ID 直接拒绝，避免把人加进别的联盟的单子。
	checkArgs := append([]any{unionID}, ids...)
	valid := map[string]bool{}
	rows, err := s.db.QueryContext(r.Context(), `SELECT agent_id FROM mgr_agent_reward_member
WHERE status='active' AND union_id = ? AND agent_id IN (`+placeholders+`)`, checkArgs...)
	if err != nil {
		s.logger.Error("check reward selection union", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "校验代理所属联盟失败")
		return
	}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err == nil {
			valid[id] = true
		}
	}
	rows.Close()
	var outside []string
	for _, id := range input.AgentIDs {
		if !valid[strings.TrimSpace(id)] {
			outside = append(outside, strings.TrimSpace(id))
		}
	}
	if len(outside) > 0 {
		writeError(w, http.StatusBadRequest, "CROSS_UNION",
			"以下代理不属于当前联盟，不能加入："+strings.Join(outside, "、"))
		return
	}

	value := 0
	if input.Selected {
		value = 1
	}
	result, err := s.db.ExecContext(r.Context(),
		`UPDATE mgr_agent_reward_member SET selected = ? WHERE status='active' AND union_id = ? AND agent_id IN (`+placeholders+`)`,
		append([]any{value, unionID}, ids...)...)
	if err != nil {
		s.logger.Error("update reward selection", "error", err)
		writeError(w, http.StatusInternalServerError, "UPDATE_FAILED", "更新名单失败")
		return
	}
	affected, _ := result.RowsAffected()
	action := "移出名单"
	if input.Selected {
		action = "加入名单"
	}
	s.audit(r.Context(), &p, "game.agent_reward.edit", "agent_reward_member", strings.Join(input.AgentIDs, ","),
		map[string]any{"action": action, "count": len(input.AgentIDs), "unionId": unionID}, nil,
		map[string]any{"affected": affected}, 0, action, clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"affected": affected, "selected": input.Selected, "unionId": unionID})
}

// handlerRewardLists 列出指定联盟已保存的名单方案。
func (s *Server) handlerRewardLists(w http.ResponseWriter, r *http.Request, p principal) {
	unionID, err := normalizeRewardUnionID(r.URL.Query().Get("unionId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_UNION_ID", err.Error())
		return
	}
	rows, err := s.db.QueryContext(r.Context(), `SELECT id, name, note, member_count, created_by,
DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i')
FROM mgr_agent_reward_list WHERE union_id = ? ORDER BY updated_at DESC, id DESC`, unionID)
	if err != nil {
		s.logger.Error("query reward lists", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取名单方案失败")
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id int64
		var name, note, createdBy, updated string
		var count int
		if err := rows.Scan(&id, &name, &note, &count, &createdBy, &updated); err != nil {
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "解析名单方案失败")
			return
		}
		items = append(items, map[string]any{
			"id": id, "name": name, "note": note, "memberCount": count,
			"createdBy": createdBy, "updatedAt": updated,
		})
	}
	// 当前入选人数，前端用来提示"保存几人"。
	var selected int
	_ = s.db.QueryRowContext(r.Context(),
		`SELECT COUNT(*) FROM mgr_agent_reward_member WHERE status='active' AND union_id=? AND selected=1`,
		unionID).Scan(&selected)
	writeData(w, http.StatusOK, map[string]any{"items": items, "selected": selected, "unionId": unionID})
}

// handlerRewardListSave 把当前联盟的参与名单保存成命名方案；同联盟同名覆盖。
func (s *Server) handlerRewardListSave(w http.ResponseWriter, r *http.Request, p principal) {
	var input struct {
		UnionID string `json:"unionId"`
		Name    string `json:"name"`
		Note    string `json:"note"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	unionID, err := normalizeRewardUnionID(input.UnionID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_UNION_ID", err.Error())
		return
	}
	name := strings.TrimSpace(input.Name)
	note := strings.TrimSpace(input.Note)
	if n := len([]rune(name)); n < 1 || n > 64 {
		writeError(w, http.StatusBadRequest, "INVALID_NAME", "名单名称需要 1 到 64 个字")
		return
	}
	if len([]rune(note)) > 200 {
		writeError(w, http.StatusBadRequest, "INVALID_NOTE", "备注不能超过 200 个字")
		return
	}

	rows, err := s.db.QueryContext(r.Context(),
		`SELECT agent_id FROM mgr_agent_reward_member WHERE status='active' AND union_id=? AND selected=1 ORDER BY id`,
		unionID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取当前名单失败")
		return
	}
	var agentIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err == nil {
			agentIDs = append(agentIDs, id)
		}
	}
	rows.Close()
	if len(agentIDs) == 0 {
		writeError(w, http.StatusBadRequest, "EMPTY_LIST", "当前联盟的名单是空的，先加入代理再保存")
		return
	}

	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_FAILED", "保存名单失败")
		return
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(r.Context(), `INSERT INTO mgr_agent_reward_list (union_id, name, note, member_count, created_by)
VALUES (?,?,?,?,?)
ON DUPLICATE KEY UPDATE note = VALUES(note), member_count = VALUES(member_count), created_by = VALUES(created_by)`,
		unionID, name, note, len(agentIDs), p.Username); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_FAILED", "保存名单失败")
		return
	}
	var listID int64
	if err := tx.QueryRowContext(r.Context(), `SELECT id FROM mgr_agent_reward_list WHERE union_id = ? AND name = ?`,
		unionID, name).Scan(&listID); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_FAILED", "保存名单失败")
		return
	}
	if _, err := tx.ExecContext(r.Context(), `DELETE FROM mgr_agent_reward_list_member WHERE list_id = ?`, listID); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_FAILED", "保存名单失败")
		return
	}
	for _, id := range agentIDs {
		if _, err := tx.ExecContext(r.Context(),
			`INSERT IGNORE INTO mgr_agent_reward_list_member (list_id, agent_id) VALUES (?,?)`, listID, id); err != nil {
			writeError(w, http.StatusInternalServerError, "UPDATE_FAILED", "保存名单失败")
			return
		}
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_FAILED", "保存名单失败")
		return
	}
	s.audit(r.Context(), &p, "game.agent_reward.edit", "agent_reward_list", strconv.FormatInt(listID, 10),
		map[string]any{"name": name, "count": len(agentIDs), "unionId": unionID}, nil, nil, 0, "保存名单方案", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"id": listID, "name": name, "memberCount": len(agentIDs), "unionId": unionID})
}

// handlerRewardListApply 用某个已保存名单替换当前联盟的参与名单。
func (s *Server) handlerRewardListApply(w http.ResponseWriter, r *http.Request, p principal) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	var input struct {
		UnionID string `json:"unionId"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	unionID, err := normalizeRewardUnionID(input.UnionID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_UNION_ID", err.Error())
		return
	}
	var name, listUnion string
	if err := s.db.QueryRowContext(r.Context(), `SELECT name, union_id FROM mgr_agent_reward_list WHERE id = ?`, id).
		Scan(&name, &listUnion); err != nil {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "名单不存在")
		return
	}
	if listUnion != unionID {
		writeError(w, http.StatusBadRequest, "CROSS_UNION", "该名单方案不属于当前联盟")
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_FAILED", "加载名单失败")
		return
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(r.Context(),
		`UPDATE mgr_agent_reward_member SET selected = 0 WHERE status='active' AND union_id=? AND selected = 1`,
		unionID); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_FAILED", "加载名单失败")
		return
	}
	result, err := tx.ExecContext(r.Context(), `UPDATE mgr_agent_reward_member m
JOIN mgr_agent_reward_list_member lm ON lm.agent_id = m.agent_id AND lm.list_id = ?
SET m.selected = 1
WHERE m.status = 'active' AND m.union_id = ?`, id, unionID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_FAILED", "加载名单失败")
		return
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_FAILED", "加载名单失败")
		return
	}
	affected, _ := result.RowsAffected()
	s.audit(r.Context(), &p, "game.agent_reward.edit", "agent_reward_list", strconv.FormatInt(id, 10),
		map[string]any{"action": "apply", "name": name, "unionId": unionID}, nil, map[string]any{"affected": affected},
		0, "加载名单方案", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"id": id, "name": name, "selected": affected, "unionId": unionID})
}

// handlerRewardListDelete 删除名单方案（只删模板，不动当前名单）。
func (s *Server) handlerRewardListDelete(w http.ResponseWriter, r *http.Request, p principal) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	unionID, err := normalizeRewardUnionID(r.URL.Query().Get("unionId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_UNION_ID", err.Error())
		return
	}
	var listUnion string
	if err := s.db.QueryRowContext(r.Context(), `SELECT union_id FROM mgr_agent_reward_list WHERE id = ?`, id).
		Scan(&listUnion); err != nil {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "名单不存在")
		return
	}
	if listUnion != unionID {
		writeError(w, http.StatusBadRequest, "CROSS_UNION", "该名单方案不属于当前联盟")
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_FAILED", "删除失败")
		return
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(r.Context(), `DELETE FROM mgr_agent_reward_list_member WHERE list_id = ?`, id); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_FAILED", "删除失败")
		return
	}
	if _, err := tx.ExecContext(r.Context(), `DELETE FROM mgr_agent_reward_list WHERE id = ?`, id); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_FAILED", "删除失败")
		return
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_FAILED", "删除失败")
		return
	}
	s.audit(r.Context(), &p, "game.agent_reward.edit", "agent_reward_list", strconv.FormatInt(id, 10),
		map[string]any{"action": "delete", "unionId": unionID}, nil, nil, 0, "删除名单方案", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"id": id, "unionId": unionID})
}

func (s *Server) handlerRewardSync(w http.ResponseWriter, r *http.Request, p principal) {
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	count, err := s.syncRewardMembers(ctx)
	if err != nil {
		s.logger.Error("sync reward members", "error", err)
		writeError(w, http.StatusBadGateway, "SYNC_FAILED", "同步代理名单失败："+err.Error())
		return
	}
	s.audit(r.Context(), &p, "game.agent_reward.edit", "agent_reward_member", "sync", nil, nil,
		map[string]any{"count": count}, 0, "同步代理名单", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"count": count})
}

// ensureRewardPlan 取或创建当日该联盟该类奖励的计划行。
func (s *Server) ensureRewardPlan(ctx context.Context, date, kind, unionID, operator string) (int64, string, int64, error) {
	if _, err := s.db.ExecContext(ctx, `INSERT INTO mgr_agent_reward_plan (reward_date, kind, union_id, planned_total, status, created_by)
VALUES (?,?,?,0,'draft',?) ON DUPLICATE KEY UPDATE updated_at = updated_at`, date, kind, unionID, operator); err != nil {
		return 0, "", 0, err
	}
	var id, total int64
	var status string
	if err := s.db.QueryRowContext(ctx, `SELECT id, status, planned_total FROM mgr_agent_reward_plan
WHERE reward_date = ? AND kind = ? AND union_id = ?`, date, kind, unionID).Scan(&id, &status, &total); err != nil {
		return 0, "", 0, err
	}
	return id, status, total, nil
}

func (s *Server) handlerRewardOverview(w http.ResponseWriter, r *http.Request, p principal) {
	kind := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("kind")))
	if kind == "" {
		kind = rewardKindPerformance
	}
	if !validRewardKind(kind) {
		writeError(w, http.StatusBadRequest, "INVALID_KIND", "奖励类型不正确")
		return
	}
	date, err := rewardDate(r.URL.Query().Get("date"), time.Now())
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_DATE", err.Error())
		return
	}
	unionID, err := normalizeRewardUnionID(r.URL.Query().Get("unionId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_UNION_ID", err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()

	planID, planStatus, planned, err := s.ensureRewardPlan(ctx, date, kind, unionID, p.Username)
	if err != nil {
		s.logger.Error("ensure reward plan", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取发放计划失败")
		return
	}
	poolPercent := 0.0
	poolBase := int64(0)
	if err := s.db.QueryRowContext(ctx, `SELECT COALESCE(pool_percent,0), COALESCE(pool_base,0)
FROM mgr_agent_reward_plan WHERE id = ?`, planID).
		Scan(&poolPercent, &poolBase); err != nil {
		s.logger.Warn("load reward plan pool percent", "error", err)
		poolPercent = 0
		poolBase = 0
	}

	members, err := s.loadRewardMembers(ctx, unionID)
	if err != nil {
		s.logger.Error("load reward members", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取代理名单失败")
		return
	}
	// 代理链用联盟内全部在册代理回溯，避免只选了部分人时上级缺失。
	chainByID := map[string]rewardMember{}
	if allMembers, loadErr := s.loadRewardMembersAll(ctx, unionID); loadErr != nil {
		s.logger.Warn("load reward members for chain", "error", loadErr)
	} else {
		for _, member := range allMembers {
			chainByID[member.AgentID] = member
		}
	}
	excluded, err := s.loadRewardExcludes(ctx, unionID)
	if err != nil {
		s.logger.Error("load reward excludes", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取排除名单失败")
		return
	}
	items, err := s.loadRewardItems(ctx, planID)
	if err != nil {
		s.logger.Error("load reward items", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取分配明细失败")
		return
	}
	subs, err := s.loadRewardSubs(ctx)
	if err != nil {
		s.logger.Error("load reward subs", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取子账号失败")
		return
	}
	paidMap, err := s.loadRewardPaid(ctx, planID)
	if err != nil {
		s.logger.Error("load reward payouts", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取发放记录失败")
		return
	}

	overview := rewardOverview{
		Plan:        rewardPlanView{Date: date, Kind: kind, PlannedTotal: planned, Status: planStatus},
		Members:     []rewardMember{},
		Excluded:    []rewardExcluded{},
		Warnings:    []string{},
		LastAmounts: map[string]int64{},
	}

	skip := map[string]bool{}
	for _, ex := range excluded {
		if ex.Kind == kind || ex.Kind == "all" {
			skip[ex.AgentID] = true
			overview.Excluded = append(overview.Excluded, ex)
		}
	}

	// 三类奖励统一按「业绩股」净次数分摊：报表只含已开通业绩的代理（含创建者），
	// my = 整条线毛次数、granted = 直接下级次数、left = 扣减后的净次数。
	perfMap, allCount, perfErr := s.rewardClubPerformance(ctx, unionID, date)
	if perfErr != nil {
		s.logger.Warn("load club performance report", "error", perfErr)
		overview.Warnings = append(overview.Warnings,
			"读取业绩股报表失败："+perfErr.Error()+"；本次无法按业绩比例分摊")
		perfMap = map[string]*rewardPerf{}
	}
	if rewardDayOffset(date, time.Now()) == 0 {
		overview.Warnings = append(overview.Warnings,
			"统计日是今天，业绩股当天数据还没结算完，建议发放昨天的批次")
	}
	overview.Totals.AllCount = allCount

	missing := 0
	for _, m := range members {
		if skip[m.AgentID] {
			continue
		}
		if _, ok := perfMap[m.AgentID]; !ok {
			missing++
		}
	}
	if missing > 0 {
		overview.Warnings = append(overview.Warnings,
			fmt.Sprintf("%d 个代理没有业绩股数据（未加入业绩股或当天没有业绩），不参与分摊", missing))
	}

	for _, m := range members {
		if skip[m.AgentID] {
			continue
		}
		m.Perf = perfMap[m.AgentID]
		if item, ok := items[m.AgentID]; ok {
			m.Amount = item.amount
			m.Splits = item.splits
			m.PaidAmount = paidMap[m.AgentID]
		}
		if m.Splits == nil {
			m.Splits = []rewardSplit{}
		}
		m.Subs = subs[m.AgentID]
		if m.Subs == nil {
			m.Subs = []rewardSub{}
		}
		m.Chain = buildRewardChain(m.AgentID, chainByID)
		overview.Members = append(overview.Members, m)
	}

	sort.SliceStable(overview.Members, func(i, j int) bool {
		if overview.Members[i].Role != overview.Members[j].Role {
			return rewardRoleOrder(overview.Members[i].Role) < rewardRoleOrder(overview.Members[j].Role)
		}
		if overview.Members[i].Level != overview.Members[j].Level {
			return overview.Members[i].Level > overview.Members[j].Level
		}
		return overview.Members[i].AgentID < overview.Members[j].AgentID
	})

	var sum int64
	var points float64
	for _, m := range overview.Members {
		sum += m.Amount
		if m.Perf != nil {
			points += m.Perf.Net
		}
		if m.Amount > 0 {
			overview.Totals.Count++
		}
	}
	overview.Totals.Amount = sum
	overview.Totals.Planned = planned
	overview.Totals.Diff = planned - sum
	overview.Totals.Points = round2(points)
	overview.Totals.Excluded = int64(len(skip))

	// 业绩股占比：只用本次名单内的净次数做归一，合计固定 100.00%，
	// 与「业绩奖励」自动分摊的权重同一口径，发钱时看到的占比就是到手比例。
	shareWeights := make(map[string]float64, len(overview.Members))
	for _, m := range overview.Members {
		if m.Perf != nil && m.Perf.Net > 0 {
			shareWeights[m.AgentID] = m.Perf.Net
		}
	}
	sharePercents := rewardSharePercents(shareWeights)
	for i := range overview.Members {
		overview.Members[i].SharePercent = sharePercents[overview.Members[i].AgentID]
	}
	var poolTotal int64
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM mgr_agent_reward_member WHERE status='active' AND union_id = ?`, unionID).
		Scan(&poolTotal); err == nil {
		overview.Totals.Pool = poolTotal
	}

	if planned == 0 {
		overview.Warnings = append(overview.Warnings, "尚未设置计划发放总额，先填写总额再分配")
	}
	if len(overview.Members) == 0 {
		overview.Warnings = append(overview.Warnings,
			"当前联盟本次分配名单为空：点「添加代理」把该联盟要发奖励的代理加进名单。")
	}
	if len(shareWeights) == 0 {
		overview.Warnings = append(overview.Warnings,
			"本次名单在 "+date+" 都没有业绩股净次数，三类奖励都无法按业绩比例分摊")
	}

	// 奖池共享：历史日期优先用该批次保存时的奖池快照，没有快照才退回当前实时奖池。
	if kind == rewardKindPool {
		offset := rewardDayOffset(date, time.Now())
		useSnapshot := offset < 0 && poolBase > 0
		poolFen := poolBase
		if !useSnapshot {
			live, poolErr := s.rewardPoolTotal(ctx)
			if poolErr != nil {
				s.logger.Warn("read reward pool total", "error", poolErr)
				overview.Warnings = append(overview.Warnings,
					"读取今日奖池失败："+poolErr.Error()+"，可手动填写本次发放总额")
			} else {
				poolFen = live
				if offset < 0 {
					overview.Warnings = append(overview.Warnings,
						"该日期没有奖池快照，建议金额按当前实时奖池计算，发放前请人工核对")
				}
			}
		}
		if poolFen > 0 {
			percent := poolPercent
			if percent <= 0 {
				percent = 60
			}
			// 游戏奖池按「分」存储，页面与发放都按「金币/元」口径，这里统一换算。
			yuan := float64(poolFen) / 100
			overview.Plan.PoolAvailable = true
			overview.Plan.PoolSnapshot = useSnapshot
			overview.Plan.PoolTotal = round2(yuan)
			overview.Plan.PoolHalf = round2(yuan / 2)
			overview.Plan.PoolPercent = percent
			overview.Plan.PoolSuggested = rewardPoolSuggested(yuan, percent)
		}
		if poolPercent <= 0 {
			overview.Plan.PoolPercent = 60
		}
	} else {
		overview.Plan.PoolPercent = poolPercent
	}

	// 核心奖励按人工判断填写，把上一次已发放金额带出来做参考。
	if kind == rewardKindCore {
		if last, lastDate, err := s.lastRewardAmountsWithDate(ctx, kind, unionID); err == nil {
			overview.LastAmounts = last
			overview.LastDate = lastDate
		} else {
			s.logger.Warn("load last reward amounts", "error", err)
		}
	}

	writeData(w, http.StatusOK, overview)
}

// handlerRewardSummary 三类奖励当天的汇总（计划/已分配/人数/状态），
// 供页面顶部三栏并排显示，不用来回切换 tab 才知道哪一栏还没配平。
func (s *Server) handlerRewardSummary(w http.ResponseWriter, r *http.Request, p principal) {
	date, err := rewardDate(r.URL.Query().Get("date"), time.Now())
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_DATE", err.Error())
		return
	}
	unionID, err := normalizeRewardUnionID(r.URL.Query().Get("unionId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_UNION_ID", err.Error())
		return
	}
	rows, err := s.db.QueryContext(r.Context(), `SELECT p.kind, p.planned_total, p.status,
COALESCE(SUM(i.final_amount),0),
COALESCE(SUM(CASE WHEN i.final_amount > 0 THEN 1 ELSE 0 END),0)
FROM mgr_agent_reward_plan p
LEFT JOIN mgr_agent_reward_item i ON i.plan_id = p.id
WHERE p.reward_date = ? AND p.union_id = ?
GROUP BY p.id, p.kind, p.planned_total, p.status`, date, unionID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取奖励汇总失败")
		return
	}
	defer rows.Close()
	found := map[string]bool{}
	items := []map[string]any{}
	for rows.Next() {
		var kind, status string
		var planned, allocated, count int64
		if err := rows.Scan(&kind, &planned, &status, &allocated, &count); err != nil {
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "解析奖励汇总失败")
			return
		}
		found[kind] = true
		items = append(items, map[string]any{
			"kind": kind, "plannedTotal": planned, "allocated": allocated,
			"count": count, "status": status,
		})
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取奖励汇总失败")
		return
	}
	for _, kind := range []string{rewardKindPerformance, rewardKindCore, rewardKindPool} {
		if found[kind] {
			continue
		}
		items = append(items, map[string]any{
			"kind": kind, "plannedTotal": 0, "allocated": 0, "count": 0, "status": "draft",
		})
	}
	var selected int64
	_ = s.db.QueryRowContext(r.Context(),
		`SELECT COUNT(*) FROM mgr_agent_reward_member WHERE status='active' AND union_id=? AND selected=1`,
		unionID).Scan(&selected)
	writeData(w, http.StatusOK, map[string]any{"date": date, "items": items, "selected": selected, "unionId": unionID})
}

func rewardRoleOrder(role string) int {
	switch role {
	case "grand":
		return 0
	case "leader":
		return 1
	case "small_leader":
		return 2
	case "partner":
		return 3
	default:
		return 4
	}
}

func (s *Server) loadRewardMembers(ctx context.Context, unionID string) ([]rewardMember, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT agent_id, name, role, level, upper_id, club_id, club_name, union_id, union_name, authorized, selected, source
FROM mgr_agent_reward_member WHERE status='active' AND union_id=? AND selected=1 ORDER BY level DESC, id ASC`, unionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []rewardMember{}
	for rows.Next() {
		var m rewardMember
		if err := rows.Scan(&m.AgentID, &m.Name, &m.Role, &m.Level, &m.UpperID, &m.ClubID, &m.ClubName,
			&m.UnionID, &m.UnionName, &m.Authorized, &m.Selected, &m.Source); err != nil {
			return nil, err
		}
		list = append(list, m)
	}
	return list, rows.Err()
}

// loadRewardMembersAll 取指定联盟的全部在册代理（不看是否入选），只用于还原代理层级、
// 计算净点数时的逐级扣减。入选与否则由 loadRewardMembers 决定。
func (s *Server) loadRewardMembersAll(ctx context.Context, unionID string) ([]rewardMember, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT agent_id, name, role, level, upper_id, club_id, club_name, union_id, union_name, authorized, selected, source
FROM mgr_agent_reward_member WHERE status='active' AND union_id=? ORDER BY level DESC, id ASC`, unionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []rewardMember{}
	for rows.Next() {
		var m rewardMember
		if err := rows.Scan(&m.AgentID, &m.Name, &m.Role, &m.Level, &m.UpperID, &m.ClubID, &m.ClubName,
			&m.UnionID, &m.UnionName, &m.Authorized, &m.Selected, &m.Source); err != nil {
			return nil, err
		}
		list = append(list, m)
	}
	return list, rows.Err()
}

// buildRewardChain 从代理本人沿 upper_id 回溯到最高层，再反转成「最高层 → 本人」。
// 只使用本次联盟名单里的在册代理；断开或循环时停止，避免把其它联盟/已失效账号拼进来。
func buildRewardChain(agentID string, byID map[string]rewardMember) []rewardChainNode {
	chain := []rewardChainNode{}
	seen := map[string]bool{}
	current := strings.TrimSpace(agentID)
	for current != "" && len(chain) < 16 && !seen[current] {
		member, ok := byID[current]
		if !ok {
			break
		}
		seen[current] = true
		chain = append(chain, rewardChainNode{AgentID: member.AgentID, Name: member.Name, Role: member.Role})
		current = strings.TrimSpace(member.UpperID)
	}
	for left, right := 0, len(chain)-1; left < right; left, right = left+1, right-1 {
		chain[left], chain[right] = chain[right], chain[left]
	}
	return chain
}

// rewardAgentInUnion 校验代理确实属于指定联盟，所有按代理写入的接口都先过这一层。
func (s *Server) rewardAgentInUnion(ctx context.Context, agentID, unionID string) (bool, error) {
	var count int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM mgr_agent_reward_member
WHERE status='active' AND agent_id = ? AND union_id = ?`, agentID, unionID).Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
}

func (s *Server) loadRewardExcludes(ctx context.Context, unionID string) ([]rewardExcluded, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT e.agent_id, COALESCE(m.name,''), e.kind, e.reason, e.operator,
DATE_FORMAT(e.created_at, '%Y-%m-%d %H:%i')
FROM mgr_agent_reward_exclude e
JOIN mgr_agent_reward_member m ON m.agent_id = e.agent_id
WHERE m.union_id = ?
ORDER BY e.id DESC`, unionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []rewardExcluded{}
	for rows.Next() {
		var item rewardExcluded
		if err := rows.Scan(&item.AgentID, &item.Name, &item.Kind, &item.Reason, &item.Operator, &item.At); err != nil {
			return nil, err
		}
		list = append(list, item)
	}
	return list, rows.Err()
}

type rewardItemRow struct {
	amount int64
	splits []rewardSplit
}

func (s *Server) loadRewardItems(ctx context.Context, planID int64) (map[string]rewardItemRow, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT agent_id, final_amount, COALESCE(split_json,'')
FROM mgr_agent_reward_item WHERE plan_id = ?`, planID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := map[string]rewardItemRow{}
	for rows.Next() {
		var id string
		var amount int64
		var raw string
		if err := rows.Scan(&id, &amount, &raw); err != nil {
			return nil, err
		}
		item := rewardItemRow{amount: amount}
		if strings.TrimSpace(raw) != "" {
			_ = json.Unmarshal([]byte(raw), &item.splits)
		}
		result[id] = item
	}
	return result, rows.Err()
}

func (s *Server) loadRewardSubs(ctx context.Context) (map[string][]rewardSub, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT agent_id, sub_guuid, sub_name, note FROM mgr_agent_reward_sub_account
WHERE status='active' ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := map[string][]rewardSub{}
	for rows.Next() {
		var agent string
		var sub rewardSub
		if err := rows.Scan(&agent, &sub.SubID, &sub.SubName, &sub.Note); err != nil {
			return nil, err
		}
		result[agent] = append(result[agent], sub)
	}
	return result, rows.Err()
}

func (s *Server) loadRewardPaid(ctx context.Context, planID int64) (map[string]int64, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT agent_id, COALESCE(SUM(amount),0) FROM mgr_agent_reward_payout
WHERE plan_id = ? AND stage = 'player' AND status IN ('paid','mismatch','pending','waiting') GROUP BY agent_id`, planID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := map[string]int64{}
	for rows.Next() {
		var id string
		var amount int64
		if err := rows.Scan(&id, &amount); err != nil {
			return nil, err
		}
		result[id] = amount
	}
	return result, rows.Err()
}

// rewardPlanStarted 判断该批次是否已经真实发起过发放。
// 一旦联盟池或任一盟主额度已划出，金额就必须锁定，否则重试时无法保证总额一致。
func (s *Server) rewardPlanStarted(ctx context.Context, planID int64) (bool, error) {
	var count int64
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM mgr_agent_reward_payout
WHERE plan_id = ? AND status IN ('paid','pending','waiting','mismatch')`, planID).Scan(&count)
	return count > 0, err
}

// rewardPerformance 调游戏服结算报表，取每个代理的毛/下发/净点数。
// 净点数已由服务端扣除已下发下级，后台不再做第二次扣减；报表单位是分，这里换成元。
func (s *Server) rewardPerformance(ctx context.Context, date string) (map[string]*rewardPerf, error) {
	result, err := s.callGameCommand(ctx, "异步_查询_奖池业绩_结算报表", map[string]any{
		"date": date, "context": gameOperationContext("agent-reward-perf"),
	})
	if err != nil {
		return nil, err
	}
	if result.RetCode != 512 {
		return nil, errors.New(describeGameFailure("异步_查询_奖池业绩_结算报表", result.RetCode, result.RetResult))
	}
	raw := result.RetResult
	var text string
	if json.Unmarshal(raw, &text) == nil {
		raw = json.RawMessage(text)
	}
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil, errors.New("报表格式不正确")
	}
	var report struct {
		List []struct {
			Guuid   string  `json:"guuid"`
			My      float64 `json:"my_performance"`
			Granted float64 `json:"granted_performance"`
			Proxy   float64 `json:"proxy_performance"`
		} `json:"list"`
	}
	if err := json.Unmarshal(envelope["JackpotSettlementReport"], &report); err != nil {
		return nil, errors.New("报表缺少结算明细")
	}
	out := map[string]*rewardPerf{}
	for _, row := range report.List {
		id := strings.TrimSpace(row.Guuid)
		if id == "" {
			continue
		}
		out[id] = &rewardPerf{
			My:      round2(row.My / 100),
			Granted: round2(row.Granted / 100),
			Net:     round2(row.Proxy / 100),
		}
	}
	return out, nil
}

// rewardClubPerformance 读取「俱乐部业绩」报表（业绩股口径）。
//
// 报表只包含已开通业绩的代理（含创建者），my = 整条线毛次数、granted = 直接下级次数、
// left = 扣减后的净次数；allCount 是整个池（联盟/独立俱乐部）当天的总次数。
// 同一个代理可能同时挂在多个俱乐部，这里按 guuid 汇总，发放权重直接用净次数。
func (s *Server) rewardClubPerformance(ctx context.Context, unionID, date string) (map[string]*rewardPerf, int64, error) {
	offset := rewardDayOffset(date, time.Now())
	result, err := s.callGameCommand(ctx, "异步_查询_俱乐部_业绩_报表", map[string]any{
		"union_id": unionID, "date": offset, "context": "p@" + gameOperationContext("agent-reward-club-perf"),
	})
	if err != nil {
		return nil, 0, err
	}
	if result.RetCode != 512 {
		return nil, 0, errors.New(describeGameFailure("异步_查询_俱乐部_业绩_报表", result.RetCode, result.RetResult))
	}
	raw := result.RetResult
	var text string
	if json.Unmarshal(raw, &text) == nil {
		raw = json.RawMessage(text)
	}
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil, 0, errors.New("业绩报表格式不正确")
	}
	// 新格式带 {"context","result"} 包裹；兼容直接返回 ClubPerfReport 的旧结构。
	if inner, ok := envelope["result"]; ok {
		var innerText string
		if json.Unmarshal(inner, &innerText) == nil {
			inner = json.RawMessage(innerText)
		}
		var nested map[string]json.RawMessage
		if json.Unmarshal(inner, &nested) == nil {
			envelope = nested
		}
	}
	var report struct {
		AllCount int64   `json:"all_count"`
		List     [][]any `json:"list"`
	}
	if err := json.Unmarshal(envelope["ClubPerfReport"], &report); err != nil {
		return nil, 0, errors.New("业绩报表缺少 ClubPerfReport")
	}
	out := map[string]*rewardPerf{}
	for _, row := range report.List {
		if len(row) < 8 {
			continue
		}
		id := anyString(row[0])
		if id == "" {
			continue
		}
		my := anyFloat(row[5])
		granted := anyFloat(row[6])
		net := anyFloat(row[7])
		if existing, ok := out[id]; ok {
			existing.My = round2(existing.My + my)
			existing.Granted = round2(existing.Granted + granted)
			existing.Net = round2(existing.Net + net)
			continue
		}
		out[id] = &rewardPerf{My: round2(my), Granted: round2(granted), Net: round2(net)}
	}
	return out, report.AllCount, nil
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}

// rewardLineData 批量取整条线输赢/贡献。只对挂了俱乐部的代理发起调用，避免无意义请求。
func (s *Server) rewardLineData(ctx context.Context, members []rewardMember, overview *rewardOverview) map[string]*rewardLine {
	result := map[string]*rewardLine{}
	targets := make([]rewardMember, 0, len(members))
	for _, m := range members {
		if strings.TrimSpace(m.ClubID) != "" {
			targets = append(targets, m)
		}
	}
	if len(targets) == 0 {
		overview.Warnings = append(overview.Warnings, "名单里的代理都没有归属俱乐部，整条线输赢/贡献取不到（俱乐部口径）")
		return result
	}

	type outcome struct {
		id   string
		line *rewardLine
	}
	ch := make(chan outcome, len(targets))
	sem := make(chan struct{}, 4)
	var wg sync.WaitGroup
	for _, m := range targets {
		wg.Add(1)
		go func(m rewardMember) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			line, err := s.queryRewardLine(ctx, m.ClubID, m.AgentID)
			if err != nil {
				ch <- outcome{id: m.AgentID}
				return
			}
			ch <- outcome{id: m.AgentID, line: line}
		}(m)
	}
	wg.Wait()
	close(ch)
	for item := range ch {
		if item.line != nil {
			result[item.id] = item.line
		}
	}
	return result
}

func (s *Server) queryRewardLine(ctx context.Context, clubID, agentID string) (*rewardLine, error) {
	callCtx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	result, err := s.callGameCommand(callCtx, "异步_查询_代理_展示数据", map[string]any{
		"club_id": clubID, "agent_id": agentID, "metric": "contrib",
		"context": gameOperationContext("agent-reward-line"),
	})
	if err != nil {
		return nil, err
	}
	if result.RetCode != 512 {
		return nil, errors.New(describeGameFailure("异步_查询_代理_展示数据", result.RetCode, result.RetResult))
	}
	raw := result.RetResult
	var text string
	if json.Unmarshal(raw, &text) == nil {
		raw = json.RawMessage(text)
	}
	var payload struct {
		TeamRaw map[string]any `json:"team_raw"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}
	team := payload.TeamRaw
	if team == nil {
		return nil, errors.New("缺少团队数据")
	}
	return &rewardLine{
		TodayScore:     anyInt(team["today_score"]),
		TotalScore:     anyInt(team["total_score"]),
		YesterdayScore: anyInt(team["yesterday_score"]),
		TodayContrib:   anyFloat(team["today_contrib_fen"]) / 100,
		TotalContrib:   anyFloat(team["total_contrib_fen"]) / 100,
		TeamCount:      anyInt(team["team_count"]),
	}, nil
}

func anyInt(v any) int64 {
	switch typed := v.(type) {
	case float64:
		return int64(typed)
	case string:
		n, _ := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		return int64(n)
	case json.Number:
		n, _ := typed.Int64()
		return n
	}
	return 0
}

func anyString(v any) string {
	switch typed := v.(type) {
	case string:
		return strings.TrimSpace(typed)
	case json.Number:
		return typed.String()
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case int64:
		return strconv.FormatInt(typed, 10)
	}
	return strings.TrimSpace(fmt.Sprint(v))
}

func anyFloat(v any) float64 {
	switch typed := v.(type) {
	case float64:
		return typed
	case string:
		n, _ := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		return n
	case json.Number:
		n, _ := typed.Float64()
		return n
	}
	return 0
}

func (s *Server) handlerRewardSavePlan(w http.ResponseWriter, r *http.Request, p principal) {
	var input struct {
		UnionID      string   `json:"unionId"`
		Date         string   `json:"date"`
		Kind         string   `json:"kind"`
		PlannedTotal int64    `json:"plannedTotal"`
		PoolPercent  *float64 `json:"poolPercent"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Kind = strings.ToLower(strings.TrimSpace(input.Kind))
	if !validRewardKind(input.Kind) {
		writeError(w, http.StatusBadRequest, "INVALID_KIND", "奖励类型不正确")
		return
	}
	unionID, err := normalizeRewardUnionID(input.UnionID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_UNION_ID", err.Error())
		return
	}
	date, err := rewardDate(input.Date, time.Now())
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_DATE", err.Error())
		return
	}
	if input.PlannedTotal < 0 || input.PlannedTotal > 100000000 {
		writeError(w, http.StatusBadRequest, "INVALID_TOTAL", "发放总额必须在 0 到 1 亿金币之间")
		return
	}
	if input.PoolPercent != nil && (*input.PoolPercent < 0 || *input.PoolPercent > 100) {
		writeError(w, http.StatusBadRequest, "INVALID_PERCENT", "共享比例必须在 0 到 100 之间")
		return
	}
	planID, status, before, err := s.ensureRewardPlan(r.Context(), date, input.Kind, unionID, p.Username)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取发放计划失败")
		return
	}
	if status == rewardPlanPaid || status == rewardPlanPaying {
		writeError(w, http.StatusConflict, "PLAN_LOCKED", "该批次已发放或发放中，不能修改总额")
		return
	}
	if started, err := s.rewardPlanStarted(r.Context(), planID); err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取发放记录失败")
		return
	} else if started {
		writeError(w, http.StatusConflict, "PLAN_LOCKED", "该批次已发起过发放，金额不能再修改；如需调整请另建日期批次")
		return
	}
	if input.PoolPercent != nil {
		if _, err := s.db.ExecContext(r.Context(), `UPDATE mgr_agent_reward_plan
SET planned_total = ?, pool_percent = ?, status='draft' WHERE id = ?`,
			input.PlannedTotal, *input.PoolPercent, planID); err != nil {
			writeError(w, http.StatusInternalServerError, "UPDATE_FAILED", "保存发放总额失败")
			return
		}
	} else if _, err := s.db.ExecContext(r.Context(), `UPDATE mgr_agent_reward_plan SET planned_total = ?, status='draft'
WHERE id = ?`, input.PlannedTotal, planID); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_FAILED", "保存发放总额失败")
		return
	}
	// 奖池共享：只有发放当天保存时才落奖池快照（pool_base 存游戏原始单位「分」，便于精确对账）。
	// 历史日期保存不能把今天的实时奖池写成那一天的快照，否则事后对账会失真。
	poolBase := int64(0)
	if input.Kind == rewardKindPool && rewardDayOffset(date, time.Now()) == 0 {
		if total, err := s.rewardPoolTotal(r.Context()); err == nil {
			poolBase = total
			if _, err := s.db.ExecContext(r.Context(),
				`UPDATE mgr_agent_reward_plan SET pool_base = ? WHERE id = ?`, total, planID); err != nil {
				s.logger.Warn("save reward plan pool base", "error", err)
			}
		}
	}
	s.audit(r.Context(), &p, "game.agent_reward.edit", "agent_reward_plan", strconv.FormatInt(planID, 10),
		map[string]any{"plannedTotal": input.PlannedTotal, "kind": input.Kind, "date": date, "unionId": unionID, "poolPercent": input.PoolPercent},
		map[string]any{"plannedTotal": before}, map[string]any{"plannedTotal": input.PlannedTotal},
		0, "设置计划发放总额", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"plannedTotal": input.PlannedTotal, "poolBase": poolBase, "unionId": unionID})
}

type rewardAmountInput struct {
	UnionID string                   `json:"unionId"`
	Date    string                   `json:"date"`
	Kind    string                   `json:"kind"`
	Amounts map[string]int64         `json:"amounts"`
	Splits  map[string][]rewardSplit `json:"splits"`
}

func (s *Server) handlerRewardSaveAmounts(w http.ResponseWriter, r *http.Request, p principal) {
	var input rewardAmountInput
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Kind = strings.ToLower(strings.TrimSpace(input.Kind))
	if !validRewardKind(input.Kind) {
		writeError(w, http.StatusBadRequest, "INVALID_KIND", "奖励类型不正确")
		return
	}
	unionID, err := normalizeRewardUnionID(input.UnionID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_UNION_ID", err.Error())
		return
	}
	date, err := rewardDate(input.Date, time.Now())
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_DATE", err.Error())
		return
	}
	if len(input.Amounts) == 0 {
		writeError(w, http.StatusBadRequest, "EMPTY_AMOUNTS", "没有要保存的金额")
		return
	}
	if len(input.Amounts) > 500 {
		writeError(w, http.StatusBadRequest, "TOO_MANY", "一次最多保存 500 个代理")
		return
	}
	planID, status, planned, err := s.ensureRewardPlan(r.Context(), date, input.Kind, unionID, p.Username)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取发放计划失败")
		return
	}
	if status == rewardPlanPaid || status == rewardPlanPaying {
		writeError(w, http.StatusConflict, "PLAN_LOCKED", "该批次已发放或发放中，不能修改金额")
		return
	}
	if started, err := s.rewardPlanStarted(r.Context(), planID); err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取发放记录失败")
		return
	} else if started {
		writeError(w, http.StatusConflict, "PLAN_LOCKED", "该批次已发起过发放，金额不能再修改；如需调整请另建日期批次")
		return
	}

	// 只接受当前联盟名单里的代理，防止把别的联盟的 ID 写进这批金额。
	names := map[string]string{}
	rows, err := s.db.QueryContext(r.Context(), `SELECT agent_id, name FROM mgr_agent_reward_member
WHERE status='active' AND union_id=?`, unionID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取代理名单失败")
		return
	}
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err == nil {
			names[id] = name
		}
	}
	rows.Close()
	var outside []string
	for agentID := range input.Amounts {
		if _, ok := names[strings.TrimSpace(agentID)]; !ok {
			outside = append(outside, strings.TrimSpace(agentID))
		}
	}
	if len(outside) > 0 {
		sort.Strings(outside)
		writeError(w, http.StatusBadRequest, "CROSS_UNION",
			"以下代理不属于当前联盟，不能在这批金额里："+strings.Join(outside, "、"))
		return
	}

	var sum int64
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_FAILED", "保存失败")
		return
	}
	defer tx.Rollback()
	for agentID, amount := range input.Amounts {
		agentID = strings.TrimSpace(agentID)
		if !validAgentID(agentID) {
			writeError(w, http.StatusBadRequest, "INVALID_AGENT_ID", "代理 ID 不正确："+agentID)
			return
		}
		if amount < 0 || amount > 10000000 {
			writeError(w, http.StatusBadRequest, "INVALID_AMOUNT", "单个代理金额必须在 0 到 1000 万之间")
			return
		}
		splits := input.Splits[agentID]
		if len(splits) > 0 {
			var splitSum int64
			seen := map[string]bool{}
			for i := range splits {
				payee := strings.TrimSpace(splits[i].Payee)
				splits[i].Payee = payee
				if !validAgentID(payee) {
					writeError(w, http.StatusBadRequest, "INVALID_PAYEE", "收款账号不正确："+payee)
					return
				}
				if seen[payee] {
					writeError(w, http.StatusBadRequest, "DUPLICATE_PAYEE", "同一个收款账号出现了两次："+payee)
					return
				}
				seen[payee] = true
				if splits[i].Amount < 0 {
					writeError(w, http.StatusBadRequest, "INVALID_AMOUNT", "拆分的金额不能为负")
					return
				}
				if splits[i].Type != "main" && splits[i].Type != "sub" {
					splits[i].Type = "sub"
				}
				splitSum += splits[i].Amount
			}
			if splitSum != amount {
				writeError(w, http.StatusBadRequest, "SPLIT_MISMATCH",
					fmt.Sprintf("代理 %s 的主/子账号合计 %d 与分配金额 %d 不一致", agentID, splitSum, amount))
				return
			}
		}
		encoded := ""
		if len(splits) > 0 {
			body, _ := json.Marshal(splits)
			encoded = string(body)
		}
		if _, err := tx.ExecContext(r.Context(), `INSERT INTO mgr_agent_reward_item
(plan_id, agent_id, agent_name, final_amount, split_json, snapshot_json)
VALUES (?,?,?,?,?,?)
ON DUPLICATE KEY UPDATE final_amount = VALUES(final_amount), split_json = VALUES(split_json)`,
			planID, agentID, names[agentID], amount, encoded, ""); err != nil {
			writeError(w, http.StatusInternalServerError, "UPDATE_FAILED", "保存分配金额失败")
			return
		}
		sum += amount
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_FAILED", "保存分配金额失败")
		return
	}
	s.audit(r.Context(), &p, "game.agent_reward.edit", "agent_reward_plan", strconv.FormatInt(planID, 10),
		map[string]any{"kind": input.Kind, "date": date, "unionId": unionID, "count": len(input.Amounts), "sum": sum},
		nil, map[string]any{"sum": sum, "planned": planned}, 0, "保存分配金额", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"sum": sum, "planned": planned, "diff": planned - sum, "unionId": unionID})
}

// handlerRewardAllocate 按业绩股净次数比例分摊：三类奖励共用同一套权重。
func (s *Server) handlerRewardAllocate(w http.ResponseWriter, r *http.Request, p principal) {
	var input struct {
		UnionID string `json:"unionId"`
		Date    string `json:"date"`
		Kind    string `json:"kind"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Kind = strings.ToLower(strings.TrimSpace(input.Kind))
	if !validRewardKind(input.Kind) {
		writeError(w, http.StatusBadRequest, "INVALID_KIND", "奖励类型不正确")
		return
	}
	unionID, err := normalizeRewardUnionID(input.UnionID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_UNION_ID", err.Error())
		return
	}
	date, err := rewardDate(input.Date, time.Now())
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_DATE", err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()

	planID, status, planned, err := s.ensureRewardPlan(ctx, date, input.Kind, unionID, p.Username)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取发放计划失败")
		return
	}
	if status == rewardPlanPaid || status == rewardPlanPaying {
		writeError(w, http.StatusConflict, "PLAN_LOCKED", "该批次已发放或发放中，不能重新分摊")
		return
	}
	if started, err := s.rewardPlanStarted(ctx, planID); err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取发放记录失败")
		return
	} else if started {
		writeError(w, http.StatusConflict, "PLAN_LOCKED", "该批次已发起过发放，金额不能再调整；如需重算请另建日期批次")
		return
	}
	if planned <= 0 {
		writeError(w, http.StatusBadRequest, "NO_PLAN", "请先设置计划发放总额")
		return
	}

	members, err := s.loadRewardMembers(ctx, unionID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取代理名单失败")
		return
	}
	excluded, _ := s.loadRewardExcludes(ctx, unionID)
	skip := map[string]bool{}
	for _, ex := range excluded {
		if ex.Kind == input.Kind || ex.Kind == "all" {
			skip[ex.AgentID] = true
		}
	}

	// 三类奖励统一按业绩股净次数分摊，只有已开通业绩的代理有权重。
	perfMap, _, err := s.rewardClubPerformance(ctx, unionID, date)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取业绩股报表失败："+err.Error())
		return
	}
	weights := map[string]float64{}
	for _, m := range members {
		if skip[m.AgentID] {
			continue
		}
		if perf, ok := perfMap[m.AgentID]; ok && perf.Net > 0 {
			weights[m.AgentID] = perf.Net
		}
	}

	var totalWeight float64
	for _, weight := range weights {
		totalWeight += weight
	}
	if totalWeight <= 0 {
		writeError(w, http.StatusBadRequest, "NO_WEIGHT",
			"本次名单在 "+date+" 都没有业绩股净次数，无法按业绩比例分摊")
		return
	}

	allocated, ok := splitRewardByWeight(planned, weights)
	if !ok {
		writeError(w, http.StatusBadRequest, "NO_WEIGHT", "没有可用于分摊的权重")
		return
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_FAILED", "保存分摊结果失败")
		return
	}
	defer tx.Rollback()
	// 先清零本批次所有金额，避免上一轮残留。
	if _, err := tx.ExecContext(ctx, `UPDATE mgr_agent_reward_item SET final_amount = 0, auto_amount = 0
WHERE plan_id = ?`, planID); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_FAILED", "清空历史分摊失败")
		return
	}
	names := map[string]string{}
	rows, err := tx.QueryContext(ctx, `SELECT agent_id, name FROM mgr_agent_reward_member`)
	if err == nil {
		for rows.Next() {
			var id, name string
			if err := rows.Scan(&id, &name); err == nil {
				names[id] = name
			}
		}
		rows.Close()
	}
	for agentID, amount := range allocated {
		if amount <= 0 {
			continue
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO mgr_agent_reward_item
(plan_id, agent_id, agent_name, auto_amount, final_amount, split_json, snapshot_json)
VALUES (?,?,?,?,?,'','')
ON DUPLICATE KEY UPDATE auto_amount = VALUES(auto_amount), final_amount = VALUES(final_amount)`,
			planID, agentID, names[agentID], amount, amount); err != nil {
			writeError(w, http.StatusInternalServerError, "UPDATE_FAILED", "保存分摊结果失败")
			return
		}
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_FAILED", "保存分摊结果失败")
		return
	}
	s.audit(ctx, &p, "game.agent_reward.edit", "agent_reward_plan", strconv.FormatInt(planID, 10),
		map[string]any{"action": "allocate", "kind": input.Kind, "date": date, "unionId": unionID, "planned": planned},
		nil, map[string]any{"count": len(allocated)}, 0, "按规则自动分摊", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"count": len(allocated), "total": planned, "unionId": unionID})
}

// rewardLineTargets 返回需要取线数据的代理：本次入选名单 + 他们的直接下级。
//
// 只取一层就够了——下级的 team_raw 已经包含它自己下面所有人，上级的净点数
// 只需要减掉"直接下级整条线"。把下级补进来是为了在下级没进名单时也能正扣减，
// 否则上级的净点数会被算高、分摊时多拿钱。
func rewardLineTargets(members, all []rewardMember) []rewardMember {
	if len(members) == 0 {
		return nil
	}
	wanted := map[string]bool{}
	out := make([]rewardMember, 0, len(members)*2)
	for _, m := range members {
		if strings.TrimSpace(m.ClubID) == "" || wanted[m.AgentID] {
			continue
		}
		wanted[m.AgentID] = true
		out = append(out, m)
	}
	childOf := map[string]bool{}
	for _, m := range members {
		childOf[m.AgentID] = true
	}
	for _, m := range all {
		if !childOf[strings.TrimSpace(m.UpperID)] || wanted[m.AgentID] {
			continue
		}
		if strings.TrimSpace(m.ClubID) == "" {
			continue
		}
		wanted[m.AgentID] = true
		out = append(out, m)
	}
	return out
}

// buildRewardPerfFromLines 用俱乐部整条线的今日贡献算出每个代理的业绩点数：
//   - 毛（My）  = 该代理整条线的今日贡献（含自己和所有下线）；
//   - 下发（Granted） = 直接下级的整条线今日贡献之和；
//   - 净（Net） = 毛 − 下发，即该代理这一层真正"剩下"的点数。
//
// 这样上下级不会重复计算：每个下线只会从自己的直接上级那里被扣掉一次，
// 更下一层的贡献已经包含在直接下级的整条线里，不会重复扣。
// members 必须是「全部在册代理」，只用入选名单会漏扣未入选下级的贡献。
func buildRewardPerfFromLines(members []rewardMember, lines map[string]*rewardLine) map[string]*rewardPerf {
	childrenSum := map[string]float64{}
	for _, m := range members {
		if strings.TrimSpace(m.UpperID) == "" {
			continue
		}
		if line, ok := lines[m.AgentID]; ok && line != nil {
			childrenSum[m.UpperID] += line.TodayContrib
		}
	}
	out := map[string]*rewardPerf{}
	for _, m := range members {
		line, ok := lines[m.AgentID]
		if !ok || line == nil {
			continue
		}
		granted := round2(childrenSum[m.AgentID])
		net := round2(line.TodayContrib - granted)
		if net < 0 {
			net = 0
		}
		out[m.AgentID] = &rewardPerf{My: round2(line.TodayContrib), Granted: granted, Net: net}
	}
	return out
}

// rewardSharePercents 把净点数换算成名单内占比（百分比，保留两位小数）。
// 用最大余数法补尾差，只要有正权重，所有行的百分比合计恰好 100.00。
func rewardSharePercents(weights map[string]float64) map[string]float64 {
	result := make(map[string]float64, len(weights))
	total := 0.0
	for _, weight := range weights {
		if weight > 0 {
			total += weight
		}
	}
	if total <= 0 {
		for id := range weights {
			result[id] = 0
		}
		return result
	}
	type share struct {
		id    string
		units int64
		frac  float64
	}
	shares := make([]share, 0, len(weights))
	var used int64
	for id, weight := range weights {
		if weight <= 0 {
			result[id] = 0
			continue
		}
		// 百分比 × 100 后取整，最后一位按最大余数补，保证合计 10000。
		exact := 10000 * weight / total
		base := int64(math.Floor(exact))
		shares = append(shares, share{id: id, units: base, frac: exact - float64(base)})
		used += base
	}
	sort.SliceStable(shares, func(i, j int) bool {
		if shares[i].frac != shares[j].frac {
			return shares[i].frac > shares[j].frac
		}
		if weights[shares[i].id] != weights[shares[j].id] {
			return weights[shares[i].id] > weights[shares[j].id]
		}
		return shares[i].id < shares[j].id
	})
	left := int64(10000) - used
	for i := 0; i < len(shares) && left > 0; i++ {
		shares[i].units++
		left--
	}
	for _, item := range shares {
		result[item.id] = float64(item.units) / 100
	}
	return result
}

// splitRewardByWeight 把计划总额按权重分摊到每个代理，用最大余数法补尾差。
// 保证：结果之和恒等于 planned（只要 totalWeight > 0 且 planned >= 0），且同样的输入得到同样的结果。
func splitRewardByWeight(planned int64, weights map[string]float64) (map[string]int64, bool) {
	result := map[string]int64{}
	if planned < 0 {
		return result, false
	}
	var totalWeight float64
	for _, weight := range weights {
		if weight > 0 {
			totalWeight += weight
		}
	}
	if totalWeight <= 0 {
		return result, false
	}
	type share struct {
		id     string
		weight float64
		amount int64
		frac   float64
	}
	shares := make([]share, 0, len(weights))
	var used int64
	for id, weight := range weights {
		if weight <= 0 {
			continue
		}
		exact := float64(planned) * weight / totalWeight
		base := int64(math.Floor(exact))
		shares = append(shares, share{id: id, weight: weight, amount: base, frac: exact - float64(base)})
		used += base
	}
	sort.SliceStable(shares, func(i, j int) bool {
		if shares[i].frac != shares[j].frac {
			return shares[i].frac > shares[j].frac
		}
		if shares[i].weight != shares[j].weight {
			return shares[i].weight > shares[j].weight
		}
		return shares[i].id < shares[j].id
	})
	left := planned - used
	for i := 0; i < len(shares) && left > 0; i++ {
		shares[i].amount++
		left--
	}
	for _, item := range shares {
		result[item.id] = item.amount
	}
	return result, true
}

// lastRewardAmounts 取本联盟上一次已发放批次里每个代理的金额，作为核心奖励的参考值。
func (s *Server) lastRewardAmounts(ctx context.Context, kind, unionID string) (map[string]int64, error) {
	amounts, _, err := s.lastRewardAmountsWithDate(ctx, kind, unionID)
	return amounts, err
}

// lastRewardAmountsWithDate 同上，额外返回那一批的日期，便于页面标注"参考 11-07"。
func (s *Server) lastRewardAmountsWithDate(ctx context.Context, kind, unionID string) (map[string]int64, string, error) {
	result := map[string]int64{}
	var lastID int64
	var lastDate string
	if err := s.db.QueryRowContext(ctx, `SELECT id, DATE_FORMAT(reward_date,'%Y-%m-%d')
FROM mgr_agent_reward_plan WHERE kind = ? AND union_id = ? AND status = 'paid' ORDER BY id DESC LIMIT 1`, kind, unionID).
		Scan(&lastID, &lastDate); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return result, "", nil
		}
		return result, "", err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT agent_id, final_amount FROM mgr_agent_reward_item WHERE plan_id = ?`, lastID)
	if err != nil {
		return result, lastDate, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var amount int64
		if err := rows.Scan(&id, &amount); err != nil {
			return result, lastDate, err
		}
		result[id] = amount
	}
	return result, lastDate, rows.Err()
}

// rewardPoolTotal 读平台今天的真实奖池总额，单位是**分**（游戏服务原始口径）。
// 展示与发放金额按「元/金币」，调用方需要 /100 换算。返回分是为了保留两位小数精度。
func (s *Server) rewardPoolTotal(ctx context.Context) (int64, error) {
	callCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	snapshot, err := s.fetchRewardPools(callCtx, gameOperationContext("agent-reward-pool"))
	if err != nil {
		return 0, err
	}
	var total int64
	for _, value := range snapshot.Values {
		total += value
	}
	return total, nil
}

// rewardPoolSuggested 按「奖池总额 → 50% → 共享比例」算出本次计划发放金额。
// 比例是加在 50% 上的，不是加在整个奖池上：pool 100000 → 50% = 50000 → 60% = 30000。
// poolYuan 是奖池总额（元），返回值是整数金币。
func rewardPoolSuggested(poolYuan float64, percent float64) int64 {
	if poolYuan <= 0 || percent <= 0 {
		return 0
	}
	half := poolYuan / 2
	return int64(math.Round(half * percent / 100))
}

// handlerRewardMemberAdd 手工把游戏账号加进奖励名单并直接参与本次分配。
//
// 支持单个 agentId 或批量 agentIds（一行一个/逗号分隔由前端拆好）。
// 加入后 selected=1、source=manual：每日同步不会把人删掉，也不会掉出名单。
func (s *Server) handlerRewardMemberAdd(w http.ResponseWriter, r *http.Request, p principal) {
	var input struct {
		UnionID  string   `json:"unionId"`
		AgentID  string   `json:"agentId"`
		AgentIDs []string `json:"agentIds"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	unionID, err := normalizeRewardUnionID(input.UnionID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_UNION_ID", err.Error())
		return
	}
	raw := append([]string{input.AgentID}, input.AgentIDs...)
	ids := make([]string, 0, len(raw))
	seen := map[string]bool{}
	for _, item := range raw {
		item = strings.TrimSpace(item)
		if item == "" || seen[item] {
			continue
		}
		if !validAgentID(item) {
			writeError(w, http.StatusBadRequest, "INVALID_AGENT_ID", "代理 ID 不正确："+item)
			return
		}
		seen[item] = true
		ids = append(ids, item)
	}
	if len(ids) == 0 {
		writeError(w, http.StatusBadRequest, "INVALID_AGENT_ID", "请填写代理 ID")
		return
	}
	if len(ids) > 200 {
		writeError(w, http.StatusBadRequest, "TOO_MANY", "一次最多添加 200 个代理")
		return
	}

	added := make([]map[string]any, 0, len(ids))
	failed := make([]string, 0)
	for _, agentID := range ids {
		name, err := s.addRewardMember(r.Context(), agentID, unionID, p.Username)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				failed = append(failed, agentID+"：没有找到这个游戏账号")
				continue
			}
			if errors.Is(err, errRewardCrossUnion) {
				failed = append(failed, agentID+"："+err.Error())
				continue
			}
			s.logger.Error("add reward member", "error", err, "agentId", agentID)
			failed = append(failed, agentID+"：加入失败")
			continue
		}
		added = append(added, map[string]any{"agentId": agentID, "name": name})
	}
	if len(added) == 0 {
		writeError(w, http.StatusBadRequest, "ADD_FAILED", strings.Join(failed, "；"))
		return
	}
	s.audit(r.Context(), &p, "game.agent_reward.edit", "agent_reward_member", strings.Join(ids, ","),
		map[string]any{"action": "manual_add", "count": len(added), "unionId": unionID}, nil,
		map[string]any{"added": added, "failed": failed}, 0, "手工加入奖励名单", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{
		"agentId": ids[0], "name": added[0]["name"], "unionId": unionID,
		"added": added, "failed": failed, "count": len(added),
	})
}

// errRewardCrossUnion 手工按 ID 加人时，账号不属于当前联盟。
var errRewardCrossUnion = errors.New("不属于当前联盟，不能加入")

// addRewardMember 写入一行名单（存在则更新并设为参与）。返回昵称。
func (s *Server) addRewardMember(ctx context.Context, agentID, unionID, operator string) (string, error) {
	var name, roleText, upper string
	var level int64
	var isLeader, isPartner, isChief bool
	err := s.gameDB.QueryRowContext(ctx, `SELECT COALESCE(a.sm_name,''), COALESCE(a.sm_role,''), COALESCE(a.sm_level,0),
COALESCE(NULLIF(m.upper_guuid,''), NULLIF(a.sm_agentID,''), ''),
(a.sm_bigAgentID = a.sm_guuid), (a.sm_supperAgentID = a.sm_guuid), (a.sm_chiefAgentID = a.sm_guuid)
FROM tbl_Account a
LEFT JOIN third_marketing_info m ON m.player_guuid = a.sm_guuid
WHERE a.sm_guuid = ? ORDER BY m.id DESC LIMIT 1`, agentID).
		Scan(&name, &roleText, &level, &upper, &isLeader, &isPartner, &isChief)
	if err != nil {
		return "", err
	}
	var club, clubName, agentUnion, unionName string
	if err := s.gameDB.QueryRowContext(ctx, `SELECT ca.club_guuid, COALESCE(c.club_name,''), COALESCE(c.union_id,''),
COALESCE(u.union_name,'')
FROM club_agent_info ca
LEFT JOIN club_guuid_info c ON c.club_guuid = ca.club_guuid
LEFT JOIN club_union_info u ON u.union_id = c.union_id AND u.status='used'
WHERE ca.user_guuid = ? AND ca.status='used' ORDER BY ca.id DESC LIMIT 1`, agentID).
		Scan(&club, &clubName, &agentUnion, &unionName); err != nil {
		club, clubName, agentUnion, unionName = "", "", "", ""
	}
	agentUnion = strings.TrimSpace(agentUnion)
	if agentUnion == "" {
		return "", fmt.Errorf("%w：该账号还没有加入任何联盟", errRewardCrossUnion)
	}
	if agentUnion != unionID {
		return "", fmt.Errorf("%w：该账号属于联盟 %s", errRewardCrossUnion, agentUnion)
	}
	// 俱乐部内代理链优先作为上级，取不到时退回平台账号链。
	var clubUpper string
	_ = s.gameDB.QueryRowContext(ctx, `SELECT COALESCE(upper_guuid,'') FROM club_agent_info
WHERE user_guuid = ? AND status='used' ORDER BY id DESC LIMIT 1`, agentID).Scan(&clubUpper)
	if strings.TrimSpace(clubUpper) != "" {
		upper = strings.TrimSpace(clubUpper)
	}
	role := classifyClubRewardRole(roleText, isLeader, 0, level)
	if _, err := s.db.ExecContext(ctx, `INSERT INTO mgr_agent_reward_member
(agent_id, name, role, level, upper_id, club_id, club_name, union_id, union_name, authorized, selected, source, status)
VALUES (?,?,?,?,?,?,?,?,?,0,1,'manual','active')
ON DUPLICATE KEY UPDATE name = VALUES(name), role = VALUES(role), level = VALUES(level),
  upper_id = VALUES(upper_id), club_id = VALUES(club_id), club_name = VALUES(club_name),
  union_id = VALUES(union_id), union_name = VALUES(union_name), selected = 1, status = 'active'`,
		agentID, name, role, level, upper,
		strings.TrimSpace(club), strings.TrimSpace(clubName), agentUnion, strings.TrimSpace(unionName)); err != nil {
		return "", err
	}
	return name, nil
}

func (s *Server) handlerRewardExclude(w http.ResponseWriter, r *http.Request, p principal) {
	var input struct {
		UnionID string `json:"unionId"`
		AgentID string `json:"agentId"`
		Kind    string `json:"kind"`
		Reason  string `json:"reason"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	unionID, err := normalizeRewardUnionID(input.UnionID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_UNION_ID", err.Error())
		return
	}
	input.AgentID = strings.TrimSpace(input.AgentID)
	input.Kind = strings.ToLower(strings.TrimSpace(input.Kind))
	input.Reason = strings.TrimSpace(input.Reason)
	if !validAgentID(input.AgentID) {
		writeError(w, http.StatusBadRequest, "INVALID_AGENT_ID", "代理 ID 不正确")
		return
	}
	if ok, err := s.rewardAgentInUnion(r.Context(), input.AgentID, unionID); err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "校验代理所属联盟失败")
		return
	} else if !ok {
		writeError(w, http.StatusBadRequest, "CROSS_UNION", "该代理不属于当前联盟")
		return
	}
	if input.Kind == "" {
		input.Kind = "all"
	}
	if input.Kind != "all" && !validRewardKind(input.Kind) {
		writeError(w, http.StatusBadRequest, "INVALID_KIND", "排除范围不正确")
		return
	}
	if len([]rune(input.Reason)) < 2 || len([]rune(input.Reason)) > 200 {
		writeError(w, http.StatusBadRequest, "INVALID_REASON", "排除原因需要 2 到 200 个字")
		return
	}
	if _, err := s.db.ExecContext(r.Context(), `INSERT INTO mgr_agent_reward_exclude (agent_id, kind, reason, operator)
VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE reason = VALUES(reason), operator = VALUES(operator), created_at = NOW()`,
		input.AgentID, input.Kind, input.Reason, p.Username); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_FAILED", "保存排除记录失败")
		return
	}
	// 同步清掉本联盟未发放的分配金额，避免排除后仍被带进发放。
	if _, err := s.db.ExecContext(r.Context(), `UPDATE mgr_agent_reward_item i
JOIN mgr_agent_reward_plan p ON p.id = i.plan_id
SET i.final_amount = 0, i.auto_amount = 0
WHERE i.agent_id = ? AND p.status = 'draft' AND p.union_id = ? AND (p.kind = ? OR ? = 'all')`,
		input.AgentID, unionID, input.Kind, input.Kind); err != nil {
		s.logger.Warn("clear excluded amount", "error", err)
	}
	s.audit(r.Context(), &p, "game.agent_reward.edit", "agent_reward_exclude", input.AgentID,
		map[string]any{"kind": input.Kind, "reason": input.Reason, "unionId": unionID}, nil, nil, 0, "排除代理奖励", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"agentId": input.AgentID, "kind": input.Kind, "unionId": unionID})
}

func (s *Server) handlerRewardExcludeRemove(w http.ResponseWriter, r *http.Request, p principal) {
	agentID := strings.TrimSpace(r.PathValue("agentId"))
	if !validAgentID(agentID) {
		writeError(w, http.StatusBadRequest, "INVALID_AGENT_ID", "代理 ID 不正确")
		return
	}
	unionID, err := normalizeRewardUnionID(r.URL.Query().Get("unionId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_UNION_ID", err.Error())
		return
	}
	if ok, err := s.rewardAgentInUnion(r.Context(), agentID, unionID); err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "校验代理所属联盟失败")
		return
	} else if !ok {
		writeError(w, http.StatusBadRequest, "CROSS_UNION", "该代理不属于当前联盟")
		return
	}
	kind := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("kind")))
	if kind == "" {
		kind = "all"
	}
	result, err := s.db.ExecContext(r.Context(), `DELETE FROM mgr_agent_reward_exclude WHERE agent_id = ? AND kind = ?`, agentID, kind)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_FAILED", "恢复失败")
		return
	}
	if n, _ := result.RowsAffected(); n == 0 {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "没有找到这条排除记录")
		return
	}
	s.audit(r.Context(), &p, "game.agent_reward.edit", "agent_reward_exclude", agentID,
		map[string]any{"kind": kind, "action": "restore", "unionId": unionID}, nil, nil, 0, "恢复代理奖励", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"agentId": agentID, "unionId": unionID})
}

func (s *Server) handlerRewardSubAdd(w http.ResponseWriter, r *http.Request, p principal) {
	var input struct {
		UnionID  string `json:"unionId"`
		AgentID  string `json:"agentId"`
		SubGuuid string `json:"subGuuid"`
		Note     string `json:"note"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	unionID, err := normalizeRewardUnionID(input.UnionID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_UNION_ID", err.Error())
		return
	}
	input.AgentID = strings.TrimSpace(input.AgentID)
	input.SubGuuid = strings.TrimSpace(input.SubGuuid)
	if !validAgentID(input.AgentID) || !validAgentID(input.SubGuuid) {
		writeError(w, http.StatusBadRequest, "INVALID_AGENT_ID", "代理 ID 或子账号 ID 不正确")
		return
	}
	if input.AgentID == input.SubGuuid {
		writeError(w, http.StatusBadRequest, "SAME_ACCOUNT", "子账号不能和主账号相同")
		return
	}
	if ok, err := s.rewardAgentInUnion(r.Context(), input.AgentID, unionID); err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "校验代理所属联盟失败")
		return
	} else if !ok {
		writeError(w, http.StatusBadRequest, "CROSS_UNION", "该代理不属于当前联盟")
		return
	}
	var name string
	if err := s.db.QueryRowContext(r.Context(), `SELECT sm_name FROM kbedm.tbl_Account WHERE sm_guuid = ? LIMIT 1`,
		input.SubGuuid).Scan(&name); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "没有找到这个游戏账号")
			return
		}
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "查询玩家失败")
		return
	}
	if _, err := s.db.ExecContext(r.Context(), `INSERT INTO mgr_agent_reward_sub_account
(agent_id, sub_guuid, sub_name, note, status, created_by) VALUES (?,?,?,?,'active',?)
ON DUPLICATE KEY UPDATE sub_name = VALUES(sub_name), note = VALUES(note), status='active'`,
		input.AgentID, input.SubGuuid, name, strings.TrimSpace(input.Note), p.Username); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_FAILED", "绑定子账号失败")
		return
	}
	s.audit(r.Context(), &p, "game.agent_reward.configure", "agent_reward_sub", input.AgentID,
		map[string]any{"subGuuid": input.SubGuuid, "unionId": unionID}, nil, map[string]any{"name": name}, 0, "绑定发放子账号", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"agentId": input.AgentID, "subId": input.SubGuuid, "subName": name, "unionId": unionID})
}

func (s *Server) handlerRewardSubRemove(w http.ResponseWriter, r *http.Request, p principal) {
	agentID := strings.TrimSpace(r.PathValue("agentId"))
	subID := strings.TrimSpace(r.PathValue("subId"))
	if !validAgentID(agentID) || !validAgentID(subID) {
		writeError(w, http.StatusBadRequest, "INVALID_AGENT_ID", "参数不正确")
		return
	}
	unionID, err := normalizeRewardUnionID(r.URL.Query().Get("unionId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_UNION_ID", err.Error())
		return
	}
	if ok, err := s.rewardAgentInUnion(r.Context(), agentID, unionID); err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "校验代理所属联盟失败")
		return
	} else if !ok {
		writeError(w, http.StatusBadRequest, "CROSS_UNION", "该代理不属于当前联盟")
		return
	}
	if _, err := s.db.ExecContext(r.Context(), `UPDATE mgr_agent_reward_sub_account SET status='disabled'
WHERE agent_id = ? AND sub_guuid = ?`, agentID, subID); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_FAILED", "解绑失败")
		return
	}
	s.audit(r.Context(), &p, "game.agent_reward.configure", "agent_reward_sub", agentID,
		map[string]any{"subGuuid": subID, "action": "unbind", "unionId": unionID}, nil, nil, 0, "解绑发放子账号", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"agentId": agentID, "unionId": unionID})
}

/* ---------------- 发放 ---------------- */

type rewardPayResult struct {
	Total        int64    `json:"total"`
	Paid         int64    `json:"paid"`
	Waiting      int64    `json:"waiting"`
	Failed       int64    `json:"failed"`
	Skipped      int64    `json:"skipped"`
	Injected     int64    `json:"injected"`
	LeaderAmount int64    `json:"leaderAmount"`
	LeaderCount  int64    `json:"leaderCount"`
	Status       string   `json:"status"`
	Orders       []string `json:"orders"`
	Errors       []string `json:"errors"`
}

type rewardPayoutRow struct {
	ID          int64
	Stage       string
	AgentID     string
	ClubID      string
	Payee       string
	Amount      int64
	Order       string
	Status      string
	Description string
	// 额度流水以「分」存储，用于重试时判断上一笔是否已经到账。
	QuotaBefore int64
	QuotaAfter  int64
	CreatedAt   string
}

type rewardClubTarget struct {
	ID         string
	Name       string
	LeaderID   string
	LeaderName string
	Quota      int64
}

type rewardPayTarget struct {
	AgentID  string
	Name     string
	ClubID   string
	ClubName string
	Amount   int64
}

// rewardTransferSettled 表示这一笔已经不需要再调用游戏服；pending 是上次调用中断，
// 必须先核对余额/流水，不能直接当成已完成。
func rewardTransferSettled(status string) bool {
	switch status {
	case rewardPayoutPaid, rewardPayoutWaiting, rewardPayoutMiss:
		return true
	}
	return false
}

func (s *Server) handlerRewardPay(w http.ResponseWriter, r *http.Request, p principal) {
	var input struct {
		UnionID string `json:"unionId"`
		Date    string `json:"date"`
		Kind    string `json:"kind"`
		Confirm bool   `json:"confirm"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Kind = strings.ToLower(strings.TrimSpace(input.Kind))
	if !validRewardKind(input.Kind) {
		writeError(w, http.StatusBadRequest, "INVALID_KIND", "奖励类型不正确")
		return
	}
	unionID, err := normalizeRewardUnionID(input.UnionID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_UNION_ID", err.Error())
		return
	}
	if !input.Confirm {
		writeError(w, http.StatusBadRequest, "CONFIRM_REQUIRED", "请确认本次会真实发放俱乐部积分与额度")
		return
	}
	date, err := rewardDate(input.Date, time.Now())
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_DATE", err.Error())
		return
	}

	rewardPayoutMu.Lock()
	defer rewardPayoutMu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Minute)
	defer cancel()

	planID, status, planned, err := s.ensureRewardPlan(ctx, date, input.Kind, unionID, p.Username)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取发放计划失败")
		return
	}
	if status == rewardPlanPaid {
		writeError(w, http.StatusConflict, "ALREADY_PAID", "该批次已经发放完成，如需补发请另建日期")
		return
	}
	if status == rewardPlanPaying {
		writeError(w, http.StatusConflict, "PAYING", "该批次正在发放中，请稍后刷新")
		return
	}

	// 名单与金额：金额单位是元（俱乐部积分），额度接口要求分，调用前统一 ×100。
	rows, err := s.db.QueryContext(ctx, `SELECT i.agent_id, COALESCE(NULLIF(i.agent_name,''), m.name, ''),
COALESCE(m.club_id,''), COALESCE(m.club_name,''), i.final_amount
FROM mgr_agent_reward_item i
LEFT JOIN mgr_agent_reward_member m ON m.agent_id = i.agent_id
WHERE i.plan_id = ? AND i.final_amount > 0 ORDER BY i.id`, planID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取分配明细失败")
		return
	}
	var targets []rewardPayTarget
	var expected int64
	for rows.Next() {
		var target rewardPayTarget
		if err := rows.Scan(&target.AgentID, &target.Name, &target.ClubID, &target.ClubName, &target.Amount); err != nil {
			rows.Close()
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取分配明细失败")
			return
		}
		targets = append(targets, target)
		expected += target.Amount
	}
	rows.Close()
	if len(targets) == 0 {
		writeError(w, http.StatusBadRequest, "NOTHING_TO_PAY", "没有需要发放的代理")
		return
	}
	if expected != planned {
		writeError(w, http.StatusBadRequest, "NOT_BALANCED",
			fmt.Sprintf("分配合计 %d 与计划总额 %d 不一致，不能发放", expected, planned))
		return
	}
	if expected > math.MaxInt64/100 {
		writeError(w, http.StatusBadRequest, "INVALID_TOTAL", "发放总额超出可用范围")
		return
	}
	totalFen := expected * 100

	clubTotals := map[string]int64{}
	for _, target := range targets {
		if strings.TrimSpace(target.ClubID) == "" {
			writeError(w, http.StatusBadRequest, "CLUB_REQUIRED",
				fmt.Sprintf("代理 %s（%s）没有绑定俱乐部，无法发放俱乐部积分", target.Name, target.AgentID))
			return
		}
		clubTotals[target.ClubID] += target.Amount
	}
	clubs, err := s.rewardUnionClubs(ctx, unionID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取联盟俱乐部失败")
		return
	}
	for clubID := range clubTotals {
		if _, ok := clubs[clubID]; !ok {
			writeError(w, http.StatusBadRequest, "CLUB_REQUIRED",
				fmt.Sprintf("俱乐部 %s 不属于当前联盟，无法下划额度", clubID))
			return
		}
	}

	ownerID, ownerName, unionName := s.rewardUnionOwner(ctx, unionID)
	if ownerName == "" {
		ownerName = ownerID
	}
	if ownerName == "" {
		ownerName = "大盟主"
	}
	if unionName == "" {
		unionName = unionID
	}

	existing, err := s.loadRewardPayoutRows(ctx, planID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取发放记录失败")
		return
	}
	// 还没产生任何成功流水时，失败记录只是上一次尝试的结果；金额可能已被修改，
	// 先清掉失败行再重算，避免旧俱乐部/旧金额的失败记录干扰本次结果。
	hasSettled := false
	for _, row := range existing {
		if rewardTransferSettled(row.Status) {
			hasSettled = true
			break
		}
	}
	if !hasSettled {
		if _, err := s.db.ExecContext(ctx, `DELETE FROM mgr_agent_reward_payout
WHERE plan_id = ? AND status = 'failed'`, planID); err == nil {
			existing, _ = s.loadRewardPayoutRows(ctx, planID)
		}
	}
	var unionRow *rewardPayoutRow
	leaderRows := map[string]*rewardPayoutRow{}
	memberRows := map[string]*rewardPayoutRow{}
	for i := range existing {
		row := &existing[i]
		switch row.Stage {
		case rewardStageUnion:
			if unionRow == nil {
				unionRow = row
			}
		case rewardStageLeader:
			leaderRows[row.ClubID] = row
		default:
			key := row.AgentID + "|" + row.Payee
			if memberRows[key] == nil || memberRows[key].ID < row.ID {
				memberRows[key] = row
			}
		}
	}

	if unionRow != nil && (rewardTransferSettled(unionRow.Status) || unionRow.Status == rewardPayoutPend) && unionRow.Amount != expected {
		writeError(w, http.StatusConflict, "PLAN_LOCKED",
			fmt.Sprintf("该批次已向联盟池发放过 %d，与当前分配合计 %d 不一致，不能继续发放", unionRow.Amount, expected))
		return
	}

	if _, err := s.db.ExecContext(ctx, `UPDATE mgr_agent_reward_plan SET status='paying' WHERE id = ?`, planID); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_FAILED", "更新批次状态失败")
		return
	}

	codes := map[string]string{rewardKindPerformance: "P", rewardKindCore: "C", rewardKindPool: "S"}
	dateCode := strings.ReplaceAll(date, "-", "")
	var seq int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM mgr_agent_reward_payout`).Scan(&seq); err != nil {
		seq = 0
	}
	nextOrder := func(stage string) string {
		seq++
		stageCode := map[string]string{rewardStageUnion: "U", rewardStageLeader: "L", rewardStagePlayer: "M"}[stage]
		return fmt.Sprintf("RW%s%s%s%05d", dateCode, codes[input.Kind], stageCode, seq)
	}

	result := rewardPayResult{Total: expected, Orders: []string{}, Errors: []string{}}
	// 调用结果不确定时，只认本次操作开始后写入的积分流水，避免把历史奖励当成已到账。
	flowSince := time.Now().Add(-2 * time.Minute).Format("2006-01-02 15:04:05")

	// 第一阶段：平台把本批总额发到大盟主的联盟额度池。
	unionOK := false
	if unionRow != nil && unionRow.Status == rewardPayoutPend {
		after := s.readRewardUnionQuota(ctx, unionID)
		if after >= unionRow.QuotaBefore+totalFen {
			unionRow.Status = rewardPayoutPaid
			_, _ = s.saveRewardPayout(ctx, unionRow.ID, planID, rewardStageUnion, ownerID, ownerName,
				"", "", ownerID, unionRow.Description, unionRow.Order, expected, rewardPayoutPaid,
				unionRow.QuotaBefore, after, "")
		}
	}
	if unionRow != nil && rewardTransferSettled(unionRow.Status) {
		unionOK = true
		result.Injected = expected
		if unionRow.Order != "" {
			result.Orders = append(result.Orders, unionRow.Order)
		}
	}
	if !unionOK {
		before := s.readRewardUnionQuota(ctx, unionID)
		order := ""
		if unionRow != nil {
			order = unionRow.Order
		}
		if order == "" {
			order = nextOrder(rewardStageUnion)
		}
		desc := fmt.Sprintf("平台向大盟主「%s」的联盟额度池发放 %d 额度（联盟：%s）", ownerName, expected, unionName)
		id, saveErr := s.saveRewardPayout(ctx, rowID(unionRow), planID, rewardStageUnion, ownerID, ownerName,
			"", "", ownerID, desc, order, expected, rewardPayoutPend, before, before, "")
		if saveErr != nil {
			writeError(w, http.StatusInternalServerError, "UPDATE_FAILED", "创建联盟池发放记录失败")
			return
		}
		payload, callErr := s.callRewardCommand(ctx, "发放_总群主_奖励", map[string]any{
			"union_id": unionID, "quota_fen": totalFen, "context": gameOperationContext("reward-union"),
		})
		after := s.readRewardUnionQuota(ctx, unionID)
		if callErr != nil && after-before >= totalFen {
			callErr = nil
		}
		if callErr != nil {
			desc += "失败"
			_, _ = s.saveRewardPayout(ctx, id, planID, rewardStageUnion, ownerID, ownerName,
				"", "", ownerID, desc, order, expected, rewardPayoutFailed, before, after, callErr.Error())
			result.Failed++
			result.Errors = append(result.Errors, "联盟池发放失败："+callErr.Error())
		} else {
			if value := anyInt(payload["union_quota"]); value > 0 {
				after = value
			}
			desc = fmt.Sprintf("平台向大盟主「%s」的联盟额度池发放 %d 额度（联盟：%s），发放后池余额 %d 额度",
				ownerName, expected, unionName, after/100)
			if _, err := s.saveRewardPayout(ctx, id, planID, rewardStageUnion, ownerID, ownerName,
				"", "", ownerID, desc, order, expected, rewardPayoutPaid, before, after, ""); err != nil {
				s.logger.Warn("update union reward payout", "error", err)
			}
			result.Injected = expected
			result.Orders = append(result.Orders, order)
			unionOK = true
		}
	}

	failedClubs := map[string]string{}
	clubIDs := make([]string, 0, len(clubTotals))
	for clubID := range clubTotals {
		clubIDs = append(clubIDs, clubID)
	}
	sort.Strings(clubIDs)

	// 第二阶段：大盟主从联盟池把每个俱乐部下面所有人的金额汇总，下划到对应盟主俱乐部。
	if unionOK {
		for _, clubID := range clubIDs {
			club := clubs[clubID]
			amount := clubTotals[clubID]
			fen := amount * 100
			row := leaderRows[clubID]
			if row != nil && row.Status == rewardPayoutPend {
				after := s.readRewardClubQuota(ctx, clubID)
				if after >= row.QuotaBefore+fen {
					row.Status = rewardPayoutPaid
					_, _ = s.saveRewardPayout(ctx, row.ID, planID, rewardStageLeader, club.LeaderID, club.LeaderName,
						clubID, club.Name, club.LeaderID, row.Description, row.Order, amount, rewardPayoutPaid,
						row.QuotaBefore, after, "")
				}
			}
			if row != nil && rewardTransferSettled(row.Status) {
				result.LeaderAmount += amount
				result.LeaderCount++
				continue
			}
			before := s.readRewardClubQuota(ctx, clubID)
			order := ""
			if row != nil {
				order = row.Order
			}
			if order == "" {
				order = nextOrder(rewardStageLeader)
			}
			desc := fmt.Sprintf("大盟主「%s」从联盟池下划 %d 额度给盟主「%s」（俱乐部：%s）",
				ownerName, amount, club.LeaderName, club.Name)
			id, saveErr := s.saveRewardPayout(ctx, rowID(row), planID, rewardStageLeader, club.LeaderID, club.LeaderName,
				clubID, club.Name, club.LeaderID, desc, order, amount, rewardPayoutPend, before, before, "")
			if saveErr != nil {
				failedClubs[clubID] = "创建盟主额度记录失败"
				result.Failed++
				result.Errors = append(result.Errors, club.Name+"："+failedClubs[clubID])
				continue
			}
			payload, callErr := s.callRewardCommand(ctx, "发放_盟主_奖励", map[string]any{
				"union_id": unionID, "club_id": clubID, "quota_fen": fen,
				"context": gameOperationContext("reward-leader"),
			})
			after := s.readRewardClubQuota(ctx, clubID)
			if callErr != nil && after-before >= fen {
				callErr = nil
			}
			if callErr != nil {
				desc += "失败"
				_, _ = s.saveRewardPayout(ctx, id, planID, rewardStageLeader, club.LeaderID, club.LeaderName,
					clubID, club.Name, club.LeaderID, desc, order, amount, rewardPayoutFailed, before, after, callErr.Error())
				failedClubs[clubID] = callErr.Error()
				result.Failed++
				result.Errors = append(result.Errors, club.Name+"："+callErr.Error())
				continue
			}
			if value := anyInt(payload["club_quota"]); value > 0 {
				after = value
			}
			unionAfter := anyInt(payload["union_quota"])
			desc = fmt.Sprintf("大盟主「%s」从联盟池下划 %d 额度给盟主「%s」（俱乐部：%s），下划后俱乐部额度 %d 额度",
				ownerName, amount, club.LeaderName, club.Name, after/100)
			if unionAfter > 0 {
				desc += fmt.Sprintf("，联盟池余额 %d 额度", unionAfter/100)
			}
			if _, err := s.saveRewardPayout(ctx, id, planID, rewardStageLeader, club.LeaderID, club.LeaderName,
				clubID, club.Name, club.LeaderID, desc, order, amount, rewardPayoutPaid, before, after, ""); err != nil {
				s.logger.Warn("update leader reward payout", "error", err)
			}
			result.LeaderAmount += amount
			result.LeaderCount++
		}
	}

	// 第三阶段：各盟主按俱乐部给成员发放俱乐部积分；同俱乐部同金额合并成一批，单批最多 20 人。
	if unionOK {
		for _, clubID := range clubIDs {
			club := clubs[clubID]
			if message := failedClubs[clubID]; message != "" {
				for _, target := range targets {
					if target.ClubID != clubID {
						continue
					}
					key := target.AgentID + "|" + target.AgentID
					row := memberRows[key]
					if row != nil && rewardTransferSettled(row.Status) {
						result.Skipped++
						continue
					}
					order := ""
					if row != nil {
						order = row.Order
					}
					if order == "" {
						order = nextOrder(rewardStagePlayer)
					}
					desc := fmt.Sprintf("盟主「%s」给成员「%s」（ID:%s）发放 %d 俱乐部积分（俱乐部：%s）失败：盟主额度下划失败（%s）",
						club.LeaderName, target.Name, target.AgentID, target.Amount, club.Name, message)
					if _, err := s.saveRewardPayout(ctx, rowID(row), planID, rewardStagePlayer, target.AgentID, target.Name,
						clubID, club.Name, target.AgentID, desc, order, target.Amount, rewardPayoutFailed, 0, 0,
						"盟主额度下划失败："+message); err != nil {
						s.logger.Warn("record leader-failed player reward", "error", err)
					}
					result.Failed++
				}
				continue
			}
			byAmount := map[int64][]rewardPayTarget{}
			for _, target := range targets {
				if target.ClubID == clubID {
					byAmount[target.Amount] = append(byAmount[target.Amount], target)
				}
			}
			amounts := make([]int64, 0, len(byAmount))
			for amount := range byAmount {
				amounts = append(amounts, amount)
			}
			sort.Slice(amounts, func(i, j int) bool { return amounts[i] < amounts[j] })
			for _, amount := range amounts {
				group := byAmount[amount]
				for start := 0; start < len(group); start += 20 {
					end := start + 20
					if end > len(group) {
						end = len(group)
					}
					batch := group[start:end]
					var pendingBatch []rewardPayTarget
					for _, target := range batch {
						key := target.AgentID + "|" + target.AgentID
						row := memberRows[key]
						if row == nil {
							pendingBatch = append(pendingBatch, target)
							continue
						}
						if row.Status == rewardPayoutPend {
							if s.playerHasRewardFlow(ctx, target.AgentID, clubID, row.CreatedAt) {
								desc := fmt.Sprintf("盟主「%s」给成员「%s」（ID:%s）发放 %d 俱乐部积分（俱乐部：%s），已到账",
									club.LeaderName, target.Name, target.AgentID, amount, club.Name)
								_, _ = s.saveRewardPayout(ctx, row.ID, planID, rewardStagePlayer, target.AgentID, target.Name,
									clubID, club.Name, target.AgentID, desc, row.Order, amount, rewardPayoutPaid, 0, 0, "")
								result.Paid++
								continue
							}
							if s.playerInRoom(ctx, target.AgentID) {
								desc := fmt.Sprintf("盟主「%s」给成员「%s」（ID:%s）发放 %d 俱乐部积分（俱乐部：%s）；玩家在房间内，结算后自动补发",
									club.LeaderName, target.Name, target.AgentID, amount, club.Name)
								_, _ = s.saveRewardPayout(ctx, row.ID, planID, rewardStagePlayer, target.AgentID, target.Name,
									clubID, club.Name, target.AgentID, desc, row.Order, amount, rewardPayoutWaiting, 0, 0, "")
								result.Waiting++
								continue
							}
						}
						if rewardTransferSettled(row.Status) {
							result.Skipped++
							continue
						}
						pendingBatch = append(pendingBatch, target)
					}
					if len(pendingBatch) == 0 {
						continue
					}
					ids := make([]string, 0, len(pendingBatch))
					batchRows := map[string]*rewardPayoutRow{}
					for _, target := range pendingBatch {
						key := target.AgentID + "|" + target.AgentID
						row := memberRows[key]
						order := ""
						if row != nil && row.Status != rewardPayoutFailed {
							order = row.Order
						}
						if order == "" {
							order = nextOrder(rewardStagePlayer)
						}
						desc := fmt.Sprintf("盟主「%s」给成员「%s」（ID:%s）发放 %d 俱乐部积分（俱乐部：%s）",
							club.LeaderName, target.Name, target.AgentID, amount, club.Name)
						id, saveErr := s.saveRewardPayout(ctx, rowID(row), planID, rewardStagePlayer, target.AgentID, target.Name,
							clubID, club.Name, target.AgentID, desc, order, amount, rewardPayoutPend, 0, 0, "")
						if saveErr != nil {
							result.Failed++
							result.Errors = append(result.Errors, target.Name+"：创建发放记录失败")
							continue
						}
						batchRows[target.AgentID] = &rewardPayoutRow{
							ID: id, Stage: rewardStagePlayer, AgentID: target.AgentID, ClubID: clubID,
							Payee: target.AgentID, Amount: amount, Order: order, Status: rewardPayoutPend,
						}
						ids = append(ids, target.AgentID)
					}
					if len(ids) == 0 {
						continue
					}
					payload, callErr := s.callRewardCommand(ctx, "异步_发放_玩家_奖励", map[string]any{
						"club_id": clubID, "user_ids": ids, "gold": amount,
						"context": gameOperationContext("reward-player"),
					})
					if callErr != nil {
						for _, target := range pendingBatch {
							row := batchRows[target.AgentID]
							if row == nil {
								continue
							}
							base := fmt.Sprintf("盟主「%s」给成员「%s」（ID:%s）发放 %d 俱乐部积分（俱乐部：%s）",
								club.LeaderName, target.Name, target.AgentID, amount, club.Name)
							var commandErr *rewardCommandError
							certain := errors.As(callErr, &commandErr) || strings.Contains(callErr.Error(), "connection refused")
							uncertain := !certain
							switch {
							case s.playerHasRewardFlow(ctx, target.AgentID, clubID, flowSince):
								_, _ = s.saveRewardPayout(ctx, row.ID, planID, rewardStagePlayer, target.AgentID, target.Name,
									clubID, club.Name, target.AgentID, base+"，已到账", row.Order, amount, rewardPayoutPaid, 0, 0, "")
								result.Paid++
							case uncertain && s.playerInRoom(ctx, target.AgentID):
								_, _ = s.saveRewardPayout(ctx, row.ID, planID, rewardStagePlayer, target.AgentID, target.Name,
									clubID, club.Name, target.AgentID, base+"；玩家在房间内，结算后自动补发", row.Order, amount, rewardPayoutWaiting, 0, 0, "")
								result.Waiting++
							default:
								_, _ = s.saveRewardPayout(ctx, row.ID, planID, rewardStagePlayer, target.AgentID, target.Name,
									clubID, club.Name, target.AgentID, base+"失败", row.Order, amount, rewardPayoutFailed, 0, 0, callErr.Error())
								result.Failed++
								result.Errors = append(result.Errors, target.Name+"："+callErr.Error())
							}
						}
						continue
					}
					success := gameStringSet(payload["success"])
					waiting := gameStringSet(payload["pending"])
					failures := gameFailureMap(payload["failed"])
					for _, target := range pendingBatch {
						row := batchRows[target.AgentID]
						if row == nil {
							continue
						}
						base := fmt.Sprintf("盟主「%s」给成员「%s」（ID:%s）发放 %d 俱乐部积分（俱乐部：%s）",
							club.LeaderName, target.Name, target.AgentID, amount, club.Name)
						switch {
						case success[target.AgentID]:
							_, _ = s.saveRewardPayout(ctx, row.ID, planID, rewardStagePlayer, target.AgentID, target.Name,
								clubID, club.Name, target.AgentID, base+"，已到账", row.Order, amount, rewardPayoutPaid, 0, 0, "")
							result.Paid++
						case waiting[target.AgentID]:
							_, _ = s.saveRewardPayout(ctx, row.ID, planID, rewardStagePlayer, target.AgentID, target.Name,
								clubID, club.Name, target.AgentID, base+"；玩家在房间内，结算后自动补发", row.Order, amount, rewardPayoutWaiting, 0, 0, "")
							result.Waiting++
						default:
							message := failures[target.AgentID]
							if message == "" {
								message = "服务端未返回该玩家结果"
							}
							_, _ = s.saveRewardPayout(ctx, row.ID, planID, rewardStagePlayer, target.AgentID, target.Name,
								clubID, club.Name, target.AgentID, base+"失败", row.Order, amount, rewardPayoutFailed, 0, 0, message)
							result.Failed++
							result.Errors = append(result.Errors, target.Name+"："+message)
						}
					}
				}
			}
		}
	}

	// 未从联盟池拿到额度时，所有成员记失败，不能越过额度直接发积分。
	if !unionOK {
		for _, clubID := range clubIDs {
			club := clubs[clubID]
			for _, target := range targets {
				if target.ClubID != clubID {
					continue
				}
				key := target.AgentID + "|" + target.AgentID
				row := memberRows[key]
				if row != nil && rewardTransferSettled(row.Status) {
					result.Skipped++
					continue
				}
				order := ""
				if row != nil {
					order = row.Order
				}
				if order == "" {
					order = nextOrder(rewardStagePlayer)
				}
				desc := fmt.Sprintf("盟主「%s」给成员「%s」（ID:%s）发放 %d 俱乐部积分（俱乐部：%s）失败：联盟池发放未完成",
					club.LeaderName, target.Name, target.AgentID, target.Amount, club.Name)
				if _, err := s.saveRewardPayout(ctx, rowID(row), planID, rewardStagePlayer, target.AgentID, target.Name,
					clubID, club.Name, target.AgentID, desc, order, target.Amount, rewardPayoutFailed, 0, 0,
					"联盟池发放未完成"); err != nil {
					s.logger.Warn("record skipped player reward", "error", err)
				}
				result.Failed++
			}
		}
	}

	// 每个阶段每个对象只保留一条记录，按最终状态汇总批次结果。
	finalStatus := rewardPlanPaid
	var failedCount, successCount int64
	if err := s.db.QueryRowContext(ctx, `SELECT
COALESCE(SUM(status='failed'),0), COALESCE(SUM(status IN ('paid','waiting','mismatch')),0)
FROM mgr_agent_reward_payout WHERE plan_id = ?`, planID).Scan(&failedCount, &successCount); err != nil {
		s.logger.Warn("summarize reward payouts", "error", err)
	}
	switch {
	case successCount == 0 && failedCount > 0:
		finalStatus = rewardPlanDraft
	case failedCount > 0:
		finalStatus = rewardPlanPartial
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE mgr_agent_reward_plan SET status=? WHERE id = ?`, finalStatus, planID); err != nil {
		s.logger.Warn("update reward plan status", "error", err)
	}
	result.Status = finalStatus

	s.audit(ctx, &p, "game.agent_reward.pay", "agent_reward_plan", strconv.FormatInt(planID, 10),
		map[string]any{"kind": input.Kind, "date": date, "unionId": unionID, "planned": planned, "expected": expected},
		nil, map[string]any{
			"paid": result.Paid, "waiting": result.Waiting, "failed": result.Failed, "skipped": result.Skipped,
			"injected": result.Injected, "leaderAmount": result.LeaderAmount, "leaderCount": result.LeaderCount,
			"status": finalStatus,
		}, 0, "发放代理俱乐部积分", clientIP(r))
	writeData(w, http.StatusOK, result)
}

func rowID(row *rewardPayoutRow) int64 {
	if row == nil {
		return 0
	}
	return row.ID
}

func (s *Server) rewardUnionOwner(ctx context.Context, unionID string) (string, string, string) {
	var ownerID, ownerName, unionName string
	if err := s.db.QueryRowContext(ctx, `SELECT COALESCE(owner_guuid,''), COALESCE(owner_name,''), COALESCE(union_name,'')
FROM kbedm.club_union_info WHERE union_id = ? LIMIT 1`, unionID).Scan(&ownerID, &ownerName, &unionName); err != nil {
		s.logger.Warn("load reward union owner", "error", err, "union_id", unionID)
	}
	return ownerID, ownerName, unionName
}

func (s *Server) rewardUnionClubs(ctx context.Context, unionID string) (map[string]*rewardClubTarget, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT c.club_guuid, COALESCE(NULLIF(c.club_name,''), c.club_guuid),
COALESCE(a.sm_guuid,''), COALESCE(NULLIF(a.sm_name,''),''), COALESCE(c.union_quota,0)
FROM kbedm.club_guuid_info c
LEFT JOIN kbedm.tbl_Account a ON a.id = c.account_id
WHERE c.union_id = ? AND c.club_status <> 'del'`, unionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := map[string]*rewardClubTarget{}
	for rows.Next() {
		var club rewardClubTarget
		if err := rows.Scan(&club.ID, &club.Name, &club.LeaderID, &club.LeaderName, &club.Quota); err != nil {
			return nil, err
		}
		if club.LeaderName == "" {
			club.LeaderName = club.LeaderID
		}
		if club.LeaderName == "" {
			club.LeaderName = "盟主"
		}
		result[club.ID] = &club
	}
	return result, rows.Err()
}

func (s *Server) readRewardUnionQuota(ctx context.Context, unionID string) int64 {
	var quota int64
	if err := s.db.QueryRowContext(ctx, `SELECT COALESCE(union_quota,0) FROM kbedm.club_union_info
WHERE union_id = ?`, unionID).Scan(&quota); err != nil {
		s.logger.Warn("read reward union quota", "error", err, "union_id", unionID)
	}
	return quota
}

func (s *Server) readRewardClubQuota(ctx context.Context, clubID string) int64 {
	var quota int64
	if err := s.db.QueryRowContext(ctx, `SELECT COALESCE(union_quota,0) FROM kbedm.club_guuid_info
WHERE club_guuid = ?`, clubID).Scan(&quota); err != nil {
		s.logger.Warn("read reward club quota", "error", err, "club_id", clubID)
	}
	return quota
}

func (s *Server) loadRewardPayoutRows(ctx context.Context, planID int64) ([]rewardPayoutRow, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, COALESCE(stage,'player'), COALESCE(agent_id,''), COALESCE(club_id,''),
COALESCE(payee_guuid,''), amount, COALESCE(work_order,''), status, COALESCE(description,''), quota_before, quota_after,
COALESCE(DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s'),'')
FROM mgr_agent_reward_payout WHERE plan_id = ? ORDER BY id`, planID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []rewardPayoutRow{}
	for rows.Next() {
		var row rewardPayoutRow
		if err := rows.Scan(&row.ID, &row.Stage, &row.AgentID, &row.ClubID, &row.Payee, &row.Amount,
			&row.Order, &row.Status, &row.Description, &row.QuotaBefore, &row.QuotaAfter, &row.CreatedAt); err != nil {
			return nil, err
		}
		list = append(list, row)
	}
	return list, rows.Err()
}

func (s *Server) saveRewardPayout(ctx context.Context, existingID, planID int64, stage, agentID, subjectName,
	clubID, clubName, payee, description, order string, amount int64, status string,
	quotaBefore, quotaAfter int64, message string) (int64, error) {
	if existingID > 0 {
		_, err := s.db.ExecContext(ctx, `UPDATE mgr_agent_reward_payout SET
stage=?, agent_id=?, subject_name=?, club_id=?, club_name=?, payee_guuid=?, description=?, amount=?, work_order=?,
status=?, error_message=?, quota_before=?, quota_after=?,
paid_at=CASE WHEN ?='paid' THEN COALESCE(paid_at, NOW()) ELSE paid_at END
WHERE id=?`,
			stage, agentID, subjectName, clubID, clubName, payee, description, amount, order,
			status, truncate(message, 240), quotaBefore, quotaAfter, status, existingID)
		return existingID, err
	}
	result, err := s.db.ExecContext(ctx, `INSERT INTO mgr_agent_reward_payout
(plan_id, item_id, stage, agent_id, club_id, club_name, subject_name, payee_guuid, payee_type, amount, description,
work_order, status, error_message, quota_before, quota_after, paid_at)
VALUES (?,0,?,?,?,?,?,?,'main',?,?,?,?,?,?,?, CASE WHEN ?='paid' THEN NOW() ELSE NULL END)`,
		planID, stage, agentID, clubID, clubName, subjectName, payee, amount, description,
		order, status, truncate(message, 240), quotaBefore, quotaAfter, status)
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

func (s *Server) callRewardCommand(ctx context.Context, header string, params map[string]any) (map[string]any, error) {
	result, err := s.callGameCommand(ctx, header, params)
	if err != nil {
		return nil, err
	}
	if result.RetCode != 512 {
		// 769 是游戏服明确拒绝，和网络超时不同：不能当成“可能已处理”。
		return nil, &rewardCommandError{message: describeGameFailure(header, result.RetCode, result.RetResult)}
	}
	return decodeGameObject(result.RetResult), nil
}

type rewardCommandError struct {
	message string
}

func (e *rewardCommandError) Error() string { return e.message }

func decodeGameObject(raw json.RawMessage) map[string]any {
	var text string
	if json.Unmarshal(raw, &text) == nil {
		raw = json.RawMessage(text)
	}
	var object map[string]any
	if err := json.Unmarshal(raw, &object); err != nil {
		return map[string]any{}
	}
	if inner, ok := object["result"]; ok {
		if innerText, ok := inner.(string); ok {
			var nested map[string]any
			if json.Unmarshal([]byte(innerText), &nested) == nil {
				return nested
			}
		}
		if nested, ok := inner.(map[string]any); ok {
			return nested
		}
	}
	return object
}

func gameStringSet(value any) map[string]bool {
	result := map[string]bool{}
	switch typed := value.(type) {
	case []any:
		for _, item := range typed {
			if id := anyString(item); id != "" {
				result[id] = true
			}
		}
	case []string:
		for _, id := range typed {
			if id = strings.TrimSpace(id); id != "" {
				result[id] = true
			}
		}
	case string:
		for _, id := range strings.Split(typed, ",") {
			if id = strings.TrimSpace(id); id != "" {
				result[id] = true
			}
		}
	}
	return result
}

func gameFailureMap(value any) map[string]string {
	result := map[string]string{}
	list, _ := value.([]any)
	for _, item := range list {
		row, _ := item.(map[string]any)
		id := anyString(row["guuid"])
		if id == "" {
			id = anyString(row["user_id"])
		}
		if id == "" {
			continue
		}
		result[id] = anyString(row["error"])
	}
	return result
}

func (s *Server) playerInRoom(ctx context.Context, playerID string) bool {
	state, err := s.readPlayerBalanceState(ctx, playerID)
	return err == nil && state.RoomID != 0
}

func (s *Server) playerHasRewardFlow(ctx context.Context, playerID, clubID, since string) bool {
	query := `SELECT COUNT(*) FROM kbedm.club_history_info
WHERE opt_type='积分奖励' AND user_guuid=? AND club_guuid=?`
	args := []any{playerID, clubID}
	if strings.TrimSpace(since) != "" {
		query += ` AND date >= ?`
		args = append(args, since)
	}
	var count int64
	if err := s.db.QueryRowContext(ctx, query, args...).Scan(&count); err != nil {
		return false
	}
	return count > 0
}

/* ---------------- 账单 ---------------- */

type rewardLedgerRow struct {
	ID          int64  `json:"id"`
	PlanID      int64  `json:"planId"`
	Date        string `json:"date"`
	Kind        string `json:"kind"`
	Stage       string `json:"stage"`
	AgentID     string `json:"agentId"`
	AgentName   string `json:"agentName"`
	ClubID      string `json:"clubId"`
	ClubName    string `json:"clubName"`
	Payee       string `json:"payee"`
	PayeeType   string `json:"payeeType"`
	Amount      int64  `json:"amount"`
	QuotaAfter  int64  `json:"quotaAfter"`
	Order       string `json:"order"`
	Status      string `json:"status"`
	Error       string `json:"error"`
	Description string `json:"description"`
	PaidAt      string `json:"paidAt"`
}

func (s *Server) handlerRewardLedger(w http.ResponseWriter, r *http.Request, p principal) {
	from := strings.TrimSpace(r.URL.Query().Get("from"))
	to := strings.TrimSpace(r.URL.Query().Get("to"))
	now := time.Now().In(dashboardLocation)
	if to == "" {
		to = now.Format("2006-01-02")
	}
	if from == "" {
		from = now.AddDate(0, 0, -9).Format("2006-01-02")
	}
	if _, err := time.ParseInLocation("2006-01-02", from, dashboardLocation); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_DATE", "开始日期不正确")
		return
	}
	if _, err := time.ParseInLocation("2006-01-02", to, dashboardLocation); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_DATE", "结束日期不正确")
		return
	}
	if from > to {
		writeError(w, http.StatusBadRequest, "INVALID_DATE", "开始日期不能晚于结束日期")
		return
	}
	unionID := ""
	if raw := strings.TrimSpace(r.URL.Query().Get("unionId")); raw != "" {
		normalized, err := normalizeUnionID(raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_UNION_ID", err.Error())
			return
		}
		unionID = normalized
	}
	rows, err := s.db.QueryContext(r.Context(), `SELECT p.id, p.plan_id, DATE_FORMAT(pl.reward_date,'%Y-%m-%d'), pl.kind,
COALESCE(p.stage,'player'), COALESCE(p.agent_id,''), COALESCE(NULLIF(p.subject_name,''), i.agent_name, ''),
COALESCE(p.club_id,''), COALESCE(p.club_name,''), COALESCE(p.payee_guuid,''), COALESCE(p.payee_type,'main'),
p.amount, COALESCE(p.quota_after,0), COALESCE(p.work_order,''), p.status, COALESCE(p.error_message,''),
COALESCE(p.description,''), COALESCE(DATE_FORMAT(p.paid_at,'%Y-%m-%d %H:%i'),'')
FROM mgr_agent_reward_payout p
JOIN mgr_agent_reward_plan pl ON pl.id = p.plan_id
LEFT JOIN mgr_agent_reward_item i ON i.id = p.item_id
WHERE pl.reward_date BETWEEN ? AND ? AND (? = '' OR pl.union_id = ?)
ORDER BY pl.reward_date DESC, p.plan_id DESC,
FIELD(COALESCE(p.stage,'player'),'union','leader','player'), p.id ASC
LIMIT 5000`, from, to, unionID, unionID)
	if err != nil {
		s.logger.Error("query reward ledger", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取账单失败")
		return
	}
	defer rows.Close()
	list := []rewardLedgerRow{}
	var total, performance, core, pool, unionInjected, leaderGranted, waiting int64
	for rows.Next() {
		var row rewardLedgerRow
		if err := rows.Scan(&row.ID, &row.PlanID, &row.Date, &row.Kind, &row.Stage, &row.AgentID, &row.AgentName,
			&row.ClubID, &row.ClubName, &row.Payee, &row.PayeeType, &row.Amount, &row.QuotaAfter, &row.Order,
			&row.Status, &row.Error, &row.Description, &row.PaidAt); err != nil {
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "解析账单失败")
			return
		}
		if row.Stage == "" {
			row.Stage = rewardStagePlayer
		}
		switch {
		case row.Status == rewardPayoutPaid && row.Stage == rewardStageUnion:
			unionInjected += row.Amount
		case row.Status == rewardPayoutPaid && row.Stage == rewardStageLeader:
			leaderGranted += row.Amount
		case row.Status == rewardPayoutPaid:
			total += row.Amount
			switch row.Kind {
			case rewardKindPerformance:
				performance += row.Amount
			case rewardKindCore:
				core += row.Amount
			case rewardKindPool:
				pool += row.Amount
			}
		case row.Status == rewardPayoutWaiting:
			waiting += row.Amount
		}
		list = append(list, row)
	}
	writeData(w, http.StatusOK, map[string]any{
		"items": list, "from": from, "to": to, "unionId": unionID,
		"summary": map[string]int64{
			"total": total, "performance": performance, "core": core, "pool": pool,
			"unionInjected": unionInjected, "leaderGranted": leaderGranted, "waiting": waiting,
		},
	})
}

// handlerRewardLine 返回某代理的上级链、本人、直属下级，以及每一层的线数据。
func (s *Server) handlerRewardLine(w http.ResponseWriter, r *http.Request, p principal) {
	agentID := strings.TrimSpace(r.PathValue("agentId"))
	if !validAgentID(agentID) {
		writeError(w, http.StatusBadRequest, "INVALID_AGENT_ID", "代理 ID 不正确")
		return
	}
	date, err := rewardDate(r.URL.Query().Get("date"), time.Now())
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_DATE", err.Error())
		return
	}
	unionID, err := normalizeRewardUnionID(r.URL.Query().Get("unionId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_UNION_ID", err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	members, err := s.loadRewardMembers(ctx, unionID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取代理名单失败")
		return
	}
	allMembers, err := s.loadRewardMembersAll(ctx, unionID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取代理层级失败")
		return
	}
	byID := map[string]rewardMember{}
	for _, m := range allMembers {
		byID[m.AgentID] = m
	}
	self, ok := byID[agentID]
	if !ok {
		writeError(w, http.StatusNotFound, "AGENT_NOT_FOUND", "当前联盟名单里没有这个代理，请先同步")
		return
	}
	inList := false
	for _, m := range members {
		if m.AgentID == agentID {
			inList = true
			break
		}
	}
	if !inList {
		writeError(w, http.StatusNotFound, "AGENT_NOT_IN_LIST", "该代理还没加入本次分配名单")
		return
	}

	var ups []rewardMember
	cur := self
	for i := 0; i < 8; i++ {
		parentID := strings.TrimSpace(cur.UpperID)
		if parentID == "" {
			break
		}
		parent, exists := byID[parentID]
		if !exists {
			break
		}
		ups = append([]rewardMember{parent}, ups...)
		cur = parent
	}
	var kids []rewardMember
	for _, m := range allMembers {
		if m.UpperID == self.AgentID {
			kids = append(kids, m)
		}
	}

	perfMap := map[string]*rewardPerf{}
	if pm, err := s.rewardPerformance(ctx, date); err == nil {
		perfMap = pm
	}
	lineCache := map[string]*rewardLine{}
	queryOne := func(m rewardMember) *rewardLine {
		if strings.TrimSpace(m.ClubID) == "" {
			return nil
		}
		if cached, ok := lineCache[m.AgentID]; ok {
			return cached
		}
		line, err := s.queryRewardLine(ctx, m.ClubID, m.AgentID)
		if err != nil {
			return nil
		}
		lineCache[m.AgentID] = line
		return line
	}
	type node struct {
		AgentID  string      `json:"agentId"`
		Name     string      `json:"name"`
		Role     string      `json:"role"`
		Level    int64       `json:"level"`
		ClubID   string      `json:"clubId"`
		Relation string      `json:"relation"`
		Line     *rewardLine `json:"line"`
		Perf     *rewardPerf `json:"perf"`
	}
	nodes := []node{}
	for _, m := range ups {
		nodes = append(nodes, node{AgentID: m.AgentID, Name: m.Name, Role: m.Role, Level: m.Level, ClubID: m.ClubID,
			Relation: "upper", Line: queryOne(m), Perf: perfMap[m.AgentID]})
	}
	nodes = append(nodes, node{AgentID: self.AgentID, Name: self.Name, Role: self.Role, Level: self.Level,
		ClubID: self.ClubID, Relation: "self", Line: queryOne(self), Perf: perfMap[self.AgentID]})
	for _, m := range kids {
		nodes = append(nodes, node{AgentID: m.AgentID, Name: m.Name, Role: m.Role, Level: m.Level, ClubID: m.ClubID,
			Relation: "child", Line: queryOne(m), Perf: perfMap[m.AgentID]})
	}
	writeData(w, http.StatusOK, map[string]any{"agentId": agentID, "nodes": nodes})
}
