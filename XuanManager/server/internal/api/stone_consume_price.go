package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"time"
)

// 钻石消费价格：后台维护、客户端读取的同一份配置。
//
// 存储位置沿用游戏端已有的哈希配置表 `kbedm.usr_hash_info`
// （`hash_key='消费钻石价格'`，`hash_content` = 客户端 `Tool.Base64Decode` 可解的 JSON），
// 客户端通过 `查询_哈希_信息` 读取，不新增协议。
const stoneConsumePriceKey = "消费钻石价格"

// stoneConsumePriceMax 单项上限：与客户端 money(int32) 和业务常识对齐，防手滑多打 0。
const stoneConsumePriceMax = 100000

// stoneConsumePriceItem 是后台可配置的消费项。
// Code 必须与客户端 ConfigManager.CONSUME_* 及服务端 consume_type 完全一致。
type stoneConsumePriceItem struct {
	Code        string `json:"code"`
	Name        string `json:"name"`
	Scene       string `json:"scene"`
	Default     int    `json:"defaultStone"`
	LegacyMoney int    `json:"legacyMoney"`
	LegacyUnit  string `json:"legacyUnit"`
}

var stoneConsumePriceCatalog = []stoneConsumePriceItem{
	{Code: "换头像", Name: "更换头像", Scene: "大厅 · 我的 · 修改个人信息", Default: 10, LegacyMoney: 1000, LegacyUnit: "分"},
	{Code: "看数据", Name: "查看战绩数据", Scene: "大厅「查看数据」/ 玩家资料「看一下」", Default: 1, LegacyMoney: 50, LegacyUnit: "分"},
	{Code: "道具", Name: "牌桌道具", Scene: "牌桌 · 玩家资料 · 道具", Default: 1, LegacyMoney: 10, LegacyUnit: "分"},
	{Code: "强制秀牌", Name: "强制秀牌", Scene: "牌桌 · 强制看所有人牌", Default: 5, LegacyMoney: 500, LegacyUnit: "分"},
	{Code: "看下一张牌", Name: "看下一张牌", Scene: "牌桌 · 看剩余牌", Default: 1, LegacyMoney: 10, LegacyUnit: "分"},
	{Code: "切牌", Name: "切牌", Scene: "牌桌 · 切牌", Default: 1, LegacyMoney: 100, LegacyUnit: "分"},
	{Code: "举报", Name: "举报玩家", Scene: "牌桌 · 举报", Default: 50, LegacyMoney: 5000, LegacyUnit: "分"},
	// 翻牌是新增收费点（原来免费），没有对应金币价，LegacyMoney 留 0。
	{Code: "翻牌", Name: "牌局回顾一键翻牌", Scene: "牌桌 · 牌局回顾 · 翻牌", Default: 500, LegacyMoney: 0, LegacyUnit: ""},
	// 创建俱乐部是新增收费点（原来免费），没有对应金币价，LegacyMoney 留 0。
	{Code: "创建俱乐部", Name: "创建俱乐部", Scene: "大厅 · 俱乐部 · 创建俱乐部", Default: 10000, LegacyMoney: 0, LegacyUnit: ""},
}

// stoneConsumePriceRetired 是已停用的消费项：不再出现在后台页面，也不再写入配置。
//   - VIP 三档没有消费场景（2026-10-26 用户确认）。
//   - `延时` 曾短暂加入 catalog，但接口文档 v1.2 §3.7 规定加时价格由服务端固定档位决定
//     （第 2 次 200 钻 / 第 3 次 400 钻 / 第 1 次免费），后台配了也不生效，故一并撤下。
//
// 配置里若还留着这些旧键，读取时静默忽略；老页面提交上来也不会报「未知消费项」。
var stoneConsumePriceRetired = map[string]bool{
	"购买VIP月卡":  true,
	"购买VIP半年卡": true,
	"购买VIP年卡":  true,
	"延时":       true,
}

type stoneConsumePriceItemState struct {
	Code        string `json:"code"`
	Name        string `json:"name"`
	Scene       string `json:"scene"`
	Stone       int    `json:"stone"`
	Default     int    `json:"defaultStone"`
	LegacyMoney int    `json:"legacyMoney"`
	LegacyUnit  string `json:"legacyUnit"`
}

type stoneConsumePriceState struct {
	Items         []stoneConsumePriceItemState `json:"items"`
	StorageKey    string                       `json:"storageKey"`
	Configured    bool                         `json:"configured"`
	ClientFormat  string                       `json:"clientFormat"`
	UpdatedBy     string                       `json:"updatedBy"`
	UpdatedAt     *time.Time                   `json:"updatedAt"`
	MissingItems  []string                     `json:"missingItems"`
	UnknownItems  []string                     `json:"unknownItems"`
	ParseErrorMsg string                       `json:"parseError"`
}

type updateStoneConsumePriceRequest struct {
	Items   []stoneConsumePriceItemState `json:"items"`
	Confirm bool                         `json:"confirm"`
}

func (s *Server) handleGetStoneConsumePrice(w http.ResponseWriter, r *http.Request, p principal) {
	state, err := s.queryStoneConsumePrice(r.Context())
	if err != nil {
		s.logger.Error("read stone consume price", "error", err)
		writeError(w, http.StatusInternalServerError, "STONE_CONSUME_QUERY_FAILED", "读取钻石消费价格失败")
		return
	}
	writeData(w, http.StatusOK, state)
}

func (s *Server) handleUpdateStoneConsumePrice(w http.ResponseWriter, r *http.Request, p principal) {
	var input updateStoneConsumePriceRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if !input.Confirm {
		writeError(w, http.StatusBadRequest, "CONFIRM_REQUIRED", "请先勾选确认再保存")
		return
	}
	values, err := validateStoneConsumePriceInput(input.Items)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_STONE_CONSUME_PRICE", err.Error())
		return
	}

	beforeState, err := s.queryStoneConsumePrice(r.Context())
	if err != nil {
		s.logger.Error("read stone consume price before update", "error", err)
		writeError(w, http.StatusInternalServerError, "STONE_CONSUME_UPDATE_FAILED", "读取原有价格失败")
		return
	}

	payload, err := json.Marshal(values)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "STONE_CONSUME_UPDATE_FAILED", "生成配置内容失败")
		return
	}
	encoded := encodeClientBase64(string(payload))

	beforeRows, err := s.loadStoneConsumePriceRows(r.Context())
	if err != nil {
		s.audit(r.Context(), &p, "configuration.stone_consume.update", "usr_hash_info", stoneConsumePriceKey,
			map[string]any{"items": values}, nil, nil, 500, "读取原钻石消费价格失败", clientIP(r))
		writeError(w, http.StatusInternalServerError, "STONE_CONSUME_UPDATE_FAILED", "读取原有价格失败")
		return
	}

	var insertedID int64
	if len(beforeRows) == 0 {
		result, execErr := s.db.ExecContext(r.Context(),
			`INSERT INTO kbedm.usr_hash_info (hash_key, hash_content) VALUES (?, ?)`, stoneConsumePriceKey, encoded)
		if execErr == nil {
			insertedID, execErr = result.LastInsertId()
		}
		err = execErr
	} else {
		_, err = s.db.ExecContext(r.Context(),
			`UPDATE kbedm.usr_hash_info SET hash_content = ? WHERE hash_key = ?`, encoded, stoneConsumePriceKey)
	}
	if err != nil {
		s.logger.Error("write stone consume price", "error", err)
		if restoreErr := s.restoreStoneConsumePriceRows(r.Context(), beforeRows, insertedID); restoreErr != nil {
			s.logger.Error("restore stone consume price after write failure", "error", restoreErr)
		}
		s.audit(r.Context(), &p, "configuration.stone_consume.update", "usr_hash_info", stoneConsumePriceKey,
			map[string]any{"items": values}, map[string]any{"items": beforeState.Items}, nil, 500, "写入钻石消费价格失败", clientIP(r))
		writeError(w, http.StatusInternalServerError, "STONE_CONSUME_UPDATE_FAILED", "保存钻石消费价格失败")
		return
	}

	storedRows, verifyErr := s.loadStoneConsumePriceRows(r.Context())
	if verifyErr != nil {
		verifyErr = fmt.Errorf("回读失败: %w", verifyErr)
	} else {
		decodedContent, decodeErr := decodeStoneConsumePriceRows(storedRows)
		if decodeErr != nil {
			verifyErr = decodeErr
		} else {
			var stored map[string]int
			if unmarshalErr := json.Unmarshal([]byte(decodedContent), &stored); unmarshalErr != nil {
				verifyErr = fmt.Errorf("回读内容无法解析: %w", unmarshalErr)
			} else if mismatch := compareStoneConsumePrice(values, stored); mismatch != "" {
				verifyErr = errors.New(mismatch)
			}
		}
	}
	if verifyErr != nil {
		if restoreErr := s.restoreStoneConsumePriceRows(r.Context(), beforeRows, insertedID); restoreErr != nil {
			s.logger.Error("restore stone consume price after verify failure", "error", restoreErr)
			verifyErr = fmt.Errorf("%w（恢复原配置也失败，请立即人工检查）", verifyErr)
		}
		s.audit(r.Context(), &p, "configuration.stone_consume.update", "usr_hash_info", stoneConsumePriceKey,
			map[string]any{"items": values}, map[string]any{"items": beforeState.Items}, nil, 500, verifyErr.Error(), clientIP(r))
		writeError(w, http.StatusInternalServerError, "STONE_CONSUME_VERIFY_FAILED", verifyErr.Error())
		return
	}

	afterState, err := s.queryStoneConsumePrice(r.Context())
	if err != nil {
		afterState = stoneConsumePriceState{Items: beforeState.Items, StorageKey: stoneConsumePriceKey}
	}
	s.audit(r.Context(), &p, "configuration.stone_consume.update", "usr_hash_info", stoneConsumePriceKey,
		map[string]any{"items": values}, map[string]any{"items": beforeState.Items},
		map[string]any{"items": values}, 0, "钻石消费价格已保存并校验", clientIP(r))
	s.logger.Info("stone consume price updated", "operator", p.Username, "items", values)
	writeData(w, http.StatusOK, afterState)
}

func validateStoneConsumePriceInput(items []stoneConsumePriceItemState) (map[string]int, error) {
	if len(items) == 0 {
		return nil, errors.New("请至少提交一项消费价格")
	}
	allowed := map[string]stoneConsumePriceItem{}
	for _, item := range stoneConsumePriceCatalog {
		allowed[item.Code] = item
	}
	values := map[string]int{}
	for _, item := range items {
		// 已停用项（如 VIP 三档）老页面可能还会带上，静默忽略，不阻断保存、也不写回。
		if stoneConsumePriceRetired[item.Code] {
			continue
		}
		if _, ok := allowed[item.Code]; !ok {
			return nil, fmt.Errorf("未知消费项: %s", item.Code)
		}
		if item.Stone < 0 {
			return nil, fmt.Errorf("「%s」的钻石数量不能为负数", allowed[item.Code].Name)
		}
		if item.Stone > stoneConsumePriceMax {
			return nil, fmt.Errorf("「%s」的钻石数量不能超过 %d", allowed[item.Code].Name, stoneConsumePriceMax)
		}
		values[item.Code] = item.Stone
	}
	// 缺项按默认值补齐，避免只提交一部分把其他项写成 0。
	for _, item := range stoneConsumePriceCatalog {
		if _, ok := values[item.Code]; !ok {
			values[item.Code] = item.Default
		}
	}
	return values, nil
}

func compareStoneConsumePrice(expected, stored map[string]int) string {
	for code, value := range expected {
		if stored[code] != value {
			return fmt.Sprintf("回读校验失败：%s 期望 %d，实际 %d", code, value, stored[code])
		}
	}
	return ""
}

func (s *Server) queryStoneConsumePrice(ctx context.Context) (stoneConsumePriceState, error) {
	state := stoneConsumePriceState{
		StorageKey:   stoneConsumePriceKey,
		ClientFormat: "base64(encodeURIComponent(json))",
		Items:        []stoneConsumePriceItemState{},
		MissingItems: []string{},
		UnknownItems: []string{},
	}
	rows, err := s.loadStoneConsumePriceRows(ctx)
	if err != nil {
		return state, err
	}
	stored := map[string]int{}
	if len(rows) > 0 {
		decoded, decodeErr := decodeStoneConsumePriceRows(rows)
		if decodeErr != nil {
			state.ParseErrorMsg = decodeErr.Error()
		} else {
			if unmarshalErr := json.Unmarshal([]byte(decoded), &stored); unmarshalErr != nil {
				state.ParseErrorMsg = "现有配置不是合法的价格 JSON"
			}
		}
	}
	level := map[string]stoneConsumePriceItem{}
	for _, item := range stoneConsumePriceCatalog {
		level[item.Code] = item
		stone, ok := stored[item.Code]
		if !ok {
			state.MissingItems = append(state.MissingItems, item.Code)
			stone = item.Default
		}
		state.Items = append(state.Items, stoneConsumePriceItemState{
			Code: item.Code, Name: item.Name, Scene: item.Scene, Stone: stone,
			Default: item.Default, LegacyMoney: item.LegacyMoney, LegacyUnit: item.LegacyUnit,
		})
	}
	unknown := make([]string, 0)
	for code := range stored {
		if _, ok := level[code]; !ok && !stoneConsumePriceRetired[code] {
			unknown = append(unknown, code)
		}
	}
	sort.Strings(unknown)
	state.UnknownItems = unknown
	state.Configured = len(rows) > 0 && state.ParseErrorMsg == ""
	if meta, metaErr := s.loadStoneConsumePriceMeta(ctx); metaErr == nil && meta != nil {
		state.UpdatedBy = meta.Operator
		state.UpdatedAt = meta.UpdatedAt
	}
	return state, nil
}

type storedStoneConsumePriceRow struct {
	ID      int64
	Content string
}

func (s *Server) loadStoneConsumePriceRows(ctx context.Context) ([]storedStoneConsumePriceRow, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, COALESCE(hash_content, '')
FROM kbedm.usr_hash_info WHERE hash_key = ? ORDER BY id`, stoneConsumePriceKey)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []storedStoneConsumePriceRow{}
	for rows.Next() {
		var row storedStoneConsumePriceRow
		if err := rows.Scan(&row.ID, &row.Content); err != nil {
			return nil, err
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

func decodeStoneConsumePriceRows(rows []storedStoneConsumePriceRow) (string, error) {
	if len(rows) == 0 {
		return "", nil
	}
	// 与客户端一致：取第一条有效记录（客户端按 id 顺序也只认一条）。
	for _, row := range rows {
		decoded, err := decodeClientBase64(row.Content)
		if err != nil {
			continue
		}
		if decoded != "" {
			return decoded, nil
		}
	}
	return "", errors.New("现有配置无法解码")
}

func (s *Server) restoreStoneConsumePriceRows(ctx context.Context, before []storedStoneConsumePriceRow, insertedID int64) error {
	if insertedID > 0 {
		if _, err := s.db.ExecContext(ctx, `DELETE FROM kbedm.usr_hash_info WHERE id = ? AND hash_key = ?`, insertedID, stoneConsumePriceKey); err != nil {
			return err
		}
		return nil
	}
	var restoreErrors []error
	for _, row := range before {
		if _, err := s.db.ExecContext(ctx, `UPDATE kbedm.usr_hash_info SET hash_content = ? WHERE id = ? AND hash_key = ?`, row.Content, row.ID, stoneConsumePriceKey); err != nil {
			restoreErrors = append(restoreErrors, err)
		}
	}
	return errors.Join(restoreErrors...)
}

type stoneConsumePriceMeta struct {
	Operator  string
	UpdatedAt *time.Time
}

func (s *Server) loadStoneConsumePriceMeta(ctx context.Context) (*stoneConsumePriceMeta, error) {
	var operator string
	var created sql.NullTime
	err := s.db.QueryRowContext(ctx, `SELECT COALESCE(operator_name, ''), created_at
FROM mgr_audit_log WHERE action = 'configuration.stone_consume.update' ORDER BY id DESC LIMIT 1`).Scan(&operator, &created)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	meta := &stoneConsumePriceMeta{Operator: operator}
	if created.Valid {
		meta.UpdatedAt = &created.Time
	}
	return meta, nil
}
