package auth

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestIssueAndVerify(t *testing.T) {
	manager, err := NewManager(strings.Repeat("s", 32), 15*time.Minute, 0)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_753_696_800, 0).UTC()
	manager.now = func() time.Time { return now }

	token, issued, err := manager.Issue("user-1", "room-1", 5*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	verified, err := manager.Verify(token)
	if err != nil {
		t.Fatal(err)
	}
	if verified.UserID != issued.UserID || verified.RoomID != issued.RoomID {
		t.Fatalf("verified claims mismatch: %#v != %#v", verified, issued)
	}
}

func TestRejectsTamperedAndExpiredTokens(t *testing.T) {
	manager, err := NewManager(strings.Repeat("s", 32), 15*time.Minute, 0)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_753_696_800, 0).UTC()
	manager.now = func() time.Time { return now }
	token, _, err := manager.Issue("user-1", "room-1", time.Minute)
	if err != nil {
		t.Fatal(err)
	}

	replacement := byte('A')
	if token[len(token)-2] == replacement {
		replacement = 'B'
	}
	tampered := token[:len(token)-2] + string(replacement) + token[len(token)-1:]
	if _, err := manager.Verify(tampered); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("expected invalid token, got %v", err)
	}

	manager.now = func() time.Time { return now.Add(2 * time.Minute) }
	if _, err := manager.Verify(token); !errors.Is(err, ErrExpiredToken) {
		t.Fatalf("expected expired token, got %v", err)
	}
}
