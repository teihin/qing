package api

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// 游戏内「游戏推广」页显示的下载地址。
//
// 客户端 ConfigManager.UpdateDefConfig() 登录进大厅时执行 `GetOneHashKey("下载url")`，
// 回包 context 为 `查询哈希_下载url`，明文写进 ConfigManager.downloadurl；
// 大厅「我的 → 推广二维码」和代理页「推广」按钮打开的推广页
// 把 `panelMain.ts` 里的 `V7推广链接` 设成这个值（不做 base64，也不用再拼 /zc?guuid=）。
//
// 所以后台改的就是游戏端哈希配置表 `kbedm.usr_hash_info` 里 `hash_key='下载url'` 那条，
// 内容是一段明文 http(s) 地址，和「系统公告」「消费钻石价格」同一张表、同一套读写规范。
const (
	promotionDownloadURLKey        = "下载url"
	promotionDownloadURLAudit      = "configuration.promotion_download.update"
	promotionDownloadURLDefault    = "http://www.baidu.com"
	promotionDownloadURLMaxLength  = 512
	promotionDownloadURLClientHint = "查询哈希_下载url"
)

type promotionDownloadURLState struct {
	DownloadURL   string     `json:"downloadUrl"`
	Configured    bool       `json:"configured"`
	StorageKey    string     `json:"storageKey"`
	ClientContext string     `json:"clientContext"`
	UpdatedBy     string     `json:"updatedBy"`
	UpdatedAt     *time.Time `json:"updatedAt"`
	DuplicateRows int        `json:"duplicateRows"`
	RowCount      int        `json:"rowCount"`
}

type updatePromotionDownloadURLRequest struct {
	DownloadURL string `json:"downloadUrl"`
	Confirm     bool   `json:"confirm"`
}

type promotionDownloadURLRow struct {
	ID      int64
	Content string
}

func (s *Server) handleGetPromotionDownloadURL(w http.ResponseWriter, r *http.Request, p principal) {
	state, err := s.queryPromotionDownloadURL(r.Context())
	if err != nil {
		s.logger.Error("read promotion download url", "error", err)
		writeError(w, http.StatusInternalServerError, "PROMOTION_DOWNLOAD_QUERY_FAILED", "读取推广下载地址失败")
		return
	}
	writeData(w, http.StatusOK, state)
}

func (s *Server) handleUpdatePromotionDownloadURL(w http.ResponseWriter, r *http.Request, p principal) {
	var input updatePromotionDownloadURLRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if !input.Confirm {
		writeError(w, http.StatusBadRequest, "CONFIRM_REQUIRED", "请先勾选确认再保存")
		return
	}
	next, err := validatePromotionDownloadURL(input.DownloadURL)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PROMOTION_DOWNLOAD_URL", err.Error())
		return
	}

	beforeRows, err := s.loadPromotionDownloadURLRows(r.Context())
	if err != nil {
		s.audit(r.Context(), &p, promotionDownloadURLAudit, "usr_hash_info", promotionDownloadURLKey,
			map[string]any{"downloadUrl": next}, nil, nil, 500, "读取原下载地址失败", clientIP(r))
		writeError(w, http.StatusInternalServerError, "PROMOTION_DOWNLOAD_UPDATE_FAILED", "读取原有下载地址失败")
		return
	}
	beforeURL := promotionDownloadURLDefault
	if len(beforeRows) > 0 {
		beforeURL = strings.TrimSpace(beforeRows[0].Content)
	}

	var insertedID int64
	if len(beforeRows) == 0 {
		result, execErr := s.db.ExecContext(r.Context(),
			`INSERT INTO kbedm.usr_hash_info (hash_key, hash_content) VALUES (?, ?)`, promotionDownloadURLKey, next)
		if execErr == nil {
			insertedID, execErr = result.LastInsertId()
		}
		err = execErr
	} else {
		_, err = s.db.ExecContext(r.Context(),
			`UPDATE kbedm.usr_hash_info SET hash_content = ? WHERE hash_key = ?`, next, promotionDownloadURLKey)
	}
	if err != nil {
		s.logger.Error("write promotion download url", "error", err)
		if restoreErr := s.restorePromotionDownloadURLRows(r.Context(), beforeRows, insertedID); restoreErr != nil {
			s.logger.Error("restore promotion download url after write failure", "error", restoreErr)
			err = fmt.Errorf("%w（恢复原配置也失败，请立即人工检查）", err)
		}
		s.audit(r.Context(), &p, promotionDownloadURLAudit, "usr_hash_info", promotionDownloadURLKey,
			map[string]any{"downloadUrl": next}, map[string]any{"downloadUrl": beforeURL}, nil, 500, "写入推广下载地址失败", clientIP(r))
		writeError(w, http.StatusInternalServerError, "PROMOTION_DOWNLOAD_UPDATE_FAILED", "保存推广下载地址失败")
		return
	}

	if verifyErr := s.verifyPromotionDownloadURL(r.Context(), next); verifyErr != nil {
		if restoreErr := s.restorePromotionDownloadURLRows(r.Context(), beforeRows, insertedID); restoreErr != nil {
			s.logger.Error("restore promotion download url after verify failure", "error", restoreErr)
			verifyErr = fmt.Errorf("%w（恢复原配置也失败，请立即人工检查）", verifyErr)
		}
		s.audit(r.Context(), &p, promotionDownloadURLAudit, "usr_hash_info", promotionDownloadURLKey,
			map[string]any{"downloadUrl": next}, map[string]any{"downloadUrl": beforeURL}, nil, 500, verifyErr.Error(), clientIP(r))
		writeError(w, http.StatusInternalServerError, "PROMOTION_DOWNLOAD_VERIFY_FAILED", verifyErr.Error())
		return
	}

	s.audit(r.Context(), &p, promotionDownloadURLAudit, "usr_hash_info", promotionDownloadURLKey,
		map[string]any{"downloadUrl": next}, map[string]any{"downloadUrl": beforeURL},
		map[string]any{"downloadUrl": next}, 0, "推广下载地址已保存并校验", clientIP(r))
	s.logger.Info("promotion download url updated", "operator", p.Username, "url", next)

	state, err := s.queryPromotionDownloadURL(r.Context())
	if err != nil {
		state = promotionDownloadURLState{DownloadURL: next, Configured: true, StorageKey: promotionDownloadURLKey}
	}
	writeData(w, http.StatusOK, state)
}

func (s *Server) queryPromotionDownloadURL(ctx context.Context) (promotionDownloadURLState, error) {
	state := promotionDownloadURLState{
		DownloadURL:   promotionDownloadURLDefault,
		StorageKey:    promotionDownloadURLKey,
		ClientContext: promotionDownloadURLClientHint,
	}
	rows, err := s.loadPromotionDownloadURLRows(ctx)
	if err != nil {
		return state, err
	}
	state.RowCount = len(rows)
	if len(rows) == 0 {
		return state, nil
	}
	// 客户端按 id 顺序只认第一条，后台也以第一条为准，避免多行时显示和实际不一致。
	value := strings.TrimSpace(rows[0].Content)
	if value != "" {
		state.DownloadURL = value
	}
	state.Configured = true
	state.DuplicateRows = max(0, len(rows)-1)
	if meta := s.latestPromotionDownloadURLMeta(ctx); meta != nil {
		state.UpdatedBy = meta.Operator
		state.UpdatedAt = meta.UpdatedAt
	}
	return state, nil
}

func (s *Server) verifyPromotionDownloadURL(ctx context.Context, expected string) error {
	rows, err := s.loadPromotionDownloadURLRows(ctx)
	if err != nil {
		return fmt.Errorf("回读失败: %w", err)
	}
	if len(rows) == 0 {
		return errors.New("回读校验失败：没有读到下载地址")
	}
	if got := strings.TrimSpace(rows[0].Content); got != expected {
		return fmt.Errorf("回读校验失败：期望 %s，实际 %s", expected, got)
	}
	return nil
}

func (s *Server) loadPromotionDownloadURLRows(ctx context.Context) ([]promotionDownloadURLRow, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, COALESCE(hash_content, '')
FROM kbedm.usr_hash_info WHERE hash_key = ? ORDER BY id`, promotionDownloadURLKey)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []promotionDownloadURLRow{}
	for rows.Next() {
		var row promotionDownloadURLRow
		if err := rows.Scan(&row.ID, &row.Content); err != nil {
			return nil, err
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

// restorePromotionDownloadURLRows 按原行快照恢复。usr_hash_info 线上是 MyISAM，
// ROLLBACK 不生效，只能按原 id 逐行写回；新插入的行直接删掉。
func (s *Server) restorePromotionDownloadURLRows(ctx context.Context, before []promotionDownloadURLRow, insertedID int64) error {
	if insertedID > 0 {
		_, err := s.db.ExecContext(ctx, `DELETE FROM kbedm.usr_hash_info WHERE id = ? AND hash_key = ?`, insertedID, promotionDownloadURLKey)
		return err
	}
	var restoreErrors []error
	for _, row := range before {
		if _, err := s.db.ExecContext(ctx, `UPDATE kbedm.usr_hash_info SET hash_content = ? WHERE id = ? AND hash_key = ?`,
			row.Content, row.ID, promotionDownloadURLKey); err != nil {
			restoreErrors = append(restoreErrors, err)
		}
	}
	return errors.Join(restoreErrors...)
}

type promotionDownloadURLMeta struct {
	Operator  string
	UpdatedAt *time.Time
}

func (s *Server) latestPromotionDownloadURLMeta(ctx context.Context) *promotionDownloadURLMeta {
	var operator string
	var created sql.NullTime
	err := s.db.QueryRowContext(ctx, `SELECT COALESCE(operator_name, ''), created_at
FROM mgr_audit_log WHERE action = ? ORDER BY id DESC LIMIT 1`, promotionDownloadURLAudit).Scan(&operator, &created)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			s.logger.Error("read promotion download url audit", "error", err)
		}
		return nil
	}
	meta := &promotionDownloadURLMeta{Operator: operator}
	if created.Valid {
		meta.UpdatedAt = &created.Time
	}
	return meta
}

// validatePromotionDownloadURL 只接受完整的 http:// 或 https:// 地址：
// 这个值会原样显示在玩家手机上并被「复制」，相对路径没有意义。
func validatePromotionDownloadURL(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", errors.New("游戏下载地址不能为空")
	}
	if utf8.RuneCountInString(value) > promotionDownloadURLMaxLength {
		return "", fmt.Errorf("游戏下载地址最多 %d 个字符", promotionDownloadURLMaxLength)
	}
	for _, char := range value {
		if unicode.IsControl(char) || unicode.IsSpace(char) {
			return "", errors.New("游戏下载地址不能包含空格、换行或控制字符")
		}
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", errors.New("游戏下载地址必须是完整的 http:// 或 https:// 地址")
	}
	if parsed.User != nil {
		return "", errors.New("游戏下载地址不能包含账号密码")
	}
	return value, nil
}
