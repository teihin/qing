package api

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

// 靓号反解：运营在界面上看到的可能是靓号（个人ID 的 6 位靓号、俱乐部邀请码的 6 位靓号），
// 但所有业务表里存的仍是真实 ID。凡是「手输 ID 查询」的入口都必须先过一层反解，
// 否则运营抄着玩家发来的号码来后台搜，永远搜不到。
//
// 设计约束：
//   - 只有 6 位纯数字才可能是靓号；其它输入直接放行，不额外打 DB。
//   - 游戏服靓号表未建 / 查询失败时静默退回原值，不能因为号池不可用把整个模块拖挂。
//   - 反解只改「查询条件」，不改回包字段：列表仍返回真实 ID，前端按需自行展示靓号。

type prettyLookup struct {
	PrettyNo string
	Kind     string // uid = 个人ID靓号；invite = 俱乐部邀请码靓号
	UserID   string // uid: 绑定的玩家真实ID；invite: 绑定的代理真实ID
}

// isPrettyCandidate 判断输入是否可能是靓号：与号池口径一致，必须是 6 位纯数字。
func isPrettyCandidate(value string) bool {
	if len(value) != 6 {
		return false
	}
	for index := 0; index < len(value); index++ {
		if value[index] < '0' || value[index] > '9' {
			return false
		}
	}
	return true
}

// lookupPrettyNumber 按号码查已绑定的靓号。
// 只认 status='used'：init 还没绑人、disabled 已永久停用，都不该被用来定位账号。
func (s *Server) lookupPrettyNumber(ctx context.Context, value string) (prettyLookup, bool) {
	value = strings.TrimSpace(value)
	if s.db == nil || !isPrettyCandidate(value) || !s.hasPrettyNumberTable(ctx) {
		return prettyLookup{}, false
	}
	var out prettyLookup
	err := s.db.QueryRowContext(ctx, `SELECT pretty_no, kind, COALESCE(user_guuid, '')
FROM kbedm.usr_pretty_no_info
WHERE pretty_no = ? AND status = 'used'
LIMIT 1`, value).Scan(&out.PrettyNo, &out.Kind, &out.UserID)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) && s.logger != nil {
			s.logger.Warn("lookup pretty number", "error", err, "prettyNo", value)
		}
		return prettyLookup{}, false
	}
	return out, true
}

// clubByInviteCode 用邀请码反查俱乐部。邀请码靓号在 club_invite_code_info 里是真实行，
// 所以这个函数对普通码和靓号一视同仁。不过滤 status：搜历史码也要能找到俱乐部。
func (s *Server) clubByInviteCode(ctx context.Context, code string) string {
	return s.clubByInviteCodeStmt(ctx, code, false)
}

// clubByInviteCodeUsed 只认「当前已绑到某个俱乐部」的邀请码。
// 与 clubByInviteCode 的区别：码池里 init（还没发出去）或 club_guuid 为空的行不算绑定关系，
// 否则运营随手填一个未分配的号码就会命中一条空记录。
func (s *Server) clubByInviteCodeUsed(ctx context.Context, code string) string {
	return s.clubByInviteCodeStmt(ctx, code, true)
}

func (s *Server) clubByInviteCodeStmt(ctx context.Context, code string, usedOnly bool) string {
	code = strings.TrimSpace(code)
	if s.db == nil || !isPrettyCandidate(code) {
		return ""
	}
	query := `SELECT club_guuid
FROM kbedm.club_invite_code_info
WHERE invite_code = ? AND COALESCE(club_guuid, '') <> ''`
	if usedOnly {
		query += ` AND status = 'used'`
	}
	query += `
ORDER BY (status = 'used') DESC
LIMIT 1`
	var clubID string
	if err := s.db.QueryRowContext(ctx, query, code).Scan(&clubID); err != nil {
		if !errors.Is(err, sql.ErrNoRows) && s.logger != nil {
			s.logger.Warn("resolve club by invite code", "error", err, "inviteCode", code, "usedOnly", usedOnly)
		}
		return ""
	}
	return strings.TrimSpace(clubID)
}

// clubExists 判断输入是否本身就是**在用**（used）的俱乐部 ID。
// init/del 的俱乐部不进列表，也不该抢走「这个号码其实是邀请码/靓号」的解释权。
func (s *Server) clubExists(ctx context.Context, clubID string) bool {
	if s.db == nil || !isPrettyCandidate(clubID) {
		return false
	}
	var one int
	err := s.db.QueryRowContext(ctx,
		`SELECT 1 FROM kbedm.club_guuid_info WHERE club_guuid = ? AND club_status NOT IN ('init', 'del') LIMIT 1`,
		clubID).Scan(&one)
	return err == nil
}

// resolvePlayerInput 把「玩家真实ID / 个人ID 靓号」统一解析成真实玩家 ID。
// 解析不到（不是靓号、靓号未绑定、号池不可用）时原样返回。
func (s *Server) resolvePlayerInput(ctx context.Context, value string) string {
	value = strings.TrimSpace(value)
	if !isPrettyCandidate(value) {
		return value
	}
	lookup, ok := s.lookupPrettyNumber(ctx, value)
	if !ok || lookup.Kind != prettyKindUID || lookup.UserID == "" {
		return value
	}
	return lookup.UserID
}

// resolveClubInput 把「俱乐部ID / 邀请码（含邀请码靓号）」统一解析成俱乐部 ID。
//
// 顺序很关键：Number 与俱乐部 ID、邀请码同形，可能撞号。
// ① 已绑定到俱乐部的邀请码（used）语义最明确，优先；
// ② 当前在用的俱乐部 ID 次之；
// ③ 任意历史码（取消代理后 disabled 的码）只做兜底；
// 都不中就原样返回，让查询自然查不到（不猜）。
func (s *Server) resolveClubInput(ctx context.Context, value string) string {
	value = strings.TrimSpace(value)
	if !isPrettyCandidate(value) {
		return value
	}
	if clubID := s.clubByInviteCodeUsed(ctx, value); clubID != "" {
		return clubID
	}
	if s.clubExists(ctx, value) {
		return value
	}
	if clubID := s.clubByInviteCode(ctx, value); clubID != "" {
		return clubID
	}
	return value
}

// resolveSearchInputs 处理「一个搜索框同时能输俱乐部ID、名称、邀请码、玩家ID」的场景。
// 返回值只在该关键字是 6 位数字时非空：识别出的俱乐部ID 与玩家ID，供调用方拼精确命中条件。
func (s *Server) resolveSearchInputs(ctx context.Context, keyword string) (clubID, playerID string) {
	keyword = strings.TrimSpace(keyword)
	if !isPrettyCandidate(keyword) {
		return "", ""
	}
	// 邀请码/邀请码靓号已绑定时优先，其次才把号码当俱乐部 ID。
	if resolved := s.clubByInviteCodeUsed(ctx, keyword); resolved != "" {
		return resolved, ""
	}
	if s.clubExists(ctx, keyword) {
		return keyword, ""
	}
	if resolved := s.clubByInviteCode(ctx, keyword); resolved != "" {
		return resolved, ""
	}
	if lookup, ok := s.lookupPrettyNumber(ctx, keyword); ok &&
		lookup.Kind == prettyKindUID && lookup.UserID != "" {
		return "", lookup.UserID
	}
	return "", ""
}
