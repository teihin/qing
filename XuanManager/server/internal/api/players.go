package api

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type playerFilters struct {
	Keyword        string
	PlayerID       string
	Name           string
	LoginName      string
	AgentID        string
	AgentName      string
	Role           string
	ClientStatus   string
	ClientVersion  string
	RegisteredFrom string
	RegisteredTo   string
	LoginFrom      string
	LoginTo        string
	Level          *int64
	RoomID         *int64
	MinBalance     *float64
	MaxBalance     *float64
	BossOnly       bool
	// IPAddress 是 IP短码 解码后的 IPv4，按 tbl_Account.sm_ip 精确匹配。
	IPAddress string
}

type playerItem struct {
	ID          int64  `json:"id"`
	PlayerID    string `json:"playerId"`
	LoginName   string `json:"loginName"`
	AccountName string `json:"accountName"`
	// LoginPassword 是玩家登录密码的明文副本（mgr_player_login_password，AES-GCM 密文解密后）。
	// 游戏端只存 MD5、无法还原，所以只有 XuanManager 亲历过改密（注册/后台重置/自助改密）的账号才有值；
	// PasswordRecorded 为 false 表示历史密码未收录。只在管理员查询时填充。
	LoginPassword    string  `json:"loginPassword,omitempty"`
	PasswordRecorded bool    `json:"passwordRecorded"`
	Name             string  `json:"name"`
	Photo            string  `json:"photo"`
	Sex              string  `json:"sex"`
	Role             string  `json:"role"`
	Gold             int64   `json:"gold"`
	Gold2            int64   `json:"gold2"`
	Balance          float64 `json:"balance"`
	Stone            int64   `json:"stone"`
	Level            int64   `json:"level"`
	VIP              int64   `json:"vip"`
	VIPLevel         int64   `json:"vipLevel"`
	AgentID          string  `json:"agentId"`
	AgentName        string  `json:"agentName"`
	RoomID           int64   `json:"roomId"`
	RoomType         string  `json:"roomType"`
	ClientVersion    string  `json:"clientVersion"`
	ClientStatus     string  `json:"clientStatus"`
	// IPCode 是最近上报 IP（tbl_Account.sm_ip）的 6 位短码；原始 IP 不在列表返回。
	IPCode           string     `json:"ipCode"`
	TotalRounds      int64      `json:"totalRounds"`
	TotalScore       int64      `json:"totalScore"`
	RegistrationTime string     `json:"registrationTime"`
	LastLoginAt      *time.Time `json:"lastLoginAt"`
	LoginCount       int64      `json:"loginCount"`
	Remark           string     `json:"remark"`
	// IsBoss 是后台口径的「大小BOSS」：已配置可管理联盟（union_manage）或俱乐部（club_manage）的账号。
	// 不再按等级 99 / 董事长 / 总裁判定；等级只影响游戏内身份显示，不决定管理范围。
	IsBoss bool `json:"isBoss"`
	// UnionManage / ClubManage 是逗号分隔的授权范围，直接给后台配置弹窗回显。
	UnionManage string `json:"unionManage"`
	ClubManage  string `json:"clubManage"`
	// UnionManageNames / ClubManageNames 是按授权顺序解析出的名称，供列表直接展示管理范围。
	// 找不到名称时 name 为空串，前端回退显示编号。
	UnionManageNames []manageScopeName   `json:"unionManageNames"`
	ClubManageNames  []manageScopeName   `json:"clubManageNames"`
	Clubs            []playerClubSummary `json:"clubs"`

	// 俱乐部关系分散在五个逗号分隔列里，只用于拼 Clubs，不直接返回前端。
	clubMake  string
	clubJoin  string
	clubMake2 string
	clubJoin2 string
	ip        string
}

// 玩家登录密码只对管理员返回。管理员 = `super_admin` 角色（含 admin999 超级管理员
// 和同角色的普通管理员 admin，也兼容旧 is_super 标记），由 isEffectiveSuper 统一判定；
// 客服等其他角色即使有 game.player.view 也拿不到该字段。
func canViewPlayerLoginPassword(p principal) bool {
	return p.IsSuper
}

func (s *Server) handleListPlayers(w http.ResponseWriter, r *http.Request, p principal) {
	page, size := pageParams(r)
	canViewPassword := canViewPlayerLoginPassword(p)
	filters, err := parsePlayerFilters(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_FILTER", err.Error())
		return
	}
	// 游戏服尚未部署 union_manage 时列不存在；先探测再拼 SQL，避免整个玩家列表报错。
	hasUnionManage := s.hasManageScopeColumn(r.Context())
	where, args := buildPlayerWhere(filters, hasUnionManage)

	var total int64
	countQuery := `SELECT COUNT(DISTINCT a.id)
FROM kbedm.tbl_Account a
LEFT JOIN kbedm.kbe_accountinfos k ON k.entityDBID = a.id
LEFT JOIN kbedm.tbl_Account agent ON agent.sm_guuid = a.sm_agentID
WHERE ` + where
	if err := s.db.QueryRowContext(r.Context(), countQuery, args...).Scan(&total); err != nil {
		s.logger.Error("count game players", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取游戏玩家数量失败")
		return
	}

	queryArgs := append(append([]any{}, args...), size, (page-1)*size)
	unionManageExpr := "''"
	bossExpr := "COALESCE(TRIM(a.sm_club_manage), '') <> ''"
	if hasUnionManage {
		unionManageExpr = "COALESCE(a.sm_union_manage, '')"
		bossExpr = "(COALESCE(TRIM(a.sm_union_manage), '') <> '' OR COALESCE(TRIM(a.sm_club_manage), '') <> '')"
	}
	// 时间口径：MySQL 会话时区为 SYSTEM（Asia/Shanghai），库里的 DATETIME、NOW()、
	// CURRENT_TIMESTAMP、FROM_UNIXTIME() 拿到的都已经是北京时间墙上时间，查询时不得再叠加 8 小时。
	listQuery := fmt.Sprintf(`SELECT
a.id, a.sm_guuid, a.sm_wxID, COALESCE(k.accountName, ''), a.sm_name, a.sm_photo,
a.sm_sex, a.sm_role, a.sm_gold, a.sm_gold2,
(a.sm_gold + a.sm_gold2 / 100.0) AS balance, a.sm_stone, a.sm_level,
a.sm_vip, a.sm_vip_level, a.sm_agentID, COALESCE(agent.sm_name, ''),
a.sm_roomID, a.sm_roomType, a.sm_client_version, a.sm_client_status, COALESCE(a.sm_ip, ''),
a.sm_totoal_round_count, a.sm_total_score, a.sm_reg_time,
FROM_UNIXTIME(NULLIF(k.lasttime, 0)), COALESCE(k.numlogin, 0), a.sm_remark,
COALESCE(a.sm_club_make, ''), COALESCE(a.sm_club_join, ''),
COALESCE(a.sm_club_make2, ''), COALESCE(a.sm_club_join2, ''),
COALESCE(a.sm_club_manage, ''), %s, %s
FROM kbedm.tbl_Account a
LEFT JOIN kbedm.kbe_accountinfos k ON k.entityDBID = a.id
LEFT JOIN kbedm.tbl_Account agent ON agent.sm_guuid = a.sm_agentID
WHERE %s
ORDER BY a.id DESC
LIMIT ? OFFSET ?`, unionManageExpr, bossExpr, where)
	rows, err := s.db.QueryContext(r.Context(), listQuery, queryArgs...)
	if err != nil {
		s.logger.Error("list game players", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取游戏玩家列表失败")
		return
	}
	defer rows.Close()

	items := make([]playerItem, 0, size)
	for rows.Next() {
		var item playerItem
		var lastLogin sql.NullTime
		if err := rows.Scan(
			&item.ID, &item.PlayerID, &item.LoginName, &item.AccountName, &item.Name, &item.Photo,
			&item.Sex, &item.Role, &item.Gold, &item.Gold2, &item.Balance, &item.Stone, &item.Level,
			&item.VIP, &item.VIPLevel, &item.AgentID, &item.AgentName,
			&item.RoomID, &item.RoomType, &item.ClientVersion, &item.ClientStatus, &item.ip,
			&item.TotalRounds, &item.TotalScore, &item.RegistrationTime,
			&lastLogin, &item.LoginCount, &item.Remark,
			&item.clubMake, &item.clubJoin, &item.clubMake2, &item.clubJoin2, &item.ClubManage,
			&item.UnionManage, &item.IsBoss,
		); err != nil {
			s.logger.Error("scan game player", "error", err)
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取游戏玩家数据失败")
			return
		}
		if lastLogin.Valid {
			item.LastLoginAt = &lastLogin.Time
		}
		item.IPCode = EncodeIPCode(item.ip)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		s.logger.Error("iterate game players", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取游戏玩家数据失败")
		return
	}
	if canViewPassword {
		if err := s.attachPlayerLoginPasswords(r.Context(), items); err != nil {
			// 密码副本读取失败不能拖垮整个玩家列表；字段留空，前端显示「未收录」。
			s.logger.Error("attach player login passwords", "error", err)
		}
	}
	if err := s.attachPlayerClubs(r.Context(), items); err != nil {
		s.logger.Error("attach player clubs", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取玩家所在俱乐部失败")
		return
	}
	// 管理范围名称只用于展示，批量解析失败不能拖垮整个玩家列表。
	if err := s.attachPlayerManageScopeNames(r.Context(), items); err != nil {
		s.logger.Error("attach player manage scope names", "error", err)
	}

	writeData(w, http.StatusOK, map[string]any{
		"items": items, "page": page, "pageSize": size, "total": total,
		"canViewPassword": canViewPassword,
	})
}

func parsePlayerFilters(r *http.Request) (playerFilters, error) {
	query := r.URL.Query()
	filters := playerFilters{
		Keyword:        strings.TrimSpace(query.Get("keyword")),
		PlayerID:       strings.TrimSpace(query.Get("playerId")),
		Name:           strings.TrimSpace(query.Get("name")),
		LoginName:      strings.TrimSpace(query.Get("loginName")),
		AgentID:        strings.TrimSpace(query.Get("agentId")),
		AgentName:      strings.TrimSpace(query.Get("agentName")),
		Role:           strings.TrimSpace(query.Get("role")),
		ClientStatus:   strings.TrimSpace(query.Get("clientStatus")),
		ClientVersion:  strings.TrimSpace(query.Get("clientVersion")),
		RegisteredFrom: strings.TrimSpace(query.Get("registeredFrom")),
		RegisteredTo:   strings.TrimSpace(query.Get("registeredTo")),
		LoginFrom:      strings.TrimSpace(query.Get("loginFrom")),
		LoginTo:        strings.TrimSpace(query.Get("loginTo")),
		BossOnly:       isTruthyQueryValue(query.Get("boss")),
	}
	if ipCode := strings.TrimSpace(query.Get("ipCode")); ipCode != "" {
		ip, err := DecodeIPCode(ipCode)
		if err != nil {
			return playerFilters{}, err
		}
		filters.IPAddress = ip
	}
	for _, value := range []string{
		filters.Keyword, filters.PlayerID, filters.Name, filters.LoginName, filters.AgentID,
		filters.AgentName, filters.Role, filters.ClientStatus, filters.ClientVersion,
	} {
		if len([]rune(value)) > 100 {
			return playerFilters{}, errors.New("查询文字不能超过 100 个字符")
		}
	}
	var err error
	if filters.Level, err = optionalInt(query.Get("level"), "玩家等级", 0, 10000); err != nil {
		return playerFilters{}, err
	}
	if filters.RoomID, err = optionalInt(query.Get("roomId"), "房间 ID", 0, 1<<31-1); err != nil {
		return playerFilters{}, err
	}
	if filters.MinBalance, err = optionalFloat(query.Get("minBalance"), "最低余额"); err != nil {
		return playerFilters{}, err
	}
	if filters.MaxBalance, err = optionalFloat(query.Get("maxBalance"), "最高余额"); err != nil {
		return playerFilters{}, err
	}
	if filters.MinBalance != nil && filters.MaxBalance != nil && *filters.MinBalance > *filters.MaxBalance {
		return playerFilters{}, errors.New("最低余额不能大于最高余额")
	}
	for label, value := range map[string]string{
		"注册开始日期": filters.RegisteredFrom,
		"注册结束日期": filters.RegisteredTo,
		"登录开始日期": filters.LoginFrom,
		"登录结束日期": filters.LoginTo,
	} {
		if value != "" {
			if _, err := time.Parse("2006-01-02", value); err != nil {
				return playerFilters{}, fmt.Errorf("%s格式必须是 YYYY-MM-DD", label)
			}
		}
	}
	if filters.RegisteredFrom != "" && filters.RegisteredTo != "" && filters.RegisteredFrom > filters.RegisteredTo {
		return playerFilters{}, errors.New("注册开始日期不能晚于注册结束日期")
	}
	if filters.LoginFrom != "" && filters.LoginTo != "" && filters.LoginFrom > filters.LoginTo {
		return playerFilters{}, errors.New("登录开始日期不能晚于登录结束日期")
	}
	return filters, nil
}

func buildPlayerWhere(filters playerFilters, hasUnionManage bool) (string, []any) {
	clauses := []string{"1 = 1"}
	args := []any{}
	if filters.BossOnly {
		// 大小BOSS 条件：已配置可管理联盟或俱乐部；不再看等级 / 董事长 / 总裁。
		if hasUnionManage {
			clauses = append(clauses, "(COALESCE(TRIM(a.sm_union_manage), '') <> '' OR COALESCE(TRIM(a.sm_club_manage), '') <> '')")
		} else {
			// 游戏服还没部署 union_manage 列时只能按 club_manage 筛，避免整条查询报错。
			clauses = append(clauses, "COALESCE(TRIM(a.sm_club_manage), '') <> ''")
		}
	}
	if filters.Keyword != "" {
		like := "%" + filters.Keyword + "%"
		clauses = append(clauses, `(a.sm_guuid = ? OR a.sm_wxID = ? OR a.sm_name LIKE ? OR
k.accountName = ? OR a.sm_agentID = ? OR agent.sm_name LIKE ?)`)
		args = append(args, filters.Keyword, filters.Keyword, like, filters.Keyword, filters.Keyword, like)
	}
	addExact := func(column string, value string) {
		if value != "" {
			clauses = append(clauses, column+" = ?")
			args = append(args, value)
		}
	}
	addLike := func(column string, value string) {
		if value != "" {
			clauses = append(clauses, column+" LIKE ?")
			args = append(args, "%"+value+"%")
		}
	}
	addExact("a.sm_guuid", filters.PlayerID)
	addLike("a.sm_name", filters.Name)
	if filters.LoginName != "" {
		like := "%" + filters.LoginName + "%"
		clauses = append(clauses, "(a.sm_wxID LIKE ? OR k.accountName LIKE ?)")
		args = append(args, like, like)
	}
	addExact("a.sm_agentID", filters.AgentID)
	addLike("agent.sm_name", filters.AgentName)
	addLike("a.sm_role", filters.Role)
	addExact("a.sm_client_status", filters.ClientStatus)
	addExact("a.sm_client_version", filters.ClientVersion)
	addExact("a.sm_ip", filters.IPAddress)
	if filters.Level != nil {
		clauses = append(clauses, "a.sm_level = ?")
		args = append(args, *filters.Level)
	}
	if filters.RoomID != nil {
		clauses = append(clauses, "a.sm_roomID = ?")
		args = append(args, *filters.RoomID)
	}
	if filters.MinBalance != nil {
		clauses = append(clauses, "(a.sm_gold + a.sm_gold2 / 100.0) >= ?")
		args = append(args, *filters.MinBalance)
	}
	if filters.MaxBalance != nil {
		clauses = append(clauses, "(a.sm_gold + a.sm_gold2 / 100.0) <= ?")
		args = append(args, *filters.MaxBalance)
	}
	if filters.RegisteredFrom != "" {
		clauses = append(clauses, "a.sm_reg_time >= CONCAT(?, ' 00:00:00')")
		args = append(args, filters.RegisteredFrom)
	}
	if filters.RegisteredTo != "" {
		clauses = append(clauses, "a.sm_reg_time <= CONCAT(?, ' 23:59:59')")
		args = append(args, filters.RegisteredTo)
	}
	// 登录时间取 kbe_accountinfos.lasttime（Unix 秒）。会话时区为 +08，
	// UNIX_TIMESTAMP 按北京时间解释日期串，所以日界就是北京时间当天 00:00:00–23:59:59。
	if filters.LoginFrom != "" {
		clauses = append(clauses, "k.lasttime >= UNIX_TIMESTAMP(CONCAT(?, ' 00:00:00'))")
		args = append(args, filters.LoginFrom)
	}
	if filters.LoginTo != "" {
		clauses = append(clauses, "k.lasttime <= UNIX_TIMESTAMP(CONCAT(?, ' 23:59:59'))")
		args = append(args, filters.LoginTo)
	}
	return strings.Join(clauses, " AND "), args
}

func isTruthyQueryValue(raw string) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "1", "true":
		return true
	default:
		return false
	}
}

func optionalInt(raw, label string, min, max int64) (*int64, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value < min || value > max {
		return nil, fmt.Errorf("%s不正确", label)
	}
	return &value, nil
}

func optionalFloat(raw, label string) (*float64, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil || value < -1e12 || value > 1e12 {
		return nil, fmt.Errorf("%s不正确", label)
	}
	return &value, nil
}
