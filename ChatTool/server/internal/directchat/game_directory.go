package directchat

import (
	"context"
	"database/sql"
	"errors"
	"sort"
	"strings"
)

// GameDirectory 直接从游戏数据库读取俱乐部目录。
//
// 这里的数据库连接必须使用只读账号。该类型只执行 SELECT，不保存任何
// 俱乐部快照，也不依赖 chat_direct_club / chat_direct_club_member。
type GameDirectory struct {
	db *sql.DB
}

func NewGameDirectory(db *sql.DB) *GameDirectory { return &GameDirectory{db: db} }

type gameAccount struct {
	Guuid      string
	Name       string
	Avatar     string
	ClubMake   string
	ClubJoin   string
	ClubMake2  string
	ClubJoin2  string
	ClubManage string
}

type agentRelation struct {
	UpperGuuid string
	Note       string
	IsAgent    bool
}

func (d *GameDirectory) ListMyClubs(ctx context.Context, guuid string) ([]Club, error) {
	account, ok, err := d.account(ctx, guuid)
	if err != nil {
		return nil, err
	}
	if !ok {
		return []Club{}, nil
	}

	ids := uniqueClubIDs(account.ClubMake, account.ClubMake2, account.ClubJoin, account.ClubJoin2, account.ClubManage)
	clubs := make([]Club, 0, len(ids))
	for _, clubID := range ids {
		club, err := d.GetClub(ctx, clubID)
		if errors.Is(err, errClubNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		member, memberOK, err := d.GetMember(ctx, clubID, guuid)
		if err != nil {
			return nil, err
		}
		if !memberOK {
			continue
		}
		club.Role = member.Role
		clubs = append(clubs, club)
	}
	sort.SliceStable(clubs, func(i, j int) bool {
		if clubs[i].ClubName != clubs[j].ClubName {
			return clubs[i].ClubName < clubs[j].ClubName
		}
		return clubs[i].ClubID < clubs[j].ClubID
	})
	return clubs, nil
}

func (d *GameDirectory) GetClub(ctx context.Context, clubID string) (Club, error) {
	clubID = strings.TrimSpace(clubID)
	if clubID == "" {
		return Club{}, errClubNotFound
	}
	var club Club
	err := d.db.QueryRowContext(ctx, `SELECT club_guuid, COALESCE(club_name, ''), COALESCE(union_id, '')
FROM club_guuid_info
WHERE club_guuid = ? AND COALESCE(club_status, '') NOT IN ('init', 'del')
LIMIT 1`, clubID).Scan(&club.ClubID, &club.ClubName, &club.UnionID)
	if errors.Is(err, sql.ErrNoRows) {
		return Club{}, errClubNotFound
	}
	if err != nil {
		return Club{}, err
	}
	club.OwnerGuuid, err = d.clubOwner(ctx, clubID)
	if err != nil {
		return Club{}, err
	}
	return club, nil
}

// GetUnionByClub 返回俱乐部所属联盟。未入盟返回 ok=false。
func (d *GameDirectory) GetUnionByClub(ctx context.Context, clubID string) (Union, bool, error) {
	clubID = strings.TrimSpace(clubID)
	if clubID == "" {
		return Union{}, false, nil
	}
	var union Union
	err := d.db.QueryRowContext(ctx, `SELECT cu.union_id, COALESCE(cu.union_name, ''),
COALESCE(cu.owner_guuid, ''), COALESCE(cu.club_guuid, '')
FROM club_guuid_info cg
JOIN club_union_info cu ON cu.union_id = cg.union_id
WHERE cg.club_guuid = ? AND COALESCE(cg.union_id, '') <> ''
LIMIT 1`, clubID).Scan(&union.ID, &union.Name, &union.OwnerGuuid, &union.OwnerClub)
	if errors.Is(err, sql.ErrNoRows) {
		return Union{}, false, nil
	}
	if err != nil {
		return Union{}, false, err
	}
	return union, true, nil
}

// GetAccount 按 guuid 读取跨俱乐部展示所需的昵称和头像。
func (d *GameDirectory) GetAccount(ctx context.Context, guuid string) (GameUser, bool, error) {
	var user GameUser
	err := d.db.QueryRowContext(ctx, `SELECT sm_guuid, COALESCE(sm_name, ''), COALESCE(sm_photo, '')
FROM tbl_Account WHERE sm_guuid = ? LIMIT 1`, strings.TrimSpace(guuid)).Scan(&user.Guuid, &user.Name, &user.Avatar)
	if errors.Is(err, sql.ErrNoRows) {
		return GameUser{}, false, nil
	}
	if err != nil {
		return GameUser{}, false, err
	}
	return user, true, nil
}

func (d *GameDirectory) GetMember(ctx context.Context, clubID, guuid string) (Member, bool, error) {
	club, err := d.GetClub(ctx, clubID)
	if err != nil {
		if errors.Is(err, errClubNotFound) {
			return Member{}, false, nil
		}
		return Member{}, false, err
	}
	account, ok, err := d.accountInClub(ctx, clubID, guuid)
	if err != nil || !ok {
		return Member{}, ok, err
	}
	relations, err := d.agentRelations(ctx, clubID)
	if err != nil {
		return Member{}, false, err
	}
	return d.memberFromAccount(club, account, relations), true, nil
}

func (d *GameDirectory) ListMembers(ctx context.Context, clubID, keyword, excludeGuuid string, offset, limit int) ([]Member, int, error) {
	club, err := d.GetClub(ctx, clubID)
	if err != nil {
		return nil, 0, err
	}
	if offset < 0 {
		offset = 0
	}
	if limit <= 0 {
		limit = DefaultPageSize
	}

	where, args := memberWhere(clubID, excludeGuuid, keyword)
	var total int
	if err := d.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM tbl_Account a WHERE `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	queryArgs := append([]any{}, args...)
	queryArgs = append(queryArgs, limit, offset)
	rows, err := d.db.QueryContext(ctx, `SELECT a.sm_guuid, COALESCE(a.sm_name, ''), COALESCE(a.sm_photo, ''),
COALESCE(a.sm_club_make, ''), COALESCE(a.sm_club_join, ''), COALESCE(a.sm_club_make2, ''),
COALESCE(a.sm_club_join2, ''), COALESCE(a.sm_club_manage, '')
FROM tbl_Account a WHERE `+where+` ORDER BY a.id DESC, a.sm_guuid LIMIT ? OFFSET ?`, queryArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	relations, err := d.agentRelations(ctx, clubID)
	if err != nil {
		return nil, 0, err
	}
	items := make([]Member, 0, limit)
	for rows.Next() {
		account, err := scanGameAccount(rows)
		if err != nil {
			return nil, 0, err
		}
		items = append(items, d.memberFromAccount(club, account, relations))
	}
	return items, total, rows.Err()
}

func (d *GameDirectory) account(ctx context.Context, guuid string) (gameAccount, bool, error) {
	var account gameAccount
	err := d.db.QueryRowContext(ctx, `SELECT sm_guuid, COALESCE(sm_name, ''), COALESCE(sm_photo, ''),
COALESCE(sm_club_make, ''), COALESCE(sm_club_join, ''), COALESCE(sm_club_make2, ''),
COALESCE(sm_club_join2, ''), COALESCE(sm_club_manage, '')
FROM tbl_Account WHERE sm_guuid = ? LIMIT 1`, strings.TrimSpace(guuid)).Scan(
		&account.Guuid, &account.Name, &account.Avatar, &account.ClubMake, &account.ClubJoin,
		&account.ClubMake2, &account.ClubJoin2, &account.ClubManage)
	if errors.Is(err, sql.ErrNoRows) {
		return gameAccount{}, false, nil
	}
	if err != nil {
		return gameAccount{}, false, err
	}
	return account, true, nil
}

func (d *GameDirectory) accountInClub(ctx context.Context, clubID, guuid string) (gameAccount, bool, error) {
	where, args := accountMembershipWhere(clubID)
	args = append([]any{strings.TrimSpace(guuid)}, args...)
	var account gameAccount
	err := d.db.QueryRowContext(ctx, `SELECT a.sm_guuid, COALESCE(a.sm_name, ''), COALESCE(a.sm_photo, ''),
COALESCE(a.sm_club_make, ''), COALESCE(a.sm_club_join, ''), COALESCE(a.sm_club_make2, ''),
COALESCE(a.sm_club_join2, ''), COALESCE(a.sm_club_manage, '')
FROM tbl_Account a WHERE a.sm_guuid = ? AND (`+where+`) LIMIT 1`, args...).Scan(
		&account.Guuid, &account.Name, &account.Avatar, &account.ClubMake, &account.ClubJoin,
		&account.ClubMake2, &account.ClubJoin2, &account.ClubManage)
	if errors.Is(err, sql.ErrNoRows) {
		return gameAccount{}, false, nil
	}
	if err != nil {
		return gameAccount{}, false, err
	}
	return account, true, nil
}

func (d *GameDirectory) clubOwner(ctx context.Context, clubID string) (string, error) {
	var owner string
	err := d.db.QueryRowContext(ctx, `SELECT a.sm_guuid FROM tbl_Account a
WHERE FIND_IN_SET(?, REPLACE(COALESCE(a.sm_club_make, ''), ' ', '')) > 0
   OR FIND_IN_SET(?, REPLACE(COALESCE(a.sm_club_make2, ''), ' ', '')) > 0
ORDER BY a.id ASC LIMIT 1`, clubID, clubID).Scan(&owner)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return owner, err
}

func (d *GameDirectory) agentRelations(ctx context.Context, clubID string) (map[string]agentRelation, error) {
	// 俱乐部模式的直属关系只取 club_agent_info.upper_guuid；
	// tbl_Account.sm_agentID 属于平台模式，不能作为本俱乐部的上级。
	rows, err := d.db.QueryContext(ctx, `SELECT r.user_guuid, COALESCE(r.upper_guuid, ''), COALESCE(r.note, ''),
EXISTS(SELECT 1 FROM club_invite_code_info c
       WHERE c.club_guuid = r.club_guuid AND c.user_guuid = r.user_guuid AND c.status = 'used')
FROM club_agent_info r WHERE r.club_guuid = ? AND r.status = 'used' ORDER BY r.id ASC`, clubID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := map[string]agentRelation{}
	for rows.Next() {
		var guuid, upper, note string
		var isAgent bool
		if err := rows.Scan(&guuid, &upper, &note, &isAgent); err != nil {
			return nil, err
		}
		guuid = strings.TrimSpace(guuid)
		if guuid != "" {
			result[guuid] = agentRelation{UpperGuuid: strings.TrimSpace(upper), Note: strings.TrimSpace(note), IsAgent: isAgent}
		}
	}
	return result, rows.Err()
}

func (d *GameDirectory) memberFromAccount(club Club, account gameAccount, relations map[string]agentRelation) Member {
	m := Member{Guuid: account.Guuid, Name: account.Name, Avatar: account.Avatar, Role: RoleMember}
	if m.Name == "" {
		m.Name = m.Guuid
	}
	relation, hasRelation := relations[m.Guuid]
	if m.Guuid == club.OwnerGuuid {
		m.Role = RoleOwner
	} else if hasRelation && relation.IsAgent {
		m.Role = RoleAgent
		if relation.UpperGuuid != "" && relation.UpperGuuid == club.OwnerGuuid {
			m.Role = RoleLeader
		}
	} else if containsClubID(account.ClubManage, club.ClubID) {
		m.Role = RoleManager
	}
	if hasRelation {
		m.SuperiorAgentGuuid = relation.UpperGuuid
		m.Note = relation.Note
	}
	m.SuperiorLeaderGuuid = findSuperiorLeader(m.Guuid, club.OwnerGuuid, relations)
	return m
}

func findSuperiorLeader(guuid, owner string, relations map[string]agentRelation) string {
	current := strings.TrimSpace(guuid)
	seen := map[string]bool{}
	for i := 0; i < 64 && current != "" && !seen[current]; i++ {
		seen[current] = true
		relation, ok := relations[current]
		if !ok || relation.UpperGuuid == "" {
			return ""
		}
		if relation.UpperGuuid == owner {
			if current != guuid {
				return current
			}
			return ""
		}
		current = relation.UpperGuuid
	}
	return ""
}

func scanGameAccount(row interface{ Scan(...any) error }) (gameAccount, error) {
	var account gameAccount
	err := row.Scan(&account.Guuid, &account.Name, &account.Avatar, &account.ClubMake,
		&account.ClubJoin, &account.ClubMake2, &account.ClubJoin2, &account.ClubManage)
	return account, err
}

func memberWhere(clubID, excludeGuuid, keyword string) (string, []any) {
	where, args := accountMembershipWhere(clubID)
	where = "(" + where + ") AND a.sm_guuid <> ?"
	args = append(args, strings.TrimSpace(excludeGuuid))
	if keyword != "" {
		like := "%" + strings.ReplaceAll(strings.ReplaceAll(keyword, "\\", "\\\\"), "%", "\\%") + "%"
		where += " AND (a.sm_name LIKE ? ESCAPE '\\\\' OR a.sm_guuid LIKE ? ESCAPE '\\\\')"
		args = append(args, like, like)
	}
	return where, args
}

func accountMembershipWhere(clubID string) (string, []any) {
	columns := []string{"sm_club_make", "sm_club_join", "sm_club_make2", "sm_club_join2", "sm_club_manage"}
	parts := make([]string, 0, len(columns))
	args := make([]any, 0, len(columns))
	for _, column := range columns {
		parts = append(parts, "FIND_IN_SET(?, REPLACE(COALESCE(a."+column+", ''), ' ', '')) > 0")
		args = append(args, clubID)
	}
	return strings.Join(parts, " OR "), args
}

func uniqueClubIDs(values ...string) []string {
	seen := map[string]bool{}
	result := make([]string, 0)
	for _, value := range values {
		for _, item := range strings.Split(value, ",") {
			item = strings.TrimSpace(item)
			if item != "" && !seen[item] {
				seen[item] = true
				result = append(result, item)
			}
		}
	}
	return result
}

func containsClubID(value, clubID string) bool {
	for _, item := range strings.Split(value, ",") {
		if strings.TrimSpace(item) == strings.TrimSpace(clubID) {
			return true
		}
	}
	return false
}
