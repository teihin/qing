package api

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"sort"
	"strings"
)

type playerClubSummary struct {
	ClubID string `json:"clubId"`
	Name   string `json:"name"`
}

type playerClubMembership struct {
	ClubID     string `json:"clubId"`
	ClubName   string `json:"clubName"`
	ClubStatus string `json:"clubStatus"`
	ClubMode   string `json:"clubMode"`
	Role       string `json:"role"`
	RoleLabel  string `json:"roleLabel"`
	ClubGold   *int64 `json:"clubGold"`
	UpperID    string `json:"upperId"`
	UpperName  string `json:"upperName"`
	// Chain 是玩家在这个俱乐部里的完整代理链：本人 → 直属上级 → … → 群主/盟主 → 大盟主。
	Chain []playerClubChainNode `json:"chain"`
}

// playerClubChainNode 是代理链上的一环。
type playerClubChainNode struct {
	PlayerID  string `json:"playerId"`
	Name      string `json:"name"`
	Role      string `json:"role"`
	RoleLabel string `json:"roleLabel"`
	// UpperID 是该环节点自己的上级，便于核对链路是否连续。
	UpperID string `json:"upperId"`
	IsSelf  bool   `json:"isSelf"`
	Depth   int    `json:"depth"`
	// Missing 表示上级账号不在本俱乐部成员里（数据断链），界面必须显式提示，不能静默补成根节点。
	Missing bool `json:"missing"`
}

// playerClubChainMaxLength 是代理链的最大回溯长度，防止脏数据成环时无限循环。
const playerClubChainMaxLength = 16

type playerClubSubordinate struct {
	PlayerID  string `json:"playerId"`
	Name      string `json:"name"`
	Role      string `json:"role"`
	RoleLabel string `json:"roleLabel"`
	ClubGold  *int64 `json:"clubGold"`
	UpperID   string `json:"upperId"`
	UpperName string `json:"upperName"`
	Depth     int    `json:"depth"`
}

type clubMeta struct {
	ClubID string
	Name   string
	Status string
	Mode   string
}

func clubRoleLabel(role string) string {
	switch role {
	case "owner":
		return "群主"
	case "leader":
		return "盟主"
	case "agent":
		return "代理"
	case "manager":
		return "管理员"
	default:
		return "成员"
	}
}

func clubIDsFromMembershipColumns(values ...string) []string {
	seen := map[string]bool{}
	ids := make([]string, 0)
	for _, value := range values {
		for _, raw := range strings.Split(value, ",") {
			id := strings.TrimSpace(raw)
			if id == "" || seen[id] {
				continue
			}
			seen[id] = true
			ids = append(ids, id)
		}
	}
	return ids
}

func playerMembershipColumns(item playerItem) []string {
	return []string{item.clubMake, item.clubMake2, item.clubJoin, item.clubJoin2, item.ClubManage}
}

func (s *Server) attachPlayerClubs(ctx context.Context, items []playerItem) error {
	if len(items) == 0 {
		return nil
	}
	allIDs := make([]string, 0)
	seen := map[string]bool{}
	for index := range items {
		items[index].Clubs = []playerClubSummary{}
		for _, clubID := range clubIDsFromMembershipColumns(playerMembershipColumns(items[index])...) {
			if !seen[clubID] {
				seen[clubID] = true
				allIDs = append(allIDs, clubID)
			}
		}
	}
	if len(allIDs) == 0 {
		return nil
	}
	metas, err := s.readActiveClubMeta(ctx, allIDs)
	if err != nil {
		return err
	}
	for index := range items {
		for _, clubID := range clubIDsFromMembershipColumns(playerMembershipColumns(items[index])...) {
			meta, ok := metas[clubID]
			if !ok {
				continue
			}
			items[index].Clubs = append(items[index].Clubs, playerClubSummary{ClubID: meta.ClubID, Name: meta.Name})
		}
	}
	return nil
}

func (s *Server) readActiveClubMeta(ctx context.Context, clubIDs []string) (map[string]clubMeta, error) {
	result := map[string]clubMeta{}
	if len(clubIDs) == 0 {
		return result, nil
	}
	placeholders := strings.TrimRight(strings.Repeat("?,", len(clubIDs)), ",")
	args := make([]any, 0, len(clubIDs))
	for _, clubID := range clubIDs {
		args = append(args, clubID)
	}
	rows, err := s.db.QueryContext(ctx, `SELECT club_guuid, COALESCE(club_name, ''),
COALESCE(club_status, ''), COALESCE(club_mode, '')
FROM kbedm.club_guuid_info
WHERE club_guuid IN (`+placeholders+`) AND club_status NOT IN ('init', 'del')`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var meta clubMeta
		if err := rows.Scan(&meta.ClubID, &meta.Name, &meta.Status, &meta.Mode); err != nil {
			return nil, err
		}
		result[meta.ClubID] = meta
	}
	return result, rows.Err()
}

func (s *Server) readPlayerClubIDs(ctx context.Context, playerID string) ([]string, error) {
	var make, join, make2, join2, manage sql.NullString
	err := s.db.QueryRowContext(ctx, `SELECT sm_club_make, sm_club_join, sm_club_make2,
sm_club_join2, sm_club_manage
FROM kbedm.tbl_Account WHERE sm_guuid = ? LIMIT 1`, playerID).
		Scan(&make, &join, &make2, &join2, &manage)
	if err != nil {
		return nil, err
	}
	return clubIDsFromMembershipColumns(
		make.String, make2.String, join.String, join2.String, manage.String,
	), nil
}

func (s *Server) handleGetPlayerClubs(w http.ResponseWriter, r *http.Request, _ principal) {
	playerID, err := normalizeGamePlayerID(r.PathValue("playerId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PLAYER_ID", err.Error())
		return
	}
	clubIDs, err := s.readPlayerClubIDs(r.Context(), playerID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "PLAYER_NOT_FOUND", "没有找到这个游戏玩家 ID")
		return
	}
	if err != nil {
		s.logger.Error("read player clubs", "error", err, "playerId", playerID)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取玩家所在俱乐部失败")
		return
	}
	metas, err := s.readActiveClubMeta(r.Context(), clubIDs)
	if err != nil {
		s.logger.Error("read active club meta", "error", err, "playerId", playerID)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取玩家所在俱乐部失败")
		return
	}

	items := make([]playerClubMembership, 0, len(clubIDs))
	// 代理链要一路指到群主/盟主和大盟主，联盟归属与俱乐部创建者从俱乐部元信息补。
	chainMeta := s.readUserDataClubMetas(r.Context(), clubIDs)
	chainExtraIDs := make([]string, 0, len(clubIDs)*2)
	for _, clubID := range clubIDs {
		meta := chainMeta[clubID]
		chainExtraIDs = append(chainExtraIDs, meta.CreatorID, meta.UnionOwnerID)
	}
	chainNames := s.readUserDataNames(r.Context(), chainExtraIDs)
	for _, clubID := range clubIDs {
		meta, ok := metas[clubID]
		if !ok {
			continue
		}
		members, err := s.readClubMembers(r.Context(), clubID, meta.Mode)
		if err != nil {
			s.logger.Error("read club members", "error", err, "clubId", clubID, "playerId", playerID)
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取玩家所在俱乐部失败")
			return
		}
		names := make(map[string]string, len(members))
		var self *clubMemberNode
		for index := range members {
			names[members[index].PlayerID] = members[index].Name
			if members[index].PlayerID == playerID {
				self = &members[index]
			}
		}
		if self == nil {
			continue
		}
		item := playerClubMembership{
			ClubID: meta.ClubID, ClubName: meta.Name, ClubStatus: meta.Status, ClubMode: meta.Mode,
			Role: self.Role, RoleLabel: clubRoleLabel(self.Role), ClubGold: self.ClubGold,
			UpperID: self.UpperID, UpperName: names[self.UpperID],
			Chain: buildPlayerClubChain(playerID, *self, members, chainMeta[clubID], chainNames),
		}
		items = append(items, item)
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].ClubName != items[j].ClubName {
			return items[i].ClubName < items[j].ClubName
		}
		return items[i].ClubID < items[j].ClubID
	})
	writeData(w, http.StatusOK, map[string]any{"items": items})
}

// buildPlayerClubChain 组装玩家在某个俱乐部的完整代理链：本人 → 直属上级 → … → 群主/盟主 → 大盟主。
// 关系表缺失时按俱乐部创建者和联盟大盟主补齐；上级账号不在本俱乐部时标记 Missing 并停止回溯，
// 不伪造上级关系。
func buildPlayerClubChain(playerID string, self clubMemberNode, members []clubMemberNode,
	meta userDataClubMeta, extraNames map[string]string) []playerClubChainNode {
	byID := make(map[string]clubMemberNode, len(members))
	for _, member := range members {
		byID[member.PlayerID] = member
	}
	nameOf := func(id string) string {
		if member, ok := byID[id]; ok && strings.TrimSpace(member.Name) != "" {
			return member.Name
		}
		return strings.TrimSpace(extraNames[id])
	}

	chain := make([]playerClubChainNode, 0, 6)
	seen := map[string]bool{playerID: true}
	chain = append(chain, playerClubChainNode{
		PlayerID: playerID, Name: self.Name, Role: self.Role, RoleLabel: clubRoleLabel(self.Role),
		UpperID: self.UpperID, IsSelf: true, Depth: 0,
	})

	current := self.UpperID
	for depth := 1; current != "" && depth <= playerClubChainMaxLength; depth++ {
		if seen[current] {
			// 成环：不再重复追加，界面按已显示的链路处理。
			return chain
		}
		seen[current] = true
		member, ok := byID[current]
		if !ok {
			chain = append(chain, playerClubChainNode{
				PlayerID: current, Name: nameOf(current), Role: "missing",
				RoleLabel: "上级账号缺失", Depth: depth, Missing: true,
			})
			return chain
		}
		chain = append(chain, playerClubChainNode{
			PlayerID: current, Name: member.Name, Role: member.Role,
			RoleLabel: clubRoleLabel(member.Role), UpperID: member.UpperID, Depth: depth,
		})
		current = member.UpperID
	}

	if meta.CreatorID != "" && !seen[meta.CreatorID] {
		seen[meta.CreatorID] = true
		role, label := "owner", "群主"
		if meta.UnionID != "" {
			role, label = "leader", "盟主"
		}
		chain = append(chain, playerClubChainNode{
			PlayerID: meta.CreatorID, Name: nameOf(meta.CreatorID), Role: role,
			RoleLabel: label, Depth: len(chain),
		})
	}
	if meta.UnionID != "" && meta.UnionOwnerID != "" && !seen[meta.UnionOwnerID] {
		seen[meta.UnionOwnerID] = true
		chain = append(chain, playerClubChainNode{
			PlayerID: meta.UnionOwnerID, Name: nameOf(meta.UnionOwnerID), Role: "union_owner",
			RoleLabel: "大盟主", Depth: len(chain),
		})
	}
	// 成员表里的角色只到群主/代理，联盟内的创建者与大盟主以俱乐部归属为准改名。
	for index := range chain {
		switch {
		case chain[index].PlayerID == meta.UnionOwnerID && meta.UnionID != "":
			chain[index].Role, chain[index].RoleLabel = "union_owner", "大盟主"
		case chain[index].PlayerID == meta.CreatorID:
			if meta.UnionID != "" {
				chain[index].Role, chain[index].RoleLabel = "leader", "盟主"
			} else {
				chain[index].Role, chain[index].RoleLabel = "owner", "群主"
			}
		}
	}
	return chain
}

func (s *Server) handleGetPlayerClubSubordinates(w http.ResponseWriter, r *http.Request, _ principal) {
	playerID, err := normalizeGamePlayerID(r.PathValue("playerId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PLAYER_ID", err.Error())
		return
	}
	clubID, err := normalizeClubID(r.PathValue("clubId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_CLUB_ID", err.Error())
		return
	}
	metas, err := s.readActiveClubMeta(r.Context(), []string{clubID})
	if err != nil {
		s.logger.Error("read club meta", "error", err, "clubId", clubID)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取俱乐部失败")
		return
	}
	meta, ok := metas[clubID]
	if !ok {
		writeError(w, http.StatusNotFound, "CLUB_NOT_FOUND", "没有找到这个俱乐部")
		return
	}
	members, err := s.readClubMembers(r.Context(), clubID, meta.Mode)
	if err != nil {
		s.logger.Error("read club members", "error", err, "clubId", clubID)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取俱乐部成员失败")
		return
	}
	names := make(map[string]string, len(members))
	found := false
	for index := range members {
		names[members[index].PlayerID] = members[index].Name
		if members[index].PlayerID == playerID {
			found = true
		}
	}
	if !found {
		writeError(w, http.StatusNotFound, "PLAYER_NOT_IN_CLUB", "该玩家不在这个俱乐部中")
		return
	}

	roots, _, _ := buildClubMemberTree(members)
	nodes := map[string]*clubMemberTree{}
	var indexTree func([]*clubMemberTree)
	indexTree = func(nodesInLevel []*clubMemberTree) {
		for _, node := range nodesInLevel {
			nodes[node.PlayerID] = node
			indexTree(node.Children)
		}
	}
	indexTree(roots)

	items := make([]playerClubSubordinate, 0)
	var collect func([]*clubMemberTree, int)
	collect = func(nodesInLevel []*clubMemberTree, depth int) {
		for _, node := range nodesInLevel {
			items = append(items, playerClubSubordinate{
				PlayerID: node.PlayerID, Name: node.Name, Role: node.Role,
				RoleLabel: clubRoleLabel(node.Role), ClubGold: node.ClubGold,
				UpperID: node.UpperID, UpperName: names[node.UpperID], Depth: depth,
			})
			collect(node.Children, depth+1)
		}
	}
	if self, ok := nodes[playerID]; ok {
		collect(self.Children, 1)
	}
	writeData(w, http.StatusOK, map[string]any{
		"clubId": meta.ClubID, "clubName": meta.Name, "items": items, "total": len(items),
	})
}
