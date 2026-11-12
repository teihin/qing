package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"
)

// 后台「业绩股」总览：按联盟查看整个代理树的业绩股开通状态与业绩比例。
//
// 数据来源：
//   - 代理树/上级关系：游戏库 kbedm.club_agent_info（status='used'）；
//   - 联盟/俱乐部/创建者：kbedm.club_union_info、kbedm.club_guuid_info；
//   - 开通状态与次数：游戏服命令「异步_查询_俱乐部_业绩_报表」（union_id 视角，
//     只返回已开通代理；未命中的树节点即未开通）。
//
// 报表不含 club_id，只有俱乐部名，因此按 (guuid, club_name) 匹配；匹配不到时退回
// guuid 唯一命中，再不行就挂到对应俱乐部盟主下，避免已开通代理丢失。

type clubPerfUnionOption struct {
	UnionID   string `json:"unionId"`
	UnionName string `json:"unionName"`
	OwnerID   string `json:"ownerId"`
	OwnerName string `json:"ownerName"`
	ClubCount int    `json:"clubCount"`
}

type clubPerfNode struct {
	Key          string          `json:"key"`
	PlayerID     string          `json:"playerId"`
	Name         string          `json:"name"`
	Role         string          `json:"role"`
	ClubID       string          `json:"clubId"`
	ClubName     string          `json:"clubName"`
	UnionID      string          `json:"unionId"`
	UnionName    string          `json:"unionName"`
	ParentID     string          `json:"parentId"`
	Enabled      bool            `json:"enabled"`
	IsLeader     bool            `json:"isLeader"`
	IsUnionOwner bool            `json:"isUnionOwner"`
	My           int64           `json:"my"`
	Granted      int64           `json:"granted"`
	Left         int64           `json:"left"`
	Percent      string          `json:"percent"`
	Children     []*clubPerfNode `json:"children"`
}

type clubPerfOverview struct {
	Union        clubPerfUnionOption `json:"union"`
	Date         string              `json:"date"`
	AllCount     int64               `json:"allCount"`
	TotalCount   int                 `json:"totalCount"`
	EnabledCount int                 `json:"enabledCount"`
	Tree         []*clubPerfNode     `json:"tree"`
}

type clubPerfClub struct {
	ID, Name, CreatorID, CreatorName string
}

type clubPerfAgent struct {
	ID, Name, ClubID, ClubName, Upper string
	IsOwner, IsAgent                  bool
}

type clubPerfReportRow struct {
	ID, Name, Role, ClubName, Percent string
	My, Granted, Left                 int64
}

type clubPerfBuild struct {
	club    *clubPerfClub
	leader  *clubPerfNode
	nodes   map[string]*clubPerfNode
	parents map[string]string
	order   []string
}

func (s *Server) handleClubPerfUnions(w http.ResponseWriter, r *http.Request, p principal) {
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	rows, err := s.db.QueryContext(ctx, `SELECT cu.union_id, COALESCE(cu.union_name,''),
COALESCE(cu.owner_guuid,''), COALESCE(cu.owner_name,''),
COALESCE((SELECT COUNT(*) FROM kbedm.club_guuid_info c
          WHERE c.union_id = cu.union_id AND c.club_status NOT IN ('init','del')), 0)
FROM kbedm.club_union_info cu
WHERE cu.status <> 'init'
ORDER BY cu.id DESC`)
	if err != nil {
		s.logger.Error("list club perf unions", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取联盟列表失败")
		return
	}
	defer rows.Close()
	items := make([]clubPerfUnionOption, 0, 32)
	for rows.Next() {
		var item clubPerfUnionOption
		if err := rows.Scan(&item.UnionID, &item.UnionName, &item.OwnerID, &item.OwnerName, &item.ClubCount); err != nil {
			s.logger.Error("scan club perf union", "error", err)
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "解析联盟列表失败")
			return
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取联盟列表失败")
		return
	}
	writeData(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleClubPerfOverview(w http.ResponseWriter, r *http.Request, p principal) {
	unionID := strings.TrimSpace(r.URL.Query().Get("union_id"))
	if unionID == "" {
		writeError(w, http.StatusBadRequest, "INVALID_UNION", "请选择联盟")
		return
	}
	dateRaw := strings.TrimSpace(r.URL.Query().Get("date"))
	if dateRaw == "" {
		dateRaw = time.Now().In(dashboardLocation).AddDate(0, 0, -1).Format("2006-01-02")
	}
	date, err := rewardDate(dateRaw, time.Now())
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_DATE", err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()

	unionInfo := clubPerfUnionOption{UnionID: unionID}
	var ownerClubID string
	err = s.db.QueryRowContext(ctx, `SELECT COALESCE(union_name,''), COALESCE(owner_guuid,''),
COALESCE(owner_name,''), COALESCE(club_guuid,'')
FROM kbedm.club_union_info WHERE union_id = ? AND status <> 'init'`, unionID).
		Scan(&unionInfo.UnionName, &unionInfo.OwnerID, &unionInfo.OwnerName, &ownerClubID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "UNION_NOT_FOUND", "联盟不存在")
		return
	}
	if err != nil {
		s.logger.Error("load club perf union", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取联盟信息失败")
		return
	}

	clubs, clubOrder, err := s.clubPerfClubs(ctx, unionID)
	if err != nil {
		s.logger.Error("list club perf clubs", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取联盟俱乐部失败")
		return
	}
	agents, err := s.clubPerfAgents(ctx, unionID)
	if err != nil {
		s.logger.Error("list club perf agents", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取俱乐部代理树失败")
		return
	}

	reportDate, allCount, reportRows, err := s.clubPerfReport(ctx, unionID, date)
	if err != nil {
		s.logger.Error("load club perf report", "error", err, "union_id", unionID)
		writeError(w, http.StatusBadGateway, "GAME_COMMAND_FAILED", "读取业绩报表失败："+err.Error())
		return
	}
	if reportDate == "" {
		reportDate = date
	}

	root, totalCount, enabledCount := buildClubPerfTree(unionInfo, ownerClubID, clubs, clubOrder, agents, reportRows, allCount)
	unionInfo.ClubCount = len(clubOrder)
	writeData(w, http.StatusOK, clubPerfOverview{
		Union:        unionInfo,
		Date:         reportDate,
		AllCount:     allCount,
		TotalCount:   totalCount,
		EnabledCount: enabledCount,
		Tree:         []*clubPerfNode{root},
	})
}

type clubPerfCandidate struct {
	PlayerID  string `json:"playerId"`
	Name      string `json:"name"`
	Role      string `json:"role"`
	ClubID    string `json:"clubId"`
	ClubName  string `json:"clubName"`
	UnionID   string `json:"unionId"`
	UnionName string `json:"unionName"`
	IsLeader  bool   `json:"isLeader"`
	Enabled   bool   `json:"enabled"`
}

// handleClubPerfCandidates 返回当前联盟的全部代理（含未开通），供后台下拉选择。
func (s *Server) handleClubPerfCandidates(w http.ResponseWriter, r *http.Request, p principal) {
	unionID := strings.TrimSpace(r.URL.Query().Get("union_id"))
	if unionID == "" {
		writeError(w, http.StatusBadRequest, "INVALID_UNION", "请选择联盟")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	rows, err := s.gameDB.QueryContext(ctx, `SELECT ca.user_guuid,
COALESCE(NULLIF(ca.user_name,''), a.sm_name, ''),
ca.club_guuid, COALESCE(c.club_name,''),
COALESCE(c.union_id,''), COALESCE(u.union_name,''),
(c.account_id = a.id)
FROM kbedm.club_agent_info ca
JOIN kbedm.tbl_Account a ON a.sm_guuid = ca.user_guuid
JOIN kbedm.club_guuid_info c ON c.club_guuid = ca.club_guuid
LEFT JOIN kbedm.club_union_info u ON u.union_id = c.union_id AND u.status='used'
WHERE ca.status = 'used' AND c.union_id = ? AND c.club_status NOT IN ('init','del')
  AND ((c.account_id = a.id) OR EXISTS(
        SELECT 1 FROM kbedm.club_invite_code_info ic
        WHERE ic.club_guuid = ca.club_guuid AND ic.user_guuid = ca.user_guuid AND ic.status = 'used'))
ORDER BY (c.account_id = a.id) DESC, ca.id`, unionID)
	if err != nil {
		s.logger.Error("list club perf candidates", "error", err, "union_id", unionID)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取联盟成员失败")
		return
	}
	defer rows.Close()
	seen := map[string]bool{}
	items := make([]clubPerfCandidate, 0, 128)
	for rows.Next() {
		var item clubPerfCandidate
		if err := rows.Scan(&item.PlayerID, &item.Name, &item.ClubID, &item.ClubName,
			&item.UnionID, &item.UnionName, &item.IsLeader); err != nil {
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "解析联盟成员失败")
			return
		}
		if item.PlayerID == "" || seen[item.PlayerID] {
			continue
		}
		seen[item.PlayerID] = true
		item.UnionID = unionID
		item.Role = "合伙人"
		if item.IsLeader {
			item.Role = "盟主"
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取联盟成员失败")
		return
	}
	var ownerID, unionName string
	if err := s.db.QueryRowContext(ctx, `SELECT COALESCE(owner_guuid,''), COALESCE(union_name,'')
FROM kbedm.club_union_info WHERE union_id = ? AND status <> 'init'`, unionID).Scan(&ownerID, &unionName); err == nil {
		for i := range items {
			if items[i].UnionName == "" {
				items[i].UnionName = unionName
			}
			if items[i].PlayerID == ownerID {
				items[i].Role = "大盟主"
			}
		}
	}
	enabled := s.clubPerfEnabledSet(ctx, unionID)
	available := make([]clubPerfCandidate, 0, len(items))
	for i := range items {
		items[i].Enabled = items[i].PlayerID == ownerID || enabled[items[i].PlayerID]
		// 已开通的不再出现在「新增开通人员」列表里。
		if !items[i].Enabled {
			available = append(available, items[i])
		}
	}
	items = available
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].IsLeader != items[j].IsLeader {
			return items[i].IsLeader
		}
		if items[i].Name != items[j].Name {
			return items[i].Name < items[j].Name
		}
		return items[i].PlayerID < items[j].PlayerID
	})
	writeData(w, http.StatusOK, map[string]any{"items": items})
}

// clubPerfEnabledSet 返回该联盟已开通业绩股的 guuid 集合（俱乐部级 + 联盟层）。
func (s *Server) clubPerfEnabledSet(ctx context.Context, unionID string) map[string]bool {
	result := map[string]bool{}
	rows, err := s.gameDB.QueryContext(ctx, `SELECT DISTINCT g.user_guuid
FROM kbedm.club_perf_grant_info g
JOIN kbedm.club_guuid_info c ON c.club_guuid = g.club_guuid
WHERE c.union_id = ? AND g.status = 'used'`, unionID)
	if err != nil {
		s.logger.Warn("read club perf enabled set", "error", err, "union_id", unionID)
	} else {
		for rows.Next() {
			var id string
			if rows.Scan(&id) == nil && id != "" {
				result[id] = true
			}
		}
		rows.Close()
	}
	rows, err = s.gameDB.QueryContext(ctx, `SELECT DISTINCT leader_guuid
FROM kbedm.club_perf_union_grant_info WHERE union_id = ? AND status = 'used'`, unionID)
	if err != nil {
		s.logger.Warn("read club perf union enabled set", "error", err, "union_id", unionID)
	} else {
		for rows.Next() {
			var id string
			if rows.Scan(&id) == nil && id != "" {
				result[id] = true
			}
		}
		rows.Close()
	}
	return result
}

type clubPerfPlayer struct {
	PlayerID  string `json:"playerId"`
	Name      string `json:"name"`
	Role      string `json:"role"`
	ClubID    string `json:"clubId"`
	ClubName  string `json:"clubName"`
	UnionID   string `json:"unionId"`
	UnionName string `json:"unionName"`
	IsLeader  bool   `json:"isLeader"`
	IsAgent   bool   `json:"isAgent"`
	Enabled   bool   `json:"enabled"`
	Eligible  bool   `json:"eligible"`
}

// handleClubPerfPlayer 核对联盟内的目标玩家，供后台「新增开通人员」弹窗使用。
func (s *Server) handleClubPerfPlayer(w http.ResponseWriter, r *http.Request, p principal) {
	unionID := strings.TrimSpace(r.URL.Query().Get("union_id"))
	playerID := strings.TrimSpace(r.URL.Query().Get("player_id"))
	if unionID == "" || playerID == "" {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "请选择联盟并输入玩家ID")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	player, err := s.clubPerfLookupPlayer(ctx, unionID, playerID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "PLAYER_NOT_FOUND", "该玩家不在本联盟代理树中")
		return
	}
	if err != nil {
		s.logger.Error("lookup club perf player", "error", err, "union_id", unionID, "player_id", playerID)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "核对玩家失败")
		return
	}
	writeData(w, http.StatusOK, player)
}

// handleClubPerfGrant 只做「开通」，不提供取消；与客户端一致走 enabled=1。
func (s *Server) handleClubPerfGrant(w http.ResponseWriter, r *http.Request, p principal) {
	var input struct {
		UnionID  string `json:"union_id"`
		PlayerID string `json:"player_id"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	unionID := strings.TrimSpace(input.UnionID)
	playerID := strings.TrimSpace(input.PlayerID)
	if unionID == "" || playerID == "" {
		writeError(w, http.StatusBadRequest, "INVALID_PARAMS", "请选择联盟并输入玩家ID")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	player, err := s.clubPerfLookupPlayer(ctx, unionID, playerID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "PLAYER_NOT_FOUND", "该玩家不在本联盟代理树中")
		return
	}
	if err != nil {
		s.logger.Error("lookup club perf player for grant", "error", err, "union_id", unionID, "player_id", playerID)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "核对玩家失败")
		return
	}
	if !player.Eligible {
		writeError(w, http.StatusBadRequest, "PLAYER_NOT_ELIGIBLE", "只能为盟主或合伙人开通业绩股")
		return
	}

	op := "p@" + gameOperationContext("club-perf-grant")
	requestAudit := map[string]any{"unionId": unionID, "clubId": player.ClubID, "enabled": 1, "context": op}
	result, err := s.callGameCommand(ctx, "设置_俱乐部_业绩_授权", map[string]any{
		"club_id": player.ClubID, "user_id": player.PlayerID, "enabled": 1, "context": op,
	})
	if err != nil {
		s.audit(r.Context(), &p, "game.club_perf.grant", "game_player", player.PlayerID,
			requestAudit, player, nil, 502, "游戏服调用失败", clientIP(r))
		writeError(w, http.StatusBadGateway, "GAME_COMMAND_FAILED", "授权失败："+err.Error())
		return
	}
	if result.RetCode != 512 {
		message := describeGameFailure("设置_俱乐部_业绩_授权", result.RetCode, result.RetResult)
		s.audit(r.Context(), &p, "game.club_perf.grant", "game_player", player.PlayerID,
			requestAudit, player, result.RetResult, result.RetCode, message, clientIP(r))
		writeError(w, http.StatusBadGateway, "GAME_COMMAND_FAILED", message)
		return
	}
	scope, clubIDs := decodeClubPerfGrantResult(result.RetResult)
	message := "已授权业绩股成员"
	if scope == "union" {
		message = "已授权盟主业绩股"
	}
	s.audit(r.Context(), &p, "game.club_perf.grant", "game_player", player.PlayerID,
		requestAudit, player, map[string]any{"scope": scope, "clubIds": clubIDs}, 0, message, clientIP(r))
	writeData(w, http.StatusOK, map[string]any{
		"player": player, "scope": scope, "clubIds": clubIDs, "message": message,
	})
}

func (s *Server) clubPerfLookupPlayer(ctx context.Context, unionID, playerID string) (*clubPerfPlayer, error) {
	var player clubPerfPlayer
	var isOwner bool
	err := s.gameDB.QueryRowContext(ctx, `SELECT ca.user_guuid,
COALESCE(NULLIF(ca.user_name,''), a.sm_name, ''),
ca.club_guuid, COALESCE(c.club_name,''),
COALESCE(c.union_id,''), COALESCE(u.union_name,''),
(c.account_id = a.id),
EXISTS(SELECT 1 FROM kbedm.club_invite_code_info ic
       WHERE ic.club_guuid = ca.club_guuid AND ic.user_guuid = ca.user_guuid AND ic.status = 'used')
FROM kbedm.club_agent_info ca
JOIN kbedm.tbl_Account a ON a.sm_guuid = ca.user_guuid
JOIN kbedm.club_guuid_info c ON c.club_guuid = ca.club_guuid
LEFT JOIN kbedm.club_union_info u ON u.union_id = c.union_id AND u.status='used'
WHERE ca.user_guuid = ? AND ca.status = 'used'
  AND c.union_id = ? AND c.club_status NOT IN ('init','del')
ORDER BY (c.account_id = a.id) DESC, ca.id
LIMIT 1`, playerID, unionID).
		Scan(&player.PlayerID, &player.Name, &player.ClubID, &player.ClubName,
			&player.UnionID, &player.UnionName, &isOwner, &player.IsAgent)
	if err != nil {
		return nil, err
	}
	player.UnionID = unionID
	player.IsLeader = isOwner
	player.Role = "玩家"
	var ownerID, ownerClubID string
	if err := s.db.QueryRowContext(ctx, `SELECT COALESCE(owner_guuid,''), COALESCE(club_guuid,'')
FROM kbedm.club_union_info WHERE union_id = ? AND status <> 'init'`, unionID).
		Scan(&ownerID, &ownerClubID); err != nil && !errors.Is(err, sql.ErrNoRows) {
		s.logger.Warn("load club perf union owner", "error", err, "union_id", unionID)
	}
	if player.PlayerID == ownerID {
		player.Role = "大盟主"
	} else if isOwner {
		player.Role = "盟主"
	} else if player.IsAgent {
		player.Role = "合伙人"
	}
	player.Eligible = isOwner || player.IsAgent
	if player.PlayerID == ownerID && player.ClubID == ownerClubID {
		player.Enabled = true
	}
	if !player.Enabled {
		player.Enabled = s.clubPerfGrantUsed(ctx, unionID, player.ClubID, player.PlayerID)
	}
	return &player, nil
}

func (s *Server) clubPerfGrantUsed(ctx context.Context, unionID, clubID, playerID string) bool {
	var status string
	err := s.gameDB.QueryRowContext(ctx, `SELECT status FROM kbedm.club_perf_grant_info
WHERE club_guuid = ? AND user_guuid = ? LIMIT 1`, clubID, playerID).Scan(&status)
	if err == nil && status == "used" {
		return true
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		s.logger.Warn("read club perf grant", "error", err, "club_id", clubID, "player_id", playerID)
	}
	err = s.gameDB.QueryRowContext(ctx, `SELECT status FROM kbedm.club_perf_union_grant_info
WHERE union_id = ? AND leader_club_id = ? AND leader_guuid = ? LIMIT 1`, unionID, clubID, playerID).Scan(&status)
	if err == nil && status == "used" {
		return true
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		s.logger.Warn("read club perf union grant", "error", err, "union_id", unionID, "club_id", clubID, "player_id", playerID)
	}
	return false
}

func decodeClubPerfGrantResult(raw json.RawMessage) (string, []string) {
	var text string
	if json.Unmarshal(raw, &text) == nil {
		raw = json.RawMessage(text)
	}
	var envelope map[string]json.RawMessage
	if json.Unmarshal(raw, &envelope) != nil {
		return "", nil
	}
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
	var scope string
	if value, ok := envelope["scope"]; ok {
		_ = json.Unmarshal(value, &scope)
	}
	var clubs []string
	if value, ok := envelope["club_ids"]; ok {
		_ = json.Unmarshal(value, &clubs)
	}
	if len(clubs) == 0 {
		if value, ok := envelope["club_id"]; ok {
			var clubID string
			if json.Unmarshal(value, &clubID) == nil && clubID != "" {
				clubs = append(clubs, clubID)
			}
		}
	}
	return scope, clubs
}

func (s *Server) clubPerfClubs(ctx context.Context, unionID string) (map[string]*clubPerfClub, []string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT c.club_guuid, COALESCE(c.club_name,''),
COALESCE(a.sm_guuid,''), COALESCE(a.sm_name,'')
FROM kbedm.club_guuid_info c
LEFT JOIN kbedm.tbl_Account a ON a.id = c.account_id
WHERE c.union_id = ? AND c.club_status NOT IN ('init','del')
ORDER BY c.id`, unionID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	clubs := map[string]*clubPerfClub{}
	order := make([]string, 0, 8)
	for rows.Next() {
		item := &clubPerfClub{}
		if err := rows.Scan(&item.ID, &item.Name, &item.CreatorID, &item.CreatorName); err != nil {
			return nil, nil, err
		}
		if item.ID == "" {
			continue
		}
		if _, exists := clubs[item.ID]; exists {
			continue
		}
		clubs[item.ID] = item
		order = append(order, item.ID)
	}
	return clubs, order, rows.Err()
}

func (s *Server) clubPerfAgents(ctx context.Context, unionID string) ([]clubPerfAgent, error) {
	rows, err := s.gameDB.QueryContext(ctx, `SELECT ca.user_guuid,
COALESCE(NULLIF(ca.user_name,''), a.sm_name, ''),
ca.club_guuid, COALESCE(c.club_name,''),
COALESCE(NULLIF(ca.upper_guuid,''), ''),
(c.account_id = a.id),
EXISTS(SELECT 1 FROM kbedm.club_invite_code_info ic
       WHERE ic.club_guuid = ca.club_guuid AND ic.user_guuid = ca.user_guuid AND ic.status = 'used')
FROM kbedm.club_agent_info ca
JOIN kbedm.tbl_Account a ON a.sm_guuid = ca.user_guuid
JOIN kbedm.club_guuid_info c ON c.club_guuid = ca.club_guuid
WHERE ca.status = 'used' AND c.union_id = ? AND c.club_status NOT IN ('init','del')
ORDER BY ca.id`, unionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	agents := make([]clubPerfAgent, 0, 128)
	seen := map[string]bool{}
	for rows.Next() {
		var item clubPerfAgent
		if err := rows.Scan(&item.ID, &item.Name, &item.ClubID, &item.ClubName, &item.Upper, &item.IsOwner, &item.IsAgent); err != nil {
			return nil, err
		}
		key := item.ClubID + ":" + item.ID
		if item.ID == "" || seen[key] {
			continue
		}
		seen[key] = true
		agents = append(agents, item)
	}
	return agents, rows.Err()
}

func (s *Server) clubPerfReport(ctx context.Context, unionID, date string) (string, int64, []clubPerfReportRow, error) {
	offset := rewardDayOffset(date, time.Now())
	result, err := s.callGameCommand(ctx, "异步_查询_俱乐部_业绩_报表", map[string]any{
		"union_id": unionID, "date": offset, "context": "p@" + gameOperationContext("club-perf-overview"),
	})
	if err != nil {
		return "", 0, nil, err
	}
	if result.RetCode != 512 {
		return "", 0, nil, errors.New(describeGameFailure("异步_查询_俱乐部_业绩_报表", result.RetCode, result.RetResult))
	}
	reportDate, allCount, list, err := decodeClubPerfReport(result.RetResult)
	if err != nil {
		return "", 0, nil, err
	}
	rows := make([]clubPerfReportRow, 0, len(list))
	for _, row := range list {
		if len(row) < 9 {
			continue
		}
		id := anyString(row[0])
		if id == "" {
			continue
		}
		item := clubPerfReportRow{
			ID:       id,
			Name:     anyString(row[1]),
			Role:     anyString(row[2]),
			ClubName: anyString(row[4]),
			My:       int64(anyFloat(row[5])),
			Granted:  int64(anyFloat(row[6])),
			Left:     int64(anyFloat(row[7])),
			Percent:  anyString(row[8]),
		}
		if item.Percent == "" && allCount > 0 {
			item.Percent = fmt.Sprintf("%.2f", float64(item.Left)*100/float64(allCount))
		}
		rows = append(rows, item)
	}
	return reportDate, allCount, rows, nil
}

func decodeClubPerfReport(raw json.RawMessage) (string, int64, [][]any, error) {
	var text string
	if json.Unmarshal(raw, &text) == nil {
		raw = json.RawMessage(text)
	}
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return "", 0, nil, errors.New("业绩报表格式不正确")
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
		Date     string  `json:"date"`
		AllCount int64   `json:"all_count"`
		List     [][]any `json:"list"`
	}
	if err := json.Unmarshal(envelope["ClubPerfReport"], &report); err != nil {
		return "", 0, nil, errors.New("业绩报表缺少 ClubPerfReport")
	}
	return report.Date, report.AllCount, report.List, nil
}

func buildClubPerfTree(unionInfo clubPerfUnionOption, ownerClubID string, clubs map[string]*clubPerfClub,
	clubOrder []string, agents []clubPerfAgent, reportRows []clubPerfReportRow, allCount int64) (*clubPerfNode, int, int) {
	builds := map[string]*clubPerfBuild{}
	clubsByName := map[string][]*clubPerfBuild{}
	for _, id := range clubOrder {
		club := clubs[id]
		builds[id] = &clubPerfBuild{club: club, nodes: map[string]*clubPerfNode{}, parents: map[string]string{}}
		clubsByName[club.Name] = append(clubsByName[club.Name], builds[id])
	}
	newNode := func(id, name, clubID, clubName string) *clubPerfNode {
		return &clubPerfNode{
			Key: clubID + ":" + id, PlayerID: id, Name: name, ClubID: clubID, ClubName: clubName,
			UnionID: unionInfo.UnionID, UnionName: unionInfo.UnionName, Role: "玩家",
			Percent: "0.00", Children: []*clubPerfNode{},
		}
	}

	// 先建盟主节点，再按 ca.id 顺序建代理；上级只认已出现的节点，避免环。
	ownerIDs := map[string]string{}
	ownerNames := map[string]string{}
	for _, a := range agents {
		if !a.IsOwner {
			continue
		}
		if _, exists := ownerIDs[a.ClubID]; !exists {
			ownerIDs[a.ClubID] = a.ID
			ownerNames[a.ClubID] = a.Name
		}
	}
	for _, id := range clubOrder {
		bc := builds[id]
		leaderID := strings.TrimSpace(bc.club.CreatorID)
		if leaderID == "" {
			leaderID = ownerIDs[id]
		}
		if leaderID == "" {
			continue
		}
		name := bc.club.CreatorName
		if name == "" {
			name = ownerNames[id]
		}
		leader := newNode(leaderID, name, bc.club.ID, bc.club.Name)
		leader.IsLeader = true
		leader.Role = "盟主"
		bc.leader = leader
		bc.nodes[leaderID] = leader
	}
	for _, a := range agents {
		bc := builds[a.ClubID]
		if bc == nil {
			continue
		}
		if bc.leader != nil && a.ID == bc.leader.PlayerID {
			if bc.leader.Name == "" {
				bc.leader.Name = a.Name
			}
			continue
		}
		node := bc.nodes[a.ID]
		if node == nil {
			node = newNode(a.ID, a.Name, a.ClubID, a.ClubName)
			bc.nodes[a.ID] = node
			bc.order = append(bc.order, a.ID)
		}
		if node.Name == "" {
			node.Name = a.Name
		}
		if a.IsAgent {
			node.Role = "合伙人"
		}
		if a.Upper != "" && a.Upper != a.ID {
			if _, ok := bc.nodes[a.Upper]; ok {
				bc.parents[a.ID] = a.Upper
			}
		}
	}

	// 报表只返回已开通代理；按 (guuid, 俱乐部名) 映射，未命中即未开通。
	loose := make([]*clubPerfNode, 0)
	for _, row := range reportRows {
		var target *clubPerfNode
		for _, bc := range clubsByName[row.ClubName] {
			if node := bc.nodes[row.ID]; node != nil {
				target = node
				break
			}
		}
		if target == nil {
			var hits []*clubPerfNode
			for _, id := range clubOrder {
				if node := builds[id].nodes[row.ID]; node != nil {
					hits = append(hits, node)
				}
			}
			if len(hits) == 1 {
				target = hits[0]
			}
		}
		if target == nil {
			if list := clubsByName[row.ClubName]; len(list) > 0 {
				bc := list[0]
				target = newNode(row.ID, row.Name, bc.club.ID, bc.club.Name)
				bc.nodes[row.ID] = target
				bc.order = append(bc.order, row.ID)
				if bc.leader != nil {
					bc.parents[row.ID] = bc.leader.PlayerID
				}
			} else {
				target = newNode(row.ID, row.Name, "", row.ClubName)
				loose = append(loose, target)
			}
			target.Role = "合伙人"
			if row.Role != "" {
				target.Role = row.Role
			}
		}
		target.Enabled = true
		target.My = row.My
		target.Granted = row.Granted
		target.Left = row.Left
		target.Percent = row.Percent
		if target.Name == "" {
			target.Name = row.Name
		}
	}

	// 联盟根：总群主。找不到代理行时合成一个。
	rootID := strings.TrimSpace(unionInfo.OwnerID)
	var root *clubPerfNode
	if rootID != "" {
		for _, id := range clubOrder {
			if node := builds[id].nodes[rootID]; node != nil {
				root = node
				break
			}
		}
	}
	if root == nil {
		clubName := ""
		if club := clubs[ownerClubID]; club != nil {
			clubName = club.Name
		}
		root = newNode(rootID, unionInfo.OwnerName, ownerClubID, clubName)
	}
	root.IsUnionOwner = true
	root.IsLeader = true
	root.Role = "大盟主"
	root.ParentID = ""

	// 挂树：盟主挂联盟根，代理按上级挂；上级缺失时挂盟主/联盟根。
	for _, id := range clubOrder {
		bc := builds[id]
		for _, agentID := range bc.order {
			node := bc.nodes[agentID]
			if node == nil || node == root {
				continue
			}
			var parent *clubPerfNode
			if parentID := bc.parents[agentID]; parentID != "" {
				parent = bc.nodes[parentID]
			}
			if parent == nil || parent == node {
				if bc.leader != nil && bc.leader != node && bc.leader != root {
					parent = bc.leader
				} else {
					parent = root
				}
			}
			node.ParentID = parent.PlayerID
			parent.Children = append(parent.Children, node)
		}
		if bc.leader != nil && bc.leader != root {
			bc.leader.ParentID = root.PlayerID
			root.Children = append(root.Children, bc.leader)
		}
	}
	// 报表里出现、但不在任何俱乐部树里的代理，挂在联盟根下。
	for _, node := range loose {
		node.ParentID = root.PlayerID
		root.Children = append(root.Children, node)
	}
	attached := map[*clubPerfNode]bool{}
	var markAttached func(nodes []*clubPerfNode)
	markAttached = func(nodes []*clubPerfNode) {
		for _, n := range nodes {
			if attached[n] {
				continue
			}
			attached[n] = true
			markAttached(n.Children)
		}
	}
	markAttached([]*clubPerfNode{root})
	for _, id := range clubOrder {
		for _, node := range builds[id].nodes {
			if !attached[node] {
				node.ParentID = root.PlayerID
				root.Children = append(root.Children, node)
				attached[node] = true
			}
		}
	}

	// 联盟根口径：我 = 联盟池总次数；下放 = A1 已下放 + 已授权盟主的整俱乐部 M_c。
	root.Enabled = true
	root.My = allCount
	granted := root.Granted
	for _, id := range clubOrder {
		bc := builds[id]
		if bc.leader != nil && bc.leader != root && bc.leader.Enabled {
			granted += bc.leader.My
		}
	}
	root.Granted = granted
	root.Left = allCount - granted
	if root.Left < 0 {
		root.Left = 0
	}
	if allCount > 0 {
		root.Percent = fmt.Sprintf("%.2f", float64(root.Left)*100/float64(allCount))
	} else {
		root.Percent = "0.00"
	}

	// 只列出已授权业绩股的人员：未授权节点删除，其已授权下级提升到最近的已授权上级。
	filterEnabledClubPerf(root)
	sortClubPerfChildren(root)
	total, enabled := countClubPerfNodes(root)
	return root, total, enabled
}

// filterEnabledClubPerf 保留 enabled 节点；disabled 节点本身不展示，但把它下面
// 已保留的（已授权）子孙挂到当前父节点，避免未授权盟主的下级消失。
func filterEnabledClubPerf(node *clubPerfNode) bool {
	children := make([]*clubPerfNode, 0, len(node.Children))
	for _, child := range node.Children {
		if filterEnabledClubPerf(child) {
			children = append(children, child)
		} else {
			children = append(children, child.Children...)
		}
	}
	node.Children = children
	return node.Enabled
}

func sortClubPerfChildren(node *clubPerfNode) {
	if node == nil {
		return
	}
	sort.SliceStable(node.Children, func(i, j int) bool {
		a, b := node.Children[i], node.Children[j]
		if a.IsLeader != b.IsLeader {
			return a.IsLeader
		}
		if a.Enabled != b.Enabled {
			return a.Enabled
		}
		if a.Name != b.Name {
			return a.Name < b.Name
		}
		return a.PlayerID < b.PlayerID
	})
	for _, child := range node.Children {
		sortClubPerfChildren(child)
	}
}

func countClubPerfNodes(node *clubPerfNode) (int, int) {
	if node == nil {
		return 0, 0
	}
	total, enabled := 1, 0
	if node.Enabled {
		enabled = 1
	}
	for _, child := range node.Children {
		childTotal, childEnabled := countClubPerfNodes(child)
		total += childTotal
		enabled += childEnabled
	}
	return total, enabled
}
