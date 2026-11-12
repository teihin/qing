package security

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"math/big"
	"net/url"
	"strings"
	"time"
)

// TOTP 参数固定为 Google Authenticator 的默认值（RFC 6238，SHA-1 / 30 秒 / 6 位），
// 改动会导致已绑定的验证器全部失效。
const (
	TOTPPeriodSeconds  = 30
	TOTPDigits         = 6
	totpSecretBytes    = 20
	recoveryCodeLength = 10
	recoveryCodeCount  = 10
)

// 去掉 0/O/1/I 等易混淆字符，方便用户手抄和输入。
const recoveryAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

var totpBase32 = base32.StdEncoding.WithPadding(base32.NoPadding)

// NewTOTPSecret 生成 160 位随机密钥，输出 32 位 Base32 字符串。
func NewTOTPSecret() (string, error) {
	raw := make([]byte, totpSecretBytes)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return totpBase32.EncodeToString(raw), nil
}

// TOTPCode 计算某个时间点的动态码，只用于测试和排查；登录校验请用 ValidateTOTP。
func TOTPCode(secret string, at time.Time) (string, error) {
	unix := at.Unix()
	if unix < 0 {
		return "", fmt.Errorf("时间早于 Unix 纪元")
	}
	return totpCodeAt(secret, uint64(unix/TOTPPeriodSeconds))
}

// ValidateTOTP 校验动态码，允许前后各一个时间步长（±30 秒）。
// 返回命中的步长，调用方用它做防重放：同一个步长不能重复通过。
func ValidateTOTP(secret, code string, now time.Time) (int64, bool) {
	code = normalizeDigits(code)
	if len(code) != TOTPDigits {
		return 0, false
	}
	unix := now.Unix()
	if unix < 0 {
		return 0, false
	}
	current := int64(unix / TOTPPeriodSeconds)
	for offset := int64(-1); offset <= 1; offset++ {
		counter := current + offset
		if counter < 0 {
			continue
		}
		expected, err := totpCodeAt(secret, uint64(counter))
		if err != nil {
			return 0, false
		}
		if subtle.ConstantTimeCompare([]byte(expected), []byte(code)) == 1 {
			return counter, true
		}
	}
	return 0, false
}

// TOTPURI 生成验证器扫码用的 otpauth URI。
func TOTPURI(issuer, account, secret string) string {
	label := url.PathEscape(issuer + ":" + account)
	query := url.Values{}
	query.Set("secret", secret)
	query.Set("issuer", issuer)
	query.Set("algorithm", "SHA1")
	query.Set("digits", fmt.Sprintf("%d", TOTPDigits))
	query.Set("period", fmt.Sprintf("%d", TOTPPeriodSeconds))
	return "otpauth://totp/" + label + "?" + query.Encode()
}

// NewRecoveryCodes 生成一批一次性恢复码，默认 10 个。
func NewRecoveryCodes() ([]string, error) {
	limit := big.NewInt(int64(len(recoveryAlphabet)))
	seen := make(map[string]bool, recoveryCodeCount)
	codes := make([]string, 0, recoveryCodeCount)
	for len(codes) < recoveryCodeCount {
		var builder strings.Builder
		builder.Grow(recoveryCodeLength)
		for i := 0; i < recoveryCodeLength; i++ {
			value, err := rand.Int(rand.Reader, limit)
			if err != nil {
				return nil, err
			}
			builder.WriteByte(recoveryAlphabet[value.Int64()])
		}
		code := builder.String()
		if seen[code] {
			continue
		}
		seen[code] = true
		codes = append(codes, code)
	}
	return codes, nil
}

// NormalizeRecoveryCode 统一恢复码输入：忽略大小写、空格和短横线。
func NormalizeRecoveryCode(value string) string {
	value = strings.ToUpper(strings.TrimSpace(value))
	value = strings.ReplaceAll(value, " ", "")
	return strings.ReplaceAll(value, "-", "")
}

func totpCodeAt(secret string, counter uint64) (string, error) {
	key, err := totpBase32.DecodeString(strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(secret), " ", "")))
	if err != nil || len(key) == 0 {
		return "", fmt.Errorf("动态口令密钥格式不正确")
	}
	var payload [8]byte
	binary.BigEndian.PutUint64(payload[:], counter)
	mac := hmac.New(sha1.New, key)
	_, _ = mac.Write(payload[:])
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	value := (uint32(sum[offset])&0x7f)<<24 |
		uint32(sum[offset+1])<<16 |
		uint32(sum[offset+2])<<8 |
		uint32(sum[offset+3])
	return fmt.Sprintf("%0*d", TOTPDigits, value%1_000_000), nil
}

func normalizeDigits(value string) string {
	value = strings.TrimSpace(value)
	value = strings.ReplaceAll(value, " ", "")
	return strings.ReplaceAll(value, "-", "")
}
