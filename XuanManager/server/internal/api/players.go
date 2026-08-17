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
	Level          *int64
	RoomID         *int64
	MinBalance     *float64
	MaxBalance     *float64
}

type playerItem struct {
	ID               int64      `json:"id"`
	PlayerID         string     `json:"playerId"`
	LoginName        string     `json:"loginName"`
	AccountName      string     `json:"accountName"`
	Name             string     `json:"name"`
	Photo            string     `json:"photo"`
	Sex              string     `json:"sex"`
	Role             string     `json:"role"`
	Gold             int64      `json:"gold"`
	Gold2            int64      `json:"gold2"`
	Balance          float64    `json:"balance"`
	Stone            int64      `json:"stone"`
	Level            int64      `json:"level"`
	VIP              int64      `json:"vip"`
	VIPLevel         int64      `json:"vipLevel"`
	AgentID          string     `json:"agentId"`
	AgentName        string     `json:"agentName"`
	RoomID           int64      `json:"roomId"`
	RoomType         string     `json:"roomType"`
	ClientVersion    string     `json:"clientVersion"`
	ClientStatus     string     `json:"clientStatus"`
	TotalRounds      int64      `json:"totalRounds"`
	TotalScore       int64      `json:"totalScore"`
	RegistrationTime string     `json:"registrationTime"`
	LastLoginAt      *time.Time `json:"lastLoginAt"`
	LoginCount       int64      `json:"loginCount"`
	Remark           string     `json:"remark"`
}

func (s *Server) handleListPlayers(w http.ResponseWriter, r *http.Request, _ principal) {
	page, size := pageParams(r)
	filters, err := parsePlayerFilters(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_FILTER", err.Error())
		return
	}
	where, args := buildPlayerWhere(filters)

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
	rows, err := s.db.QueryContext(r.Context(), `SELECT
a.id, a.sm_guuid, a.sm_wxID, COALESCE(k.accountName, ''), a.sm_name, a.sm_photo,
a.sm_sex, a.sm_role, a.sm_gold, a.sm_gold2,
(a.sm_gold + a.sm_gold2 / 100.0) AS balance, a.sm_stone, a.sm_level,
a.sm_vip, a.sm_vip_level, a.sm_agentID, COALESCE(agent.sm_name, ''),
a.sm_roomID, a.sm_roomType, a.sm_client_version, a.sm_client_status,
a.sm_totoal_round_count, a.sm_total_score, a.sm_reg_time,
DATE_ADD(FROM_UNIXTIME(NULLIF(k.lasttime, 0)), INTERVAL 8 HOUR), COALESCE(k.numlogin, 0), a.sm_remark
FROM kbedm.tbl_Account a
LEFT JOIN kbedm.kbe_accountinfos k ON k.entityDBID = a.id
LEFT JOIN kbedm.tbl_Account agent ON agent.sm_guuid = a.sm_agentID
WHERE `+where+`
ORDER BY a.id DESC
LIMIT ? OFFSET ?`, queryArgs...)
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
			&item.RoomID, &item.RoomType, &item.ClientVersion, &item.ClientStatus,
			&item.TotalRounds, &item.TotalScore, &item.RegistrationTime,
			&lastLogin, &item.LoginCount, &item.Remark,
		); err != nil {
			s.logger.Error("scan game player", "error", err)
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取游戏玩家数据失败")
			return
		}
		if lastLogin.Valid {
			item.LastLoginAt = &lastLogin.Time
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		s.logger.Error("iterate game players", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取游戏玩家数据失败")
		return
	}

	writeData(w, http.StatusOK, map[string]any{
		"items": items, "page": page, "pageSize": size, "total": total,
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
	for label, value := range map[string]string{"开始日期": filters.RegisteredFrom, "结束日期": filters.RegisteredTo} {
		if value != "" {
			if _, err := time.Parse("2006-01-02", value); err != nil {
				return playerFilters{}, fmt.Errorf("%s格式必须是 YYYY-MM-DD", label)
			}
		}
	}
	if filters.RegisteredFrom != "" && filters.RegisteredTo != "" && filters.RegisteredFrom > filters.RegisteredTo {
		return playerFilters{}, errors.New("开始日期不能晚于结束日期")
	}
	return filters, nil
}

func buildPlayerWhere(filters playerFilters) (string, []any) {
	clauses := []string{"1 = 1"}
	args := []any{}
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
	return strings.Join(clauses, " AND "), args
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
