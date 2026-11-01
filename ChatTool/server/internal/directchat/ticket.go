package directchat

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

// TicketVerifier 把游戏侧签发的短期聊天票据换成 guuid。
//
// 客户端不能自报 meGuuid：票据由持有服务端密钥的游戏服务/发放工具签名，
// 客户端只有票据串，无法伪造其他账号的身份。
type TicketVerifier interface {
	Verify(ctx context.Context, ticket string) (GameUser, error)
}

// TicketIssuer 与校验器共用同一份密钥，供联调工具和单元测试签发票据。
// 生产环境只在校验侧部署密钥，签发在游戏服或运维工具里完成。
type TicketIssuer struct {
	key []byte
	ttl time.Duration
}

// NewTicketIssuer 创建票据签发器。
func NewTicketIssuer(key []byte, ttl time.Duration) *TicketIssuer {
	return &TicketIssuer{key: key, ttl: ttl}
}

type ticketPayload struct {
	Guuid  string `json:"guuid"`
	Name   string `json:"name"`
	Avatar string `json:"avatar"`
	Issued int64  `json:"iat"`
	Expiry int64  `json:"exp"`
	Nonce  string `json:"nonce"`
}

const ticketPrefix = "dc1"

// Issue 为指定账号签发聊天票据。
func (issuer *TicketIssuer) Issue(guuid, name, avatar string) (string, error) {
	if strings.TrimSpace(guuid) == "" {
		return "", errors.New("guuid 不能为空")
	}
	nonce, err := NewID()
	if err != nil {
		return "", err
	}
	now := time.Now()
	payload := ticketPayload{
		Guuid:  guuid,
		Name:   name,
		Avatar: avatar,
		Issued: now.Unix(),
		Expiry: now.Add(issuer.ttl).Unix(),
		Nonce:  nonce,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	encoded := base64.RawURLEncoding.EncodeToString(body)
	sig := signTicket(issuer.key, encoded)
	return ticketPrefix + "." + encoded + "." + sig, nil
}

// HMACTicketVerifier 校验游戏票据的签名与有效期。
type HMACTicketVerifier struct {
	key      []byte
	maxAhead time.Duration
}

// NewTicketVerifier 创建校验器；maxTTL 限制票据被接受的最长有效期。
func NewTicketVerifier(key []byte, maxTTL time.Duration) *HMACTicketVerifier {
	if maxTTL <= 0 {
		maxTTL = 10 * time.Minute
	}
	return &HMACTicketVerifier{key: key, maxAhead: maxTTL}
}

// Enabled 表示是否配置了票据密钥。
func (v *HMACTicketVerifier) Enabled() bool { return len(v.key) >= 16 }

// Verify 校验票据并返回游戏身份。
func (v *HMACTicketVerifier) Verify(_ context.Context, ticket string) (GameUser, error) {
	if !v.Enabled() {
		return GameUser{}, errAuthRequired
	}
	parts := strings.Split(strings.TrimSpace(ticket), ".")
	if len(parts) != 3 || parts[0] != ticketPrefix {
		return GameUser{}, errAuthRequired
	}
	if !hmac.Equal([]byte(parts[2]), []byte(signTicket(v.key, parts[1]))) {
		return GameUser{}, errAuthRequired
	}
	body, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return GameUser{}, errAuthRequired
	}
	var payload ticketPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		return GameUser{}, errAuthRequired
	}
	now := time.Now()
	issued := time.Unix(payload.Issued, 0)
	expiry := time.Unix(payload.Expiry, 0)
	if strings.TrimSpace(payload.Guuid) == "" {
		return GameUser{}, errAuthRequired
	}
	if expiry.Before(now) {
		return GameUser{}, errAuthExpired
	}
	// 票据必须是短期的：过期窗口或者签发时间在未来过远都视为无效。
	if expiry.Sub(issued) > v.maxAhead || issued.After(now.Add(time.Minute)) {
		return GameUser{}, errAuthRequired
	}
	return GameUser{Guuid: strings.TrimSpace(payload.Guuid), Name: payload.Name, Avatar: payload.Avatar}, nil
}

func signTicket(key []byte, encoded string) string {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(ticketPrefix + "." + encoded))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
