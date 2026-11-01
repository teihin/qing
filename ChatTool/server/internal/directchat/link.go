package directchat

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"time"
)

/*
link.go 实现「与客服入口同一套轻量加密资料」的换票路径。

为什么需要它：设计文档 5.2 要求服务端不能信任客户端自报的 meGuuid，但游戏内一期
还没有正式票据（票据需要 KB 登录服签发，属于服务端改造）。项目现有的客服入口已经
使用 Tool.encrypt()（AES-ECB + 内置口令 + ts 时间戳）把玩家资料加密后交给 ChatTool，
由服务端解密并校验时效。直聊复用同一套密文格式，客户端仍然只提交密文，不提交
meGuuid 明文字段，因此不会退化成「客户端自报身份」。

正式票据（dc1.<payload>.<hmac>）准备好后直接走 POST /api/direct/session 的 ticket
分支即可，客户端与这里都不用再改。
*/

// LinkVerifier 把轻量加密资料还原成游戏身份。
type LinkVerifier interface {
	Verify(ctx context.Context, payload string) (GameUser, error)
}

// AESLinkVerifier 解密与客服链接一致的密文，并校验 ts 时效。
type AESLinkVerifier struct {
	key []byte
	ttl time.Duration
	now func() time.Time
}

// NewAESLinkVerifier 创建链接校验器。key 为空时一律拒绝（不允许退化为信任客户端）。
func NewAESLinkVerifier(passphrase string, ttl time.Duration) *AESLinkVerifier {
	if ttl <= 0 {
		ttl = 15 * time.Minute
	}
	return &AESLinkVerifier{key: []byte(passphrase), ttl: ttl, now: time.Now}
}

type linkPayload struct {
	PlayerID  string `json:"playerId"`
	VIPID     string `json:"vipid"`
	Nickname  string `json:"nickname"`
	Name      string `json:"name"`
	Avatar    string `json:"avatar"`
	AvatarURL string `json:"avatarUrl"`
	Platform  string `json:"platform"`
	IssuedAt  int64  `json:"ts"`
}

// Verify 解密并校验资料；任何格式问题都按未鉴权处理。
func (v *AESLinkVerifier) Verify(ctx context.Context, payload string) (GameUser, error) {
	if len(v.key) < 16 {
		return GameUser{}, errAuthRequired
	}
	decoded, err := decryptLinkPayload(payload, string(v.key))
	if err != nil {
		return GameUser{}, errAuthRequired
	}
	guuid := strings.TrimSpace(decoded.PlayerID)
	if guuid == "" {
		guuid = strings.TrimSpace(decoded.VIPID)
	}
	if guuid == "" || len(guuid) > 64 {
		return GameUser{}, errAuthRequired
	}
	// ts 必须存在且在有效窗口内：缺 ts 的旧格式不接受，避免重放。
	if decoded.IssuedAt <= 0 {
		return GameUser{}, errAuthRequired
	}
	now := v.now()
	issued := time.Unix(decoded.IssuedAt, 0)
	if issued.After(now.Add(5*time.Minute)) || now.Sub(issued) > v.ttl {
		return GameUser{}, errExpiredLink
	}
	name := strings.TrimSpace(decoded.Nickname)
	if name == "" {
		name = strings.TrimSpace(decoded.Name)
	}
	if name == "" {
		name = guuid
	}
	if len([]rune(name)) > 64 {
		name = string([]rune(name)[:64])
	}
	avatar := strings.TrimSpace(decoded.Avatar)
	if avatar == "" {
		avatar = strings.TrimSpace(decoded.AvatarURL)
	}
	if len(avatar) > 255 {
		avatar = ""
	}
	return GameUser{Guuid: guuid, Name: name, Avatar: avatar}, nil
}

var errExpiredLink = newError(401, CodeAuthExpired, "聊天登录信息已过期，请重新进入游戏")

// decryptLinkPayload 与 internal/api 的客服链接解密保持一致：
// 密钥 = SHA1(口令) 的十六进制前 16 个字符，AES-128-ECB + PKCS7，密文为十六进制字符串。
func decryptLinkPayload(value, passphrase string) (linkPayload, error) {
	var payload linkPayload
	value = strings.TrimSpace(value)
	if len(value) < aes.BlockSize*2 || len(value) > 64<<10 || len(value)%2 != 0 {
		return payload, errors.New("invalid encrypted link length")
	}
	ciphertext, err := hex.DecodeString(value)
	if err != nil || len(ciphertext) == 0 || len(ciphertext)%aes.BlockSize != 0 {
		return payload, errors.New("invalid encrypted link data")
	}
	digest := sha1.Sum([]byte(passphrase))
	keyHex := hex.EncodeToString(digest[:])
	block, err := aes.NewCipher([]byte(keyHex[:16]))
	if err != nil {
		return payload, err
	}
	plaintext := make([]byte, len(ciphertext))
	for offset := 0; offset < len(ciphertext); offset += aes.BlockSize {
		block.Decrypt(plaintext[offset:offset+aes.BlockSize], ciphertext[offset:offset+aes.BlockSize])
	}
	padding := int(plaintext[len(plaintext)-1])
	if padding < 1 || padding > aes.BlockSize || padding > len(plaintext) {
		return payload, errors.New("invalid encrypted link padding")
	}
	for _, value := range plaintext[len(plaintext)-padding:] {
		if int(value) != padding {
			return payload, errors.New("invalid encrypted link padding")
		}
	}
	decoder := json.NewDecoder(bytes.NewReader(plaintext[:len(plaintext)-padding]))
	if err := decoder.Decode(&payload); err != nil {
		return payload, err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return payload, errors.New("invalid encrypted link json")
	}
	return payload, nil
}
