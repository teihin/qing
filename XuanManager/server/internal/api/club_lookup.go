package api

import (
	"context"
	"database/sql"
	"strings"
)

// clubLookupInfo 是后台展示用的俱乐部摘要。
// 创建者按 tbl_Account.sm_club_make / sm_club_make2 反查（与俱乐部管理同口径），
// 创建者邀请码取 club_invite_code_info 中该创建者在本俱乐部最新一条 used 记录。
type clubLookupInfo struct {
	ClubID     string
	ClubName   string
	OwnerID    string
	OwnerName  string
	InviteCode string
}

func (s *Server) lookupClubInfo(ctx context.Context, clubIDs []string) (map[string]clubLookupInfo, error) {
	result := make(map[string]clubLookupInfo, len(clubIDs))
	ids := normalizeClubIDs(clubIDs)
	if len(ids) == 0 {
		return result, nil
	}

	placeholders := strings.TrimRight(strings.Repeat("?,", len(ids)), ",")
	nameArgs := make([]any, 0, len(ids))
	for _, id := range ids {
		nameArgs = append(nameArgs, id)
	}
	rows, err := s.db.QueryContext(ctx, `SELECT club_guuid, COALESCE(club_name, '')
FROM kbedm.club_guuid_info WHERE club_guuid IN (`+placeholders+`)`, nameArgs...)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var clubID, name string
		if err := rows.Scan(&clubID, &name); err != nil {
			rows.Close()
			return nil, err
		}
		info := result[clubID]
		info.ClubID = clubID
		info.ClubName = strings.TrimSpace(name)
		result[clubID] = info
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	owners, err := s.lookupClubOwners(ctx, ids)
	if err != nil {
		return nil, err
	}
	ownerIDs := make([]string, 0, len(ids))
	for _, id := range ids {
		info := result[id]
		info.ClubID = id
		info.OwnerID = owners[id]
		result[id] = info
		if info.OwnerID != "" {
			ownerIDs = append(ownerIDs, info.OwnerID)
		}
	}
	if len(ownerIDs) > 0 {
		names, nameErr := s.playerNames(ctx, ownerIDs)
		if nameErr != nil {
			return nil, nameErr
		}
		for index := range ids {
			info := result[ids[index]]
			info.OwnerName = names[info.OwnerID]
			result[ids[index]] = info
		}
	}

	pairs := make([][2]string, 0, len(ids))
	for _, id := range ids {
		info := result[id]
		if info.OwnerID != "" {
			pairs = append(pairs, [2]string{id, info.OwnerID})
		}
	}
	if len(pairs) == 0 {
		return result, nil
	}
	pairPlaceholders := strings.TrimRight(strings.Repeat("(?,?),", len(pairs)), ",")
	inviteArgs := make([]any, 0, len(pairs)*2)
	for _, pair := range pairs {
		inviteArgs = append(inviteArgs, pair[0], pair[1])
	}
	inviteRows, err := s.db.QueryContext(ctx, `SELECT club_guuid, user_guuid, invite_code
FROM kbedm.club_invite_code_info
WHERE status = 'used' AND (club_guuid, user_guuid) IN (`+pairPlaceholders+`)
ORDER BY id DESC`, inviteArgs...)
	if err != nil {
		return nil, err
	}
	defer inviteRows.Close()
	seen := map[string]bool{}
	for inviteRows.Next() {
		var clubID, ownerID, inviteCode string
		if err := inviteRows.Scan(&clubID, &ownerID, &inviteCode); err != nil {
			return nil, err
		}
		key := clubID + "\x00" + ownerID
		if seen[key] {
			continue
		}
		seen[key] = true
		info := result[clubID]
		info.InviteCode = strings.TrimSpace(inviteCode)
		result[clubID] = info
	}
	return result, inviteRows.Err()
}

// lookupClubOwners 批量反查俱乐部创建者，避免逐俱乐部查询。
func (s *Server) lookupClubOwners(ctx context.Context, clubIDs []string) (map[string]string, error) {
	owners := make(map[string]string, len(clubIDs))
	clubSet := make(map[string]bool, len(clubIDs))
	for _, id := range clubIDs {
		clubSet[id] = true
	}
	parts := make([]string, 0, len(clubIDs))
	args := make([]any, 0, len(clubIDs)*2)
	for _, id := range clubIDs {
		parts = append(parts,
			"(FIND_IN_SET(?, REPLACE(COALESCE(a.sm_club_make, ''), ' ', '')) > 0"+
				" OR FIND_IN_SET(?, REPLACE(COALESCE(a.sm_club_make2, ''), ' ', '')) > 0)")
		args = append(args, id, id)
	}
	rows, err := s.db.QueryContext(ctx, `SELECT a.sm_guuid, a.sm_club_make, a.sm_club_make2
FROM kbedm.tbl_Account a WHERE `+strings.Join(parts, " OR "), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var guuid string
		var make, make2 sql.NullString
		if err := rows.Scan(&guuid, &make, &make2); err != nil {
			return nil, err
		}
		for _, field := range []string{make.String, make2.String} {
			for _, token := range strings.Split(field, ",") {
				clubID := strings.TrimSpace(token)
				if clubID != "" && clubSet[clubID] && owners[clubID] == "" {
					owners[clubID] = guuid
				}
			}
		}
	}
	return owners, rows.Err()
}

func normalizeClubIDs(values []string) []string {
	seen := make(map[string]bool, len(values))
	ids := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || value == "0" || seen[value] {
			continue
		}
		seen[value] = true
		ids = append(ids, value)
	}
	return ids
}
