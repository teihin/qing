package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"
)

var (
	ErrInvalidToken = errors.New("invalid token")
	ErrExpiredToken = errors.New("expired token")
)

type Claims struct {
	UserID    string `json:"sub"`
	RoomID    string `json:"room"`
	IssuedAt  int64  `json:"iat"`
	ExpiresAt int64  `json:"exp"`
	Nonce     string `json:"nonce"`
}

type Manager struct {
	secret      []byte
	maxLifetime time.Duration
	clockSkew   time.Duration
	now         func() time.Time
}

func NewManager(secret string, maxLifetime, clockSkew time.Duration) (*Manager, error) {
	if len(secret) < 32 {
		return nil, errors.New("token secret must contain at least 32 characters")
	}
	if maxLifetime <= 0 {
		return nil, errors.New("max token lifetime must be positive")
	}
	return &Manager{
		secret:      []byte(secret),
		maxLifetime: maxLifetime,
		clockSkew:   clockSkew,
		now:         time.Now,
	}, nil
}

func (m *Manager) Issue(userID, roomID string, lifetime time.Duration) (string, Claims, error) {
	if err := validateIdentity(userID, roomID); err != nil {
		return "", Claims{}, err
	}
	if lifetime <= 0 || lifetime > m.maxLifetime {
		return "", Claims{}, fmt.Errorf("token lifetime must be between 1ns and %s", m.maxLifetime)
	}

	nonceBytes := make([]byte, 12)
	if _, err := rand.Read(nonceBytes); err != nil {
		return "", Claims{}, fmt.Errorf("generate token nonce: %w", err)
	}

	now := m.now().UTC()
	claims := Claims{
		UserID:    userID,
		RoomID:    roomID,
		IssuedAt:  now.Unix(),
		ExpiresAt: now.Add(lifetime).Unix(),
		Nonce:     base64.RawURLEncoding.EncodeToString(nonceBytes),
	}
	token, err := m.sign(claims)
	return token, claims, err
}

func (m *Manager) Verify(token string) (Claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[0] != "v1" {
		return Claims{}, ErrInvalidToken
	}

	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return Claims{}, ErrInvalidToken
	}
	if base64.RawURLEncoding.EncodeToString(payload) != parts[1] {
		return Claims{}, ErrInvalidToken
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return Claims{}, ErrInvalidToken
	}
	if base64.RawURLEncoding.EncodeToString(signature) != parts[2] {
		return Claims{}, ErrInvalidToken
	}

	expected := m.signature(parts[1])
	if !hmac.Equal(signature, expected) {
		return Claims{}, ErrInvalidToken
	}

	var claims Claims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return Claims{}, ErrInvalidToken
	}
	if err := validateIdentity(claims.UserID, claims.RoomID); err != nil {
		return Claims{}, ErrInvalidToken
	}
	if claims.IssuedAt <= 0 || claims.ExpiresAt <= claims.IssuedAt || claims.Nonce == "" {
		return Claims{}, ErrInvalidToken
	}

	now := m.now().UTC()
	issuedAt := time.Unix(claims.IssuedAt, 0)
	expiresAt := time.Unix(claims.ExpiresAt, 0)
	if issuedAt.After(now.Add(m.clockSkew)) {
		return Claims{}, ErrInvalidToken
	}
	if expiresAt.Before(now.Add(-m.clockSkew)) {
		return Claims{}, ErrExpiredToken
	}
	if expiresAt.Sub(issuedAt) > m.maxLifetime+m.clockSkew {
		return Claims{}, ErrInvalidToken
	}

	return claims, nil
}

func (m *Manager) sign(claims Claims) (string, error) {
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", fmt.Errorf("encode token claims: %w", err)
	}
	payloadString := base64.RawURLEncoding.EncodeToString(payload)
	signature := base64.RawURLEncoding.EncodeToString(m.signature(payloadString))
	return "v1." + payloadString + "." + signature, nil
}

func (m *Manager) signature(payload string) []byte {
	mac := hmac.New(sha256.New, m.secret)
	_, _ = mac.Write([]byte("v1."))
	_, _ = mac.Write([]byte(payload))
	return mac.Sum(nil)
}

func validateIdentity(userID, roomID string) error {
	if err := validateTextID("user ID", userID); err != nil {
		return err
	}
	if err := validateTextID("room ID", roomID); err != nil {
		return err
	}
	return nil
}

func validateTextID(label, value string) error {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 128 {
		return fmt.Errorf("%s must contain 1 to 128 bytes", label)
	}
	for _, r := range value {
		if unicode.IsControl(r) {
			return fmt.Errorf("%s contains control characters", label)
		}
	}
	return nil
}
