package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

type roomRecordListFilters struct {
	Keyword  string
	DateFrom string
	DateTo   string
}

type roomRecordListItem struct {
	RoomID       string   `json:"roomId"`
	RoomName     string   `json:"roomName"`
	IsDijiuKing  bool     `json:"isDijiuKing"`
	RecordedAt   string   `json:"recordedAt"`
	StartedAt    string   `json:"startedAt"`
	EndedAt      string   `json:"endedAt"`
	RoundCount   int64    `json:"roundCount"`
	PlayerCount  int64    `json:"playerCount"`
	TotalBuyIn   float64  `json:"totalBuyIn"`
	Participants []string `json:"participants"`
}

type roomRecordOverview struct {
	RoomID         string  `json:"roomId"`
	RoomName       string  `json:"roomName"`
	StartedAt      string  `json:"startedAt"`
	EndedAt        string  `json:"endedAt"`
	RoundCount     int64   `json:"roundCount"`
	PlayerCount    int     `json:"playerCount"`
	TotalBuyIn     float64 `json:"totalBuyIn"`
	TotalWin       float64 `json:"totalWin"`
	TotalLoss      float64 `json:"totalLoss"`
	ScoreBalance   float64 `json:"scoreBalance"`
	Jackpot        string  `json:"jackpot"`
	BaseRule       string  `json:"baseRule"`
	MangoRule      string  `json:"mangoRule"`
	DurationRule   string  `json:"durationRule"`
	SettlementRule string  `json:"settlementRule"`
	IsDijiuKing    bool    `json:"isDijiuKing"`
}

type roomRecordPlayer struct {
	ID               int64   `json:"id"`
	PlayerID         string  `json:"playerId"`
	PlayerName       string  `json:"playerName"`
	Seat             int64   `json:"seat"`
	Score            float64 `json:"score"`
	RecordedScore    float64 `json:"recordedScore"`
	SettlementReturn float64 `json:"settlementReturn"`
	ScoreSource      string  `json:"scoreSource"`
	ScoreMismatch    bool    `json:"scoreMismatch"`
	Result           string  `json:"result"`
	TotalBuyIn       float64 `json:"totalBuyIn"`
	RoundsPlayed     int64   `json:"roundsPlayed"`
	JoinedAt         string  `json:"joinedAt"`
	LeftAt           string  `json:"leftAt"`
}

type roomRecordRound struct {
	Round       int64  `json:"round"`
	PlayedAt    string `json:"playedAt"`
	PlayerCount int64  `json:"playerCount"`
	TotalWin    int64  `json:"totalWin"`
	TotalLoss   int64  `json:"totalLoss"`
	NetScore    int64  `json:"netScore"`
	ActionCount int64  `json:"actionCount"`
}

type roomRecordCard struct {
	Suit int `json:"suit"`
	Rank int `json:"rank"`
}

type roomRecordRoundPlayer struct {
	ID             int64            `json:"id"`
	PlayerID       string           `json:"playerId"`
	PlayerName     string           `json:"playerName"`
	Seat           int64            `json:"seat"`
	Score          int64            `json:"score"`
	Result         string           `json:"result"`
	PlayedAt       string           `json:"playedAt"`
	State          string           `json:"state"`
	Role           string           `json:"role"`
	BetScore       int64            `json:"betScore"`
	MangoScore     int64            `json:"mangoScore"`
	RemainingMango int64            `json:"remainingMango"`
	Cards          []roomRecordCard `json:"cards"`
	DealtCards     []roomRecordCard `json:"dealtCards"`
	RevealFlags    string           `json:"revealFlags"`
	PoolScore      int64            `json:"poolScore"`
	Compensation   string           `json:"compensation"`
}

type roomRecordAction struct {
	ID             int64  `json:"id"`
	OccurredAt     string `json:"occurredAt"`
	PlayerID       string `json:"playerId"`
	PlayerName     string `json:"playerName"`
	Seat           int64  `json:"seat"`
	Stage          int64  `json:"stage"`
	Action         string `json:"action"`
	ActionScore    int64  `json:"actionScore"`
	RemainingScore int64  `json:"remainingScore"`
}

func (s *Server) handleRoomRecord(w http.ResponseWriter, r *http.Request, _ principal) {
	roomID := strings.TrimSpace(r.URL.Query().Get("roomId"))
	if roomID == "" {
		s.handleListRoomRecords(w, r)
		return
	}
	if !validRoomRecordID(roomID) {
		writeError(w, http.StatusBadRequest, "INVALID_ROOM_ID", "请输入正确的房间号")
		return
	}

	players, overview, err := s.queryRoomRecordPlayers(r, roomID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "ROOM_RECORD_NOT_FOUND", "没有找到这个房间的战绩记录")
		return
	}
	if err != nil {
		s.logger.Error("query room record players", "roomId", roomID, "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取房间总战绩失败")
		return
	}

	rounds, err := s.queryRoomRecordRounds(r, roomID)
	if err != nil {
		s.logger.Error("query room record rounds", "roomId", roomID, "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取房间逐局战绩失败")
		return
	}
	writeData(w, http.StatusOK, map[string]any{"room": overview, "players": players, "rounds": rounds})
}

func (s *Server) handleListRoomRecords(w http.ResponseWriter, r *http.Request) {
	page, size := pageParams(r)
	filters, err := parseRoomRecordListFilters(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_FILTER", err.Error())
		return
	}
	where, args := buildRoomRecordListWhere(filters)

	var total int64
	if err := s.db.QueryRowContext(r.Context(), `SELECT COUNT(DISTINCT t.roomID)
FROM kbedm.usr_total_score t WHERE `+where, args...).Scan(&total); err != nil {
		s.logger.Error("count room records", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取房间战绩数量失败")
		return
	}

	queryArgs := append(append([]any{}, args...), size, (page-1)*size)
	rows, err := s.db.QueryContext(r.Context(), `SELECT
t.roomID,
COALESCE(MAX(NULLIF(NULLIF(TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(t.remark2, ',', 5), ',', -1)), '0'), '')), ''),
MAX(CASE WHEN TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(t.remark, ',', 11), ',', -1)) = '地方' THEN 1 ELSE 0 END),
COALESCE(MAX(CONCAT(t.date, ' ', t.time)), ''),
COALESCE(MIN(NULLIF(NULLIF(TRIM(SUBSTRING_INDEX(t.remark2, ',', 1)), '0'), '')), ''),
COALESCE(MAX(NULLIF(NULLIF(TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(t.remark2, ',', 2), ',', -1)), '0'), '')), ''),
COALESCE(MAX(t.rounds), 0), COUNT(*),
COALESCE(SUM(CAST(NULLIF(TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(t.remark, ',', 2), ',', -1)), '') AS DECIMAL(20,2))), 0),
COALESCE(GROUP_CONCAT(CONCAT(COALESCE(NULLIF(t.user_name, ''), '未设置昵称'), '（', t.user_guuid, '）') ORDER BY t.number ASC SEPARATOR '、'), '')
FROM kbedm.usr_total_score t WHERE `+where+`
GROUP BY t.roomID ORDER BY MAX(t.id) DESC LIMIT ? OFFSET ?`, queryArgs...)
	if err != nil {
		s.logger.Error("list room records", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取房间战绩列表失败")
		return
	}
	defer rows.Close()

	items := make([]roomRecordListItem, 0, size)
	for rows.Next() {
		var item roomRecordListItem
		var participants string
		if err := rows.Scan(&item.RoomID, &item.RoomName, &item.IsDijiuKing,
			&item.RecordedAt, &item.StartedAt, &item.EndedAt, &item.RoundCount, &item.PlayerCount,
			&item.TotalBuyIn, &participants); err != nil {
			s.logger.Error("scan room record list", "error", err)
			writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取房间战绩列表失败")
			return
		}
		if participants != "" {
			item.Participants = strings.Split(participants, "、")
		} else {
			item.Participants = []string{}
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		s.logger.Error("iterate room records", "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取房间战绩列表失败")
		return
	}

	writeData(w, http.StatusOK, map[string]any{
		"items": items, "page": page, "pageSize": size, "total": total,
	})
}

func parseRoomRecordListFilters(r *http.Request) (roomRecordListFilters, error) {
	query := r.URL.Query()
	filters := roomRecordListFilters{
		Keyword:  strings.TrimSpace(query.Get("keyword")),
		DateFrom: strings.TrimSpace(query.Get("dateFrom")),
		DateTo:   strings.TrimSpace(query.Get("dateTo")),
	}
	if len([]rune(filters.Keyword)) > 100 {
		return roomRecordListFilters{}, errors.New("查询文字不能超过 100 个字符")
	}
	for label, value := range map[string]string{"开始日期": filters.DateFrom, "结束日期": filters.DateTo} {
		if value != "" {
			if _, err := time.Parse("2006-01-02", value); err != nil {
				return roomRecordListFilters{}, errors.New(label + "格式必须是 YYYY-MM-DD")
			}
		}
	}
	if filters.DateFrom != "" && filters.DateTo != "" && filters.DateFrom > filters.DateTo {
		return roomRecordListFilters{}, errors.New("开始日期不能晚于结束日期")
	}
	return filters, nil
}

func buildRoomRecordListWhere(filters roomRecordListFilters) (string, []any) {
	clauses := []string{"1 = 1"}
	args := []any{}
	if filters.Keyword != "" {
		like := "%" + filters.Keyword + "%"
		clauses = append(clauses, `EXISTS (
  SELECT 1 FROM kbedm.usr_total_score x
  WHERE x.roomID = t.roomID AND (
    x.roomID = ? OR x.user_guuid = ? OR x.user_name LIKE ? OR
    TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(x.remark2, ',', 5), ',', -1)) LIKE ?
  )
)`)
		args = append(args, filters.Keyword, filters.Keyword, like, like)
	}
	if filters.DateFrom != "" {
		clauses = append(clauses, "t.date >= ?")
		args = append(args, filters.DateFrom)
	}
	if filters.DateTo != "" {
		clauses = append(clauses, "t.date <= ?")
		args = append(args, filters.DateTo)
	}
	return strings.Join(clauses, " AND "), args
}

func (s *Server) queryRoomRecordPlayers(r *http.Request, roomID string) ([]roomRecordPlayer, roomRecordOverview, error) {
	rows, err := s.db.QueryContext(r.Context(), `SELECT t.id, t.roomID, t.date, t.time, t.user_name, t.user_guuid,
t.score, t.rounds, t.number, t.remark, t.remark2,
COALESCE(w.settlement_return, 0), (w.user_guuid IS NOT NULL)
FROM kbedm.usr_total_score t
LEFT JOIN (
  SELECT user_guuid, SUM(new_money - old_money) AS settlement_return
  FROM kbedm.usr_cash_water WHERE remark1 = ? AND option_type = '结算'
  GROUP BY user_guuid
) w ON w.user_guuid = t.user_guuid
WHERE t.roomID = ? ORDER BY t.number ASC, t.id ASC`, roomID, roomID)
	if err != nil {
		return nil, roomRecordOverview{}, err
	}
	defer rows.Close()
	players := []roomRecordPlayer{}
	overview := roomRecordOverview{RoomID: roomID}
	for rows.Next() {
		var item roomRecordPlayer
		var recordRoomID, date, clock, scoreRaw, remark, remark2 string
		var rounds, seat int64
		var hasSettlement bool
		if err := rows.Scan(&item.ID, &recordRoomID, &date, &clock, &item.PlayerName, &item.PlayerID,
			&scoreRaw, &rounds, &seat, &remark, &remark2,
			&item.SettlementReturn, &hasSettlement); err != nil {
			return nil, roomRecordOverview{}, err
		}
		item.Seat = seat
		item.RecordedScore, _ = strconv.ParseFloat(scoreRaw, 64)
		roomFields := strings.Split(remark, ",")
		metaFields := strings.Split(remark2, ",")
		item.TotalBuyIn = floatAt(roomFields, 1)
		item.Score, item.ScoreSource = resolvedRoomScore(item.RecordedScore, item.TotalBuyIn, item.SettlementReturn, hasSettlement)
		item.ScoreMismatch = scoreMismatch(item.Score, item.RecordedScore)
		item.Result = scoreResult(item.Score)
		item.JoinedAt = stringAt(metaFields, 0)
		item.LeftAt = stringAt(metaFields, 1)
		item.RoundsPlayed = intAt(metaFields, 3)
		players = append(players, item)

		if len(players) == 1 {
			overview.RoomName = stringAt(metaFields, 4)
			overview.RoundCount = rounds
			overview.Jackpot = stringAt(metaFields, 2)
			overview.BaseRule = stringAt(roomFields, 5)
			overview.MangoRule = stringAt(roomFields, 6)
			overview.DurationRule = stringAt(roomFields, 7)
			overview.SettlementRule = stringAt(roomFields, 10)
			overview.IsDijiuKing = isDijiuKingRule(rawAt(roomFields, 10))
		}
		if item.JoinedAt != "" && (overview.StartedAt == "" || item.JoinedAt < overview.StartedAt) {
			overview.StartedAt = item.JoinedAt
		}
		if item.LeftAt > overview.EndedAt {
			overview.EndedAt = item.LeftAt
		}
		if rounds > overview.RoundCount {
			overview.RoundCount = rounds
		}
		overview.TotalBuyIn += item.TotalBuyIn
		overview.ScoreBalance += item.Score
		if item.Score > 0 {
			overview.TotalWin += item.Score
		} else if item.Score < 0 {
			overview.TotalLoss += -item.Score
		}
	}
	if err := rows.Err(); err != nil {
		return nil, roomRecordOverview{}, err
	}
	if len(players) == 0 {
		return nil, roomRecordOverview{}, sql.ErrNoRows
	}
	sort.SliceStable(players, func(i, j int) bool {
		if players[i].Score == players[j].Score {
			return players[i].Seat < players[j].Seat
		}
		return players[i].Score > players[j].Score
	})
	overview.PlayerCount = len(players)
	return players, overview, nil
}

func (s *Server) queryRoomRecordRounds(r *http.Request, roomID string) ([]roomRecordRound, error) {
	rows, err := s.db.QueryContext(r.Context(), `SELECT r.rounds,
MIN(CONCAT(r.date, ' ', r.time)), COUNT(*),
COALESCE(SUM(CASE WHEN r.score > 0 THEN r.score ELSE 0 END), 0),
COALESCE(ABS(SUM(CASE WHEN r.score < 0 THEN r.score ELSE 0 END)), 0),
COALESCE(SUM(r.score), 0),
(SELECT COUNT(*) FROM kbedm.usr_paipu_log p WHERE p.roomID = r.roomID AND p.round_count = r.rounds)
FROM kbedm.usr_round_score r WHERE r.roomID = ?
GROUP BY r.rounds ORDER BY r.rounds DESC`, roomID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []roomRecordRound{}
	for rows.Next() {
		var item roomRecordRound
		if err := rows.Scan(&item.Round, &item.PlayedAt, &item.PlayerCount, &item.TotalWin, &item.TotalLoss, &item.NetScore, &item.ActionCount); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Server) handleRoomRecordRound(w http.ResponseWriter, r *http.Request, _ principal) {
	roomID := strings.TrimSpace(r.PathValue("roomId"))
	round, err := strconv.ParseInt(r.PathValue("round"), 10, 64)
	if !validRoomRecordID(roomID) || err != nil || round < 1 || round > 1000000 {
		writeError(w, http.StatusBadRequest, "INVALID_ROUND", "房间号或局数不正确")
		return
	}
	players, err := s.queryRoomRecordRoundPlayers(r, roomID, round)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "ROUND_RECORD_NOT_FOUND", "没有找到这一局的战绩记录")
		return
	}
	if err != nil {
		s.logger.Error("query room round players", "roomId", roomID, "round", round, "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取本局玩家战绩失败")
		return
	}
	actions, err := s.queryRoomRecordActions(r, roomID, round)
	if err != nil {
		s.logger.Error("query room round actions", "roomId", roomID, "round", round, "error", err)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取本局操作牌谱失败")
		return
	}
	writeData(w, http.StatusOK, map[string]any{"roomId": roomID, "round": round, "players": players, "actions": actions})
}

func (s *Server) queryRoomRecordRoundPlayers(r *http.Request, roomID string, round int64) ([]roomRecordRoundPlayer, error) {
	rows, err := s.db.QueryContext(r.Context(), `SELECT id, date, time, user_name, user_guuid, score, number, remark
FROM kbedm.usr_round_score WHERE roomID = ? AND rounds = ? ORDER BY number ASC, id ASC`, roomID, round)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []roomRecordRoundPlayer{}
	for rows.Next() {
		var item roomRecordRoundPlayer
		var date, clock, remark string
		if err := rows.Scan(&item.ID, &date, &clock, &item.PlayerName, &item.PlayerID, &item.Score, &item.Seat, &remark); err != nil {
			return nil, err
		}
		item.PlayedAt = strings.TrimSpace(date + " " + clock)
		item.Result = scoreResult(float64(item.Score))
		parseRoundPlayerRemark(remark, &item)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, sql.ErrNoRows
	}
	return items, nil
}

func (s *Server) queryRoomRecordActions(r *http.Request, roomID string, round int64) ([]roomRecordAction, error) {
	rows, err := s.db.QueryContext(r.Context(), `SELECT id, date, time, user_name, user_guuid,
player_number, xiazhu_count, xiazhu_type, xiazhu_score, money_score
FROM kbedm.usr_paipu_log WHERE roomID = ? AND round_count = ?
ORDER BY xiazhu_count ASC, id ASC LIMIT 1000`, roomID, round)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []roomRecordAction{}
	for rows.Next() {
		var item roomRecordAction
		var date, clock string
		if err := rows.Scan(&item.ID, &date, &clock, &item.PlayerName, &item.PlayerID, &item.Seat,
			&item.Stage, &item.Action, &item.ActionScore, &item.RemainingScore); err != nil {
			return nil, err
		}
		item.OccurredAt = strings.TrimSpace(date + " " + clock)
		items = append(items, item)
	}
	return items, rows.Err()
}

func parseRoundPlayerRemark(remark string, item *roomRecordRoundPlayer) {
	parts := strings.Split(remark, "@")
	item.State = stringAt(parts, 0)
	item.Cards = parseRoomCards(stringAt(parts, 1))
	item.BetScore = labeledInt(stringAt(parts, 2), "下注:")
	item.MangoScore = labeledInt(strings.TrimSpace(stringAt(parts, 4)), "芒果:")
	item.RemainingMango = labeledInt(strings.TrimSpace(stringAt(parts, 5)), "本局剩余芒果:")
	item.Role = stringAt(parts, 6)
	item.DealtCards = parseRoomCards(stringAt(parts, 7))
	item.RevealFlags = stringAt(parts, 8)
	item.PoolScore, _ = strconv.ParseInt(strings.TrimSpace(stringAt(parts, 9)), 10, 64)
	item.Compensation = stringAt(parts, 10)
}

func parseRoomCards(raw string) []roomRecordCard {
	var pairs [][]int
	if err := json.Unmarshal([]byte(raw), &pairs); err != nil {
		return []roomRecordCard{}
	}
	cards := make([]roomRecordCard, 0, len(pairs))
	for _, pair := range pairs {
		if len(pair) != 2 || pair[0] < 0 || pair[0] > 4 || pair[1] < 1 || pair[1] > 13 {
			continue
		}
		cards = append(cards, roomRecordCard{Suit: pair[0], Rank: pair[1]})
	}
	return cards
}

func validRoomRecordID(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 20 {
		return false
	}
	for _, char := range value {
		if char < '0' || char > '9' {
			return false
		}
	}
	return value != "0"
}

func scoreResult(score float64) string {
	if score > 0 {
		return "win"
	}
	if score < 0 {
		return "loss"
	}
	return "draw"
}

func resolvedRoomScore(recordedScore, totalBuyIn, settlementReturn float64, hasSettlement bool) (float64, string) {
	if hasSettlement {
		return settlementReturn - totalBuyIn, "settlement"
	}
	return recordedScore, "record"
}

func stringAt(values []string, index int) string {
	if index < 0 || index >= len(values) {
		return ""
	}
	value := strings.TrimSpace(values[index])
	if value == "0" {
		return ""
	}
	return value
}

func intAt(values []string, index int) int64 {
	value, _ := strconv.ParseInt(strings.TrimSpace(rawAt(values, index)), 10, 64)
	return value
}

func floatAt(values []string, index int) float64 {
	value, _ := strconv.ParseFloat(strings.TrimSpace(rawAt(values, index)), 64)
	return value
}

func rawAt(values []string, index int) string {
	if index < 0 || index >= len(values) {
		return ""
	}
	return values[index]
}

func labeledInt(value, label string) int64 {
	value = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(value), label))
	result, _ := strconv.ParseInt(value, 10, 64)
	return result
}
