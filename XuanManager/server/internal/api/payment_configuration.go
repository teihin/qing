package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

const (
	paymentListKey         = "支付管理"
	paymentDomainKey       = "支付域名"
	paymentBranchKey       = "提现需要支行"
	paymentAlipayTextKey   = "提现文本_支付宝"
	paymentUnionPayTextKey = "提现文本_银联"
	paymentUSDTTextKey     = "提现文本_USDT"
)

var paymentConfigurationMutationMu sync.Mutex

var defaultPaymentChannelNames = []string{
	"支付1", "支付2", "支付3", "支付4", "支付5", "支付6", "支付7", "支付8", "支付9", "支付10", "支付11", "支付12",
	"VIP充值", "VIP充值2", "自助充值", "提现",
}

type paymentChannelConfig struct {
	Name          string   `json:"name"`
	Enabled       bool     `json:"enabled"`
	NeedsInfo     bool     `json:"needsInfo"`
	InfoFields    []string `json:"infoFields"`
	PresetAmounts string   `json:"presetAmounts"`
	DisplayText   string   `json:"displayText"`
	Banks         string   `json:"banks"`
	AllowCustom   bool     `json:"allowCustom"`
	CustomMin     string   `json:"customMin"`
	CustomMax     string   `json:"customMax"`
	Configured    bool     `json:"configured"`
	EncodingError bool     `json:"encodingError"`
}

type paymentConfigurationState struct {
	Channels             []paymentChannelConfig `json:"channels"`
	PaymentDomain        string                 `json:"paymentDomain"`
	RequireBankBranch    bool                   `json:"requireBankBranch"`
	AlipayWithdrawalText string                 `json:"alipayWithdrawalText"`
	UnionWithdrawalText  string                 `json:"unionWithdrawalText"`
	USDTWithdrawalText   string                 `json:"usdtWithdrawalText"`
	Revision             string                 `json:"revision"`
	LastUpdatedBy        string                 `json:"lastUpdatedBy"`
	LastUpdatedAt        *time.Time             `json:"lastUpdatedAt"`
}

type updatePaymentConfigurationRequest struct {
	Channels             []paymentChannelConfig `json:"channels"`
	PaymentDomain        string                 `json:"paymentDomain"`
	RequireBankBranch    bool                   `json:"requireBankBranch"`
	AlipayWithdrawalText string                 `json:"alipayWithdrawalText"`
	UnionWithdrawalText  string                 `json:"unionWithdrawalText"`
	USDTWithdrawalText   string                 `json:"usdtWithdrawalText"`
	Revision             string                 `json:"revision"`
	Confirm              bool                   `json:"confirm"`
}

type paymentClientConfig struct {
	NeedInfo   bool   `json:"needinfo"`
	InfoList   string `json:"infolist"`
	Money      string `json:"money"`
	Notify     string `json:"notify"`
	Bank       string `json:"bank"`
	OpenInput  bool   `json:"bOpenInput"`
	InputRange string `json:"inputrange"`
}

type storedHashRow struct {
	ID      int64
	Key     string
	Content string
}

func (s *Server) handleGetPaymentConfiguration(w http.ResponseWriter, r *http.Request, p principal) {
	state, err := s.queryPaymentConfiguration(r.Context(), p)
	if err != nil {
		s.logger.Error("read payment configuration", "error", err)
		writeError(w, http.StatusInternalServerError, "PAYMENT_CONFIGURATION_QUERY_FAILED", "读取支付通道配置失败")
		return
	}
	writeData(w, http.StatusOK, state)
}

func (s *Server) handleUpdatePaymentConfiguration(w http.ResponseWriter, r *http.Request, p principal) {
	var input updatePaymentConfigurationRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if !input.Confirm {
		writeError(w, http.StatusBadRequest, "PAYMENT_CONFIRM_REQUIRED", "请确认支付配置会直接影响客户端充值和提现入口")
		return
	}
	if err := normalizeAndValidatePaymentRequest(&input); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PAYMENT_CONFIGURATION", err.Error())
		return
	}
	paymentConfigurationMutationMu.Lock()
	defer paymentConfigurationMutationMu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	before, err := s.queryPaymentConfiguration(ctx, p)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "PAYMENT_CONFIGURATION_QUERY_FAILED", "读取当前支付配置失败")
		return
	}
	if input.Revision == "" || input.Revision != before.Revision {
		writeError(w, http.StatusConflict, "PAYMENT_CONFIGURATION_CHANGED", "支付配置已被其他管理员修改，请刷新后再保存")
		return
	}
	writes, err := paymentHashWrites(input)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PAYMENT_CONFIGURATION", err.Error())
		return
	}
	keys := make([]string, 0, len(writes))
	for key := range writes {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	beforeRows, err := s.loadStoredHashRows(ctx, keys)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "PAYMENT_CONFIGURATION_UPDATE_FAILED", "保存前快照失败")
		return
	}
	insertedIDs := []int64{}
	if err := s.writeHashValues(ctx, writes, &insertedIDs); err != nil {
		restoreErr := s.restoreStoredHashRows(ctx, beforeRows, insertedIDs, keys)
		s.logger.Error("write payment configuration", "error", err, "restoreError", restoreErr)
		s.audit(ctx, &p, "configuration.payment.update", "game_configuration", "payments", paymentAuditSummary(input), before, nil, 500, "支付配置保存失败", clientIP(r))
		writeError(w, http.StatusInternalServerError, "PAYMENT_CONFIGURATION_UPDATE_FAILED", "支付配置保存失败，已尝试恢复原配置")
		return
	}
	after, verifyErr := s.queryPaymentConfiguration(ctx, p)
	if verifyErr != nil || !paymentStateMatchesRequest(after, input) {
		restoreErr := s.restoreStoredHashRows(ctx, beforeRows, insertedIDs, keys)
		s.logger.Error("verify payment configuration", "error", verifyErr, "restoreError", restoreErr)
		writeError(w, http.StatusInternalServerError, "PAYMENT_CONFIGURATION_VERIFY_FAILED", "支付配置回读校验失败，已尝试恢复原配置")
		return
	}
	s.audit(ctx, &p, "configuration.payment.update", "game_configuration", "payments", paymentAuditSummary(input), before, after, 0, "支付通道配置已保存并完成回读校验", clientIP(r))
	writeData(w, http.StatusOK, after)
}

func (s *Server) queryPaymentConfiguration(ctx context.Context, p principal) (paymentConfigurationState, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT hash_key, COALESCE(hash_content, '')
FROM kbedm.usr_hash_info
WHERE hash_key IN (?, ?, ?, ?, ?, ?)
	   OR LEFT(hash_key, CHAR_LENGTH('支付配置_')) = '支付配置_'
ORDER BY id`, paymentListKey, paymentDomainKey, paymentBranchKey, paymentAlipayTextKey, paymentUnionPayTextKey, paymentUSDTTextKey)
	if err != nil {
		return paymentConfigurationState{}, err
	}
	defer rows.Close()
	values := map[string]string{}
	channelNames := append([]string{}, defaultPaymentChannelNames...)
	seenNames := map[string]bool{}
	for _, name := range channelNames {
		seenNames[name] = true
	}
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			return paymentConfigurationState{}, err
		}
		if _, exists := values[key]; !exists {
			values[key] = value
		}
		if strings.HasPrefix(key, "支付配置_") {
			name := strings.TrimPrefix(key, "支付配置_")
			if name != "" && !seenNames[name] {
				seenNames[name] = true
				channelNames = append(channelNames, name)
			}
		}
	}
	if err := rows.Err(); err != nil {
		return paymentConfigurationState{}, err
	}
	enabled := splitHashList(values[paymentListKey])
	state := paymentConfigurationState{
		Channels: []paymentChannelConfig{}, PaymentDomain: values[paymentDomainKey],
		RequireBankBranch:    strings.EqualFold(values[paymentBranchKey], "true"),
		AlipayWithdrawalText: values[paymentAlipayTextKey], UnionWithdrawalText: values[paymentUnionPayTextKey],
		USDTWithdrawalText: values[paymentUSDTTextKey],
	}
	for _, name := range channelNames {
		channel := paymentChannelConfig{Name: name, Enabled: enabled[name]}
		encoded, configured := values["支付配置_"+name]
		channel.Configured = configured && encoded != ""
		if channel.Configured {
			decoded, decodeErr := decodeClientBase64(encoded)
			var client paymentClientConfig
			if decodeErr != nil || json.Unmarshal([]byte(decoded), &client) != nil {
				channel.EncodingError = true
			} else {
				channel.NeedsInfo = client.NeedInfo
				channel.InfoFields = splitHashListOrdered(client.InfoList)
				channel.PresetAmounts = client.Money
				channel.DisplayText = client.Notify
				channel.Banks = client.Bank
				channel.AllowCustom = client.OpenInput
				parts := strings.Split(client.InputRange, ",")
				if len(parts) == 2 {
					channel.CustomMin = strings.TrimSpace(parts[0])
					channel.CustomMax = strings.TrimSpace(parts[1])
				}
			}
		}
		state.Channels = append(state.Channels, channel)
	}
	state.Revision = paymentStateRevision(state)
	updatedBy, updatedAt, err := s.latestAuditAttribution(ctx, "configuration.payment.update", p)
	if err != nil {
		return state, err
	}
	state.LastUpdatedBy, state.LastUpdatedAt = updatedBy, updatedAt
	return state, nil
}

func normalizeAndValidatePaymentRequest(input *updatePaymentConfigurationRequest) error {
	input.PaymentDomain = strings.TrimSpace(input.PaymentDomain)
	if utf8.RuneCountInString(input.PaymentDomain) > 500 {
		return errors.New("支付域名不能超过 500 个字符")
	}
	if input.PaymentDomain != "" {
		parsed, err := url.Parse(input.PaymentDomain)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil {
			return errors.New("支付域名必须是完整的 HTTP 或 HTTPS 地址，且不能包含账号密码")
		}
	}
	texts := []*string{&input.AlipayWithdrawalText, &input.UnionWithdrawalText, &input.USDTWithdrawalText}
	for _, textValue := range texts {
		*textValue = strings.TrimSpace(*textValue)
		if err := validateConfigurationText(*textValue, 0, 2000, true, "提现说明"); err != nil {
			return err
		}
	}
	if len(input.Channels) < 1 || len(input.Channels) > 50 {
		return errors.New("支付通道数量必须在 1 到 50 个之间")
	}
	seen := map[string]bool{}
	for index := range input.Channels {
		channel := &input.Channels[index]
		channel.Name = strings.TrimSpace(channel.Name)
		if err := validatePaymentChannelName(channel.Name); err != nil {
			return err
		}
		if seen[channel.Name] {
			return fmt.Errorf("支付通道 %s 重复", channel.Name)
		}
		seen[channel.Name] = true
		channel.PresetAmounts = strings.TrimSpace(channel.PresetAmounts)
		channel.DisplayText = strings.TrimSpace(channel.DisplayText)
		channel.Banks = strings.TrimSpace(channel.Banks)
		channel.CustomMin = strings.TrimSpace(channel.CustomMin)
		channel.CustomMax = strings.TrimSpace(channel.CustomMax)
		if err := validateConfigurationText(channel.PresetAmounts, 0, 1000, false, channel.Name+"预设金额"); err != nil {
			return err
		}
		if err := validateConfigurationText(channel.DisplayText, 0, 1000, true, channel.Name+"支付说明"); err != nil {
			return err
		}
		if err := validateConfigurationText(channel.Banks, 0, 4000, true, channel.Name+"银行列表"); err != nil {
			return err
		}
		if len(channel.InfoFields) > 20 {
			return fmt.Errorf("%s 的资料字段不能超过 20 个", channel.Name)
		}
		for infoIndex := range channel.InfoFields {
			channel.InfoFields[infoIndex] = strings.TrimSpace(channel.InfoFields[infoIndex])
			if err := validateSimplePaymentValue(channel.InfoFields[infoIndex], 32, "资料字段"); err != nil {
				return err
			}
		}
		if channel.AllowCustom {
			minValue, minErr := strconv.ParseFloat(channel.CustomMin, 64)
			maxValue, maxErr := strconv.ParseFloat(channel.CustomMax, 64)
			if minErr != nil || maxErr != nil || minValue < 0 || maxValue <= minValue || maxValue > 1e9 {
				return fmt.Errorf("%s 的自定义金额范围不正确", channel.Name)
			}
		}
	}
	return nil
}

func validatePaymentChannelName(value string) error {
	if err := validateSimplePaymentValue(value, 32, "支付通道名称"); err != nil {
		return err
	}
	if strings.ContainsAny(value, "#,_/") {
		return errors.New("支付通道名称不能包含 #、逗号、下划线或斜杠")
	}
	return nil
}

func validateSimplePaymentValue(value string, maxLength int, label string) error {
	if value == "" || utf8.RuneCountInString(value) > maxLength {
		return fmt.Errorf("%s不能为空且不能超过 %d 个字符", label, maxLength)
	}
	for _, char := range value {
		if unicode.IsControl(char) || char == '#' {
			return fmt.Errorf("%s不能包含 # 或控制字符", label)
		}
	}
	return nil
}

func paymentHashWrites(input updatePaymentConfigurationRequest) (map[string]string, error) {
	writes := map[string]string{
		paymentDomainKey: input.PaymentDomain, paymentBranchKey: strconv.FormatBool(input.RequireBankBranch),
		paymentAlipayTextKey: input.AlipayWithdrawalText, paymentUnionPayTextKey: input.UnionWithdrawalText,
		paymentUSDTTextKey: input.USDTWithdrawalText,
	}
	enabled := strings.Builder{}
	for _, channel := range input.Channels {
		if channel.Enabled {
			enabled.WriteString(channel.Name)
			enabled.WriteByte('#')
		}
		inputRange := ""
		if channel.AllowCustom {
			inputRange = channel.CustomMin + "," + channel.CustomMax
		}
		client := paymentClientConfig{
			NeedInfo: channel.NeedsInfo, InfoList: joinHashList(channel.InfoFields), Money: channel.PresetAmounts,
			Notify: channel.DisplayText, Bank: channel.Banks, OpenInput: channel.AllowCustom, InputRange: inputRange,
		}
		body, err := json.Marshal(client)
		if err != nil {
			return nil, err
		}
		writes["支付配置_"+channel.Name] = encodeClientBase64(string(body))
	}
	writes[paymentListKey] = enabled.String()
	return writes, nil
}

func (s *Server) loadStoredHashRows(ctx context.Context, keys []string) ([]storedHashRow, error) {
	if len(keys) == 0 {
		return nil, nil
	}
	marks := make([]string, len(keys))
	args := make([]any, len(keys))
	for index, key := range keys {
		marks[index], args[index] = "?", key
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, hash_key, COALESCE(hash_content, '') FROM kbedm.usr_hash_info
WHERE hash_key IN (`+strings.Join(marks, ",")+`) ORDER BY id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []storedHashRow{}
	for rows.Next() {
		var row storedHashRow
		if err := rows.Scan(&row.ID, &row.Key, &row.Content); err != nil {
			return nil, err
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

func (s *Server) writeHashValues(ctx context.Context, values map[string]string, insertedIDs *[]int64) error {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		var exists int
		if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM kbedm.usr_hash_info WHERE hash_key = ?`, key).Scan(&exists); err != nil {
			return err
		}
		if exists > 0 {
			if _, err := s.db.ExecContext(ctx, `UPDATE kbedm.usr_hash_info SET hash_content = ? WHERE hash_key = ?`, values[key], key); err != nil {
				return err
			}
		} else {
			result, err := s.db.ExecContext(ctx, `INSERT INTO kbedm.usr_hash_info (hash_key, hash_content) VALUES (?, ?)`, key, values[key])
			if err != nil {
				return err
			}
			id, err := result.LastInsertId()
			if err != nil {
				return err
			}
			*insertedIDs = append(*insertedIDs, id)
		}
	}
	return nil
}

func (s *Server) restoreStoredHashRows(ctx context.Context, rows []storedHashRow, insertedIDs []int64, managedKeys []string) error {
	var restoreErrors []error
	for _, id := range insertedIDs {
		if _, err := s.db.ExecContext(ctx, `DELETE FROM kbedm.usr_hash_info WHERE id = ?`, id); err != nil {
			restoreErrors = append(restoreErrors, err)
		}
	}
	beforeKeys := map[string]bool{}
	for _, row := range rows {
		beforeKeys[row.Key] = true
		if _, err := s.db.ExecContext(ctx, `UPDATE kbedm.usr_hash_info SET hash_content = ? WHERE id = ? AND hash_key = ?`, row.Content, row.ID, row.Key); err != nil {
			restoreErrors = append(restoreErrors, err)
		}
	}
	for _, key := range managedKeys {
		if !beforeKeys[key] {
			if _, err := s.db.ExecContext(ctx, `DELETE FROM kbedm.usr_hash_info WHERE hash_key = ?`, key); err != nil {
				restoreErrors = append(restoreErrors, err)
			}
		}
	}
	return errors.Join(restoreErrors...)
}

func paymentStateRevision(state paymentConfigurationState) string {
	state.Revision, state.LastUpdatedBy, state.LastUpdatedAt = "", "", nil
	body, _ := json.Marshal(state)
	digest := sha256.Sum256(body)
	return hex.EncodeToString(digest[:])
}

func paymentStateMatchesRequest(state paymentConfigurationState, input updatePaymentConfigurationRequest) bool {
	expected := paymentConfigurationState{
		Channels: input.Channels, PaymentDomain: input.PaymentDomain, RequireBankBranch: input.RequireBankBranch,
		AlipayWithdrawalText: input.AlipayWithdrawalText, UnionWithdrawalText: input.UnionWithdrawalText, USDTWithdrawalText: input.USDTWithdrawalText,
	}
	for index := range expected.Channels {
		expected.Channels[index].Configured = true
		expected.Channels[index].EncodingError = false
	}
	return paymentStateRevision(state) == paymentStateRevision(expected)
}

func paymentAuditSummary(input updatePaymentConfigurationRequest) map[string]any {
	enabled := []string{}
	for _, channel := range input.Channels {
		if channel.Enabled {
			enabled = append(enabled, channel.Name)
		}
	}
	return map[string]any{"enabledChannels": enabled, "channelCount": len(input.Channels), "paymentDomain": input.PaymentDomain, "requireBankBranch": input.RequireBankBranch}
}

func splitHashList(value string) map[string]bool {
	result := map[string]bool{}
	for _, item := range splitHashListOrdered(value) {
		result[item] = true
	}
	return result
}

func splitHashListOrdered(value string) []string {
	result := []string{}
	for _, item := range strings.Split(value, "#") {
		item = strings.TrimSpace(item)
		if item != "" {
			result = append(result, item)
		}
	}
	return result
}

func joinHashList(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return strings.Join(values, "#") + "#"
}
