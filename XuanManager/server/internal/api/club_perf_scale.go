package api

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// 俱乐部业绩全局折算百分比。
//
// 服务端从 kbedm.usr_hash_info 读取 `俱乐部业绩全局百分比`（明文整数，如 50），
// 在「查询信息 / 下发列表 / 后台报表」三个查询里按该百分比折算次数：
// 分子折算、分母（池当日原始总次数）不折算，所以所有代理合计占比约等于该百分比。
//
// 约定（与 `俱乐部积分对应钻石输赢比` 同口径，明文数字，不是 base64）：
//   - 缺行 / 空 / 非法 → 按 50；
//   - 0 → 全部折算为 0；大于 100 → 夹到 100；100 → 恢复原始值；
//   - 改值最多 10 秒进入服务端缓存；历史日期同样按当前值折算（无快照）；
//   - 后台只 Update/Insert，不删行；恢复原始口径请把值改成 100。
const (
	clubPerfScaleKey         = "俱乐部业绩全局百分比"
	clubPerfScaleAudit       = "configuration.club_perf_scale.update"
	clubPerfScaleDefault     = 50
	clubPerfScaleMax         = 100
	clubPerfScaleClientFmt   = "明文整数（0~100），如 50"
	clubPerfScaleClientHint  = "俱乐部业绩全局百分比"
	clubPerfScaleWriteFormat = "%d"
)

type clubPerfScaleState struct {
	Percent        int        `json:"percent"`
	DefaultPercent int        `json:"defaultPercent"`
	MaxPercent     int        `json:"maxPercent"`
	Configured     bool       `json:"configured"`
	StorageKey     string     `json:"storageKey"`
	ClientContext  string     `json:"clientContext"`
	ClientFormat   string     `json:"clientFormat"`
	UpdatedBy      string     `json:"updatedBy"`
	UpdatedAt      *time.Time `json:"updatedAt"`
	RowCount       int        `json:"rowCount"`
	DuplicateRows  int        `json:"duplicateRows"`
	ParseError     string     `json:"parseError"`
}

type updateClubPerfScaleRequest struct {
	// 用指针区分"没传"和"传了 0"：0 是合法值（全部折算为 0），不能被缺字段静默顶替。
	Percent *int `json:"percent"`
	Confirm bool `json:"confirm"`
}

type clubPerfScaleRow struct {
	ID      int64
	Content string
}

func (s *Server) handleGetClubPerfScale(w http.ResponseWriter, r *http.Request, p principal) {
	state, err := s.queryClubPerfScale(r.Context())
	if err != nil {
		s.logger.Error("read club perf scale", "error", err)
		writeError(w, http.StatusInternalServerError, "CLUB_PERF_SCALE_QUERY_FAILED", "读取业绩全局折算百分比失败")
		return
	}
	writeData(w, http.StatusOK, state)
}

func (s *Server) handleUpdateClubPerfScale(w http.ResponseWriter, r *http.Request, p principal) {
	var input updateClubPerfScaleRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if !input.Confirm {
		writeError(w, http.StatusBadRequest, "CONFIRM_REQUIRED", "请先勾选确认再保存")
		return
	}
	if input.Percent == nil {
		writeError(w, http.StatusBadRequest, "INVALID_CLUB_PERF_SCALE", "请填写折算百分比")
		return
	}
	percent, err := validateClubPerfScale(*input.Percent)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_CLUB_PERF_SCALE", err.Error())
		return
	}
	value := fmt.Sprintf(clubPerfScaleWriteFormat, percent)

	beforeRows, err := s.loadClubPerfScaleRows(r.Context())
	if err != nil {
		s.audit(r.Context(), &p, clubPerfScaleAudit, "usr_hash_info", clubPerfScaleKey,
			map[string]any{"percent": percent}, nil, nil, 500, "读取原业绩折算百分比失败", clientIP(r))
		writeError(w, http.StatusInternalServerError, "CLUB_PERF_SCALE_UPDATE_FAILED", "读取原业绩折算百分比失败")
		return
	}
	beforePercent := clubPerfScaleDefault
	if len(beforeRows) > 0 {
		if parsed, parseErr := parseClubPerfScale(beforeRows[0].Content); parseErr == nil {
			beforePercent = parsed
		}
	}

	var insertedID int64
	if len(beforeRows) == 0 {
		result, execErr := s.db.ExecContext(r.Context(),
			`INSERT INTO kbedm.usr_hash_info (hash_key, hash_content) VALUES (?, ?)`, clubPerfScaleKey, value)
		if execErr == nil {
			insertedID, execErr = result.LastInsertId()
		}
		err = execErr
	} else {
		// 服务端只认一条：多行时统一写成同一个值，不删行。
		_, err = s.db.ExecContext(r.Context(),
			`UPDATE kbedm.usr_hash_info SET hash_content = ? WHERE hash_key = ?`, value, clubPerfScaleKey)
	}
	if err != nil {
		s.logger.Error("write club perf scale", "error", err)
		if restoreErr := s.restoreClubPerfScaleRows(r.Context(), beforeRows, insertedID); restoreErr != nil {
			s.logger.Error("restore club perf scale after write failure", "error", restoreErr)
		}
		s.audit(r.Context(), &p, clubPerfScaleAudit, "usr_hash_info", clubPerfScaleKey,
			map[string]any{"percent": percent}, map[string]any{"percent": beforePercent}, nil, 500, "写入业绩折算百分比失败", clientIP(r))
		writeError(w, http.StatusInternalServerError, "CLUB_PERF_SCALE_UPDATE_FAILED", "保存业绩全局折算百分比失败")
		return
	}

	if verifyErr := s.verifyClubPerfScale(r.Context(), percent); verifyErr != nil {
		if restoreErr := s.restoreClubPerfScaleRows(r.Context(), beforeRows, insertedID); restoreErr != nil {
			s.logger.Error("restore club perf scale after verify failure", "error", restoreErr)
			verifyErr = fmt.Errorf("%w（恢复原配置也失败，请立即人工检查）", verifyErr)
		}
		s.audit(r.Context(), &p, clubPerfScaleAudit, "usr_hash_info", clubPerfScaleKey,
			map[string]any{"percent": percent}, map[string]any{"percent": beforePercent}, nil, 500, verifyErr.Error(), clientIP(r))
		writeError(w, http.StatusInternalServerError, "CLUB_PERF_SCALE_VERIFY_FAILED", verifyErr.Error())
		return
	}

	s.audit(r.Context(), &p, clubPerfScaleAudit, "usr_hash_info", clubPerfScaleKey,
		map[string]any{"percent": percent}, map[string]any{"percent": beforePercent},
		map[string]any{"percent": percent}, 0, "业绩全局折算百分比已保存并校验", clientIP(r))
	s.logger.Info("club perf scale updated", "operator", p.Username, "percent", percent)

	state, err := s.queryClubPerfScale(r.Context())
	if err != nil {
		state = clubPerfScaleState{
			Percent: percent, DefaultPercent: clubPerfScaleDefault, MaxPercent: clubPerfScaleMax, Configured: true,
			StorageKey: clubPerfScaleKey, ClientContext: clubPerfScaleClientHint, ClientFormat: clubPerfScaleClientFmt,
		}
	}
	writeData(w, http.StatusOK, state)
}

func (s *Server) queryClubPerfScale(ctx context.Context) (clubPerfScaleState, error) {
	state := clubPerfScaleState{
		Percent:        clubPerfScaleDefault,
		DefaultPercent: clubPerfScaleDefault,
		MaxPercent:     clubPerfScaleMax,
		StorageKey:     clubPerfScaleKey,
		ClientContext:  clubPerfScaleClientHint,
		ClientFormat:   clubPerfScaleClientFmt,
	}
	rows, err := s.loadClubPerfScaleRows(ctx)
	if err != nil {
		return state, err
	}
	state.RowCount = len(rows)
	state.DuplicateRows = max(0, len(rows)-1)
	if len(rows) == 0 {
		return state, nil
	}
	value, parseErr := parseClubPerfScale(rows[0].Content)
	if parseErr != nil {
		state.ParseError = parseErr.Error()
		return state, nil
	}
	state.Percent = value
	state.Configured = true
	if meta := s.latestClubPerfScaleMeta(ctx); meta != nil {
		state.UpdatedBy = meta.Operator
		state.UpdatedAt = meta.UpdatedAt
	}
	return state, nil
}

func (s *Server) verifyClubPerfScale(ctx context.Context, expected int) error {
	rows, err := s.loadClubPerfScaleRows(ctx)
	if err != nil {
		return fmt.Errorf("回读失败: %w", err)
	}
	if len(rows) == 0 {
		return errors.New("回读校验失败：没有读到业绩折算百分比")
	}
	for _, row := range rows {
		got, parseErr := parseClubPerfScale(row.Content)
		if parseErr != nil {
			return fmt.Errorf("回读校验失败：%w", parseErr)
		}
		if got != expected {
			return fmt.Errorf("回读校验失败：期望 %d，实际 %d", expected, got)
		}
	}
	return nil
}

func (s *Server) loadClubPerfScaleRows(ctx context.Context) ([]clubPerfScaleRow, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, COALESCE(hash_content, '')
FROM kbedm.usr_hash_info WHERE hash_key = ? ORDER BY id`, clubPerfScaleKey)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []clubPerfScaleRow{}
	for rows.Next() {
		var row clubPerfScaleRow
		if err := rows.Scan(&row.ID, &row.Content); err != nil {
			return nil, err
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

// restoreClubPerfScaleRows 按原行快照恢复。usr_hash_info 线上是 MyISAM，
// ROLLBACK 不生效，只能按原 id 逐行写回；新插入的行直接删掉。
func (s *Server) restoreClubPerfScaleRows(ctx context.Context, before []clubPerfScaleRow, insertedID int64) error {
	if insertedID > 0 {
		_, err := s.db.ExecContext(ctx, `DELETE FROM kbedm.usr_hash_info WHERE id = ? AND hash_key = ?`, insertedID, clubPerfScaleKey)
		return err
	}
	var restoreErrors []error
	for _, row := range before {
		if _, err := s.db.ExecContext(ctx, `UPDATE kbedm.usr_hash_info SET hash_content = ? WHERE id = ? AND hash_key = ?`,
			row.Content, row.ID, clubPerfScaleKey); err != nil {
			restoreErrors = append(restoreErrors, err)
		}
	}
	return errors.Join(restoreErrors...)
}

type clubPerfScaleMeta struct {
	Operator  string
	UpdatedAt *time.Time
}

func (s *Server) latestClubPerfScaleMeta(ctx context.Context) *clubPerfScaleMeta {
	var operator string
	var created sql.NullTime
	err := s.db.QueryRowContext(ctx, `SELECT COALESCE(operator_name, ''), created_at
FROM mgr_audit_log WHERE action = ? ORDER BY id DESC LIMIT 1`, clubPerfScaleAudit).Scan(&operator, &created)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			s.logger.Error("read club perf scale audit", "error", err)
		}
		return nil
	}
	meta := &clubPerfScaleMeta{Operator: operator}
	if created.Valid {
		meta.UpdatedAt = &created.Time
	}
	return meta
}

// parseClubPerfScale 解析库里的明文值。允许带一个百分号后缀（历史手填留的），
// 其余一律按非法处理，由后台提示"现有配置无法解析"并允许整体覆盖。
func parseClubPerfScale(content string) (int, error) {
	text := strings.TrimSpace(content)
	text = strings.TrimSuffix(text, "%")
	text = strings.TrimSpace(text)
	if text == "" {
		return 0, errors.New("折算百分比为空")
	}
	value, err := strconv.Atoi(text)
	if err != nil {
		return 0, fmt.Errorf("现有配置不是合法整数：%s", strings.TrimSpace(content))
	}
	if value < 0 || value > clubPerfScaleMax {
		return 0, fmt.Errorf("现有配置超出范围 0~%d：%s", clubPerfScaleMax, strings.TrimSpace(content))
	}
	return value, nil
}

func validateClubPerfScale(percent int) (int, error) {
	if percent < 0 {
		return 0, errors.New("折算百分比不能为负数")
	}
	if percent > clubPerfScaleMax {
		return 0, fmt.Errorf("折算百分比不能超过 %d", clubPerfScaleMax)
	}
	return percent, nil
}

// clampClubPerfScale 用于读取服务端报表自带的 scale_percent：缺失或非法时按 100（不折算）。
func clampClubPerfScale(value int) int {
	if value < 0 || value > clubPerfScaleMax {
		return clubPerfScaleMax
	}
	return value
}

// scaledClubPerfCount 按百分比折算次数，保留两位小数（与游戏服返回口径一致）。
func scaledClubPerfCount(raw int64, percent int) float64 {
	return math.Round(float64(raw)*float64(clampClubPerfScale(percent))) / 100
}
