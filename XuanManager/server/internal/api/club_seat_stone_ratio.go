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

// 俱乐部配分模式「入座扣钻」的积分→钻石兑换比例。
//
// 服务端从 kbedm.usr_hash_info 读取 `俱乐部积分对应钻石输赢比`（纯小数字符串，如 0.1），
// 建房时快照到房间：带入积分 × 比例 = 扣玩家钻石，结算按最终积分 × 比例退回。
// 0 表示不扣钻石；缺行/空/非法按 1.0（1:1）。改值最多 10 秒进入服务端缓存，
// 老房不变、新建房生效；后台不要删行，恢复 1:1 请把值改成 1.0。
const (
	clubSeatStoneRatioKey        = "俱乐部积分对应钻石输赢比"
	clubSeatStoneRatioAudit      = "configuration.club_seat_stone_ratio.update"
	clubSeatStoneRatioDefault    = 1.0
	clubSeatStoneRatioMax        = 1000.0
	clubSeatStoneRatioDecimals   = 4
	clubSeatStoneRatioClientHint = "俱乐部积分对应钻石输赢比"
	clubSeatStoneRatioClientFmt  = "纯小数字符串（如 0.1）；0 = 不扣钻石"
)

type clubSeatStoneRatioState struct {
	Ratio         float64    `json:"ratio"`
	DefaultRatio  float64    `json:"defaultRatio"`
	Configured    bool       `json:"configured"`
	StorageKey    string     `json:"storageKey"`
	ClientContext string     `json:"clientContext"`
	ClientFormat  string     `json:"clientFormat"`
	UpdatedBy     string     `json:"updatedBy"`
	UpdatedAt     *time.Time `json:"updatedAt"`
	RowCount      int        `json:"rowCount"`
	DuplicateRows int        `json:"duplicateRows"`
	ParseError    string     `json:"parseError"`
}

type updateClubSeatStoneRatioRequest struct {
	Ratio   float64 `json:"ratio"`
	Confirm bool    `json:"confirm"`
}

type clubSeatStoneRatioRow struct {
	ID      int64
	Content string
}

func (s *Server) handleGetClubSeatStoneRatio(w http.ResponseWriter, r *http.Request, p principal) {
	state, err := s.queryClubSeatStoneRatio(r.Context())
	if err != nil {
		s.logger.Error("read club seat stone ratio", "error", err)
		writeError(w, http.StatusInternalServerError, "CLUB_SEAT_STONE_RATIO_QUERY_FAILED", "读取带入钻石兑换比例失败")
		return
	}
	writeData(w, http.StatusOK, state)
}

func (s *Server) handleUpdateClubSeatStoneRatio(w http.ResponseWriter, r *http.Request, p principal) {
	var input updateClubSeatStoneRatioRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if !input.Confirm {
		writeError(w, http.StatusBadRequest, "CONFIRM_REQUIRED", "请先勾选确认再保存")
		return
	}
	ratio, value, err := validateClubSeatStoneRatio(input.Ratio)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_CLUB_SEAT_STONE_RATIO", err.Error())
		return
	}

	beforeRows, err := s.loadClubSeatStoneRatioRows(r.Context())
	if err != nil {
		s.audit(r.Context(), &p, clubSeatStoneRatioAudit, "usr_hash_info", clubSeatStoneRatioKey,
			map[string]any{"ratio": ratio}, nil, nil, 500, "读取原兑换比例失败", clientIP(r))
		writeError(w, http.StatusInternalServerError, "CLUB_SEAT_STONE_RATIO_UPDATE_FAILED", "读取原有兑换比例失败")
		return
	}
	beforeRatio := clubSeatStoneRatioDefault
	if len(beforeRows) > 0 {
		if parsed, parseErr := parseClubSeatStoneRatio(beforeRows[0].Content); parseErr == nil {
			beforeRatio = parsed
		}
	}

	var insertedID int64
	if len(beforeRows) == 0 {
		result, execErr := s.db.ExecContext(r.Context(),
			`INSERT INTO kbedm.usr_hash_info (hash_key, hash_content) VALUES (?, ?)`, clubSeatStoneRatioKey, value)
		if execErr == nil {
			insertedID, execErr = result.LastInsertId()
		}
		err = execErr
	} else {
		// 服务端只认一行且不删行：多行时统一写成同一个值。
		_, err = s.db.ExecContext(r.Context(),
			`UPDATE kbedm.usr_hash_info SET hash_content = ? WHERE hash_key = ?`, value, clubSeatStoneRatioKey)
	}
	if err != nil {
		s.logger.Error("write club seat stone ratio", "error", err)
		if restoreErr := s.restoreClubSeatStoneRatioRows(r.Context(), beforeRows, insertedID); restoreErr != nil {
			s.logger.Error("restore club seat stone ratio after write failure", "error", restoreErr)
		}
		s.audit(r.Context(), &p, clubSeatStoneRatioAudit, "usr_hash_info", clubSeatStoneRatioKey,
			map[string]any{"ratio": ratio}, map[string]any{"ratio": beforeRatio}, nil, 500, "写入带入钻石兑换比例失败", clientIP(r))
		writeError(w, http.StatusInternalServerError, "CLUB_SEAT_STONE_RATIO_UPDATE_FAILED", "保存带入钻石兑换比例失败")
		return
	}

	if verifyErr := s.verifyClubSeatStoneRatio(r.Context(), ratio); verifyErr != nil {
		if restoreErr := s.restoreClubSeatStoneRatioRows(r.Context(), beforeRows, insertedID); restoreErr != nil {
			s.logger.Error("restore club seat stone ratio after verify failure", "error", restoreErr)
			verifyErr = fmt.Errorf("%w（恢复原配置也失败，请立即人工检查）", verifyErr)
		}
		s.audit(r.Context(), &p, clubSeatStoneRatioAudit, "usr_hash_info", clubSeatStoneRatioKey,
			map[string]any{"ratio": ratio}, map[string]any{"ratio": beforeRatio}, nil, 500, verifyErr.Error(), clientIP(r))
		writeError(w, http.StatusInternalServerError, "CLUB_SEAT_STONE_RATIO_VERIFY_FAILED", verifyErr.Error())
		return
	}

	s.audit(r.Context(), &p, clubSeatStoneRatioAudit, "usr_hash_info", clubSeatStoneRatioKey,
		map[string]any{"ratio": ratio}, map[string]any{"ratio": beforeRatio},
		map[string]any{"ratio": ratio}, 0, "带入钻石兑换比例已保存并校验", clientIP(r))
	s.logger.Info("club seat stone ratio updated", "operator", p.Username, "ratio", ratio)

	state, err := s.queryClubSeatStoneRatio(r.Context())
	if err != nil {
		state = clubSeatStoneRatioState{
			Ratio: ratio, DefaultRatio: clubSeatStoneRatioDefault, Configured: true,
			StorageKey: clubSeatStoneRatioKey, ClientContext: clubSeatStoneRatioClientHint,
			ClientFormat: clubSeatStoneRatioClientFmt,
		}
	}
	writeData(w, http.StatusOK, state)
}

func (s *Server) queryClubSeatStoneRatio(ctx context.Context) (clubSeatStoneRatioState, error) {
	state := clubSeatStoneRatioState{
		Ratio:         clubSeatStoneRatioDefault,
		DefaultRatio:  clubSeatStoneRatioDefault,
		StorageKey:    clubSeatStoneRatioKey,
		ClientContext: clubSeatStoneRatioClientHint,
		ClientFormat:  clubSeatStoneRatioClientFmt,
	}
	rows, err := s.loadClubSeatStoneRatioRows(ctx)
	if err != nil {
		return state, err
	}
	state.RowCount = len(rows)
	if len(rows) == 0 {
		return state, nil
	}
	value, parseErr := parseClubSeatStoneRatio(rows[0].Content)
	if parseErr != nil {
		state.ParseError = parseErr.Error()
	} else {
		state.Ratio = value
		state.Configured = true
	}
	state.DuplicateRows = max(0, len(rows)-1)
	if meta := s.latestClubSeatStoneRatioMeta(ctx); meta != nil {
		state.UpdatedBy = meta.Operator
		state.UpdatedAt = meta.UpdatedAt
	}
	return state, nil
}

func (s *Server) verifyClubSeatStoneRatio(ctx context.Context, expected float64) error {
	rows, err := s.loadClubSeatStoneRatioRows(ctx)
	if err != nil {
		return fmt.Errorf("回读失败: %w", err)
	}
	if len(rows) == 0 {
		return errors.New("回读校验失败：没有读到兑换比例")
	}
	for _, row := range rows {
		got, parseErr := parseClubSeatStoneRatio(row.Content)
		if parseErr != nil {
			return fmt.Errorf("回读校验失败：%w", parseErr)
		}
		if math.Abs(got-expected) > 1e-9 {
			return fmt.Errorf("回读校验失败：期望 %s，实际 %s",
				formatClubSeatStoneRatio(expected), formatClubSeatStoneRatio(got))
		}
	}
	return nil
}

func (s *Server) loadClubSeatStoneRatioRows(ctx context.Context) ([]clubSeatStoneRatioRow, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, COALESCE(hash_content, '')
FROM kbedm.usr_hash_info WHERE hash_key = ? ORDER BY id`, clubSeatStoneRatioKey)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []clubSeatStoneRatioRow{}
	for rows.Next() {
		var row clubSeatStoneRatioRow
		if err := rows.Scan(&row.ID, &row.Content); err != nil {
			return nil, err
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

// restoreClubSeatStoneRatioRows 按原行快照恢复。usr_hash_info 线上是 MyISAM，
// ROLLBACK 不生效，只能按原 id 逐行写回；新插入的行直接删掉。
func (s *Server) restoreClubSeatStoneRatioRows(ctx context.Context, before []clubSeatStoneRatioRow, insertedID int64) error {
	if insertedID > 0 {
		_, err := s.db.ExecContext(ctx, `DELETE FROM kbedm.usr_hash_info WHERE id = ? AND hash_key = ?`, insertedID, clubSeatStoneRatioKey)
		return err
	}
	var restoreErrors []error
	for _, row := range before {
		if _, err := s.db.ExecContext(ctx, `UPDATE kbedm.usr_hash_info SET hash_content = ? WHERE id = ? AND hash_key = ?`,
			row.Content, row.ID, clubSeatStoneRatioKey); err != nil {
			restoreErrors = append(restoreErrors, err)
		}
	}
	return errors.Join(restoreErrors...)
}

type clubSeatStoneRatioMeta struct {
	Operator  string
	UpdatedAt *time.Time
}

func (s *Server) latestClubSeatStoneRatioMeta(ctx context.Context) *clubSeatStoneRatioMeta {
	var operator string
	var created sql.NullTime
	err := s.db.QueryRowContext(ctx, `SELECT COALESCE(operator_name, ''), created_at
FROM mgr_audit_log WHERE action = ? ORDER BY id DESC LIMIT 1`, clubSeatStoneRatioAudit).Scan(&operator, &created)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			s.logger.Error("read club seat stone ratio audit", "error", err)
		}
		return nil
	}
	meta := &clubSeatStoneRatioMeta{Operator: operator}
	if created.Valid {
		meta.UpdatedAt = &created.Time
	}
	return meta
}

func parseClubSeatStoneRatio(content string) (float64, error) {
	text := strings.TrimSpace(content)
	if text == "" {
		return 0, errors.New("兑换比例为空")
	}
	value, err := strconv.ParseFloat(text, 64)
	if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, fmt.Errorf("现有配置不是合法小数：%s", text)
	}
	if value < 0 || value > clubSeatStoneRatioMax {
		return 0, fmt.Errorf("现有配置超出范围 0~%s：%s", formatClubSeatStoneRatio(clubSeatStoneRatioMax), text)
	}
	return value, nil
}

// validateClubSeatStoneRatio 返回四舍五入到 4 位小数后的值与实际写入内容。
// 写入用 'f' 格式，避免科学计数法（服务端按 float 解析，但明文更好查库）。
func validateClubSeatStoneRatio(ratio float64) (float64, string, error) {
	if math.IsNaN(ratio) || math.IsInf(ratio, 0) {
		return 0, "", errors.New("兑换比例必须是数字")
	}
	if ratio < 0 {
		return 0, "", errors.New("兑换比例不能为负数")
	}
	if ratio > clubSeatStoneRatioMax {
		return 0, "", fmt.Errorf("兑换比例不能超过 %s", formatClubSeatStoneRatio(clubSeatStoneRatioMax))
	}
	scale := math.Pow10(clubSeatStoneRatioDecimals)
	rounded := math.Round(ratio*scale) / scale
	return rounded, formatClubSeatStoneRatio(rounded), nil
}

func formatClubSeatStoneRatio(value float64) string {
	return strconv.FormatFloat(value, 'f', -1, 64)
}
