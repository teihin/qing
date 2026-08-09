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

type agentBonusFilters struct {
	Kind           string
	SourcePlayerID string
	RoomID         string
	DateFrom       string
	DateTo         string
}

type agentBonusSummary struct {
	TotalBonus              float64 `json:"totalBonus"`
	WithdrawnBonus          float64 `json:"withdrawnBonus"`
	RemainingBonus          float64 `json:"remainingBonus"`
	IncomeSourceTotal       float64 `json:"incomeSourceTotal"`
	IncomeSourceCount       int64   `json:"incomeSourceCount"`
	WithdrawalRecordTotal   float64 `json:"withdrawalRecordTotal"`
	WithdrawalRecordCount   int64   `json:"withdrawalRecordCount"`
	UnrecordedWithdrawal    float64 `json:"unrecordedWithdrawal"`
	AccountBalanceMatches   bool    `json:"accountBalanceMatches"`
	IncomeSourcesMatchTotal bool    `json:"incomeSourcesMatchTotal"`
}

type agentBonusItem struct {
	ID                string  `json:"id"`
	Type              string  `json:"type"`
	OccurredAt        string  `json:"occurredAt"`
	Date              string  `json:"date"`
	Time              string  `json:"time"`
	Amount            float64 `json:"amount"`
	SourceType        string  `json:"sourceType"`
	SourceDescription string  `json:"sourceDescription"`
	SourcePlayerID    string  `json:"sourcePlayerId"`
	SourcePlayerName  string  `json:"sourcePlayerName"`
	RoomID            string  `json:"roomId"`
	RoomName          string  `json:"roomName"`
	SourceBase        float64 `json:"sourceBase"`
	Rate              float64 `json:"rate"`
	SourceLevel       string  `json:"sourceLevel"`
}

type agentBonusResponse struct {
	AgentID   string            `json:"agentId"`
	AgentName string            `json:"agentName"`
	Summary   agentBonusSummary `json:"summary"`
	Items     []agentBonusItem  `json:"items"`
	Page      int               `json:"page"`
	PageSize  int               `json:"pageSize"`
	Total     int64             `json:"total"`
}

func (s *Server) handleAgentBonuses(w http.ResponseWriter, r *http.Request, _ principal) {
	agentID := strings.TrimSpace(r.PathValue("agentId"))
	if !validAgentID(agentID) {
		writeError(w, http.StatusBadRequest, "INVALID_AGENT_ID", "代理 ID 不正确")
		return
	}
	selected, err := s.queryAgentItem(r.Context(), agentID)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && !selected.isAgentCandidate()) {
		writeError(w, http.StatusNotFound, "AGENT_NOT_FOUND", "代理不存在")
		return
	}
	if err != nil {
		s.logger.Error("query agent before bonuses", "error", err, "agentId", agentID)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取代理失败")
		return
	}

	filters, err := parseAgentBonusFilters(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_FILTER", err.Error())
		return
	}
	page, size := pageParams(r)

	var remainingRaw, totalRaw, withdrawnRaw int64
	if err := s.db.QueryRowContext(r.Context(), `SELECT sm_hongli, sm_all_hongli, sm_use_hongli
FROM kbedm.tbl_Account WHERE sm_guuid = ?`, agentID).Scan(&remainingRaw, &totalRaw, &withdrawnRaw); err != nil {
		s.logger.Error("query agent bonus balances", "error", err, "agentId", agentID)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取代理红利汇总失败")
		return
	}

	var incomeCount, incomeRaw, withdrawalCount, withdrawalRecordedRaw int64
	if err := s.db.QueryRowContext(r.Context(), `SELECT COUNT(*), COALESCE(SUM(tax_number), 0)
FROM kbedm.usr_income_info WHERE proxy_guuid = ?`, agentID).Scan(&incomeCount, &incomeRaw); err != nil {
		s.logger.Error("summarize agent bonus income", "error", err, "agentId", agentID)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取代理红利来源汇总失败")
		return
	}
	if err := s.db.QueryRowContext(r.Context(), `SELECT COUNT(*), COALESCE(SUM(ABS(activity_int)), 0)
FROM kbedm.usr_activity_info_sub_hongli
WHERE user_guuid = ? AND (activity_int < 0 OR activity_type LIKE '%提取%')`, agentID).Scan(&withdrawalCount, &withdrawalRecordedRaw); err != nil {
		s.logger.Error("summarize agent bonus withdrawals", "error", err, "agentId", agentID)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取代理红利提取汇总失败")
		return
	}

	ledgerSQL, ledgerArgs := buildAgentBonusLedger(agentID, filters)
	items := []agentBonusItem{}
	var total int64
	if ledgerSQL != "" {
		if err := s.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM (`+ledgerSQL+`) bonus_ledger`, ledgerArgs...).Scan(&total); err != nil {
			s.logger.Error("count agent bonus ledger", "error", err, "agentId", agentID)
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取代理红利流水数量失败")
			return
		}
		queryArgs := append(append([]any{}, ledgerArgs...), size, (page-1)*size)
		rows, err := s.db.QueryContext(r.Context(), `SELECT ledger_id, source_id, event_date, event_time, flow_type, raw_amount,
source_player_id, source_player_name, room_id, room_name, source_base, source_rate, source_level, source_note
FROM (`+ledgerSQL+`) bonus_ledger
ORDER BY event_date DESC, event_time DESC, source_id DESC
LIMIT ? OFFSET ?`, queryArgs...)
		if err != nil {
			s.logger.Error("list agent bonus ledger", "error", err, "agentId", agentID)
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取代理红利流水失败")
			return
		}
		defer rows.Close()
		items = make([]agentBonusItem, 0, size)
		for rows.Next() {
			var item agentBonusItem
			var sourceID, rawAmount int64
			var sourceBase, sourceRate string
			var sourceNote string
			if err := rows.Scan(
				&item.ID, &sourceID, &item.Date, &item.Time, &item.Type, &rawAmount,
				&item.SourcePlayerID, &item.SourcePlayerName, &item.RoomID, &item.RoomName,
				&sourceBase, &sourceRate, &item.SourceLevel, &sourceNote,
			); err != nil {
				s.logger.Error("scan agent bonus ledger", "error", err, "agentId", agentID)
				writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取代理红利流水失败")
				return
			}
			item.Amount = bonusAmount(rawAmount)
			item.SourceBase = decimalString(sourceBase)
			item.Rate = decimalString(sourceRate)
			item.OccurredAt = strings.TrimSpace(strings.TrimSpace(item.Date) + " " + strings.TrimSpace(item.Time))
			if item.Type == "income" {
				item.SourceType = "对局红利"
				item.SourceDescription = bonusIncomeDescription(item.SourcePlayerName, item.SourcePlayerID, item.RoomID)
			} else {
				item.SourceType = "红利提取"
				item.SourceDescription = strings.TrimSpace(sourceNote)
				if item.SourceDescription == "" {
					item.SourceDescription = "代理提取红利"
				}
			}
			items = append(items, item)
		}
		if err := rows.Err(); err != nil {
			s.logger.Error("iterate agent bonus ledger", "error", err, "agentId", agentID)
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取代理红利流水失败")
			return
		}
	}

	unrecordedWithdrawalRaw := withdrawnRaw - withdrawalRecordedRaw
	if unrecordedWithdrawalRaw < 0 {
		unrecordedWithdrawalRaw = 0
	}
	writeData(w, http.StatusOK, agentBonusResponse{
		AgentID: agentID, AgentName: selected.Name,
		Summary: agentBonusSummary{
			TotalBonus: bonusAmount(totalRaw), WithdrawnBonus: bonusAmount(withdrawnRaw), RemainingBonus: bonusAmount(remainingRaw),
			IncomeSourceTotal: bonusAmount(incomeRaw), IncomeSourceCount: incomeCount,
			WithdrawalRecordTotal: bonusAmount(withdrawalRecordedRaw), WithdrawalRecordCount: withdrawalCount,
			UnrecordedWithdrawal:    bonusAmount(unrecordedWithdrawalRaw),
			AccountBalanceMatches:   totalRaw == remainingRaw+withdrawnRaw,
			IncomeSourcesMatchTotal: incomeRaw == totalRaw,
		},
		Items: items, Page: page, PageSize: size, Total: total,
	})
}

func parseAgentBonusFilters(r *http.Request) (agentBonusFilters, error) {
	query := r.URL.Query()
	filters := agentBonusFilters{
		Kind: strings.TrimSpace(query.Get("type")), SourcePlayerID: strings.TrimSpace(query.Get("sourcePlayerId")),
		RoomID: strings.TrimSpace(query.Get("roomId")), DateFrom: strings.TrimSpace(query.Get("dateFrom")), DateTo: strings.TrimSpace(query.Get("dateTo")),
	}
	if filters.Kind == "" {
		filters.Kind = "all"
	}
	if filters.Kind != "all" && filters.Kind != "income" && filters.Kind != "withdrawal" {
		return agentBonusFilters{}, errors.New("流水类型不正确")
	}
	if filters.SourcePlayerID != "" && !validAgentID(filters.SourcePlayerID) {
		return agentBonusFilters{}, errors.New("来源玩家 ID 不正确")
	}
	if filters.RoomID != "" {
		if _, err := strconv.ParseUint(filters.RoomID, 10, 64); err != nil || len(filters.RoomID) > 20 {
			return agentBonusFilters{}, errors.New("房间号不正确")
		}
	}
	for label, value := range map[string]string{"开始日期": filters.DateFrom, "结束日期": filters.DateTo} {
		if value != "" {
			if _, err := time.Parse("2006-01-02", value); err != nil {
				return agentBonusFilters{}, fmt.Errorf("%s格式必须是 YYYY-MM-DD", label)
			}
		}
	}
	if filters.DateFrom != "" && filters.DateTo != "" && filters.DateFrom > filters.DateTo {
		return agentBonusFilters{}, errors.New("开始日期不能晚于结束日期")
	}
	return filters, nil
}

func buildAgentBonusLedger(agentID string, filters agentBonusFilters) (string, []any) {
	segments := []string{}
	args := []any{}
	if filters.Kind == "all" || filters.Kind == "income" {
		where := []string{"i.proxy_guuid = ?"}
		incomeArgs := []any{agentID}
		if filters.SourcePlayerID != "" {
			where = append(where, "i.winner_guuid = ?")
			incomeArgs = append(incomeArgs, filters.SourcePlayerID)
		}
		if filters.RoomID != "" {
			where = append(where, "i.roomID = ?")
			incomeArgs = append(incomeArgs, filters.RoomID)
		}
		if filters.DateFrom != "" {
			where = append(where, "i.date >= ?")
			incomeArgs = append(incomeArgs, filters.DateFrom)
		}
		if filters.DateTo != "" {
			where = append(where, "i.date <= ?")
			incomeArgs = append(incomeArgs, filters.DateTo)
		}
		segments = append(segments, `SELECT CONCAT('income:', i.id) AS ledger_id, i.id AS source_id,
i.date AS event_date, i.time AS event_time, 'income' AS flow_type, i.tax_number AS raw_amount,
COALESCE(i.winner_guuid, '') AS source_player_id, COALESCE(i.winner_name, '') AS source_player_name,
CAST(i.roomID AS CHAR) AS room_id, COALESCE(i.remark2, '') AS room_name,
COALESCE(i.remark3, '') AS source_base, COALESCE(i.remark4, '') AS source_rate,
COALESCE(i.remark5, '') AS source_level, '' AS source_note
FROM kbedm.usr_income_info i WHERE `+strings.Join(where, " AND "))
		args = append(args, incomeArgs...)
	}
	if (filters.Kind == "all" || filters.Kind == "withdrawal") && filters.SourcePlayerID == "" && filters.RoomID == "" {
		where := []string{"h.user_guuid = ?", "(h.activity_int < 0 OR h.activity_type LIKE '%提取%')"}
		withdrawalArgs := []any{agentID}
		if filters.DateFrom != "" {
			where = append(where, "h.date >= ?")
			withdrawalArgs = append(withdrawalArgs, filters.DateFrom)
		}
		if filters.DateTo != "" {
			where = append(where, "h.date <= ?")
			withdrawalArgs = append(withdrawalArgs, filters.DateTo)
		}
		segments = append(segments, `SELECT CONCAT('withdrawal:', h.id) AS ledger_id, h.id AS source_id,
h.date AS event_date, h.time AS event_time, 'withdrawal' AS flow_type, -ABS(h.activity_int) AS raw_amount,
'' AS source_player_id, '' AS source_player_name, '' AS room_id, '' AS room_name,
'' AS source_base, '' AS source_rate, '' AS source_level,
COALESCE(NULLIF(h.activity_str, ''), NULLIF(h.remark2, ''), h.activity_type) AS source_note
FROM kbedm.usr_activity_info_sub_hongli h WHERE `+strings.Join(where, " AND "))
		args = append(args, withdrawalArgs...)
	}
	return strings.Join(segments, " UNION ALL "), args
}

func bonusAmount(raw int64) float64 {
	return float64(raw) / 100
}

func decimalString(raw string) float64 {
	value, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil {
		return 0
	}
	return value
}

func bonusIncomeDescription(playerName, playerID, roomID string) string {
	player := strings.TrimSpace(playerName)
	if player == "" {
		player = "来源玩家"
	}
	if strings.TrimSpace(playerID) != "" {
		player += "（ID " + strings.TrimSpace(playerID) + "）"
	}
	if strings.TrimSpace(roomID) != "" {
		return player + "在房间 " + strings.TrimSpace(roomID) + " 产生的代理红利"
	}
	return player + "产生的代理红利"
}
