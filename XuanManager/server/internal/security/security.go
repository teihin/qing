package security

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"
)

var usernamePattern = regexp.MustCompile(`^[A-Za-z0-9_.-]{4,32}$`)

func ValidateUsername(value string) error {
	if !usernamePattern.MatchString(value) {
		return errors.New("账号须为 4-32 位字母、数字、点、下划线或短横线")
	}
	return nil
}

func ValidatePassword(value string) error {
	length := utf8.RuneCountInString(value)
	if length < 8 || len(value) > 72 {
		return errors.New("密码长度须为 8-72 个字符")
	}
	var hasLetter, hasNumber, hasSymbol bool
	for _, r := range value {
		switch {
		case r >= 'A' && r <= 'Z', r >= 'a' && r <= 'z':
			hasLetter = true
		case r >= '0' && r <= '9':
			hasNumber = true
		default:
			hasSymbol = true
		}
	}
	if !hasNumber || !hasSymbol || (!hasLetter && length < 10) {
		return errors.New("密码需包含数字和特殊字符；不含字母时至少 10 位")
	}
	return nil
}

func HashPassword(value string) (string, error) {
	if err := ValidatePassword(value); err != nil {
		return "", err
	}
	return hashPassword(value)
}

// HashBootstrapPassword only exists for the one-time, user-selected initial
// super administrator credential. All later passwords use HashPassword.
func HashBootstrapPassword(value string) (string, error) {
	if utf8.RuneCountInString(value) < 8 || len(value) > 72 {
		return "", errors.New("初始超级管理员密码长度须为 8-72 个字符")
	}
	return hashPassword(value)
}

func hashPassword(value string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(value), 12)
	if err != nil {
		return "", fmt.Errorf("生成密码摘要失败: %w", err)
	}
	return string(hash), nil
}

func VerifyPassword(hash, value string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(value)) == nil
}

func NewToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func HashToken(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func EqualTokenHash(value, expectedHash string) bool {
	actual := HashToken(value)
	if len(actual) != len(expectedHash) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(actual), []byte(expectedHash)) == 1
}
