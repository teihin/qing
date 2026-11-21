package api

// 网页支付：客服在后台生成一条带签名的付款链接发给玩家，玩家在 H5 页里选金额，
// 后台代调第三方聚合代收网关（当前只有雷马 sdmpay），把玩家送到对方托管的收银台；
// 到账结果只认异步回调（+ 手动同步查单兜底），客户端不参与。
//
// 设计要点：
//   - 链接本身不落库，靠 HMAC 签名里带的支付商 / 客服 / 玩家信息和过期时间自证，
//     客服复制出去就能用，改一个字节就失效。
//   - 支付商密钥用 AES-GCM 加密存在 mgr_pay_provider.secure_key，接口只返回「是否已配置」。
//   - 金额一律用 DECIMAL 存、字符串传，避免浮点误差把验签搞挂。

import (
	"context"
	"crypto/hmac"
	"crypto/md5"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"xuanmanager/internal/security"
)

const (
	payProviderKindSdmpay = "sdmpay"

	payStatusPending = "pending"
	payStatusPaid    = "paid"
	payStatusFailed  = "failed"
	payStatusClosed  = "closed"

	paySettingBaseURL = "pay.base_url"

	payLinkDefaultHours = 1
	payLinkMaxHours     = 168

	payOrderPerIP10Min = 20
	payCheckoutPath    = "/orders/v3/scan"
	payQueryPath       = "/orders/query"
)

var payLocation = time.FixedZone("Asia/Shanghai", 8*60*60)

// 这些通道在雷马文档里明确要求带 payerName：网关实名制 / 小额 / 包司抗投，
// 以及各种转账、固码通道（平台要靠付款人姓名核对是谁付的）。
// 后台开关固定打开且不允许关掉，否则建单会被服务商直接拒。
var payPayerRequiredChannels = map[string]bool{
	"ALIPAYH5":       true,
	"ALIPAYTOALIPAY": true,
	"ALIPAYTOBANK":   true,
	"MICROBANK":      true,
	"REALNAMEBANK":   true,
	"GRCBANK":        true,
	"BANKTOBANK":     true,
}

func payChannelNeedsPayer(code string) bool {
	return payPayerRequiredChannels[strings.ToUpper(strings.TrimSpace(code))]
}

// 币种也按通道固定，不让运营选：文档里只有 USDT / 菲律宾 GCash 系需要显式带，
// USDT 收人民币必须传 USE(ERC20) 或 USX(TRC20)，不传会按 CNY 建单导致币种不符。
// currencyCode 不参与签名，改它不影响验签。
func payChannelCurrency(code string) string {
	switch strings.ToUpper(strings.TrimSpace(code)) {
	case "USDT", "USDTCNY":
		return "USE"
	case "GCASHSCAN", "GCASHTRANSFER":
		return "PHP"
	}
	return "CNY"
}

var payStatusLabels = map[string]string{
	payStatusPending: "待支付",
	payStatusPaid:    "已支付",
	payStatusFailed:  "支付失败",
	payStatusClosed:  "已关闭",
}

// ---------------------------------------------------------------- 数据结构

type payChannel struct {
	Code          string   `json:"code"`
	Name          string   `json:"name"`
	Enabled       bool     `json:"enabled"`
	PresetAmounts []string `json:"presetAmounts"`
	RequirePayer  bool     `json:"requirePayer"`
	// AllowCustom 控制付款页是否给「输入其他金额」入口，默认关闭。
	AllowCustom bool `json:"allowCustom"`
	// PayerLocked 表示这个通道在服务商侧必须带付款人姓名，后台不能关。
	PayerLocked bool   `json:"payerLocked"`
	MinAmount   string `json:"minAmount"`
	MaxAmount   string `json:"maxAmount"`
	SortOrder   int    `json:"sortOrder"`
}

type payProvider struct {
	ID            int64        `json:"id"`
	Code          string       `json:"code"`
	Name          string       `json:"name"`
	Kind          string       `json:"kind"`
	GatewayBase   string       `json:"gatewayBase"`
	RequestPrefix string       `json:"requestPrefix"`
	MerchantCode  string       `json:"merchantCode"`
	CallbackIP    string       `json:"callbackIp"`
	Remark        string       `json:"remark"`
	MinAmount     string       `json:"minAmount"`
	MaxAmount     string       `json:"maxAmount"`
	Enabled       bool         `json:"enabled"`
	SortOrder     int          `json:"sortOrder"`
	HasSecureKey  bool         `json:"hasSecureKey"`
	SecureKey     string       `json:"secureKey,omitempty"`
	Channels      []payChannel `json:"channels"`
}

type payProviderInput struct {
	Code          string `json:"code"`
	Name          string `json:"name"`
	Kind          string `json:"kind"`
	GatewayBase   string `json:"gatewayBase"`
	RequestPrefix string `json:"requestPrefix"`
	MerchantCode  string `json:"merchantCode"`
	SecureKey     string `json:"secureKey"`
	CallbackIP    string `json:"callbackIp"`
	Remark        string `json:"remark"`
	MinAmount     string `json:"minAmount"`
	MaxAmount     string `json:"maxAmount"`
	Enabled       bool   `json:"enabled"`
	SortOrder     int    `json:"sortOrder"`
}

type payChannelsInput struct {
	Channels []payChannel `json:"channels"`
}

type payOrderItem struct {
	ID           int64  `json:"id"`
	OrderNo      string `json:"orderNo"`
	ProviderID   int64  `json:"providerId"`
	ProviderName string `json:"providerName"`
	ChannelCode  string `json:"channelCode"`
	ChannelName  string `json:"channelName"`
	Amount       string `json:"amount"`
	Status       string `json:"status"`
	StatusLabel  string `json:"statusLabel"`
	GamerOrderID string `json:"gamerOrderId"`
	PayURL       string `json:"payUrl"`
	PlayerID     string `json:"playerId"`
	PlayerName   string `json:"playerName"`
	OperatorName string `json:"operatorName"`
	PayerIP      string `json:"payerIp"`
	Remark       string `json:"remark"`
	PaidAt       string `json:"paidAt"`
	CreatedAt    string `json:"createdAt"`
}

type payOrderResponse struct {
	Items    []payOrderItem `json:"items"`
	Total    int64          `json:"total"`
	Page     int            `json:"page"`
	PageSize int            `json:"pageSize"`
	Summary  payStatBucket  `json:"summary"`
}

type payStatBucket struct {
	Orders     int64  `json:"orders"`
	PaidOrders int64  `json:"paidOrders"`
	PaidAmount string `json:"paidAmount"`
	SuccessPct string `json:"successPct"`
}

type payChannelStat struct {
	ChannelCode string `json:"channelCode"`
	ChannelName string `json:"channelName"`
	Orders      int64  `json:"orders"`
	PaidOrders  int64  `json:"paidOrders"`
	PaidAmount  string `json:"paidAmount"`
}

type payStatsResponse struct {
	Today     payStatBucket    `json:"today"`
	Yesterday payStatBucket    `json:"yesterday"`
	Week      payStatBucket    `json:"week"`
	Month     payStatBucket    `json:"month"`
	Total     payStatBucket    `json:"total"`
	Channels  []payChannelStat `json:"channels"`
	Pending   int64            `json:"pending"`
}

type payLinkRequest struct {
	ProviderID   int64  `json:"providerId"`
	PlayerID     string `json:"playerId"`
	PlayerName   string `json:"playerName"`
	Remark       string `json:"remark"`
	ExpiresHours int    `json:"expiresHours"`
}

type payLinkResponse struct {
	URL       string `json:"url"`
	ExpiresAt string `json:"expiresAt"`
}

type payLinkPayload struct {
	ProviderID int64  `json:"p"`
	OperatorID int64  `json:"o"`
	PlayerID   string `json:"u"`
	PlayerName string `json:"n"`
	Remark     string `json:"r"`
	ExpiresAt  int64  `json:"e"`
}

type payPublicLink struct {
	ProviderCode string       `json:"providerCode"`
	ProviderName string       `json:"providerName"`
	PlayerName   string       `json:"playerName"`
	Remark       string       `json:"remark"`
	ExpiresAt    string       `json:"expiresAt"`
	Channels     []payChannel `json:"channels"`
	Sandbox      bool         `json:"sandbox"`
}

type payPublicOrderRequest struct {
	Token     string `json:"token"`
	Channel   string `json:"channel"`
	Amount    string `json:"amount"`
	PayerName string `json:"payerName"`
}

type payPublicOrder struct {
	OrderNo     string `json:"orderNo"`
	Status      string `json:"status"`
	StatusLabel string `json:"statusLabel"`
	Amount      string `json:"amount"`
	ChannelName string `json:"channelName"`
	PayURL      string `json:"payUrl"`
	PaidAt      string `json:"paidAt"`
}

// ---------------------------------------------------------------- 链接签名

func (s *Server) payLinkKey() []byte {
	material := s.cfg.CredentialKey
	if material == "" {
		material = s.cfg.DBPassword
	}
	sum := sha256.Sum256([]byte("xuanmanager/pay-link/v1\x00" + material))
	return sum[:]
}

func (s *Server) payLinkToken(payload payLinkPayload) (string, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	encoded := base64.RawURLEncoding.EncodeToString(body)
	mac := hmac.New(sha256.New, s.payLinkKey())
	mac.Write([]byte(encoded))
	return encoded + "." + hex.EncodeToString(mac.Sum(nil))[:40], nil
}

func (s *Server) parsePayLinkToken(token string) (payLinkPayload, error) {
	parts := strings.Split(strings.TrimSpace(token), ".")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return payLinkPayload{}, errors.New("链接格式不正确")
	}
	mac := hmac.New(sha256.New, s.payLinkKey())
	mac.Write([]byte(parts[0]))
	expected := hex.EncodeToString(mac.Sum(nil))[:40]
	if !hmac.Equal([]byte(expected), []byte(parts[1])) {
		return payLinkPayload{}, errors.New("链接校验失败")
	}
	body, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return payLinkPayload{}, errors.New("链接内容无法解析")
	}
	var payload payLinkPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		return payLinkPayload{}, errors.New("链接内容无法解析")
	}
	if payload.ProviderID <= 0 {
		return payLinkPayload{}, errors.New("链接内容不完整")
	}
	if payload.ExpiresAt > 0 && time.Now().Unix() > payload.ExpiresAt {
		return payLinkPayload{}, errors.New("链接已过期，请联系客服重新获取")
	}
	return payload, nil
}

// ---------------------------------------------------------------- 支付商读取

// payPagePath 是玩家付款页的路径前缀，回调也挂在同一前缀下。
func (s *Server) payPagePath() string {
	if s.cfg.PayPath != "" {
		return s.cfg.PayPath
	}
	return "/pgw"
}

func (s *Server) payBaseURL(ctx context.Context, r *http.Request) string {
	if value := strings.TrimSpace(s.platformSetting(ctx, paySettingBaseURL)); value != "" {
		return strings.TrimRight(value, "/")
	}
	if value := strings.TrimSpace(s.cfg.PayBaseURL); value != "" {
		return strings.TrimRight(value, "/")
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if proto := strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")); proto != "" {
		scheme = strings.Split(proto, ",")[0]
	}
	return scheme + "://" + r.Host
}

func (s *Server) loadPayProviders(ctx context.Context) ([]payProvider, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, code, name, kind, gateway_base, request_prefix, merchant_code,
secure_key, callback_ip, remark, min_amount, max_amount, enabled, sort_order
FROM mgr_pay_provider ORDER BY sort_order, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []payProvider{}
	index := map[int64]int{}
	for rows.Next() {
		var item payProvider
		var minAmount, maxAmount float64
		var sealed string
		if err := rows.Scan(&item.ID, &item.Code, &item.Name, &item.Kind, &item.GatewayBase, &item.RequestPrefix,
			&item.MerchantCode, &sealed, &item.CallbackIP, &item.Remark, &minAmount, &maxAmount, &item.Enabled, &item.SortOrder); err != nil {
			return nil, err
		}
		item.MinAmount = formatAmount(minAmount)
		item.MaxAmount = formatAmount(maxAmount)
		item.HasSecureKey = strings.TrimSpace(sealed) != ""
		item.Channels = []payChannel{}
		index[item.ID] = len(items)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return items, nil
	}
	channelRows, err := s.db.QueryContext(ctx, `SELECT provider_id, code, name, enabled, preset_amounts, require_payer,
allow_custom, min_amount, max_amount, sort_order FROM mgr_pay_channel ORDER BY sort_order, id`)
	if err != nil {
		return nil, err
	}
	defer channelRows.Close()
	for channelRows.Next() {
		var providerID int64
		var item payChannel
		var preset string
		var minAmount, maxAmount float64
		if err := channelRows.Scan(&providerID, &item.Code, &item.Name, &item.Enabled, &preset, &item.RequirePayer,
			&item.AllowCustom, &minAmount, &maxAmount, &item.SortOrder); err != nil {
			return nil, err
		}
		item.PresetAmounts = splitPresetAmounts(preset)
		item.MinAmount = formatAmount(minAmount)
		item.MaxAmount = formatAmount(maxAmount)
		if payChannelNeedsPayer(item.Code) {
			item.RequirePayer = true
			item.PayerLocked = true
		}
		if position, ok := index[providerID]; ok {
			items[position].Channels = append(items[position].Channels, item)
		}
	}
	return items, channelRows.Err()
}

func (s *Server) loadPayProvider(ctx context.Context, id int64) (payProvider, error) {
	items, err := s.loadPayProviders(ctx)
	if err != nil {
		return payProvider{}, err
	}
	for _, item := range items {
		if item.ID == id {
			return item, nil
		}
	}
	return payProvider{}, sql.ErrNoRows
}

func (s *Server) payProviderSecret(ctx context.Context, providerID int64) (string, error) {
	var sealed string
	err := s.db.QueryRowContext(ctx, `SELECT secure_key FROM mgr_pay_provider WHERE id = ?`, providerID).Scan(&sealed)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(sealed) == "" {
		return "", errors.New("该支付商还没有配置加密金钥")
	}
	return security.OpenCredential(s.credentialKey(), sealed)
}

// ---------------------------------------------------------------- 后台：支付商

func (s *Server) handleListPayProviders(w http.ResponseWriter, r *http.Request, p principal) {
	items, err := s.loadPayProviders(r.Context())
	if err != nil {
		s.logger.Error("list pay providers", "error", err)
		writeError(w, http.StatusInternalServerError, "PAY_PROVIDER_QUERY_FAILED", "读取支付商失败")
		return
	}
	writeData(w, http.StatusOK, map[string]any{
		"items":          items,
		"baseUrl":        s.payBaseURL(r.Context(), r),
		"baseUrlFromEnv": strings.TrimSpace(s.platformSetting(r.Context(), paySettingBaseURL)) != "",
		"statusLabels":   payStatusLabels,
	})
}

func (s *Server) handleSavePayProvider(w http.ResponseWriter, r *http.Request, p principal) {
	var input payProviderInput
	if !decodeJSON(w, r, &input) {
		return
	}
	normalizePayProviderInput(&input)
	if message := validatePayProviderInput(input); message != "" {
		writeError(w, http.StatusBadRequest, "INVALID_PROVIDER", message)
		return
	}
	var id int64
	if raw := r.PathValue("id"); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || parsed <= 0 {
			writeError(w, http.StatusBadRequest, "INVALID_ID", "支付商 ID 不正确")
			return
		}
		id = parsed
	}

	sealed, err := s.sealOptionalSecret(input.SecureKey)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "SECRET_SEAL_FAILED", "加密金钥保存失败")
		return
	}

	var before any
	if id == 0 {
		result, err := s.db.ExecContext(r.Context(), `INSERT INTO mgr_pay_provider
(code, name, kind, gateway_base, request_prefix, merchant_code, secure_key, callback_ip, remark, min_amount, max_amount, enabled, sort_order)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, input.Code, input.Name, input.Kind, input.GatewayBase,
			input.RequestPrefix, input.MerchantCode, sealed, input.CallbackIP, input.Remark,
			input.MinAmount, input.MaxAmount, input.Enabled, input.SortOrder)
		if err != nil {
			if isDuplicateKey(err) {
				writeError(w, http.StatusConflict, "PAY_PROVIDER_CODE_TAKEN", "这个内部标识已被占用")
				return
			}
			s.logger.Error("create pay provider", "error", err)
			writeError(w, http.StatusInternalServerError, "PAY_PROVIDER_CREATE_FAILED", "新增支付商失败")
			return
		}
		id, _ = result.LastInsertId()
	} else {
		existing, err := s.loadPayProvider(r.Context(), id)
		if err != nil {
			writeError(w, http.StatusNotFound, "PAY_PROVIDER_NOT_FOUND", "支付商不存在")
			return
		}
		before = existing
		var err2 error
		if sealed == "" {
			_, err2 = s.db.ExecContext(r.Context(), `UPDATE mgr_pay_provider SET code = ?, name = ?, kind = ?,
gateway_base = ?, request_prefix = ?, merchant_code = ?, callback_ip = ?, remark = ?, min_amount = ?, max_amount = ?,
enabled = ?, sort_order = ? WHERE id = ?`, input.Code, input.Name, input.Kind, input.GatewayBase, input.RequestPrefix,
				input.MerchantCode, input.CallbackIP, input.Remark, input.MinAmount, input.MaxAmount, input.Enabled,
				input.SortOrder, id)
		} else {
			_, err2 = s.db.ExecContext(r.Context(), `UPDATE mgr_pay_provider SET code = ?, name = ?, kind = ?,
gateway_base = ?, request_prefix = ?, merchant_code = ?, secure_key = ?, callback_ip = ?, remark = ?, min_amount = ?,
max_amount = ?, enabled = ?, sort_order = ? WHERE id = ?`, input.Code, input.Name, input.Kind, input.GatewayBase,
				input.RequestPrefix, input.MerchantCode, sealed, input.CallbackIP, input.Remark, input.MinAmount,
				input.MaxAmount, input.Enabled, input.SortOrder, id)
		}
		if err2 != nil {
			if isDuplicateKey(err2) {
				writeError(w, http.StatusConflict, "PAY_PROVIDER_CODE_TAKEN", "这个内部标识已被占用")
				return
			}
			s.logger.Error("update pay provider", "error", err2)
			writeError(w, http.StatusInternalServerError, "PAY_PROVIDER_UPDATE_FAILED", "保存支付商失败")
			return
		}
	}
	item, err := s.loadPayProvider(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "PAY_PROVIDER_QUERY_FAILED", "读取支付商失败")
		return
	}
	s.audit(r.Context(), &p, "game.pay_web.config", "mgr_pay_provider", numericID(id), nil, before,
		redactProvider(input), 0, "保存支付商", clientIP(r))
	writeData(w, http.StatusOK, item)
}

// sealOptionalSecret 空串表示「不修改已保存的密钥」。
func (s *Server) sealOptionalSecret(value string) (string, error) {
	if strings.TrimSpace(value) == "" {
		return "", nil
	}
	return security.SealCredential(s.credentialKey(), strings.TrimSpace(value))
}

func redactProvider(input payProviderInput) map[string]any {
	return map[string]any{
		"code": input.Code, "name": input.Name, "kind": input.Kind, "gatewayBase": input.GatewayBase,
		"requestPrefix": input.RequestPrefix, "merchantCode": input.MerchantCode,
		"secureKeyChanged": strings.TrimSpace(input.SecureKey) != "",
		"enabled":          input.Enabled,
	}
}

func (s *Server) handleSavePayChannels(w http.ResponseWriter, r *http.Request, p principal) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	var input payChannelsInput
	if !decodeJSON(w, r, &input) {
		return
	}
	if _, err := s.loadPayProvider(r.Context(), id); err != nil {
		writeError(w, http.StatusNotFound, "PAY_PROVIDER_NOT_FOUND", "支付商不存在")
		return
	}
	seen := map[string]bool{}
	normalized := make([]payChannel, 0, len(input.Channels))
	for _, item := range input.Channels {
		channel := payChannel{
			Code:          strings.ToUpper(strings.TrimSpace(item.Code)),
			Name:          strings.TrimSpace(item.Name),
			Enabled:       item.Enabled,
			RequirePayer:  item.RequirePayer || payChannelNeedsPayer(item.Code),
			AllowCustom:   item.AllowCustom,
			PresetAmounts: normalizePresetAmounts(item.PresetAmounts),
			MinAmount:     formatAmount(parseAmountOr(item.MinAmount, 1)),
			MaxAmount:     formatAmount(parseAmountOr(item.MaxAmount, 50000)),
			SortOrder:     item.SortOrder,
		}
		if message := validatePayChannel(channel, seen); message != "" {
			writeError(w, http.StatusBadRequest, "INVALID_CHANNEL", message)
			return
		}
		seen[channel.Code] = true
		normalized = append(normalized, channel)
	}

	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "PAY_CHANNEL_SAVE_FAILED", "保存通道失败")
		return
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(r.Context(), `DELETE FROM mgr_pay_channel WHERE provider_id = ?`, id); err != nil {
		writeError(w, http.StatusInternalServerError, "PAY_CHANNEL_SAVE_FAILED", "保存通道失败")
		return
	}
	for _, item := range normalized {
		if _, err := tx.ExecContext(r.Context(), `INSERT INTO mgr_pay_channel
(provider_id, code, name, enabled, preset_amounts, require_payer, allow_custom, min_amount, max_amount, sort_order)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, item.Code, item.Name, item.Enabled,
			strings.Join(item.PresetAmounts, ","), item.RequirePayer, item.AllowCustom, item.MinAmount, item.MaxAmount, item.SortOrder); err != nil {
			s.logger.Error("save pay channel", "error", err)
			writeError(w, http.StatusInternalServerError, "PAY_CHANNEL_SAVE_FAILED", "保存通道失败")
			return
		}
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "PAY_CHANNEL_SAVE_FAILED", "保存通道失败")
		return
	}
	s.audit(r.Context(), &p, "game.pay_web.config", "mgr_pay_channel", numericID(id), nil, nil, normalized,
		0, "保存支付通道", clientIP(r))
	items, err := s.loadPayProviders(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "PAY_PROVIDER_QUERY_FAILED", "读取支付商失败")
		return
	}
	writeData(w, http.StatusOK, map[string]any{"items": items})
}

// ---------------------------------------------------------------- 后台：付款链接

func (s *Server) handleCreatePayLink(w http.ResponseWriter, r *http.Request, p principal) {
	var input payLinkRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	provider, err := s.loadPayProvider(r.Context(), input.ProviderID)
	if err != nil {
		writeError(w, http.StatusNotFound, "PAY_PROVIDER_NOT_FOUND", "支付商不存在")
		return
	}
	if !provider.Enabled {
		writeError(w, http.StatusBadRequest, "PAY_PROVIDER_DISABLED", "该支付商已停用")
		return
	}
	active := make([]payChannel, 0, len(provider.Channels))
	for _, item := range provider.Channels {
		if item.Enabled {
			active = append(active, item)
		}
	}
	if len(active) == 0 {
		writeError(w, http.StatusBadRequest, "PAY_CHANNEL_EMPTY", "该支付商没有启用任何付款通道")
		return
	}
	if !provider.HasSecureKey {
		writeError(w, http.StatusBadRequest, "PAY_PROVIDER_NO_SECRET", "该支付商还没有填写加密金钥，玩家无法付款")
		return
	}
	hours := input.ExpiresHours
	if hours <= 0 {
		hours = payLinkDefaultHours
	}
	if hours > payLinkMaxHours {
		hours = payLinkMaxHours
	}
	expires := time.Now().Add(time.Duration(hours) * time.Hour)
	payload := payLinkPayload{
		ProviderID: provider.ID,
		OperatorID: p.ID,
		PlayerID:   strings.TrimSpace(input.PlayerID),
		PlayerName: strings.TrimSpace(input.PlayerName),
		Remark:     strings.TrimSpace(input.Remark),
		ExpiresAt:  expires.Unix(),
	}
	token, err := s.payLinkToken(payload)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "PAY_LINK_FAILED", "生成付款链接失败")
		return
	}
	link := s.payBaseURL(r.Context(), r) + s.payPagePath() + "?t=" + url.QueryEscape(token)
	s.audit(r.Context(), &p, "game.pay_web.link", "pay_link", numericID(provider.ID), nil, nil,
		map[string]any{"playerId": payload.PlayerID, "playerName": payload.PlayerName, "provider": provider.Code},
		0, "生成付款链接", clientIP(r))
	writeData(w, http.StatusOK, payLinkResponse{URL: link, ExpiresAt: formatBeijing(expires)})
}

func (s *Server) handleGetPaySettings(w http.ResponseWriter, r *http.Request, p principal) {
	writeData(w, http.StatusOK, map[string]any{
		"baseUrl": s.payBaseURL(r.Context(), r),
	})
}

func (s *Server) handleUpdatePaySettings(w http.ResponseWriter, r *http.Request, p principal) {
	var input struct {
		BaseURL string `json:"baseUrl"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	value := strings.TrimRight(strings.TrimSpace(input.BaseURL), "/")
	if value != "" {
		parsed, err := url.Parse(value)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
			writeError(w, http.StatusBadRequest, "INVALID_BASE_URL", "付款链接域名必须是完整的 http:// 或 https:// 地址")
			return
		}
	}
	if _, err := s.db.ExecContext(r.Context(), `INSERT INTO mgr_platform_setting (setting_key, setting_value, updated_by)
VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
		paySettingBaseURL, value, p.Username); err != nil {
		writeError(w, http.StatusInternalServerError, "WRITE_FAILED", "保存失败")
		return
	}
	s.invalidatePlatformSettings()
	s.audit(r.Context(), &p, "game.pay_web.config", "platform_setting", paySettingBaseURL, nil, nil,
		map[string]any{"baseUrl": value}, 0, "更新付款链接域名", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"baseUrl": s.payBaseURL(r.Context(), r)})
}

// ---------------------------------------------------------------- 后台：订单与统计

type payOrderFilter struct {
	ProviderID int64
	Channel    string
	Status     string
	Keyword    string
	StartDate  string
	EndDate    string
}

func (f payOrderFilter) where() (string, []any) {
	clauses := []string{"1 = 1"}
	args := []any{}
	if f.ProviderID > 0 {
		clauses = append(clauses, "provider_id = ?")
		args = append(args, f.ProviderID)
	}
	if f.Channel != "" {
		clauses = append(clauses, "channel_code = ?")
		args = append(args, f.Channel)
	}
	if f.Status != "" {
		clauses = append(clauses, "status = ?")
		args = append(args, f.Status)
	}
	if f.Keyword != "" {
		clauses = append(clauses, "(order_no LIKE ? OR gamer_order_id LIKE ? OR player_id LIKE ? OR player_name LIKE ?)")
		like := "%" + f.Keyword + "%"
		args = append(args, like, like, like, like)
	}
	if f.StartDate != "" {
		clauses = append(clauses, "created_at >= ?")
		args = append(args, f.StartDate+" 00:00:00")
	}
	if f.EndDate != "" {
		clauses = append(clauses, "created_at <= ?")
		args = append(args, f.EndDate+" 23:59:59")
	}
	return strings.Join(clauses, " AND "), args
}

func parsePayOrderFilter(r *http.Request) payOrderFilter {
	providerID, _ := strconv.ParseInt(strings.TrimSpace(r.URL.Query().Get("providerId")), 10, 64)
	return payOrderFilter{
		ProviderID: providerID,
		Channel:    strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("channel"))),
		Status:     strings.TrimSpace(r.URL.Query().Get("status")),
		Keyword:    strings.TrimSpace(r.URL.Query().Get("keyword")),
		StartDate:  strings.TrimSpace(r.URL.Query().Get("startDate")),
		EndDate:    strings.TrimSpace(r.URL.Query().Get("endDate")),
	}
}

func (s *Server) handleListPayOrders(w http.ResponseWriter, r *http.Request, p principal) {
	page, size := pageParams(r)
	filter := parsePayOrderFilter(r)
	where, args := filter.where()

	var total int64
	if err := s.db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM mgr_pay_order WHERE "+where, args...).Scan(&total); err != nil {
		s.logger.Error("count pay orders", "error", err)
		writeError(w, http.StatusInternalServerError, "PAY_ORDER_QUERY_FAILED", "读取付款订单失败")
		return
	}
	bucket, err := s.queryPayBucket(r.Context(), where, args)
	if err != nil {
		s.logger.Error("sum pay orders", "error", err)
		writeError(w, http.StatusInternalServerError, "PAY_ORDER_QUERY_FAILED", "读取付款订单失败")
		return
	}
	query := `SELECT o.id, o.order_no, o.provider_id, COALESCE(p.name, o.provider_code), o.channel_code, o.channel_name,
o.amount, o.status, o.gamer_order_id, o.pay_url, o.player_id, o.player_name, o.operator_name, o.payer_ip, o.remark,
o.paid_at, o.created_at
FROM mgr_pay_order o LEFT JOIN mgr_pay_provider p ON p.id = o.provider_id
WHERE ` + where + ` ORDER BY o.id DESC LIMIT ? OFFSET ?`
	rows, err := s.db.QueryContext(r.Context(), query, append(append([]any{}, args...), size, (page-1)*size)...)
	if err != nil {
		s.logger.Error("list pay orders", "error", err)
		writeError(w, http.StatusInternalServerError, "PAY_ORDER_QUERY_FAILED", "读取付款订单失败")
		return
	}
	defer rows.Close()
	items := []payOrderItem{}
	for rows.Next() {
		var item payOrderItem
		var amount float64
		var paidAt, createdAt sql.NullTime
		if err := rows.Scan(&item.ID, &item.OrderNo, &item.ProviderID, &item.ProviderName, &item.ChannelCode,
			&item.ChannelName, &amount, &item.Status, &item.GamerOrderID, &item.PayURL, &item.PlayerID,
			&item.PlayerName, &item.OperatorName, &item.PayerIP, &item.Remark, &paidAt, &createdAt); err != nil {
			s.logger.Error("scan pay order", "error", err)
			continue
		}
		item.Amount = formatAmount(amount)
		item.StatusLabel = payStatusLabel(item.Status)
		if paidAt.Valid {
			item.PaidAt = formatBeijing(paidAt.Time)
		}
		if createdAt.Valid {
			item.CreatedAt = formatBeijing(createdAt.Time)
		}
		items = append(items, item)
	}
	writeData(w, http.StatusOK, payOrderResponse{Items: items, Total: total, Page: page, PageSize: size, Summary: bucket})
}

func (s *Server) handlePayStats(w http.ResponseWriter, r *http.Request, p principal) {
	filter := parsePayOrderFilter(r)
	where, args := filter.where()
	now := time.Now().In(payLocation)
	startOfToday := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, payLocation)

	stat := payStatsResponse{Channels: []payChannelStat{}}
	today, err := s.queryPayBucket(r.Context(), where+" AND created_at >= ?", append(args, startOfToday))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "PAY_STATS_FAILED", "读取订单统计失败")
		return
	}
	stat.Today = today
	yesterday, err := s.queryPayBucket(r.Context(), where+" AND created_at >= ? AND created_at < ?",
		append(args, startOfToday.AddDate(0, 0, -1), startOfToday))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "PAY_STATS_FAILED", "读取订单统计失败")
		return
	}
	stat.Yesterday = yesterday
	week, err := s.queryPayBucket(r.Context(), where+" AND created_at >= ?", append(args, startOfToday.AddDate(0, 0, -6)))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "PAY_STATS_FAILED", "读取订单统计失败")
		return
	}
	stat.Week = week
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, payLocation)
	month, err := s.queryPayBucket(r.Context(), where+" AND created_at >= ?", append(args, monthStart))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "PAY_STATS_FAILED", "读取订单统计失败")
		return
	}
	stat.Month = month
	all, err := s.queryPayBucket(r.Context(), where, args)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "PAY_STATS_FAILED", "读取订单统计失败")
		return
	}
	stat.Total = all

	if err := s.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM mgr_pay_order o WHERE `+where+
		` AND o.status = 'pending'`, args...).Scan(&stat.Pending); err != nil {
		s.logger.Warn("count pending pay orders", "error", err)
	}

	rows, err := s.db.QueryContext(r.Context(), `SELECT channel_code, MAX(channel_name),
COUNT(*), COALESCE(SUM(status = 'paid'), 0), COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0)
FROM mgr_pay_order WHERE `+where+` GROUP BY channel_code ORDER BY COUNT(*) DESC`, args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "PAY_STATS_FAILED", "读取订单统计失败")
		return
	}
	defer rows.Close()
	for rows.Next() {
		var item payChannelStat
		var amount float64
		if err := rows.Scan(&item.ChannelCode, &item.ChannelName, &item.Orders, &item.PaidOrders, &amount); err != nil {
			continue
		}
		item.PaidAmount = formatAmount(amount)
		stat.Channels = append(stat.Channels, item)
	}
	writeData(w, http.StatusOK, stat)
}

func (s *Server) queryPayBucket(ctx context.Context, where string, args []any) (payStatBucket, error) {
	var bucket payStatBucket
	var amount float64
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*), COALESCE(SUM(status = 'paid'), 0),
COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0) FROM mgr_pay_order WHERE `+where, args...).
		Scan(&bucket.Orders, &bucket.PaidOrders, &amount)
	if err != nil {
		return bucket, err
	}
	bucket.PaidAmount = formatAmount(amount)
	bucket.SuccessPct = "0.0"
	if bucket.Orders > 0 {
		bucket.SuccessPct = fmt.Sprintf("%.1f", float64(bucket.PaidOrders)*100/float64(bucket.Orders))
	}
	return bucket, nil
}

func (s *Server) handleSyncPayOrder(w http.ResponseWriter, r *http.Request, p principal) {
	orderNo := strings.TrimSpace(r.PathValue("orderNo"))
	if orderNo == "" {
		writeError(w, http.StatusBadRequest, "INVALID_ORDER", "订单号不正确")
		return
	}
	var providerID int64
	var status, gamerOrderID string
	err := s.db.QueryRowContext(r.Context(), `SELECT provider_id, status, gamer_order_id FROM mgr_pay_order WHERE order_no = ?`,
		orderNo).Scan(&providerID, &status, &gamerOrderID)
	if err != nil {
		writeError(w, http.StatusNotFound, "PAY_ORDER_NOT_FOUND", "订单不存在")
		return
	}
	provider, err := s.loadPayProvider(r.Context(), providerID)
	if err != nil {
		writeError(w, http.StatusNotFound, "PAY_PROVIDER_NOT_FOUND", "支付商不存在")
		return
	}
	secret, err := s.payProviderSecret(r.Context(), providerID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "PAY_PROVIDER_NO_SECRET", err.Error())
		return
	}
	result, err := s.sdmpayQueryOrder(r.Context(), provider, secret, orderNo)
	if err != nil {
		writeError(w, http.StatusBadGateway, "PAY_SYNC_FAILED", "向支付服务商查单失败："+err.Error())
		return
	}
	next := payStatusFromProvider(result.Status)
	if next != "" && next != status {
		_, _ = s.db.ExecContext(r.Context(), `UPDATE mgr_pay_order SET status = ?, last_sync_at = NOW(),
paid_at = IF(? = 'paid' AND paid_at IS NULL, NOW(), paid_at), notify_raw = ? WHERE order_no = ?`,
			next, next, "sync:"+result.Raw, orderNo)
	}
	_, _ = s.db.ExecContext(r.Context(), `UPDATE mgr_pay_order SET last_sync_at = NOW() WHERE order_no = ?`, orderNo)
	s.audit(r.Context(), &p, "game.pay_web.view", "mgr_pay_order", numericID(0), nil, nil,
		map[string]any{"orderNo": orderNo, "providerStatus": result.Status, "applied": next}, 0, "同步订单状态", clientIP(r))
	writeData(w, http.StatusOK, map[string]any{"orderNo": orderNo, "status": next, "providerStatus": result.Status})
}

// ---------------------------------------------------------------- 公开：付款页

func (s *Server) handlePayPublicLink(w http.ResponseWriter, r *http.Request) {
	payload, err := s.parsePayLinkToken(r.URL.Query().Get("t"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "PAY_LINK_INVALID", err.Error())
		return
	}
	provider, err := s.loadPayProvider(r.Context(), payload.ProviderID)
	if err != nil || !provider.Enabled {
		writeError(w, http.StatusBadRequest, "PAY_PROVIDER_NOT_FOUND", "付款通道暂不可用，请联系客服")
		return
	}
	channels := make([]payChannel, 0, len(provider.Channels))
	for _, item := range provider.Channels {
		if item.Enabled {
			channels = append(channels, item)
		}
	}
	if len(channels) == 0 {
		writeError(w, http.StatusBadRequest, "PAY_CHANNEL_EMPTY", "付款通道暂不可用，请联系客服")
		return
	}
	writeData(w, http.StatusOK, payPublicLink{
		ProviderCode: provider.Code,
		ProviderName: provider.Name,
		PlayerName:   payload.PlayerName,
		Remark:       payload.Remark,
		ExpiresAt:    formatBeijing(time.Unix(payload.ExpiresAt, 0)),
		Channels:     channels,
		Sandbox:      !provider.HasSecureKey,
	})
}

func (s *Server) handlePayPublicCreateOrder(w http.ResponseWriter, r *http.Request) {
	var input payPublicOrderRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	payload, err := s.parsePayLinkToken(input.Token)
	if err != nil {
		writeError(w, http.StatusBadRequest, "PAY_LINK_INVALID", err.Error())
		return
	}
	provider, err := s.loadPayProvider(r.Context(), payload.ProviderID)
	if err != nil || !provider.Enabled {
		writeError(w, http.StatusBadRequest, "PAY_PROVIDER_NOT_FOUND", "付款通道暂不可用，请联系客服")
		return
	}
	channelCode := strings.ToUpper(strings.TrimSpace(input.Channel))
	var channel *payChannel
	for i := range provider.Channels {
		if provider.Channels[i].Code == channelCode && provider.Channels[i].Enabled {
			channel = &provider.Channels[i]
			break
		}
	}
	if channel == nil {
		writeError(w, http.StatusBadRequest, "PAY_CHANNEL_INVALID", "请选择可用的付款方式")
		return
	}
	amount, ok := normalizeAmount(input.Amount)
	if !ok {
		writeError(w, http.StatusBadRequest, "PAY_AMOUNT_INVALID", "金额格式不正确")
		return
	}
	amountValue := parseAmountOr(amount, 0)
	if amountValue < parseAmountOr(channel.MinAmount, 0) || amountValue > parseAmountOr(channel.MaxAmount, 0) {
		writeError(w, http.StatusBadRequest, "PAY_AMOUNT_RANGE", "金额超出该通道允许范围（"+channel.MinAmount+" ~ "+channel.MaxAmount+"）")
		return
	}
	payerName := strings.TrimSpace(input.PayerName)
	if (channel.RequirePayer || payChannelNeedsPayer(channel.Code)) && payerName == "" {
		writeError(w, http.StatusBadRequest, "PAY_PAYER_REQUIRED", "该付款方式需要填写付款人姓名")
		return
	}
	secret, err := s.payProviderSecret(r.Context(), provider.ID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "PAY_PROVIDER_NO_SECRET", "支付通道尚未配置完成，请联系客服")
		return
	}

	ip := clientIP(r)
	var recent int
	_ = s.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM mgr_pay_order WHERE payer_ip = ? AND created_at > ?`,
		ip, time.Now().Add(-10*time.Minute)).Scan(&recent)
	if recent >= payOrderPerIP10Min {
		writeError(w, http.StatusTooManyRequests, "PAY_TOO_MANY", "下单太频繁，请稍后再试或联系客服")
		return
	}

	orderNo := newPayOrderNo()
	notifyURL := s.payBaseURL(r.Context(), r) + s.payPagePath() + "/notify/" + provider.Code
	currency := payChannelCurrency(channel.Code)
	checkout, err := s.sdmpayCreateOrder(r.Context(), provider, secret, sdmpayOrderRequest{
		MerchantOrderID: orderNo,
		Currency:        currency,
		ChannelCode:     channel.Code,
		Amount:          amount,
		SuccessURL:      notifyURL,
		MemberID:        firstNonEmpty(payload.PlayerID, "guest"),
		MemberIP:        ip,
		PayerName:       payerName,
		Extra:           orderNo,
	})
	if err != nil {
		s.logger.Warn("create pay order at provider", "error", err, "orderNo", orderNo, "provider", provider.Code)
		writeError(w, http.StatusBadGateway, "PAY_CREATE_FAILED", "创建支付订单失败："+err.Error())
		return
	}
	status := payStatusPending
	if !checkout.Ready {
		status = payStatusFailed
	}
	if _, err := s.db.ExecContext(r.Context(), `INSERT INTO mgr_pay_order
(order_no, provider_id, provider_code, channel_code, channel_name, amount, currency, status, gamer_order_id, pay_url,
notify_url, player_id, player_name, operator_id, payer_ip, remark)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		orderNo, provider.ID, provider.Code, channel.Code, channel.Name, amount, currency, status, checkout.GamerOrderID,
		firstNonEmpty(checkout.HTTPSURL, checkout.HTTPURL), notifyURL, payload.PlayerID, payload.PlayerName,
		nullableID(payload.OperatorID), ip, payload.Remark); err != nil {
		s.logger.Error("insert pay order", "error", err)
		writeError(w, http.StatusInternalServerError, "PAY_ORDER_SAVE_FAILED", "订单保存失败，请联系客服")
		return
	}
	s.audit(r.Context(), nil, "game.pay_web.order", "mgr_pay_order", orderNo, nil, nil,
		map[string]any{"provider": provider.Code, "channel": channel.Code, "amount": amount, "playerId": payload.PlayerID},
		0, "玩家创建付款订单", ip)
	writeData(w, http.StatusOK, payPublicOrder{
		OrderNo:     orderNo,
		Status:      status,
		StatusLabel: payStatusLabel(status),
		Amount:      amount,
		ChannelName: channel.Name,
		PayURL:      firstNonEmpty(checkout.HTTPSURL, checkout.HTTPURL),
	})
}

func (s *Server) handlePayPublicOrderStatus(w http.ResponseWriter, r *http.Request) {
	orderNo := strings.TrimSpace(r.PathValue("orderNo"))
	payload, err := s.parsePayLinkToken(r.URL.Query().Get("t"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "PAY_LINK_INVALID", err.Error())
		return
	}
	var item payPublicOrder
	var amount float64
	var paidAt sql.NullTime
	err = s.db.QueryRowContext(r.Context(), `SELECT order_no, status, amount, channel_name, pay_url, paid_at
FROM mgr_pay_order WHERE order_no = ? AND provider_id = ?`, orderNo, payload.ProviderID).
		Scan(&item.OrderNo, &item.Status, &amount, &item.ChannelName, &item.PayURL, &paidAt)
	if err != nil {
		writeError(w, http.StatusNotFound, "PAY_ORDER_NOT_FOUND", "订单不存在")
		return
	}
	item.Amount = formatAmount(amount)
	item.StatusLabel = payStatusLabel(item.Status)
	if paidAt.Valid {
		item.PaidAt = formatBeijing(paidAt.Time)
	}
	writeData(w, http.StatusOK, item)
}

// ---------------------------------------------------------------- 回调

func (s *Server) handlePayNotify(w http.ResponseWriter, r *http.Request) {
	code := strings.TrimSpace(r.PathValue("code"))
	body, err := io.ReadAll(io.LimitReader(r.Body, 64<<10))
	if err != nil {
		http.Error(w, "FAIL", http.StatusBadRequest)
		return
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		http.Error(w, "FAIL", http.StatusBadRequest)
		return
	}
	var providerID int64
	var providerCode, sealed, merchantCode string
	var kind string
	err = s.db.QueryRowContext(r.Context(), `SELECT id, code, kind, merchant_code, secure_key FROM mgr_pay_provider WHERE code = ?`, code).
		Scan(&providerID, &providerCode, &kind, &merchantCode, &sealed)
	if err != nil {
		// 查不到和查出错要分开记：之前一律打 unknown provider，数据库抖一下会被误读成
		// 「回调的支付商不存在」，排查方向全歪。
		if errors.Is(err, sql.ErrNoRows) {
			s.logger.Warn("pay notify for unknown provider", "code", code)
			http.Error(w, "FAIL", http.StatusNotFound)
			return
		}
		s.logger.Error("pay notify provider query failed", "error", err, "code", code)
		http.Error(w, "FAIL", http.StatusInternalServerError)
		return
	}
	if kind != payProviderKindSdmpay {
		http.Error(w, "FAIL", http.StatusBadRequest)
		return
	}
	secret, err := security.OpenCredential(s.credentialKey(), sealed)
	if err != nil || strings.TrimSpace(secret) == "" {
		s.logger.Error("pay notify without usable secret", "code", code)
		http.Error(w, "FAIL", http.StatusBadRequest)
		return
	}
	gotSign := strings.ToLower(strings.TrimSpace(anyToString(payload["sign"])))
	if gotSign == "" || !security.EqualToken(gotSign, sdmpaySign(payload, secret, "sign")) {
		s.logger.Warn("pay notify sign mismatch", "code", code, "orderNo", anyToString(payload["merchantOrderId"]))
		http.Error(w, "FAIL", http.StatusBadRequest)
		return
	}
	orderNo := strings.TrimSpace(anyToString(payload["merchantOrderId"]))
	status := payStatusFromProvider(anyToString(payload["status"]))
	if orderNo == "" || status == "" {
		http.Error(w, "FAIL", http.StatusBadRequest)
		return
	}
	raw, _ := json.Marshal(payload)
	result, err := s.db.ExecContext(r.Context(), `UPDATE mgr_pay_order SET status = ?,
paid_at = IF(? = 'paid' AND paid_at IS NULL, NOW(), paid_at), gamer_order_id = IF(? <> '', ?, gamer_order_id),
notify_raw = ?, last_sync_at = NOW() WHERE order_no = ? AND provider_id = ? AND status <> 'paid'`,
		status, status, anyToString(payload["gamerOrderId"]), anyToString(payload["gamerOrderId"]), string(raw), orderNo, providerID)
	if err != nil {
		s.logger.Error("apply pay notify", "error", err, "orderNo", orderNo)
		http.Error(w, "FAIL", http.StatusInternalServerError)
		return
	}
	if affected, _ := result.RowsAffected(); affected > 0 {
		s.audit(r.Context(), nil, "game.pay_web.notify", "mgr_pay_order", orderNo, nil, nil,
			map[string]any{"status": status, "amount": anyToString(payload["amount"])}, 0, "收到支付回调", clientIP(r))
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write([]byte("SUCCESS"))
}

// ---------------------------------------------------------------- 雷马网关

type sdmpayOrderRequest struct {
	MerchantOrderID string
	Currency        string
	ChannelCode     string
	Amount          string
	SuccessURL      string
	MemberID        string
	MemberIP        string
	PayerName       string
	Extra           string
}

type sdmpayCheckout struct {
	Ready        bool
	GamerOrderID string
	HTTPURL      string
	HTTPSURL     string
}

type sdmpayQueryResult struct {
	Status string
	Amount string
	Raw    string
}

func (p payProvider) checkoutURL() string {
	return strings.TrimRight(p.GatewayBase, "/") + "/" + strings.Trim(p.RequestPrefix, "/") + payCheckoutPath
}

func (p payProvider) queryURL() string {
	return strings.TrimRight(p.GatewayBase, "/") + "/" + strings.Trim(p.RequestPrefix, "/") + payQueryPath
}

func (s *Server) sdmpayCreateOrder(ctx context.Context, provider payProvider, secret string, input sdmpayOrderRequest) (sdmpayCheckout, error) {
	signed := map[string]string{
		"merchantCode":     provider.MerchantCode,
		"merchantOrderId":  input.MerchantOrderID,
		"paymentTypeCode":  input.ChannelCode,
		"amount":           input.Amount,
		"successUrl":       input.SuccessURL,
		"merchantMemberId": input.MemberID,
		"merchantMemberIp": input.MemberIP,
	}
	body := map[string]any{
		"merchantCode":     provider.MerchantCode,
		"merchantOrderId":  input.MerchantOrderID,
		"currencyCode":     firstNonEmpty(input.Currency, "CNY"),
		"paymentTypeCode":  input.ChannelCode,
		"amount":           input.Amount,
		"successUrl":       input.SuccessURL,
		"merchantMemberId": input.MemberID,
		"merchantMemberIp": input.MemberIP,
		"mp":               input.Extra,
		"sign":             sdmpaySignString(signed, secret),
	}
	if input.PayerName != "" {
		body["payerName"] = input.PayerName
	}
	var envelope struct {
		Result   bool `json:"result"`
		ErrorMsg any  `json:"errorMsg"`
		Data     *struct {
			GamerOrderID string `json:"gamerOrderId"`
			HTTPURL      string `json:"httpUrl"`
			HTTPSURL     string `json:"httpsUrl"`
		} `json:"data"`
	}
	if err := s.postJSON(ctx, provider.checkoutURL(), body, &envelope); err != nil {
		return sdmpayCheckout{}, err
	}
	if !envelope.Result || envelope.Data == nil {
		return sdmpayCheckout{}, errors.New(describeProviderError(envelope.ErrorMsg))
	}
	return sdmpayCheckout{
		Ready:        true,
		GamerOrderID: envelope.Data.GamerOrderID,
		HTTPURL:      envelope.Data.HTTPURL,
		HTTPSURL:     envelope.Data.HTTPSURL,
	}, nil
}

func (s *Server) sdmpayQueryOrder(ctx context.Context, provider payProvider, secret, orderNo string) (sdmpayQueryResult, error) {
	signed := map[string]string{
		"merchantCode":    provider.MerchantCode,
		"merchantOrderId": orderNo,
	}
	body := map[string]any{
		"merchantCode":    provider.MerchantCode,
		"merchantOrderId": orderNo,
		"sign":            sdmpaySignString(signed, secret),
	}
	var envelope struct {
		Result   bool `json:"result"`
		ErrorMsg any  `json:"errorMsg"`
		Data     *struct {
			Status string     `json:"status"`
			Amount flexString `json:"amount"`
		} `json:"data"`
	}
	if err := s.postJSON(ctx, provider.queryURL(), body, &envelope); err != nil {
		return sdmpayQueryResult{}, err
	}
	if !envelope.Result || envelope.Data == nil {
		return sdmpayQueryResult{}, errors.New(describeProviderError(envelope.ErrorMsg))
	}
	return sdmpayQueryResult{Status: envelope.Data.Status, Amount: string(envelope.Data.Amount)}, nil
}

func (s *Server) postJSON(ctx context.Context, endpoint string, body any, dst any) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(string(raw)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json;charset=UTF-8")
	resp, err := (&http.Client{Timeout: 20 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(resp.Body, 512<<10))
	if err != nil {
		return err
	}
	if resp.StatusCode >= 400 {
		return fmt.Errorf("网关返回 HTTP %d", resp.StatusCode)
	}
	return json.Unmarshal(payload, dst)
}

// sdmpaySignString 按文档：参与签名的参数按名称 a-z 排序，用 "|" 串 k=v，
// 末尾直接拼加密金钥，再取 MD5 小写 32 位。
func sdmpaySignString(params map[string]string, secret string) string {
	keys := make([]string, 0, len(params))
	for key := range params {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var builder strings.Builder
	for i, key := range keys {
		if i > 0 {
			builder.WriteString("|")
		}
		builder.WriteString(key)
		builder.WriteString("=")
		builder.WriteString(params[key])
	}
	builder.WriteString(secret)
	sum := md5.Sum([]byte(builder.String()))
	return hex.EncodeToString(sum[:])
}

// sdmpaySign 用于校验回调：排除 skip 字段，其余按名排序，字段值为 null 也要按字面 "null" 参与。
func sdmpaySign(payload map[string]any, secret, skip string) string {
	params := make(map[string]string, len(payload))
	for key, value := range payload {
		if key == skip {
			continue
		}
		params[key] = anyToString(value)
	}
	return sdmpaySignString(params, secret)
}

func describeProviderError(value any) string {
	switch typed := value.(type) {
	case nil:
		return "支付服务商未返回原因"
	case map[string]any:
		descript := anyToString(typed["descript"])
		code := anyToString(typed["errorMsg"])
		if descript != "" {
			return strings.TrimSpace(descript)
		}
		if code != "" {
			return code
		}
		return "支付服务商拒绝了本次下单"
	case string:
		if typed != "" {
			return typed
		}
	}
	return "支付服务商拒绝了本次下单"
}

// flexString 兼容网关把 amount 返回成数字或字符串两种写法。
type flexString string

func (f *flexString) UnmarshalJSON(data []byte) error {
	var text string
	if err := json.Unmarshal(data, &text); err == nil {
		*f = flexString(text)
		return nil
	}
	var number json.Number
	if err := json.Unmarshal(data, &number); err == nil {
		*f = flexString(number.String())
		return nil
	}
	*f = ""
	return nil
}

// ---------------------------------------------------------------- 工具

func payStatusFromProvider(status string) string {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "success":
		return payStatusPaid
	case "failed":
		return payStatusFailed
	case "unpaid", "closed":
		return payStatusClosed
	case "pending", "readytopay":
		return payStatusPending
	}
	return ""
}

func payStatusLabel(status string) string {
	if label, ok := payStatusLabels[status]; ok {
		return label
	}
	return status
}

func newPayOrderNo() string {
	return "P" + time.Now().In(payLocation).Format("20060102150405") + strconv.FormatInt(time.Now().UnixNano()%1000000, 10)
}

func formatAmount(value float64) string {
	return strconv.FormatFloat(value, 'f', 2, 64)
}

func parseAmountOr(value string, fallback float64) float64 {
	parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil || parsed < 0 {
		return fallback
	}
	return parsed
}

// normalizeAmount 统一成两位小数的字符串：签名要求请求体里的字面值和算签名时完全一致，
// 传 "100" / "100.0" / 100.00 在不同网关下验签结果不一样，这里只允许一种写法。
func normalizeAmount(value string) (string, bool) {
	amount := parseAmountOr(strings.TrimSpace(value), -1)
	if amount <= 0 || amount > 1_000_000 {
		return "", false
	}
	return strconv.FormatFloat(amount, 'f', 2, 64), true
}

func splitPresetAmounts(value string) []string {
	items := []string{}
	for _, part := range strings.Split(value, ",") {
		clean := strings.TrimSpace(part)
		if clean == "" {
			continue
		}
		if amount, ok := normalizeAmount(clean); ok {
			items = append(items, amount)
		}
	}
	return items
}

func normalizePresetAmounts(values []string) []string {
	seen := map[string]bool{}
	items := []string{}
	for _, value := range values {
		for _, part := range strings.Split(value, ",") {
			amount, ok := normalizeAmount(strings.TrimSpace(part))
			if !ok || seen[amount] {
				continue
			}
			seen[amount] = true
			items = append(items, amount)
		}
	}
	if len(items) > 12 {
		items = items[:12]
	}
	return items
}

func validatePayChannel(channel payChannel, seen map[string]bool) string {
	if channel.Code == "" || len(channel.Code) > 32 {
		return "通道代码不能为空且不超过 32 个字符"
	}
	for _, r := range channel.Code {
		if !(r >= 'A' && r <= 'Z') && !(r >= '0' && r <= '9') && r != '_' {
			return "通道代码只能用大写字母、数字和下划线：" + channel.Code
		}
	}
	if seen[channel.Code] {
		return "通道代码重复：" + channel.Code
	}
	if channel.Name == "" || len([]rune(channel.Name)) > 20 {
		return "通道名称不能为空且不超过 20 个字"
	}
	if len(channel.PresetAmounts) == 0 {
		return "通道「" + channel.Name + "」至少要有一个金额档位"
	}
	if parseAmountOr(channel.MinAmount, 0) > parseAmountOr(channel.MaxAmount, 0) {
		return "通道「" + channel.Name + "」的最小金额不能大于最大金额"
	}
	return ""
}

func normalizePayProviderInput(input *payProviderInput) {
	input.Code = strings.ToLower(strings.TrimSpace(input.Code))
	input.Name = strings.TrimSpace(input.Name)
	input.Kind = strings.ToLower(strings.TrimSpace(input.Kind))
	if input.Kind == "" {
		input.Kind = payProviderKindSdmpay
	}
	input.GatewayBase = strings.TrimRight(strings.TrimSpace(input.GatewayBase), "/")
	input.RequestPrefix = strings.Trim(strings.TrimSpace(input.RequestPrefix), "/")
	input.MerchantCode = strings.TrimSpace(input.MerchantCode)
	input.SecureKey = strings.TrimSpace(input.SecureKey)
	input.CallbackIP = strings.TrimSpace(input.CallbackIP)
	input.Remark = strings.TrimSpace(input.Remark)
	input.MinAmount = formatAmount(parseAmountOr(input.MinAmount, 1))
	input.MaxAmount = formatAmount(parseAmountOr(input.MaxAmount, 50000))
}

func validatePayProviderInput(input payProviderInput) string {
	if input.Kind != payProviderKindSdmpay {
		return "目前只支持 sdmpay 类型的支付商"
	}
	if len(input.Code) < 2 || len(input.Code) > 32 {
		return "内部标识需要 2~32 个字符"
	}
	for _, r := range input.Code {
		if !(r >= 'a' && r <= 'z') && !(r >= '0' && r <= '9') && r != '_' {
			return "内部标识只能用小写字母、数字和下划线"
		}
	}
	if input.Name == "" || len([]rune(input.Name)) > 20 {
		return "支付商名称不能为空且不超过 20 个字"
	}
	parsed, err := url.Parse(input.GatewayBase)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return "网关地址必须是完整的 http:// 或 https:// 地址"
	}
	if input.MerchantCode == "" || len(input.MerchantCode) > 100 {
		return "商户号不能为空且不超过 100 个字符"
	}
	if parseAmountOr(input.MinAmount, 0) > parseAmountOr(input.MaxAmount, 0) {
		return "单笔最小金额不能大于最大金额"
	}
	return ""
}

func anyToString(value any) string {
	switch typed := value.(type) {
	case nil:
		return "null"
	case string:
		return typed
	case bool:
		if typed {
			return "true"
		}
		return "false"
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case json.Number:
		return typed.String()
	default:
		return fmt.Sprintf("%v", typed)
	}
}

func formatBeijing(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.In(payLocation).Format("2006-01-02 15:04:05")
}
