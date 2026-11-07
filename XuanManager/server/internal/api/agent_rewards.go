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
//   - 业绩点数取自游戏服「奖池业绩结算报表」，上下级扣减由服务端完成，后台不再二次扣减；
//   - 整条线输赢/贡献取自「代理展示数据」（俱乐部口径），未挂俱乐部的代理明确返回无数据；
//   - 发放复用既有的 exchange 通道，一单一笔、唯一工单、写后回读余额核对。

const (
	rewardKindPerformance = "performance"
	rewardKindCore        = "core"
	rewardKindPool        = "pool"

	rewardPlanDraft    = "draft"
	rewardPlanPaying   = "paying"
	rewardPlanPaid     = "paid"
	rewardPlanPartial  = "partial"
	rewardPayoutPaid   = "paid"
	rewardPayoutFailed = "failed"
	rewardPayoutMiss   = "mismatch"
	rewardPayoutPend   = "pending"
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

type rewardMember struct {
	AgentID    string        `json:"agentId"`
	Name       string        `json:"name"`
	Role       string        `json:"role"`
	Level      int64         `json:"level"`
	UpperID    string        `json:"upperId"`
	ClubID     string        `json:"clubId"`
	ClubName   string        `json:"clubName"`
	UnionID    string        `json:"unionId"`
	UnionName  string        `json:"unionName"`
	Authorized bool          `json:"authorized"`
	Selected   bool          `json:"selected"`
	Source     string        `json:"source"`
	Perf       *rewardPerf   `json:"perf"`
	Line       *rewardLine   `json:"line"`
	Amount     int64         `json:"amount"`
	Splits     []rewardSplit `json:"splits"`
	Subs       []rewardSub   `json:"subs"`
	PaidAmount int64         `json:"paidAmount"`
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
}

type rewardTotals struct {
	Amount   int64   `json:"amount"`
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
}

func validRewardKind(kind string) bool {
	return kind == rewardKindPerformance || kind == rewardKindCore || kind == rewardKindPool
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
	return raw, nil
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
  club_id = IF(source='auto', VALUES(club_id), club_id),
  club_name = IF(source='auto', VALUES(club_name), club_name),
  union_id = IF(source='auto', VALUES(union_id), union_id),
  union_name = IF(source='auto', VALUES(union_name), union_name),
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

// handlerRewardCandidates 候选池：俱乐部在册的全部代理，带 selected 标记，供「批量添加」勾选。
func (s *Server) handlerRewardCandidates(w http.ResponseWriter, r *http.Request, p principal) {
	unionID := strings.TrimSpace(r.URL.Query().Get("unionId"))
	clubID := strings.TrimSpace(r.URL.Query().Get("clubId"))
	keyword := strings.TrimSpace(r.URL.Query().Get("keyword"))

	rows, err := s.db.QueryContext(r.Context(), `SELECT agent_id, name, role, level, club_id, club_name,
union_id, union_name, authorized, selected
FROM mgr_agent_reward_member
WHERE status='active'
  AND (? = '' OR union_id = ?)
  AND (? = '' OR club_id = ?)
ORDER BY FIELD(role,'grand','leader','small_leader','partner','agent'), union_name, club_name, level DESC, id ASC`,
		unionID, unionID, clubID, clubID)
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
		`SELECT COUNT(*) FROM mgr_agent_reward_member WHERE status='active' AND selected=1`).Scan(&selectedCount); err != nil {
		s.logger.Warn("count selected reward members", "error", err)
	}
	if err := s.db.QueryRowContext(r.Context(),
		`SELECT COUNT(*) FROM mgr_agent_reward_member WHERE status='active'`).Scan(&total); err != nil {
		s.logger.Warn("count reward candidates", "error", err)
	}
	writeData(w, http.StatusOK, map[string]any{
		"items": items, "selected": selectedCount, "total": total,
	})
}

// handlerRewardSelect 批量把候选代理加入或移出本次分配名单。
func (s *Server) handlerRewardSelect(w http.ResponseWriter, r *http.Request, p principal) {
	var input struct {
		AgentIDs []string `json:"agentIds"`
		Selected bool     `json:"selected"`
	}
	if !decodeJSON(w, r, &input) {
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
	value := 0
	if input.Selected {
		value = 1
	}
	result, err := s.db.ExecContext(r.Context(),
		`UPDATE mgr_agent_reward_member SET selected = ? WHERE status='active' AND agent_id IN (`+placeholders+`)`,
		append([]any{value}, ids...)...)
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
		map[string]any{"action": action, "count": len(input.AgentIDs)}, nil, map[string]any{"affected": affected},
		0, action, clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"affected": affected, "selected": input.Selected})
}

// handlerRewardLists 列出已保存的名单方案。
func (s *Server) handlerRewardLists(w http.ResponseWriter, r *http.Request, p principal) {
	rows, err := s.db.QueryContext(r.Context(), `SELECT id, name, note, member_count, created_by,
DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i')
FROM mgr_agent_reward_list ORDER BY updated_at DESC, id DESC`)
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
		`SELECT COUNT(*) FROM mgr_agent_reward_member WHERE status='active' AND selected=1`).Scan(&selected)
	writeData(w, http.StatusOK, map[string]any{"items": items, "selected": selected})
}

// handlerRewardListSave 把当前参与名单保存成命名方案；同名覆盖。
func (s *Server) handlerRewardListSave(w http.ResponseWriter, r *http.Request, p principal) {
	var input struct {
		Name string `json:"name"`
		Note string `json:"note"`
	}
	if !decodeJSON(w, r, &input) {
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
		`SELECT agent_id FROM mgr_agent_reward_member WHERE status='active' AND selected=1 ORDER BY id`)
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
		writeError(w, http.StatusBadRequest, "EMPTY_LIST", "当前名单是空的，先加入代理再保存")
		return
	}

	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_FAILED", "保存名单失败")
		return
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(r.Context(), `INSERT INTO mgr_agent_reward_list (name, note, member_count, created_by)
VALUES (?,?,?,?)
ON DUPLICATE KEY UPDATE note = VALUES(note), member_count = VALUES(member_count), created_by = VALUES(created_by)`,
		name, note, len(agentIDs), p.Username); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_FAILED", "保存名单失败")
		return
	}
	var listID int64
	if err := tx.QueryRowContext(r.Context(), `SELECT id FROM mgr_agent_reward_list WHERE name = ?`, name).Scan(&listID); err != nil {
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
		map[string]any{"name": name, "count": len(agentIDs)}, nil, nil, 0, "保存名单方案", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"id": listID, "name": name, "memberCount": len(agentIDs)})
}

// handlerRewardListApply 用某个已保存名单替换当前参与名单。
func (s *Server) handlerRewardListApply(w http.ResponseWriter, r *http.Request, p principal) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	var name string
	if err := s.db.QueryRowContext(r.Context(), `SELECT name FROM mgr_agent_reward_list WHERE id = ?`, id).Scan(&name); err != nil {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "名单不存在")
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_FAILED", "加载名单失败")
		return
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(r.Context(),
		`UPDATE mgr_agent_reward_member SET selected = 0 WHERE status='active' AND selected = 1`); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_FAILED", "加载名单失败")
		return
	}
	result, err := tx.ExecContext(r.Context(), `UPDATE mgr_agent_reward_member m
JOIN mgr_agent_reward_list_member lm ON lm.agent_id = m.agent_id AND lm.list_id = ?
SET m.selected = 1
WHERE m.status = 'active'`, id)
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
		map[string]any{"action": "apply", "name": name}, nil, map[string]any{"affected": affected},
		0, "加载名单方案", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"id": id, "name": name, "selected": affected})
}

// handlerRewardListDelete 删除名单方案（只删模板，不动当前名单）。
func (s *Server) handlerRewardListDelete(w http.ResponseWriter, r *http.Request, p principal) {
	id, ok := parseID(w, r)
	if !ok {
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
		map[string]any{"action": "delete"}, nil, nil, 0, "删除名单方案", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"id": id})
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

// ensureRewardPlan 取或创建当日该类奖励的计划行。
func (s *Server) ensureRewardPlan(ctx context.Context, date, kind, operator string) (int64, string, int64, error) {
	if _, err := s.db.ExecContext(ctx, `INSERT INTO mgr_agent_reward_plan (reward_date, kind, planned_total, status, created_by)
VALUES (?,?,0,'draft',?) ON DUPLICATE KEY UPDATE updated_at = updated_at`, date, kind, operator); err != nil {
		return 0, "", 0, err
	}
	var id, total int64
	var status string
	if err := s.db.QueryRowContext(ctx, `SELECT id, status, planned_total FROM mgr_agent_reward_plan
WHERE reward_date = ? AND kind = ?`, date, kind).Scan(&id, &status, &total); err != nil {
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
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()

	planID, planStatus, planned, err := s.ensureRewardPlan(ctx, date, kind, p.Username)
	if err != nil {
		s.logger.Error("ensure reward plan", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取发放计划失败")
		return
	}

	members, err := s.loadRewardMembers(ctx)
	if err != nil {
		s.logger.Error("load reward members", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取代理名单失败")
		return
	}
	excluded, err := s.loadRewardExcludes(ctx)
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
		Plan:     rewardPlanView{Date: date, Kind: kind, PlannedTotal: planned, Status: planStatus},
		Members:  []rewardMember{},
		Excluded: []rewardExcluded{},
		Warnings: []string{},
	}

	skip := map[string]bool{}
	for _, ex := range excluded {
		if ex.Kind == kind || ex.Kind == "all" {
			skip[ex.AgentID] = true
			overview.Excluded = append(overview.Excluded, ex)
		}
	}

	// 业绩点数 = 俱乐部整条线的今日贡献，按上下级逐级扣减（上级减掉下级那条线），
	// 与需求里"上级 2 点分给下级 1.8 点、上级只剩 0.2"是同一口径。
	lineMap := s.rewardLineData(ctx, members, &overview)
	perfMap := buildRewardPerfFromLines(members, lineMap)

	for _, m := range members {
		if skip[m.AgentID] {
			continue
		}
		m.Perf = perfMap[m.AgentID]
		m.Line = lineMap[m.AgentID]
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
	var poolTotal int64
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM mgr_agent_reward_member WHERE status='active'`).
		Scan(&poolTotal); err == nil {
		overview.Totals.Pool = poolTotal
	}

	if planned == 0 {
		overview.Warnings = append(overview.Warnings, "尚未设置计划发放总额，先填写总额再分配")
	}
	if len(overview.Members) == 0 {
		overview.Warnings = append(overview.Warnings,
			"本次分配名单为空：点右上「批量添加」，按联盟或俱乐部勾选要发奖励的代理。")
	}
	if kind == rewardKindPerformance {
		var totalNet float64
		for _, perf := range perfMap {
			totalNet += perf.Net
		}
		if totalNet <= 0 {
			overview.Warnings = append(overview.Warnings,
				"今天所有代理的整条线贡献都是 0（当天没有产生贡献或线数据未加载），业绩奖励无法按点数分摊")
		}
	}
	writeData(w, http.StatusOK, overview)
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

func (s *Server) loadRewardMembers(ctx context.Context) ([]rewardMember, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT agent_id, name, role, level, upper_id, club_id, club_name, union_id, union_name, authorized, selected, source
FROM mgr_agent_reward_member WHERE status='active' AND selected=1 ORDER BY level DESC, id ASC`)
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

func (s *Server) loadRewardExcludes(ctx context.Context) ([]rewardExcluded, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT e.agent_id, COALESCE(m.name,''), e.kind, e.reason, e.operator,
DATE_FORMAT(e.created_at, '%Y-%m-%d %H:%i')
FROM mgr_agent_reward_exclude e
LEFT JOIN mgr_agent_reward_member m ON m.agent_id = e.agent_id
ORDER BY e.id DESC`)
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
WHERE plan_id = ? AND status IN ('paid','mismatch','pending') GROUP BY agent_id`, planID)
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
	missing := len(members) - len(result)
	if missing > 0 {
		overview.Warnings = append(overview.Warnings,
			fmt.Sprintf("%d 个代理没有俱乐部线数据（未挂俱乐部或代理树未加载），对应行显示「无数据」", missing))
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
		Date         string `json:"date"`
		Kind         string `json:"kind"`
		PlannedTotal int64  `json:"plannedTotal"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Kind = strings.ToLower(strings.TrimSpace(input.Kind))
	if !validRewardKind(input.Kind) {
		writeError(w, http.StatusBadRequest, "INVALID_KIND", "奖励类型不正确")
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
	planID, status, before, err := s.ensureRewardPlan(r.Context(), date, input.Kind, p.Username)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取发放计划失败")
		return
	}
	if status == rewardPlanPaid || status == rewardPlanPaying {
		writeError(w, http.StatusConflict, "PLAN_LOCKED", "该批次已发放或发放中，不能修改总额")
		return
	}
	if _, err := s.db.ExecContext(r.Context(), `UPDATE mgr_agent_reward_plan SET planned_total = ?, status='draft'
WHERE id = ?`, input.PlannedTotal, planID); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_FAILED", "保存发放总额失败")
		return
	}
	s.audit(r.Context(), &p, "game.agent_reward.edit", "agent_reward_plan", strconv.FormatInt(planID, 10),
		map[string]any{"plannedTotal": input.PlannedTotal, "kind": input.Kind, "date": date},
		map[string]any{"plannedTotal": before}, map[string]any{"plannedTotal": input.PlannedTotal},
		0, "设置计划发放总额", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"plannedTotal": input.PlannedTotal})
}

type rewardAmountInput struct {
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
	planID, status, planned, err := s.ensureRewardPlan(r.Context(), date, input.Kind, p.Username)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取发放计划失败")
		return
	}
	if status == rewardPlanPaid || status == rewardPlanPaying {
		writeError(w, http.StatusConflict, "PLAN_LOCKED", "该批次已发放或发放中，不能修改金额")
		return
	}

	names := map[string]string{}
	rows, err := s.db.QueryContext(r.Context(), `SELECT agent_id, name FROM mgr_agent_reward_member`)
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
		map[string]any{"kind": input.Kind, "date": date, "count": len(input.Amounts), "sum": sum},
		nil, map[string]any{"sum": sum, "planned": planned}, 0, "保存分配金额", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"sum": sum, "planned": planned, "diff": planned - sum})
}

// handlerRewardAllocate 按规则自动分摊：业绩按净点数、核心按上次金额、奖池共享按今日输赢正向部分。
func (s *Server) handlerRewardAllocate(w http.ResponseWriter, r *http.Request, p principal) {
	var input struct {
		Date string `json:"date"`
		Kind string `json:"kind"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Kind = strings.ToLower(strings.TrimSpace(input.Kind))
	if !validRewardKind(input.Kind) {
		writeError(w, http.StatusBadRequest, "INVALID_KIND", "奖励类型不正确")
		return
	}
	date, err := rewardDate(input.Date, time.Now())
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_DATE", err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()

	planID, status, planned, err := s.ensureRewardPlan(ctx, date, input.Kind, p.Username)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取发放计划失败")
		return
	}
	if status == rewardPlanPaid || status == rewardPlanPaying {
		writeError(w, http.StatusConflict, "PLAN_LOCKED", "该批次已发放或发放中，不能重新分摊")
		return
	}
	if planned <= 0 {
		writeError(w, http.StatusBadRequest, "NO_PLAN", "请先设置计划发放总额")
		return
	}

	members, err := s.loadRewardMembers(ctx)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取代理名单失败")
		return
	}
	excluded, _ := s.loadRewardExcludes(ctx)
	skip := map[string]bool{}
	for _, ex := range excluded {
		if ex.Kind == input.Kind || ex.Kind == "all" {
			skip[ex.AgentID] = true
		}
	}

	weights := map[string]float64{}
	overview := rewardOverview{Warnings: []string{}}
	switch input.Kind {
	case rewardKindPerformance:
		lineMap := s.rewardLineData(ctx, members, &overview)
		perfMap := buildRewardPerfFromLines(members, lineMap)
		for _, m := range members {
			if skip[m.AgentID] {
				continue
			}
			if perf, ok := perfMap[m.AgentID]; ok && perf.Net > 0 {
				weights[m.AgentID] = perf.Net
			}
		}
	case rewardKindPool:
		lineMap := s.rewardLineData(ctx, members, &overview)
		for _, m := range members {
			if skip[m.AgentID] {
				continue
			}
			if line, ok := lineMap[m.AgentID]; ok && line.TodayScore > 0 {
				weights[m.AgentID] = float64(line.TodayScore)
			}
		}
	case rewardKindCore:
		last, err := s.lastRewardAmounts(ctx, input.Kind)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取上次金额失败")
			return
		}
		for _, m := range members {
			if skip[m.AgentID] {
				continue
			}
			if amount, ok := last[m.AgentID]; ok && amount > 0 {
				weights[m.AgentID] = float64(amount)
			}
		}
	}

	var totalWeight float64
	for _, weight := range weights {
		totalWeight += weight
	}
	if totalWeight <= 0 {
		message := map[string]string{
			rewardKindPerformance: "当天所有代理业绩点数都是 0，无法按点数分摊",
			rewardKindPool:        "当天所有代理的整条线今日输赢都不是正数，无法按输赢分摊",
			rewardKindCore:        "没有可参考的上次金额，请手动填写",
		}[input.Kind]
		writeError(w, http.StatusBadRequest, "NO_WEIGHT", message)
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
		map[string]any{"action": "allocate", "kind": input.Kind, "date": date, "planned": planned},
		nil, map[string]any{"count": len(allocated)}, 0, "按规则自动分摊", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"count": len(allocated), "total": planned})
}

// buildRewardPerfFromLines 用俱乐部整条线的今日贡献算出每个代理的业绩点数：
//   - 毛（My）  = 该代理整条线的今日贡献（含自己和所有下线）；
//   - 下发（Granted） = 直接下级的整条线今日贡献之和；
//   - 净（Net） = 毛 − 下发，即该代理这一层真正"剩下"的点数。
//
// 这样上下级不会重复计算：每个下线只会从自己的直接上级那里被扣掉一次，
// 更下一层的贡献已经包含在直接下级的整条线里，不会重复扣。
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

// lastRewardAmounts 取上一次已发放批次里每个代理的金额，作为核心奖励的参考值。
func (s *Server) lastRewardAmounts(ctx context.Context, kind string) (map[string]int64, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT i.agent_id, i.final_amount
FROM mgr_agent_reward_item i
JOIN mgr_agent_reward_plan p ON p.id = i.plan_id
WHERE p.kind = ? AND p.status = 'paid' AND p.id = (
  SELECT MAX(id) FROM mgr_agent_reward_plan WHERE kind = ? AND status = 'paid'
)`, kind, kind)
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

// handlerRewardMemberAdd 手工把某个游戏账号加进奖励名单（source=manual，同步时不会被删）。
func (s *Server) handlerRewardMemberAdd(w http.ResponseWriter, r *http.Request, p principal) {
	var input struct {
		AgentID string `json:"agentId"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	agentID := strings.TrimSpace(input.AgentID)
	if !validAgentID(agentID) {
		writeError(w, http.StatusBadRequest, "INVALID_AGENT_ID", "代理 ID 不正确")
		return
	}
	var name, roleText, upper string
	var level int64
	var isLeader, isPartner, isChief bool
	err := s.db.QueryRowContext(r.Context(), `SELECT COALESCE(a.sm_name,''), COALESCE(a.sm_role,''), COALESCE(a.sm_level,0),
COALESCE(NULLIF(m.upper_guuid,''), NULLIF(a.sm_agentID,''), ''),
(a.sm_bigAgentID = a.sm_guuid), (a.sm_supperAgentID = a.sm_guuid), (a.sm_chiefAgentID = a.sm_guuid)
FROM kbedm.tbl_Account a
LEFT JOIN kbedm.third_marketing_info m ON m.player_guuid = a.sm_guuid
WHERE a.sm_guuid = ? ORDER BY m.id DESC LIMIT 1`, agentID).
		Scan(&name, &roleText, &level, &upper, &isLeader, &isPartner, &isChief)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "PLAYER_NOT_FOUND", "没有找到这个游戏账号")
		return
	}
	if err != nil {
		s.logger.Error("query player for reward member", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "查询玩家失败")
		return
	}
	var club, clubName, unionID, unionName string
	if err := s.db.QueryRowContext(r.Context(), `SELECT ca.club_guuid, COALESCE(c.club_name,''), COALESCE(c.union_id,''),
COALESCE(u.union_name,'')
FROM kbedm.club_agent_info ca
LEFT JOIN kbedm.club_guuid_info c ON c.club_guuid = ca.club_guuid
LEFT JOIN kbedm.club_union_info u ON u.union_id = c.union_id AND u.status='used'
WHERE ca.user_guuid = ? AND ca.status='used' ORDER BY ca.id DESC LIMIT 1`, agentID).
		Scan(&club, &clubName, &unionID, &unionName); err != nil {
		club, clubName, unionID, unionName = "", "", "", ""
	}
	if _, err := s.db.ExecContext(r.Context(), `INSERT INTO mgr_agent_reward_member
(agent_id, name, role, level, upper_id, club_id, club_name, union_id, union_name, authorized, source, status)
VALUES (?,?,?,?,?,?,?,?,?,0,'manual','active')
ON DUPLICATE KEY UPDATE name = VALUES(name), role = VALUES(role), level = VALUES(level),
  upper_id = VALUES(upper_id), club_id = VALUES(club_id), club_name = VALUES(club_name),
  union_id = VALUES(union_id), union_name = VALUES(union_name), status = 'active'`,
		agentID, name, classifyClubRewardRole(roleText, false, 0, level), level, upper,
		strings.TrimSpace(club), strings.TrimSpace(clubName), strings.TrimSpace(unionID), strings.TrimSpace(unionName)); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_FAILED", "加入名单失败")
		return
	}
	s.audit(r.Context(), &p, "game.agent_reward.edit", "agent_reward_member", agentID,
		map[string]any{"action": "manual_add"}, nil, map[string]any{"name": name}, 0, "手工加入奖励名单", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"agentId": agentID, "name": name})
}

func (s *Server) handlerRewardExclude(w http.ResponseWriter, r *http.Request, p principal) {
	var input struct {
		AgentID string `json:"agentId"`
		Kind    string `json:"kind"`
		Reason  string `json:"reason"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	input.AgentID = strings.TrimSpace(input.AgentID)
	input.Kind = strings.ToLower(strings.TrimSpace(input.Kind))
	input.Reason = strings.TrimSpace(input.Reason)
	if !validAgentID(input.AgentID) {
		writeError(w, http.StatusBadRequest, "INVALID_AGENT_ID", "代理 ID 不正确")
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
	// 同步清掉未发放的分配金额，避免排除后仍被带进发放。
	if _, err := s.db.ExecContext(r.Context(), `UPDATE mgr_agent_reward_item i
JOIN mgr_agent_reward_plan p ON p.id = i.plan_id
SET i.final_amount = 0, i.auto_amount = 0
WHERE i.agent_id = ? AND p.status = 'draft' AND (p.kind = ? OR ? = 'all')`,
		input.AgentID, input.Kind, input.Kind); err != nil {
		s.logger.Warn("clear excluded amount", "error", err)
	}
	s.audit(r.Context(), &p, "game.agent_reward.edit", "agent_reward_exclude", input.AgentID,
		map[string]any{"kind": input.Kind, "reason": input.Reason}, nil, nil, 0, "排除代理奖励", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"agentId": input.AgentID, "kind": input.Kind})
}

func (s *Server) handlerRewardExcludeRemove(w http.ResponseWriter, r *http.Request, p principal) {
	agentID := strings.TrimSpace(r.PathValue("agentId"))
	if !validAgentID(agentID) {
		writeError(w, http.StatusBadRequest, "INVALID_AGENT_ID", "代理 ID 不正确")
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
		map[string]any{"kind": kind, "action": "restore"}, nil, nil, 0, "恢复代理奖励", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"agentId": agentID})
}

func (s *Server) handlerRewardSubAdd(w http.ResponseWriter, r *http.Request, p principal) {
	var input struct {
		AgentID  string `json:"agentId"`
		SubGuuid string `json:"subGuuid"`
		Note     string `json:"note"`
	}
	if !decodeJSON(w, r, &input) {
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
		map[string]any{"subGuuid": input.SubGuuid}, nil, map[string]any{"name": name}, 0, "绑定发放子账号", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"agentId": input.AgentID, "subId": input.SubGuuid, "subName": name})
}

func (s *Server) handlerRewardSubRemove(w http.ResponseWriter, r *http.Request, p principal) {
	agentID := strings.TrimSpace(r.PathValue("agentId"))
	subID := strings.TrimSpace(r.PathValue("subId"))
	if !validAgentID(agentID) || !validAgentID(subID) {
		writeError(w, http.StatusBadRequest, "INVALID_AGENT_ID", "参数不正确")
		return
	}
	if _, err := s.db.ExecContext(r.Context(), `UPDATE mgr_agent_reward_sub_account SET status='disabled'
WHERE agent_id = ? AND sub_guuid = ?`, agentID, subID); err != nil {
		writeError(w, http.StatusInternalServerError, "UPDATE_FAILED", "解绑失败")
		return
	}
	s.audit(r.Context(), &p, "game.agent_reward.configure", "agent_reward_sub", agentID,
		map[string]any{"subGuuid": subID, "action": "unbind"}, nil, nil, 0, "解绑发放子账号", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"agentId": agentID})
}

/* ---------------- 发放 ---------------- */

type rewardPayResult struct {
	Total   int64    `json:"total"`
	Paid    int64    `json:"paid"`
	Failed  int64    `json:"failed"`
	Skipped int64    `json:"skipped"`
	Status  string   `json:"status"`
	Orders  []string `json:"orders"`
	Errors  []string `json:"errors"`
}

func (s *Server) handlerRewardPay(w http.ResponseWriter, r *http.Request, p principal) {
	var input struct {
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
	if !input.Confirm {
		writeError(w, http.StatusBadRequest, "CONFIRM_REQUIRED", "请确认本次会真实发放金币")
		return
	}
	date, err := rewardDate(input.Date, time.Now())
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_DATE", err.Error())
		return
	}
	if s.cfg.GameExchangeSign == "" {
		writeError(w, http.StatusServiceUnavailable, "PAY_DISABLED", "游戏发钱通道未配置，无法发放")
		return
	}

	rewardPayoutMu.Lock()
	defer rewardPayoutMu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Minute)
	defer cancel()

	planID, status, planned, err := s.ensureRewardPlan(ctx, date, input.Kind, p.Username)
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

	type target struct {
		itemID int64
		agent  string
		name   string
		amount int64
		splits []rewardSplit
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, agent_id, agent_name, final_amount, COALESCE(split_json,'')
FROM mgr_agent_reward_item WHERE plan_id = ? AND final_amount > 0 ORDER BY id`, planID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取分配明细失败")
		return
	}
	var targets []target
	var expected int64
	for rows.Next() {
		var t target
		var raw string
		if err := rows.Scan(&t.itemID, &t.agent, &t.name, &t.amount, &raw); err != nil {
			rows.Close()
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取分配明细失败")
			return
		}
		if strings.TrimSpace(raw) != "" {
			_ = json.Unmarshal([]byte(raw), &t.splits)
		}
		targets = append(targets, t)
		expected += t.amount
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

	// 已成功发放过的账号不再重复发，防止重复点击/重复请求造成双发。
	paidRows, err := s.db.QueryContext(ctx, `SELECT payee_guuid FROM mgr_agent_reward_payout
WHERE plan_id = ? AND status IN ('paid','mismatch')`, planID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取发放记录失败")
		return
	}
	alreadyPaid := map[string]bool{}
	for paidRows.Next() {
		var payee string
		if err := paidRows.Scan(&payee); err == nil {
			alreadyPaid[payee] = true
		}
	}
	paidRows.Close()

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

	result := rewardPayResult{Total: expected, Orders: []string{}, Errors: []string{}}
	for _, t := range targets {
		payees := t.splits
		if len(payees) == 0 {
			payees = []rewardSplit{{Payee: t.agent, Type: "main", Amount: t.amount}}
		}
		for _, split := range payees {
			if split.Amount <= 0 {
				continue
			}
			payee := strings.TrimSpace(split.Payee)
			if alreadyPaid[payee] {
				result.Skipped++
				continue
			}
			seq++
			order := fmt.Sprintf("JL%s%s%05d", dateCode, codes[input.Kind], seq)
			before, _ := s.readPlayerBalanceState(ctx, payee)
			if _, err := s.db.ExecContext(ctx, `INSERT INTO mgr_agent_reward_payout
(plan_id, item_id, agent_id, payee_guuid, payee_type, amount, work_order, status, balance_before)
VALUES (?,?,?,?,?,?,?,'pending',?)`,
				planID, t.itemID, t.agent, payee, split.Type, split.Amount, order, int64(before.Balance)); err != nil {
				result.Errors = append(result.Errors, fmt.Sprintf("%s：创建发放单失败", payee))
				result.Failed++
				continue
			}
			if err := s.callBalanceExchange(ctx, payee, split.Amount, order); err != nil {
				result.Failed++
				result.Errors = append(result.Errors, fmt.Sprintf("%s（%s）：%v", payee, order, err))
				_, _ = s.db.ExecContext(ctx, `UPDATE mgr_agent_reward_payout SET status='failed', error_message=?
WHERE work_order = ?`, truncate(err.Error(), 240), order)
				continue
			}
			result.Paid++
			result.Orders = append(result.Orders, order)
			alreadyPaid[payee] = true
		}
	}

	// 逐笔回读余额核对：账号金币必须正好增加发放金额。
	if len(result.Orders) > 0 {
		time.Sleep(600 * time.Millisecond)
	}
	afterRows, err := s.db.QueryContext(ctx, `SELECT id, payee_guuid, amount, work_order, balance_before
FROM mgr_agent_reward_payout WHERE plan_id = ? AND status='pending'`, planID)
	if err == nil {
		type pending struct {
			id     int64
			payee  string
			amount int64
			order  string
			before int64
		}
		var list []pending
		for afterRows.Next() {
			var item pending
			if err := afterRows.Scan(&item.id, &item.payee, &item.amount, &item.order, &item.before); err == nil {
				list = append(list, item)
			}
		}
		afterRows.Close()
		for _, item := range list {
			state, err := s.readPlayerBalanceState(ctx, item.payee)
			if err != nil {
				_, _ = s.db.ExecContext(ctx, `UPDATE mgr_agent_reward_payout SET status='mismatch',
error_message='发放后读取余额失败' WHERE id = ?`, item.id)
				continue
			}
			after := int64(state.Balance)
			if after-item.before == item.amount {
				_, _ = s.db.ExecContext(ctx, `UPDATE mgr_agent_reward_payout SET status='paid', ret_code=512,
balance_after=?, paid_at=NOW() WHERE id = ?`, after, item.id)
			} else {
				_, _ = s.db.ExecContext(ctx, `UPDATE mgr_agent_reward_payout SET status='mismatch', ret_code=512,
balance_after=?, error_message=? WHERE id = ?`,
					after, truncate(fmt.Sprintf("余额未按预期增加：前 %d，后 %d，应加 %d", item.before, after, item.amount), 240), item.id)
			}
		}
	}

	finalStatus := rewardPlanPaid
	var mismatch, failed int
	if err := s.db.QueryRowContext(ctx, `SELECT
COALESCE(SUM(status='mismatch'),0), COALESCE(SUM(status='failed'),0)
FROM mgr_agent_reward_payout WHERE plan_id = ?`, planID).Scan(&mismatch, &failed); err != nil {
		s.logger.Warn("summarize reward payouts", "error", err)
	}
	if mismatch > 0 || failed > 0 {
		finalStatus = rewardPlanPartial
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE mgr_agent_reward_plan SET status=? WHERE id = ?`, finalStatus, planID); err != nil {
		s.logger.Warn("update reward plan status", "error", err)
	}
	result.Status = finalStatus

	s.audit(ctx, &p, "game.agent_reward.pay", "agent_reward_plan", strconv.FormatInt(planID, 10),
		map[string]any{"kind": input.Kind, "date": date, "planned": planned, "expected": expected},
		nil, map[string]any{"paid": result.Paid, "failed": result.Failed, "skipped": result.Skipped, "status": finalStatus},
		0, "发放代理奖励", clientIP(r))
	writeData(w, http.StatusOK, result)
}

/* ---------------- 账单 ---------------- */

type rewardLedgerRow struct {
	ID        int64  `json:"id"`
	Date      string `json:"date"`
	Kind      string `json:"kind"`
	AgentID   string `json:"agentId"`
	AgentName string `json:"agentName"`
	Payee     string `json:"payee"`
	PayeeType string `json:"payeeType"`
	Amount    int64  `json:"amount"`
	Order     string `json:"order"`
	Status    string `json:"status"`
	Error     string `json:"error"`
	PaidAt    string `json:"paidAt"`
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
	rows, err := s.db.QueryContext(r.Context(), `SELECT p.id, DATE_FORMAT(pl.reward_date,'%Y-%m-%d'), pl.kind,
p.agent_id, i.agent_name, p.payee_guuid, p.payee_type, p.amount, p.work_order, p.status,
p.error_message, COALESCE(DATE_FORMAT(p.paid_at,'%Y-%m-%d %H:%i'),'')
FROM mgr_agent_reward_payout p
JOIN mgr_agent_reward_plan pl ON pl.id = p.plan_id
LEFT JOIN mgr_agent_reward_item i ON i.id = p.item_id
WHERE pl.reward_date BETWEEN ? AND ?
ORDER BY pl.reward_date DESC, p.id DESC
LIMIT 5000`, from, to)
	if err != nil {
		s.logger.Error("query reward ledger", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取账单失败")
		return
	}
	defer rows.Close()
	list := []rewardLedgerRow{}
	var total, performance, core, pool int64
	for rows.Next() {
		var row rewardLedgerRow
		if err := rows.Scan(&row.ID, &row.Date, &row.Kind, &row.AgentID, &row.AgentName, &row.Payee,
			&row.PayeeType, &row.Amount, &row.Order, &row.Status, &row.Error, &row.PaidAt); err != nil {
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "解析账单失败")
			return
		}
		if row.Status == "paid" {
			total += row.Amount
			switch row.Kind {
			case rewardKindPerformance:
				performance += row.Amount
			case rewardKindCore:
				core += row.Amount
			case rewardKindPool:
				pool += row.Amount
			}
		}
		list = append(list, row)
	}
	writeData(w, http.StatusOK, map[string]any{
		"items": list, "from": from, "to": to,
		"summary": map[string]int64{"total": total, "performance": performance, "core": core, "pool": pool},
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
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	members, err := s.loadRewardMembers(ctx)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取代理名单失败")
		return
	}
	byID := map[string]rewardMember{}
	for _, m := range members {
		byID[m.AgentID] = m
	}
	self, ok := byID[agentID]
	if !ok {
		writeError(w, http.StatusNotFound, "AGENT_NOT_FOUND", "名单里没有这个代理，请先同步")
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
	for _, m := range members {
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
