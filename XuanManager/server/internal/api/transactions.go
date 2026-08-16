package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"
)

const (
	transactionItemCondition        = `(w.option_type LIKE '%道具%' OR w.option_type LIKE '%商城%' OR w.option_type LIKE '%购买%' OR CONCAT_WS(' ', w.remark1, w.remark2, w.remark3, w.remark4, w.remark5) LIKE '%道具%' OR CONCAT_WS(' ', w.remark1, w.remark2, w.remark3, w.remark4, w.remark5) LIKE '%商城%')`
	transactionGameCondition        = `(w.option_type IN ('带入', '打局', '结算', '芒皮', '揍芒', '休芒') OR w.option_type LIKE '%输赢%' OR w.option_type LIKE '%战绩%' OR w.option_type LIKE '%下注%' OR w.option_type LIKE '%游戏%')`
	transactionConsumptionCondition = `(w.option_type LIKE '%消费%' OR w.option_type LIKE '%支付%' OR w.option_type LIKE '%扣费%')`
	transactionAdjustmentCondition  = `(w.option_type LIKE '%充值%' OR w.option_type LIKE '%补分%' OR w.option_type LIKE '%扣分%' OR w.option_type LIKE '%退款%' OR w.option_type LIKE '%赠送%' OR w.option_type LIKE '%红包%' OR w.option_type LIKE '%转账%' OR w.option_type LIKE '%提现%')`
	transactionCategorySQL          = `CASE
WHEN ` + transactionItemCondition + ` THEN 'item'
WHEN ` + transactionGameCondition + ` THEN 'game'
WHEN ` + transactionConsumptionCondition + ` THEN 'consumption'
WHEN ` + transactionAdjustmentCondition + ` THEN 'adjustment'
ELSE 'other' END`
)

type transactionFilters struct {
	PlayerID   string
	Keyword    string
	Category   string
	Direction  string
	OptionType string
	StartDate  string
	EndDate    string
}

type transactionPlayer struct {
	PlayerID       string  `json:"playerId"`
	LoginName      string  `json:"loginName"`
	Name           string  `json:"name"`
	CurrentBalance float64 `json:"currentBalance"`
	TotalRecords   int64   `json:"totalRecords"`
}

type transactionSummary struct {
	RecordCount int64   `json:"recordCount"`
	TotalIn     float64 `json:"totalIn"`
	TotalOut    float64 `json:"totalOut"`
	NetChange   float64 `json:"netChange"`
	GameNet     float64 `json:"gameNet"`
	ItemSpend   float64 `json:"itemSpend"`
	FirstAt     string  `json:"firstAt"`
	LastAt      string  `json:"lastAt"`
}

type transactionOptionType struct {
	Name  string `json:"name"`
	Count int64  `json:"count"`
}

type transactionItem struct {
	ID                   int64   `json:"id"`
	OccurredAt           string  `json:"occurredAt"`
	Date                 string  `json:"date"`
	Time                 string  `json:"time"`
	PlayerName           string  `json:"playerName"`
	PlayerID             string  `json:"playerId"`
	OptionType           string  `json:"optionType"`
	Category             string  `json:"category"`
	Direction            string  `json:"direction"`
	OldBalance           float64 `json:"oldBalance"`
	BusinessAmount       float64 `json:"businessAmount"`
	NewBalance           float64 `json:"newBalance"`
	Change               float64 `json:"change"`
	Remark1              string  `json:"remark1"`
	Remark2              string  `json:"remark2"`
	Remark3              string  `json:"remark3"`
	Remark4              string  `json:"remark4"`
	Remark5              string  `json:"remark5"`
	MaintenanceReason    string  `json:"maintenanceReason"`
	MaintenanceOperator  string  `json:"maintenanceOperator"`
	MaintenanceWorkOrder string  `json:"maintenanceWorkOrder"`
}

type balanceAdjustmentAuditRequest struct {
	Action    string `json:"action"`
	Amount    int64  `json:"amount"`
	Reason    string `json:"reason"`
	WorkOrder string `json:"workOrder"`
}

type balanceAdjustmentAuditSnapshot struct {
	Balance float64 `json:"balance"`
}

type balanceAdjustmentAuditRecord struct {
	OperatorName string
	CreatedAt    time.Time
	Hidden       bool
	Request      balanceAdjustmentAuditRequest
	Before       balanceAdjustmentAuditSnapshot
	After        balanceAdjustmentAuditSnapshot
}

func (s *Server) handleListTransactions(w http.ResponseWriter, r *http.Request, p principal) {
	page, size := pageParams(r)
	filters, err := parseTransactionFilters(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_FILTER", err.Error())
		return
	}

	var player transactionPlayer
	err = s.db.QueryRowContext(r.Context(), `SELECT sm_guuid, sm_wxID, sm_name,
(sm_gold + sm_gold2 / 100.0),
(SELECT COUNT(*) FROM kbedm.usr_cash_water w WHERE w.user_guuid = a.sm_guuid)
FROM kbedm.tbl_Account a WHERE sm_guuid = ? LIMIT 1`, filters.PlayerID).Scan(
		&player.PlayerID, &player.LoginName, &player.Name, &player.CurrentBalance, &player.TotalRecords,
	)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "PLAYER_NOT_FOUND", "没有找到这个游戏用户ID")
		return
	}
	if err != nil {
		s.logger.Error("query transaction player", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取玩家金币信息失败")
		return
	}

	where, args := buildTransactionWhere(filters)
	deltaSQL := `ROUND(w.new_money - w.old_money, 2)`
	var summary transactionSummary
	err = s.db.QueryRowContext(r.Context(), `SELECT
COUNT(*),
COALESCE(SUM(CASE WHEN `+deltaSQL+` > 0 THEN `+deltaSQL+` ELSE 0 END), 0),
COALESCE(ABS(SUM(CASE WHEN `+deltaSQL+` < 0 THEN `+deltaSQL+` ELSE 0 END)), 0),
COALESCE(SUM(`+deltaSQL+`), 0),
COALESCE(SUM(CASE WHEN `+transactionCategorySQL+` = 'game' THEN `+deltaSQL+` ELSE 0 END), 0),
COALESCE(ABS(SUM(CASE WHEN `+transactionCategorySQL+` = 'item' AND `+deltaSQL+` < 0 THEN `+deltaSQL+` ELSE 0 END)), 0),
COALESCE(MIN(CONCAT(w.date, ' ', w.time)), ''), COALESCE(MAX(CONCAT(w.date, ' ', w.time)), '')
FROM kbedm.usr_cash_water w WHERE `+where, args...).Scan(
		&summary.RecordCount, &summary.TotalIn, &summary.TotalOut, &summary.NetChange,
		&summary.GameNet, &summary.ItemSpend, &summary.FirstAt, &summary.LastAt,
	)
	if err != nil {
		s.logger.Error("summarize transactions", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "统计金币变化失败")
		return
	}

	queryArgs := append(append([]any{}, args...), size, (page-1)*size)
	rows, err := s.db.QueryContext(r.Context(), `SELECT
w.id, w.date, w.time, w.user_name, w.user_guuid, w.option_type,
`+transactionCategorySQL+`, w.old_money, w.add_money, w.new_money, `+deltaSQL+`,
w.remark1, w.remark2, w.remark3, w.remark4, w.remark5
FROM kbedm.usr_cash_water w
WHERE `+where+`
ORDER BY w.date DESC, w.time DESC, w.id DESC
LIMIT ? OFFSET ?`, queryArgs...)
	if err != nil {
		s.logger.Error("list transactions", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取金币变化记录失败")
		return
	}
	defer rows.Close()
	items := make([]transactionItem, 0, size)
	for rows.Next() {
		var item transactionItem
		if err := rows.Scan(
			&item.ID, &item.Date, &item.Time, &item.PlayerName, &item.PlayerID, &item.OptionType,
			&item.Category, &item.OldBalance, &item.BusinessAmount, &item.NewBalance, &item.Change,
			&item.Remark1, &item.Remark2, &item.Remark3, &item.Remark4, &item.Remark5,
		); err != nil {
			s.logger.Error("scan transaction", "error", err)
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取金币变化数据失败")
			return
		}
		item.OccurredAt = strings.TrimSpace(item.Date + " " + item.Time)
		switch {
		case item.Change > 0:
			item.Direction = "in"
		case item.Change < 0:
			item.Direction = "out"
		default:
			item.Direction = "unchanged"
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		s.logger.Error("iterate transactions", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取金币变化数据失败")
		return
	}
	if err := s.attachBalanceAdjustmentAudit(r.Context(), p, filters.PlayerID, items); err != nil {
		s.logger.Error("attach balance adjustment audit", "error", err, "playerId", filters.PlayerID)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取客服维护原因失败")
		return
	}

	optionTypes, err := s.queryTransactionOptionTypes(r, filters.PlayerID)
	if err != nil {
		s.logger.Error("query transaction option types", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取交易类型失败")
		return
	}
	writeData(w, http.StatusOK, map[string]any{
		"player": player, "summary": summary, "optionTypes": optionTypes,
		"items": items, "page": page, "pageSize": size, "total": summary.RecordCount,
	})
}

func (s *Server) attachBalanceAdjustmentAudit(ctx context.Context, p principal, playerID string, items []transactionItem) error {
	if len(items) == 0 {
		return nil
	}
	startDate, endDate := items[0].Date, items[0].Date
	for _, item := range items[1:] {
		if item.Date < startDate {
			startDate = item.Date
		}
		if item.Date > endDate {
			endDate = item.Date
		}
	}
	rows, err := s.db.QueryContext(ctx, `SELECT audit_row.operator_name, audit_row.request_json, audit_row.before_json,
audit_row.after_json, audit_row.created_at, COALESCE(operator_user.username = 'admin999', 0)
FROM mgr_audit_log audit_row
LEFT JOIN mgr_user operator_user ON operator_user.id = audit_row.operator_id
WHERE audit_row.action = 'game.player.balance_adjust' AND audit_row.target_type = 'game_player' AND audit_row.target_id = ?
  AND audit_row.created_at >= ? AND audit_row.created_at < DATE_ADD(?, INTERVAL 1 DAY)
ORDER BY audit_row.created_at DESC, audit_row.id DESC`, playerID, startDate, endDate)
	if err != nil {
		return err
	}
	defer rows.Close()
	audits := make([]balanceAdjustmentAuditRecord, 0)
	for rows.Next() {
		var audit balanceAdjustmentAuditRecord
		var requestJSON string
		var beforeJSON, afterJSON sql.NullString
		var operatorIsSuper bool
		if err := rows.Scan(&audit.OperatorName, &requestJSON, &beforeJSON, &afterJSON, &audit.CreatedAt, &operatorIsSuper); err != nil {
			return err
		}
		audit.Hidden = hideSuperUserFrom(p, operatorIsSuper)
		if json.Unmarshal([]byte(requestJSON), &audit.Request) != nil ||
			!beforeJSON.Valid || json.Unmarshal([]byte(beforeJSON.String), &audit.Before) != nil ||
			strings.TrimSpace(audit.Request.Reason) == "" {
			continue
		}
		if !afterJSON.Valid || json.Unmarshal([]byte(afterJSON.String), &audit.After) != nil {
			audit.After.Balance = audit.Before.Balance
			if audit.Request.Action == "add" {
				audit.After.Balance += float64(audit.Request.Amount)
			} else if audit.Request.Action == "subtract" {
				audit.After.Balance -= float64(audit.Request.Amount)
			} else {
				continue
			}
		}
		audits = append(audits, audit)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	matchBalanceAdjustmentAudits(items, audits)
	return nil
}

func matchBalanceAdjustmentAudits(items []transactionItem, audits []balanceAdjustmentAuditRecord) {
	used := make([]bool, len(items))
	for _, audit := range audits {
		bestIndex := -1
		bestDistance := 31 * time.Second
		for index := range items {
			item := &items[index]
			if used[index] || math.Abs(item.OldBalance-audit.Before.Balance) > 0.005 || math.Abs(item.NewBalance-audit.After.Balance) > 0.005 {
				continue
			}
			if audit.Request.Action == "add" && item.Change <= 0 || audit.Request.Action == "subtract" && item.Change >= 0 {
				continue
			}
			occurredAt, err := time.ParseInLocation("2006-01-02 15:04:05", item.OccurredAt, audit.CreatedAt.Location())
			if err != nil {
				continue
			}
			distance := audit.CreatedAt.Sub(occurredAt)
			if distance < 0 {
				distance = -distance
			}
			if distance <= 30*time.Second && distance < bestDistance {
				bestIndex, bestDistance = index, distance
			}
		}
		if bestIndex < 0 {
			continue
		}
		used[bestIndex] = true
		if audit.Hidden {
			continue
		}
		items[bestIndex].MaintenanceReason = audit.Request.Reason
		items[bestIndex].MaintenanceOperator = audit.OperatorName
		items[bestIndex].MaintenanceWorkOrder = audit.Request.WorkOrder
	}
}

func parseTransactionFilters(r *http.Request) (transactionFilters, error) {
	query := r.URL.Query()
	filters := transactionFilters{
		PlayerID: strings.TrimSpace(query.Get("playerId")), Keyword: strings.TrimSpace(query.Get("keyword")),
		Category: strings.TrimSpace(query.Get("category")), Direction: strings.TrimSpace(query.Get("direction")),
		OptionType: strings.TrimSpace(query.Get("optionType")), StartDate: strings.TrimSpace(query.Get("startDate")),
		EndDate: strings.TrimSpace(query.Get("endDate")),
	}
	if !validGameID(filters.PlayerID) {
		return transactionFilters{}, errors.New("请输入正确的游戏用户ID")
	}
	for _, value := range []string{filters.Keyword, filters.OptionType} {
		if len([]rune(value)) > 100 {
			return transactionFilters{}, errors.New("查询文字不能超过 100 个字符")
		}
	}
	if filters.Category == "" {
		filters.Category = "all"
	}
	if filters.Direction == "" {
		filters.Direction = "all"
	}
	validCategories := map[string]bool{"all": true, "game": true, "item": true, "consumption": true, "adjustment": true, "other": true}
	validDirections := map[string]bool{"all": true, "in": true, "out": true, "unchanged": true}
	if !validCategories[filters.Category] {
		return transactionFilters{}, errors.New("交易分类不正确")
	}
	if !validDirections[filters.Direction] {
		return transactionFilters{}, errors.New("金币变化方向不正确")
	}
	for label, value := range map[string]string{"开始日期": filters.StartDate, "结束日期": filters.EndDate} {
		if value != "" {
			if _, err := time.Parse("2006-01-02", value); err != nil {
				return transactionFilters{}, fmt.Errorf("%s格式必须是 YYYY-MM-DD", label)
			}
		}
	}
	if filters.StartDate != "" && filters.EndDate != "" && filters.StartDate > filters.EndDate {
		return transactionFilters{}, errors.New("开始日期不能晚于结束日期")
	}
	return filters, nil
}

func buildTransactionWhere(filters transactionFilters) (string, []any) {
	clauses := []string{"w.user_guuid = ?"}
	args := []any{filters.PlayerID}
	if filters.StartDate != "" {
		clauses = append(clauses, "w.date >= ?")
		args = append(args, filters.StartDate)
	}
	if filters.EndDate != "" {
		clauses = append(clauses, "w.date <= ?")
		args = append(args, filters.EndDate)
	}
	if filters.OptionType != "" {
		clauses = append(clauses, "w.option_type = ?")
		args = append(args, filters.OptionType)
	}
	if filters.Category != "all" {
		clauses = append(clauses, transactionCategorySQL+" = ?")
		args = append(args, filters.Category)
	}
	deltaSQL := "ROUND(w.new_money - w.old_money, 2)"
	switch filters.Direction {
	case "in":
		clauses = append(clauses, deltaSQL+" > 0")
	case "out":
		clauses = append(clauses, deltaSQL+" < 0")
	case "unchanged":
		clauses = append(clauses, deltaSQL+" = 0")
	}
	if filters.Keyword != "" {
		like := "%" + filters.Keyword + "%"
		clauses = append(clauses, `(w.option_type LIKE ? OR w.remark1 LIKE ? OR w.remark2 LIKE ? OR w.remark3 LIKE ? OR w.remark4 LIKE ? OR w.remark5 LIKE ?)`)
		args = append(args, like, like, like, like, like, like)
	}
	return strings.Join(clauses, " AND "), args
}

func (s *Server) queryTransactionOptionTypes(r *http.Request, playerID string) ([]transactionOptionType, error) {
	rows, err := s.db.QueryContext(r.Context(), `SELECT option_type, COUNT(*)
FROM kbedm.usr_cash_water WHERE user_guuid = ? GROUP BY option_type ORDER BY COUNT(*) DESC, option_type`, playerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []transactionOptionType{}
	for rows.Next() {
		var item transactionOptionType
		if err := rows.Scan(&item.Name, &item.Count); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
