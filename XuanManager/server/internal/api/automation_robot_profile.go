package api

import (
	"context"
	"sort"
	"strings"
)

// 机器人 = 游戏账号，后台列表要能直接看到游戏侧身份：
//   - 用户ID（玩家 guuid）
//   - 它已经加入的俱乐部，以及每个俱乐部的金币（带入就是从这里扣）
//
// 数据来源：kbedm.third_marketing_info（营销表，建号时写入 player_guuid）
//        + kbedm.tbl_Account（首次登录后游戏服建的玩家行，sm_club_make/join/manage + sm_club_gold）
//        + kbedm.club_guuid_info（俱乐部名称）
// 这些都在游戏库，后台自己的 mgr_automation_robot 只存账号名，所以要按账号批量补一次。

type robotClub struct {
	ClubID string `json:"clubId"`
	Name   string `json:"name"`
	// ClubGold 是这个玩家在该俱乐部的金币余额（sm_club_gold 里对应的那一项）。
	ClubGold *int64 `json:"clubGold"`
}

// attachRobotGameProfiles 给机器人列表/详情补用户ID与俱乐部金币。
// 查不到（账号还没登录过、或营销表没有记录）就留空，不影响列表本身。
func (s *Server) attachRobotGameProfiles(ctx context.Context, items []automationRobotItem) {
	accounts := make([]string, 0, len(items))
	seen := map[string]bool{}
	for _, item := range items {
		account := strings.TrimSpace(item.Account)
		if account == "" || seen[account] {
			continue
		}
		seen[account] = true
		accounts = append(accounts, account)
	}
	if len(accounts) == 0 {
		return
	}

	type profile struct {
		playerID string
		clubIDs  []string
		gold     map[string]float64
	}
	profiles := map[string]profile{}
	args := make([]any, 0, len(accounts))
	for _, account := range accounts {
		args = append(args, account)
	}
	rows, err := s.db.QueryContext(ctx, `SELECT m.player_wxid, COALESCE(m.player_guuid, ''),
COALESCE(a.sm_club_make, ''), COALESCE(a.sm_club_join, ''), COALESCE(a.sm_club_manage, ''),
COALESCE(a.sm_club_gold, '')
FROM kbedm.third_marketing_info m
LEFT JOIN kbedm.tbl_Account a ON a.sm_guuid = m.player_guuid
WHERE m.player_wxid IN (`+placeholders(len(args))+`)`, args...)
	if err != nil {
		s.logger.Error("attach robot game profiles", "error", err)
		return
	}
	defer rows.Close()
	clubIDSeen := map[string]bool{}
	allClubIDs := make([]string, 0)
	for rows.Next() {
		var account, playerID, clubMake, clubJoin, clubManage, clubGold string
		if err := rows.Scan(&account, &playerID, &clubMake, &clubJoin, &clubManage, &clubGold); err != nil {
			s.logger.Error("scan robot game profile", "error", err)
			continue
		}
		if _, exists := profiles[account]; exists {
			continue
		}
		ids := clubIDsFromMembershipColumns(clubMake, clubJoin, clubManage)
		for _, id := range ids {
			if !clubIDSeen[id] {
				clubIDSeen[id] = true
				allClubIDs = append(allClubIDs, id)
			}
		}
		profiles[account] = profile{playerID: playerID, clubIDs: ids, gold: parseUserDataClubGold(clubGold)}
	}
	if err := rows.Err(); err != nil {
		s.logger.Error("iterate robot game profiles", "error", err)
	}

	names := map[string]string{}
	if len(allClubIDs) > 0 {
		if metas, err := s.readActiveClubMeta(ctx, allClubIDs); err == nil {
			for id, meta := range metas {
				names[id] = meta.Name
			}
		} else {
			s.logger.Error("read robot club meta", "error", err)
		}
	}

	for index := range items {
		prof, ok := profiles[strings.TrimSpace(items[index].Account)]
		if !ok {
			continue
		}
		items[index].PlayerID = prof.playerID
		clubs := make([]robotClub, 0, len(prof.clubIDs))
		for _, clubID := range prof.clubIDs {
			name := names[clubID]
			if strings.TrimSpace(name) == "" {
				name = clubID
			}
			club := robotClub{ClubID: clubID, Name: name}
			if amount, ok := prof.gold[clubID]; ok {
				value := int64(amount)
				club.ClubGold = &value
			}
			clubs = append(clubs, club)
		}
		sort.SliceStable(clubs, func(i, j int) bool { return clubs[i].ClubID < clubs[j].ClubID })
		items[index].Clubs = clubs
	}
}
