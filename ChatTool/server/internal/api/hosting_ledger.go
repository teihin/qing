package api

import (
	"context"
	"database/sql"
	"net/http"
	"strconv"
	"strings"
	"time"

	"chattool/internal/directchat"
	"chattool/internal/security"
)

type hostingLedgerFilter struct {
	Date     string
	Owner    string
	Player   string
	AgentID  int64
	Page     int
	PageSize int
	dayStart time.Time
	dayEnd   time.Time
}

type hostingLedgerSummary struct {
	Up       int64 `json:"up"`
	Down     int64 `json:"down"`
	Give     int64 `json:"give"`
	Received int64 `json:"received"`
	Count    int64 `json:"count"`
}

type hostingLedgerItem struct {
	ID            string    `json:"id"`
	CreatedAt     time.Time `json:"createdAt"`
	OperationType string    `json:"operationType"`
	PlayerID      string    `json:"playerId"`
	PlayerName    string    `json:"playerName"`
	OwnerName     string    `json:"ownerName"`
	GroupType     string    `json:"groupType"`
	GroupName     string    `json:"groupName"`
	AgentID       int64     `json:"agentId"`
	AgentName     string    `json:"agentName"`
	Amount        int64     `json:"amount"`
	Balance       *int64    `json:"balance"`
}

type hostingLedgerRow struct {
	ID            string
	Status        string
	OperationType string
	Amount        int64
	Balance       *int64
}

func (s *Server) handleHostingLedger(w http.ResponseWriter, r *http.Request, p agentPrincipal) {
	filter, err := parseHostingLedgerFilter(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	where, args := hostingLedgerWhere(filter, p)
	var summary hostingLedgerSummary
	if err := s.db.QueryRowContext(r.Context(), `SELECT
COALESCE(SUM(CASE WHEN operation_type='up' THEN amount ELSE 0 END),0),
COALESCE(SUM(CASE WHEN operation_type='down' THEN amount ELSE 0 END),0),
COUNT(*)
FROM chat_hosting_gold_ledger WHERE status='success' AND created_at>=? AND created_at<?`+where,
		append([]any{filter.dayStart, filter.dayEnd}, args...)...).Scan(&summary.Up, &summary.Down, &summary.Count); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "读取对账汇总失败")
		return
	}
	rows, err := s.db.QueryContext(r.Context(), `SELECT id, created_at, operation_type, player_id, player_name,
owner_name, group_type, group_name, agent_id, agent_name, amount, balance
FROM chat_hosting_gold_ledger WHERE status='success' AND created_at>=? AND created_at<?`+where+
		` ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
		append(append([]any{filter.dayStart, filter.dayEnd}, args...), filter.PageSize+1,
			(filter.Page-1)*filter.PageSize)...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "读取对账记录失败")
		return
	}
	defer rows.Close()
	items := make([]hostingLedgerItem, 0, filter.PageSize)
	hasMore := false
	for rows.Next() {
		var item hostingLedgerItem
		var balance sql.NullInt64
		if err := rows.Scan(&item.ID, &item.CreatedAt, &item.OperationType, &item.PlayerID, &item.PlayerName,
			&item.OwnerName, &item.GroupType, &item.GroupName, &item.AgentID, &item.AgentName, &item.Amount, &balance); err != nil {
			writeError(w, http.StatusInternalServerError, "DB_ERROR", "读取对账记录失败")
			return
		}
		if balance.Valid {
			value := balance.Int64
			item.Balance = &value
		}
		if len(items) >= filter.PageSize {
			hasMore = true
			break
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "读取对账记录失败")
		return
	}
	scope := "self"
	if p.IsSupervisor() {
		scope = "all"
	}
	writeData(w, http.StatusOK, map[string]any{
		"date": filter.Date, "summary": summary, "items": items,
		"page": filter.Page, "pageSize": filter.PageSize, "hasMore": hasMore, "scope": scope,
	})
}

func (s *Server) handleHostingLedgerOwners(w http.ResponseWriter, r *http.Request, p agentPrincipal) {
	filter, err := parseHostingLedgerFilter(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	where, args := hostingLedgerWhere(filter, p)
	rows, err := s.db.QueryContext(r.Context(), `SELECT DISTINCT owner_name FROM chat_hosting_gold_ledger
WHERE status='success' AND created_at>=? AND created_at<? AND owner_name<>''`+where+` ORDER BY owner_name`,
		append([]any{filter.dayStart, filter.dayEnd}, args...)...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "读取盟主列表失败")
		return
	}
	defer rows.Close()
	items := make([]string, 0)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			writeError(w, http.StatusInternalServerError, "DB_ERROR", "读取盟主列表失败")
			return
		}
		items = append(items, name)
	}
	writeData(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleHostingLedgerAgents(w http.ResponseWriter, r *http.Request, p agentPrincipal) {
	filter, err := parseHostingLedgerFilter(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	where, args := hostingLedgerWhere(filter, p)
	rows, err := s.db.QueryContext(r.Context(), `SELECT agent_id, MAX(agent_name) AS name
FROM chat_hosting_gold_ledger WHERE status='success' AND created_at>=? AND created_at<?`+where+
		` GROUP BY agent_id ORDER BY name`, append([]any{filter.dayStart, filter.dayEnd}, args...)...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", "读取客服列表失败")
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id int64
		var name string
		if err := rows.Scan(&id, &name); err != nil {
			writeError(w, http.StatusInternalServerError, "DB_ERROR", "读取客服列表失败")
			return
		}
		items = append(items, map[string]any{"id": id, "name": name})
	}
	// 普通客服即使当天没有操作，也保留自己的选项，便于看到当前筛选范围。
	if !p.IsSupervisor() && len(items) == 0 {
		items = append(items, map[string]any{"id": p.ID, "name": p.DisplayName})
	}
	writeData(w, http.StatusOK, map[string]any{"items": items})
}

// parseHostingLedgerFilter 只解析日期/筛选/分页；日期按服务器本地时区自然日。
func parseHostingLedgerFilter(r *http.Request) (hostingLedgerFilter, error) {
	query := r.URL.Query()
	date := strings.TrimSpace(query.Get("date"))
	var day time.Time
	if date == "" {
		now := time.Now()
		day = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local)
		date = day.Format("2006-01-02")
	} else {
		parsed, err := time.ParseInLocation("2006-01-02", date, time.Local)
		if err != nil {
			return hostingLedgerFilter{}, errInvalidLedgerDate
		}
		day = parsed
	}
	page, _ := strconv.Atoi(query.Get("page"))
	if page < 1 {
		page = 1
	}
	pageSize, _ := strconv.Atoi(query.Get("pageSize"))
	if pageSize <= 0 {
		pageSize = 50
	}
	if pageSize > 100 {
		pageSize = 100
	}
	agentID, _ := strconv.ParseInt(strings.TrimSpace(query.Get("agentId")), 10, 64)
	if agentID < 0 {
		agentID = 0
	}
	return hostingLedgerFilter{
		Date: date, Owner: strings.TrimSpace(query.Get("owner")),
		Player: strings.TrimSpace(query.Get("player")), AgentID: agentID,
		Page: page, PageSize: pageSize, dayStart: day, dayEnd: day.Add(24 * time.Hour),
	}, nil
}

var errInvalidLedgerDate = &ledgerInputError{"日期格式不正确，应为 YYYY-MM-DD"}

type ledgerInputError struct{ message string }

func (e *ledgerInputError) Error() string { return e.message }

// hostingLedgerWhere 生成筛选条件；普通客服只能看到自己的操作。
func hostingLedgerWhere(filter hostingLedgerFilter, p agentPrincipal) (string, []any) {
	where := ""
	args := make([]any, 0)
	if filter.Owner != "" {
		where += " AND owner_name = ?"
		args = append(args, filter.Owner)
	}
	if filter.Player != "" {
		where += " AND (player_id = ? OR player_name LIKE ?)"
		args = append(args, filter.Player, "%"+filter.Player+"%")
	}
	if !p.IsSupervisor() {
		// 普通客服无论传什么客服筛选，都只能看到自己的记录。
		where += " AND agent_id = ?"
		args = append(args, p.ID)
	} else if filter.AgentID > 0 {
		where += " AND agent_id = ?"
		args = append(args, filter.AgentID)
	}
	return where, args
}

// startHostingGoldLedger 先落 pending 行占位，request_id 唯一防止双击/并发重复提交。
func (s *Server) startHostingGoldLedger(ctx context.Context, requestID string, action string,
	target directchat.HostedGoldTarget, hostedGuuid string, amount int64, p agentPrincipal) (string, *hostingLedgerRow, error) {
	if requestID == "" {
		generated, err := security.RandomID()
		if err != nil {
			return "", nil, err
		}
		requestID = generated
	}
	id, err := security.RandomID()
	if err != nil {
		return "", nil, err
	}
	result, err := s.db.ExecContext(ctx, `INSERT INTO chat_hosting_gold_ledger
(id, request_id, status, operation_type, hosted_guuid, hosted_name, group_type, group_id, group_name, club_id,
player_id, player_name, owner_name, agent_id, agent_name, amount, balance, created_at, updated_at)
VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NOW(3), NOW(3))
ON DUPLICATE KEY UPDATE updated_at = updated_at`,
		id, requestID, action, hostedGuuid, target.HostedName, target.GroupType, target.GroupID,
		target.GroupName, target.ClubID, target.PeerGuuid, target.PeerName, target.HostedName,
		p.ID, p.DisplayName, amount)
	if err != nil {
		return "", nil, err
	}
	affected, _ := result.RowsAffected()
	if affected > 0 {
		return id, nil, nil
	}
	var existing hostingLedgerRow
	var balance sql.NullInt64
	err = s.db.QueryRowContext(ctx, `SELECT id, status, operation_type, amount, balance
FROM chat_hosting_gold_ledger WHERE request_id=?`, requestID).Scan(
		&existing.ID, &existing.Status, &existing.OperationType, &existing.Amount, &balance)
	if err != nil {
		return "", nil, err
	}
	if balance.Valid {
		value := balance.Int64
		existing.Balance = &value
	}
	return existing.ID, &existing, nil
}

func (s *Server) finishHostingGoldLedger(ctx context.Context, id, status string, balance *int64, errorMessage string) error {
	var balanceArg any
	if balance != nil {
		balanceArg = *balance
	}
	_, err := s.db.ExecContext(ctx, `UPDATE chat_hosting_gold_ledger
SET status=?, balance=?, error_message=?, updated_at=NOW(3) WHERE id=?`,
		status, balanceArg, errorMessage, id)
	return err
}
