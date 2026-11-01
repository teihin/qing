package directchat

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strconv"
	"strings"
	"time"
)

// NewID 生成 32 位十六进制 ID（16 字节随机），用于会话、消息和附件。
func NewID() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

// NewToken 生成 64 位十六进制的会话令牌（32 字节随机）。
func NewToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

// PairKey 对两个 guuid 做稳定排序后生成会话唯一键。
//
// 唯一性必须是 (club_id, pair_key)：只按 user_a/user_b 建唯一索引会把不同
// 俱乐部的会话合并成一条。
func PairKey(a, b string) (low, high, key string) {
	if a <= b {
		low, high = a, b
	} else {
		low, high = b, a
	}
	return low, high, low + ":" + high
}

// Cursor 是历史消息的游标，由服务端根据 (created_at, id) 生成并签名。
type Cursor struct {
	At time.Time
	ID string
}

const cursorVersion = "c1"

// EncodeCursor 生成不可篡改的游标串：base64url(payload|signature)。
func EncodeCursor(key []byte, at time.Time, id string) string {
	if id == "" {
		return ""
	}
	payload := cursorVersion + "|" + strconv.FormatInt(at.UTC().UnixMilli(), 10) + "|" + id
	sig := cursorSignature(key, payload)
	return base64.RawURLEncoding.EncodeToString([]byte(payload + "|" + sig))
}

// DecodeCursor 校验并解析游标。客户端自行拼接或修改的游标一律拒绝。
func DecodeCursor(key []byte, value string) (Cursor, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return Cursor{}, errors.New("empty cursor")
	}
	raw, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return Cursor{}, errors.New("malformed cursor")
	}
	parts := strings.Split(string(raw), "|")
	if len(parts) != 4 || parts[0] != cursorVersion {
		return Cursor{}, errors.New("malformed cursor")
	}
	payload := parts[0] + "|" + parts[1] + "|" + parts[2]
	if !hmac.Equal([]byte(parts[3]), []byte(cursorSignature(key, payload))) {
		return Cursor{}, errors.New("cursor signature mismatch")
	}
	ms, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || parts[2] == "" {
		return Cursor{}, errors.New("malformed cursor")
	}
	return Cursor{At: time.UnixMilli(ms).In(time.Local), ID: parts[2]}, nil
}

func cursorSignature(key []byte, payload string) string {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(payload))
	return hex.EncodeToString(mac.Sum(nil))[:32]
}
