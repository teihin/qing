package security

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
	"strings"
)

const credentialVersion = "v1:"

// DeriveTOTPKey 把配置里的密钥材料收敛成 32 字节 AES 密钥。
// 加域分隔串，避免同一份材料在直聊票据、托管 PIN 等其他用途里被复用。
func DeriveTOTPKey(material string) []byte {
	sum := sha256.Sum256([]byte("chattool/totp-secret/v1\x00" + material))
	return sum[:]
}

// SealCredential 用 AES-256-GCM 加密，输出 v1:<base64(nonce|ciphertext)>。
func SealCredential(key []byte, plaintext string) (string, error) {
	if len(plaintext) == 0 {
		return "", nil
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return credentialVersion + base64.RawStdEncoding.EncodeToString(sealed), nil
}

// OpenCredential 解开 SealCredential 的密文；空串表示「没有保存密钥」。
func OpenCredential(key []byte, sealed string) (string, error) {
	sealed = strings.TrimSpace(sealed)
	if sealed == "" {
		return "", nil
	}
	if !strings.HasPrefix(sealed, credentialVersion) {
		return "", errors.New("凭据版本不支持")
	}
	raw, err := base64.RawStdEncoding.DecodeString(strings.TrimPrefix(sealed, credentialVersion))
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", errors.New("凭据长度不正确")
	}
	plaintext, err := gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], nil)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}
