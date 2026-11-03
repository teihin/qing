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
}

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
	return []string{item.clubMake, item.clubMake2, item.clubJoin, item.clubJoin2, item.clubManage}
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
