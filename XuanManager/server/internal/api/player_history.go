package api

import (
	"database/sql"
	"net/http"
	"sort"
	"strconv"
	"strings"
)

type playerRoomSummary struct {
	RoomCount             int64   `json:"roomCount"`
	RoundsPlayed          int64   `json:"roundsPlayed"`
	WinRooms              int64   `json:"winRooms"`
	LossRooms             int64   `json:"lossRooms"`
	DrawRooms             int64   `json:"drawRooms"`
	TotalBuyIn            float64 `json:"totalBuyIn"`
	TotalSettlementReturn float64 `json:"totalSettlementReturn"`
	NetScore              float64 `json:"netScore"`
}

type playerRoomHistoryItem struct {
	ID               int64   `json:"id"`
	RoomID           string  `json:"roomId"`
	RoomName         string  `json:"roomName"`
	PlayMode         string  `json:"playMode"`
	CreatorName      string  `json:"creatorName"`
	CreatorID        string  `json:"creatorId"`
	RecordedAt       string  `json:"recordedAt"`
	StartedAt        string  `json:"startedAt"`
	EndedAt          string  `json:"endedAt"`
	Seat             int64   `json:"seat"`
	RoomRoundCount   int64   `json:"roomRoundCount"`
	RoundsPlayed     int64   `json:"roundsPlayed"`
	TotalBuyIn       float64 `json:"totalBuyIn"`
	SettlementReturn float64 `json:"settlementReturn"`
	RecordedScore    float64 `json:"recordedScore"`
	Score            float64 `json:"score"`
	ScoreSource      string  `json:"scoreSource"`
	ScoreMismatch    bool    `json:"scoreMismatch"`
	Result           string  `json:"result"`
}

func (s *Server) handlePlayerRoomHistory(w http.ResponseWriter, r *http.Request, _ principal) {
	playerID := strings.TrimSpace(r.PathValue("playerId"))
	if !validGameID(playerID) {
		writeError(w, http.StatusBadRequest, "INVALID_PLAYER_ID", "游戏用户ID不正确")
		return
	}
	page, size := pageParams(r)

	var exists int
	err := s.db.QueryRowContext(r.Context(), `SELECT 1 FROM kbedm.tbl_Account WHERE sm_guuid = ? LIMIT 1`, playerID).Scan(&exists)
	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "PLAYER_NOT_FOUND", "没有找到这个游戏用户ID")
		return
	}
	if err != nil {
		s.logger.Error("query player before room history", "playerId", playerID, "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取玩家信息失败")
		return
	}

	items, total, summary, err := s.queryPlayerRoomHistory(r, playerID, page, size)
	if err != nil {
		s.logger.Error("query player room history", "playerId", playerID, "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取玩家房间战绩失败")
		return
	}
	writeData(w, http.StatusOK, map[string]any{
		"items": items, "summary": summary, "page": page, "pageSize": size, "total": total,
	})
}

func (s *Server) queryPlayerRoomHistory(r *http.Request, playerID string, page, size int) ([]playerRoomHistoryItem, int64, playerRoomSummary, error) {
	rows, err := s.db.QueryContext(r.Context(), `SELECT t.id, t.roomID, t.date, t.time, t.creater_name, t.creater_guuid,
t.score, t.rounds, t.number, t.play_mode, t.remark, t.remark2,
COALESCE(w.settlement_return, 0), (w.roomID IS NOT NULL)
FROM kbedm.usr_total_score t
LEFT JOIN (
  SELECT remark1 AS roomID, SUM(new_money - old_money) AS settlement_return
  FROM kbedm.usr_cash_water
  WHERE user_guuid = ? AND option_type = '结算'
  GROUP BY remark1
) w ON w.roomID = t.roomID
WHERE t.user_guuid = ?
ORDER BY t.date DESC, t.time DESC, t.id DESC`, playerID, playerID)
	if err != nil {
		return nil, 0, playerRoomSummary{}, err
	}
	defer rows.Close()

	all := []playerRoomHistoryItem{}
	summary := playerRoomSummary{}
	for rows.Next() {
		var item playerRoomHistoryItem
		var date, clock, scoreRaw, remark, remark2 string
		var hasSettlement bool
		if err := rows.Scan(&item.ID, &item.RoomID, &date, &clock, &item.CreatorName, &item.CreatorID,
			&scoreRaw, &item.RoomRoundCount, &item.Seat, &item.PlayMode, &remark, &remark2,
			&item.SettlementReturn, &hasSettlement); err != nil {
			return nil, 0, playerRoomSummary{}, err
		}
		roomFields := strings.Split(remark, ",")
		metaFields := strings.Split(remark2, ",")
		item.RecordedAt = strings.TrimSpace(date + " " + clock)
		item.RoomName = stringAt(metaFields, 4)
		item.StartedAt = stringAt(metaFields, 0)
		item.EndedAt = stringAt(metaFields, 1)
		item.RoundsPlayed = intAt(metaFields, 3)
		item.TotalBuyIn = floatAt(roomFields, 1)
		item.RecordedScore, _ = strconv.ParseFloat(scoreRaw, 64)
		item.Score, item.ScoreSource = resolvedRoomScore(item.RecordedScore, item.TotalBuyIn, item.SettlementReturn, hasSettlement)
		item.ScoreMismatch = scoreMismatch(item.Score, item.RecordedScore)
		item.Result = scoreResult(item.Score)
		all = append(all, item)

		summary.RoomCount++
		summary.RoundsPlayed += item.RoundsPlayed
		summary.TotalBuyIn += item.TotalBuyIn
		if hasSettlement {
			summary.TotalSettlementReturn += item.SettlementReturn
		}
		summary.NetScore += item.Score
		switch item.Result {
		case "win":
			summary.WinRooms++
		case "loss":
			summary.LossRooms++
		default:
			summary.DrawRooms++
		}
	}
	if err := rows.Err(); err != nil {
		return nil, 0, playerRoomSummary{}, err
	}

	sort.SliceStable(all, func(i, j int) bool {
		if all[i].RecordedAt == all[j].RecordedAt {
			return all[i].ID > all[j].ID
		}
		return all[i].RecordedAt > all[j].RecordedAt
	})
	total := int64(len(all))
	start := (page - 1) * size
	if start >= len(all) {
		return []playerRoomHistoryItem{}, total, summary, nil
	}
	end := start + size
	if end > len(all) {
		end = len(all)
	}
	return all[start:end], total, summary, nil
}

func scoreMismatch(score, recordedScore float64) bool {
	difference := score - recordedScore
	return difference > 0.005 || difference < -0.005
}

func isDijiuKingRule(value string) bool {
	value = strings.TrimSpace(value)
	return value == "地方" || strings.Contains(value, "地九王")
}
