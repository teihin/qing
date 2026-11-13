package api

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	relationDeviceDays    = 90
	relationGPSDays       = 7
	relationIPDays        = 7
	relationMaxSharedIP   = 20
	relationMaxSharedCell = 50
	relationMatchRowLimit = 20000
	relationDetailLimit   = 200
)

var relationScores = map[string]int{"device": 100, "gps": 60, "ip": 30}

var relationTypeOrder = []string{"device", "gps", "ip"}

type relationCell struct {
	Lat int64
	Lon int64
}

type relationAccumulator struct {
	name     string
	types    map[string]bool
	score    int
	lastSeen time.Time
}

type playerRelation struct {
	PlayerID string   `json:"playerId"`
	Name     string   `json:"name"`
	Types    []string `json:"types"`
	Score    int      `json:"score"`
	LastSeen string   `json:"lastSeen"`
}

// loadPlayerRelations 按方案 §6 聚合同设备 / 同 GPS 网格 / 同公网 IP 的关联账号。
// 关联查询失败不能拖垮玩家列表；调用方按需降级。
func (s *Server) loadPlayerRelations(ctx context.Context, guuids []string) (map[string][]playerRelation, error) {
	sources := make([]string, 0, len(guuids))
	seen := make(map[string]bool, len(guuids))
	for _, id := range guuids {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		sources = append(sources, id)
	}
	result := make(map[string][]playerRelation, len(sources))
	if len(sources) == 0 {
		return result, nil
	}

	devices := map[string][]string{}
	cells := map[relationCell][]string{}
	ips := map[uint32][]string{}

	for _, part := range chunkRelationValues(sources, 400) {
		rows, err := s.gameDB.QueryContext(ctx, `SELECT user_guuid, device_id, gps_lat_e3, gps_lon_e3, last_gps_at
FROM usr_player_device_info
WHERE user_guuid IN (`+placeholders(len(part))+`)
  AND last_seen >= DATE_SUB(NOW(), INTERVAL `+strconv.Itoa(relationDeviceDays)+` DAY)`, stringArgs(part)...)
		if err != nil {
			return nil, err
		}
		gpsCutoff := time.Now().AddDate(0, 0, -relationGPSDays)
		for rows.Next() {
			var guuid, device string
			var lat, lon sql.NullInt64
			var gpsAt sql.NullTime
			if err := rows.Scan(&guuid, &device, &lat, &lon, &gpsAt); err != nil {
				rows.Close()
				return nil, err
			}
			if device != "" {
				devices[device] = append(devices[device], guuid)
			}
			if lat.Valid && lon.Valid && gpsAt.Valid && gpsAt.Time.After(gpsCutoff) {
				cell := relationCell{Lat: lat.Int64, Lon: lon.Int64}
				cells[cell] = append(cells[cell], guuid)
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
	}

	for _, part := range chunkRelationValues(sources, 400) {
		rows, err := s.gameDB.QueryContext(ctx, `SELECT user_guuid, login_ip
FROM usr_login_ip_info
WHERE user_guuid IN (`+placeholders(len(part))+`)
  AND ip_public = 1
  AND login_day >= DATE_SUB(CURDATE(), INTERVAL `+strconv.Itoa(relationIPDays)+` DAY)`, stringArgs(part)...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var guuid string
			var ip uint32
			if err := rows.Scan(&guuid, &ip); err != nil {
				rows.Close()
				return nil, err
			}
			if ip != 0 {
				ips[ip] = append(ips[ip], guuid)
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
	}

	allowedIPs, err := s.relationAllowedIPs(ctx, ips)
	if err != nil {
		return nil, err
	}
	allowedCells, err := s.relationAllowedCells(ctx, cells)
	if err != nil {
		return nil, err
	}

	acc := make(map[string]map[string]*relationAccumulator, len(sources))
	add := func(src, rel, name, kind string, seen time.Time) {
		if rel == "" || rel == src {
			return
		}
		bySrc := acc[src]
		if bySrc == nil {
			bySrc = map[string]*relationAccumulator{}
			acc[src] = bySrc
		}
		item := bySrc[rel]
		if item == nil {
			item = &relationAccumulator{types: map[string]bool{}}
			bySrc[rel] = item
		}
		if !item.types[kind] {
			item.types[kind] = true
			item.score += relationScores[kind]
			if item.score > 100 {
				item.score = 100
			}
		}
		// 名称优先设备快照：IP 先写入，GPS/设备随后覆盖。
		if name != "" {
			item.name = name
		}
		if seen.After(item.lastSeen) {
			item.lastSeen = seen
		}
	}

	for _, part := range chunkRelationValues(allowedIPs, 300) {
		args := uint32Args(part)
		query := `SELECT user_guuid, user_name, login_ip, last_login_time
FROM usr_login_ip_info
WHERE login_ip IN (` + placeholders(len(part)) + `)
  AND ip_public = 1
  AND login_day >= DATE_SUB(CURDATE(), INTERVAL ` + strconv.Itoa(relationIPDays) + ` DAY)
LIMIT ?`
		queryArgs := append(args, relationMatchRowLimit)
		rows, err := s.gameDB.QueryContext(ctx, query, queryArgs...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var rel, name string
			var ip uint32
			var seen time.Time
			if err := rows.Scan(&rel, &name, &ip, &seen); err != nil {
				rows.Close()
				return nil, err
			}
			for _, src := range ips[ip] {
				add(src, rel, name, "ip", seen)
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
	}

	for _, part := range chunkRelationValues(allowedCells, 100) {
		conditions := make([]string, 0, len(part))
		args := make([]any, 0, len(part)*2)
		for _, cell := range part {
			conditions = append(conditions, "(gps_lat_e3 = ? AND gps_lon_e3 = ?)")
			args = append(args, cell.Lat, cell.Lon)
		}
		query := `SELECT user_guuid, user_name, gps_lat_e3, gps_lon_e3, last_gps_at
FROM usr_player_device_info
WHERE last_gps_at >= DATE_SUB(NOW(), INTERVAL ` + strconv.Itoa(relationGPSDays) + ` DAY)
  AND (` + strings.Join(conditions, " OR ") + `)
LIMIT ?`
		queryArgs := append(args, relationMatchRowLimit)
		rows, err := s.gameDB.QueryContext(ctx, query, queryArgs...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var rel, name string
			var cell relationCell
			var seen time.Time
			if err := rows.Scan(&rel, &name, &cell.Lat, &cell.Lon, &seen); err != nil {
				rows.Close()
				return nil, err
			}
			for _, src := range cells[cell] {
				add(src, rel, name, "gps", seen)
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
	}

	deviceIDs := make([]string, 0, len(devices))
	for device := range devices {
		deviceIDs = append(deviceIDs, device)
	}
	for _, part := range chunkRelationValues(deviceIDs, 200) {
		query := `SELECT user_guuid, user_name, device_id, last_seen
FROM usr_player_device_info
WHERE device_id IN (` + placeholders(len(part)) + `)
  AND last_seen >= DATE_SUB(NOW(), INTERVAL ` + strconv.Itoa(relationDeviceDays) + ` DAY)
LIMIT ?`
		args := append(stringArgs(part), relationMatchRowLimit)
		rows, err := s.gameDB.QueryContext(ctx, query, args...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var rel, name, device string
			var seen time.Time
			if err := rows.Scan(&rel, &name, &device, &seen); err != nil {
				rows.Close()
				return nil, err
			}
			for _, src := range devices[device] {
				add(src, rel, name, "device", seen)
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
	}

	for src, byRel := range acc {
		list := make([]playerRelation, 0, len(byRel))
		for rel, item := range byRel {
			types := make([]string, 0, len(item.types))
			for _, kind := range relationTypeOrder {
				if item.types[kind] {
					types = append(types, kind)
				}
			}
			list = append(list, playerRelation{
				PlayerID: rel,
				Name:     item.name,
				Types:    types,
				Score:    item.score,
				LastSeen: formatRelationTime(item.lastSeen),
			})
		}
		sort.Slice(list, func(i, j int) bool {
			if list[i].Score != list[j].Score {
				return list[i].Score > list[j].Score
			}
			if list[i].LastSeen != list[j].LastSeen {
				return list[i].LastSeen > list[j].LastSeen
			}
			return list[i].PlayerID < list[j].PlayerID
		})
		result[src] = list
	}
	return result, nil
}

func (s *Server) relationAllowedIPs(ctx context.Context, ips map[uint32][]string) ([]uint32, error) {
	if len(ips) == 0 {
		return nil, nil
	}
	values := make([]uint32, 0, len(ips))
	for ip := range ips {
		values = append(values, ip)
	}
	counts := map[uint32]int{}
	for _, part := range chunkRelationValues(values, 300) {
		query := `SELECT login_ip, COUNT(DISTINCT user_guuid)
FROM usr_login_ip_info
WHERE login_ip IN (` + placeholders(len(part)) + `)
  AND ip_public = 1
  AND login_day >= DATE_SUB(CURDATE(), INTERVAL ` + strconv.Itoa(relationIPDays) + ` DAY)
GROUP BY login_ip`
		rows, err := s.gameDB.QueryContext(ctx, query, uint32Args(part)...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var ip uint32
			var count int
			if err := rows.Scan(&ip, &count); err != nil {
				rows.Close()
				return nil, err
			}
			counts[ip] = count
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
	}
	allowed := make([]uint32, 0, len(values))
	for _, ip := range values {
		if counts[ip] <= relationMaxSharedIP {
			allowed = append(allowed, ip)
		}
	}
	return allowed, nil
}

func (s *Server) relationAllowedCells(ctx context.Context, cells map[relationCell][]string) ([]relationCell, error) {
	if len(cells) == 0 {
		return nil, nil
	}
	values := make([]relationCell, 0, len(cells))
	for cell := range cells {
		values = append(values, cell)
	}
	counts := map[relationCell]int{}
	for _, part := range chunkRelationValues(values, 100) {
		conditions := make([]string, 0, len(part))
		args := make([]any, 0, len(part)*2)
		for _, cell := range part {
			conditions = append(conditions, "(gps_lat_e3 = ? AND gps_lon_e3 = ?)")
			args = append(args, cell.Lat, cell.Lon)
		}
		query := `SELECT gps_lat_e3, gps_lon_e3, COUNT(DISTINCT user_guuid)
FROM usr_player_device_info
WHERE last_gps_at >= DATE_SUB(NOW(), INTERVAL ` + strconv.Itoa(relationGPSDays) + ` DAY)
  AND (` + strings.Join(conditions, " OR ") + `)
GROUP BY gps_lat_e3, gps_lon_e3`
		rows, err := s.gameDB.QueryContext(ctx, query, args...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var cell relationCell
			var count int
			if err := rows.Scan(&cell.Lat, &cell.Lon, &count); err != nil {
				rows.Close()
				return nil, err
			}
			counts[cell] = count
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
	}
	allowed := make([]relationCell, 0, len(values))
	for _, cell := range values {
		if counts[cell] <= relationMaxSharedCell {
			allowed = append(allowed, cell)
		}
	}
	return allowed, nil
}

func (s *Server) handlePlayerRelations(w http.ResponseWriter, r *http.Request, p principal) {
	playerID, err := normalizeGamePlayerID(r.PathValue("playerId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PLAYER_ID", err.Error())
		return
	}
	var name string
	if err := s.gameDB.QueryRowContext(r.Context(), `SELECT COALESCE(sm_name, '') FROM tbl_Account WHERE sm_guuid = ? LIMIT 1`, playerID).Scan(&name); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "PLAYER_NOT_FOUND", "没有找到这个游戏玩家 ID")
			return
		}
		s.logger.Error("read player before relations", "error", err, "playerId", playerID)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取玩家账号失败")
		return
	}
	relations, err := s.loadPlayerRelations(r.Context(), []string{playerID})
	if err != nil {
		s.logger.Error("load player relations", "error", err, "playerId", playerID)
		writeError(w, http.StatusInternalServerError, "QUERY_ERROR", "读取关联账号失败")
		return
	}
	items := relations[playerID]
	total := len(items)
	if len(items) > relationDetailLimit {
		items = items[:relationDetailLimit]
	}
	if items == nil {
		items = []playerRelation{}
	}
	writeData(w, http.StatusOK, map[string]any{
		"playerId": playerID,
		"name":     name,
		"items":    items,
		"total":    total,
	})
}

func chunkRelationValues[T any](values []T, size int) [][]T {
	if size <= 0 {
		size = 1
	}
	out := make([][]T, 0, (len(values)+size-1)/size)
	for len(values) > size {
		out = append(out, values[:size])
		values = values[size:]
	}
	if len(values) > 0 {
		out = append(out, values)
	}
	return out
}

func stringArgs(values []string) []any {
	args := make([]any, len(values))
	for i, value := range values {
		args[i] = value
	}
	return args
}

func uint32Args(values []uint32) []any {
	args := make([]any, len(values))
	for i, value := range values {
		args[i] = value
	}
	return args
}

func formatRelationTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.Format("2006-01-02 15:04:05")
}
