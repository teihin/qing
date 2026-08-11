package api

import (
	"context"
	"crypto/aes"
	"crypto/sha1"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type captureExecer struct {
	query string
	args  []any
}

func (exec *captureExecer) ExecContext(_ context.Context, query string, args ...any) (sql.Result, error) {
	exec.query = query
	exec.args = args
	return nil, nil
}

func TestInsertSystemMessageUsesUniqueClientMessageID(t *testing.T) {
	exec := &captureExecer{}
	if err := insertSystemMessage(context.Background(), exec, "conversation-id", "系统消息"); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(exec.query, "client_message_id") {
		t.Fatal("system messages must persist a client message id")
	}
	if len(exec.args) != 4 || exec.args[0] == "" || exec.args[0] != exec.args[3] {
		t.Fatalf("message id and client message id must be the same unique value: %#v", exec.args)
	}
}

func TestPlayerLinkTimestampCompatibility(t *testing.T) {
	now := time.Unix(1786442400, 0)
	if !playerLinkTimestampValid(0, now, 15*time.Minute) {
		t.Fatal("legacy encrypted payload without timestamp must remain compatible")
	}
	if playerLinkTimestampValid(-1, now, 15*time.Minute) {
		t.Fatal("negative timestamp must be rejected")
	}
	if !playerLinkTimestampValid(now.Add(-14*time.Minute).Unix(), now, 15*time.Minute) {
		t.Fatal("fresh timestamp must be accepted")
	}
	if playerLinkTimestampValid(now.Add(-16*time.Minute).Unix(), now, 15*time.Minute) {
		t.Fatal("expired timestamp must be rejected")
	}
	if playerLinkTimestampValid(now.Add(3*time.Minute).Unix(), now, 15*time.Minute) {
		t.Fatal("future timestamp outside the clock-skew window must be rejected")
	}
}

func TestClassifyUpload(t *testing.T) {
	tests := []struct{ mime, kind, ext string }{
		{"image/jpeg", "image", ".jpg"},
		{"image/png", "image", ".png"},
		{"video/mp4", "video", ".mp4"},
		{"application/pdf", "file", ".pdf"},
	}
	for _, test := range tests {
		kind, size, ext, ok := classifyUpload(test.mime)
		if !ok || kind != test.kind || ext != test.ext || size <= 0 {
			t.Fatalf("unexpected classification for %s", test.mime)
		}
	}
	if _, _, _, ok := classifyUpload("image/svg+xml"); ok {
		t.Fatal("SVG must not be accepted")
	}
	if _, _, _, ok := classifyUpload("text/html; charset=utf-8"); ok {
		t.Fatal("HTML must not be accepted")
	}
}

func TestSanitizeFilename(t *testing.T) {
	if got := sanitizeFilename("../../secret.txt"); got != "secret.txt" {
		t.Fatalf("unexpected filename %q", got)
	}
	if got := sanitizeFilename("bad\x00name.pdf"); got != "badname.pdf" {
		t.Fatalf("unexpected control filtering %q", got)
	}
}

func TestRequireText(t *testing.T) {
	if _, err := requireText("   ", 10); err == nil {
		t.Fatal("empty text must fail")
	}
	if value, err := requireText("  hello  ", 10); err != nil || value != "hello" {
		t.Fatalf("unexpected text validation: %q %v", value, err)
	}
}

func TestNormalizeMemoPlayerID(t *testing.T) {
	if value, ok := normalizeMemoPlayerID("  123456  "); !ok || value != "123456" {
		t.Fatalf("unexpected memo player id normalization: %q %v", value, ok)
	}
	if _, ok := normalizeMemoPlayerID("   "); ok {
		t.Fatal("empty memo player id must fail")
	}
	if _, ok := normalizeMemoPlayerID(strings.Repeat("玩", 65)); ok {
		t.Fatal("memo player id longer than 64 characters must fail")
	}
}

func TestNormalizeChannelCode(t *testing.T) {
	if value, ok := normalizeChannelCode(""); !ok || value != defaultChannelCode {
		t.Fatalf("legacy payload must default to general channel: %q %v", value, ok)
	}
	if value, ok := normalizeChannelCode(" VIP_RECHARGE "); !ok || value != "vip_recharge" {
		t.Fatalf("unexpected VIP channel normalization: %q %v", value, ok)
	}
	for _, value := range []string{"../vip", "vip-recharge", strings.Repeat("a", 33)} {
		if _, ok := normalizeChannelCode(value); ok {
			t.Fatalf("invalid channel %q must fail", value)
		}
	}
}

func TestPlayerSessionCookieNames(t *testing.T) {
	const ref = "0123456789abcdef0123456789abcdef"
	if got := playerSessionCookieName(ref); got != playerSessionCookie+"_"+ref {
		t.Fatalf("unexpected scoped player cookie name %q", got)
	}
	if got := playerSessionCookieName("not-valid"); got != playerSessionCookie {
		t.Fatalf("invalid ref must fall back to legacy cookie, got %q", got)
	}
}

func TestSafeMediaStoragePath(t *testing.T) {
	root := "/srv/chattool/uploads"
	path, err := safeMediaStoragePath(root, "2026/08/11/0123456789abcdef0123456789abcdef.png")
	if err != nil || path != "/srv/chattool/uploads/2026/08/11/0123456789abcdef0123456789abcdef.png" {
		t.Fatalf("unexpected safe media path: %q %v", path, err)
	}
	for _, value := range []string{"../secret", "/etc/passwd", "2026/../../secret"} {
		if _, err := safeMediaStoragePath(root, value); err == nil {
			t.Fatalf("unsafe media path %q must fail", value)
		}
	}
}

func TestClientIPTrustsForwardedHeaderOnlyFromLoopbackProxy(t *testing.T) {
	proxied := httptest.NewRequest("GET", "http://154.37.155.17/chattool/api/health", nil)
	proxied.RemoteAddr = "127.0.0.1:43210"
	proxied.Header.Set("X-Forwarded-For", "203.0.113.8, 127.0.0.1")
	if got := clientIP(proxied); got != "203.0.113.8" {
		t.Fatalf("unexpected proxied client IP %q", got)
	}

	spoofed := httptest.NewRequest("GET", "http://154.37.155.17/chattool/api/health", nil)
	spoofed.RemoteAddr = "198.51.100.9:43210"
	spoofed.Header.Set("X-Forwarded-For", "203.0.113.8")
	if got := clientIP(spoofed); got != "198.51.100.9" {
		t.Fatalf("untrusted forwarded header must be ignored, got %q", got)
	}
}

func TestDecryptPlayerLinkMatchesCocosToolEncrypt(t *testing.T) {
	key := "client-visible-link-key-for-test"
	original := directPlayerPayload{
		PlayerID: "123456",
		Nickname: "测试玩家",
		Level:    "50",
		Platform: "android",
		Channel:  "vip_recharge",
		IssuedAt: 1786442400,
		Metadata: map[string]any{"当前房间": "888888"},
	}
	plaintext, err := json.Marshal(original)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha1.Sum([]byte(key))
	keyHex := hex.EncodeToString(digest[:])
	block, err := aes.NewCipher([]byte(keyHex[:16]))
	if err != nil {
		t.Fatal(err)
	}
	padding := aes.BlockSize - len(plaintext)%aes.BlockSize
	padded := append(append([]byte{}, plaintext...), make([]byte, padding)...)
	for index := len(padded) - padding; index < len(padded); index++ {
		padded[index] = byte(padding)
	}
	ciphertext := make([]byte, len(padded))
	for offset := 0; offset < len(padded); offset += aes.BlockSize {
		block.Encrypt(ciphertext[offset:offset+aes.BlockSize], padded[offset:offset+aes.BlockSize])
	}
	decoded, err := decryptPlayerLink(hex.EncodeToString(ciphertext), key)
	if err != nil {
		t.Fatal(err)
	}
	if decoded.PlayerID != original.PlayerID || decoded.Nickname != original.Nickname || decoded.IssuedAt != original.IssuedAt || decoded.Channel != original.Channel {
		t.Fatalf("unexpected decoded payload: %+v", decoded)
	}
}

func TestDecryptPlayerLinkCryptoJSKnownVector(t *testing.T) {
	const ciphertext = "e59f2fa256a5f903160e9fd493744e8b80dc7da505eef46797f875a634a75c816e520691074dcd2515071ccbb94d81a139422cc8b52f57bb9a69e83275fa26f3"
	decoded, err := decryptPlayerLink(ciphertext, "client-visible-link-key-for-test")
	if err != nil {
		t.Fatal(err)
	}
	if decoded.PlayerID != "123456" || decoded.Nickname != "测试玩家" || decoded.IssuedAt != 1786442400 {
		t.Fatalf("unexpected CryptoJS vector result: %+v", decoded)
	}
}

func TestDecryptPlayerLinkAcceptsNumericLevel(t *testing.T) {
	key := "client-visible-link-key-for-test"
	plaintext := []byte(`{"playerId":"123456","nickname":"测试玩家","level":9,"platform":"android","ts":1786442400}`)
	digest := sha1.Sum([]byte(key))
	keyHex := hex.EncodeToString(digest[:])
	block, err := aes.NewCipher([]byte(keyHex[:16]))
	if err != nil {
		t.Fatal(err)
	}
	padding := aes.BlockSize - len(plaintext)%aes.BlockSize
	padded := append(append([]byte{}, plaintext...), make([]byte, padding)...)
	for index := len(padded) - padding; index < len(padded); index++ {
		padded[index] = byte(padding)
	}
	ciphertext := make([]byte, len(padded))
	for offset := 0; offset < len(padded); offset += aes.BlockSize {
		block.Encrypt(ciphertext[offset:offset+aes.BlockSize], padded[offset:offset+aes.BlockSize])
	}
	decoded, err := decryptPlayerLink(hex.EncodeToString(ciphertext), key)
	if err != nil {
		t.Fatal(err)
	}
	if string(decoded.Level) != "9" {
		t.Fatalf("unexpected numeric level normalization %q", decoded.Level)
	}
}

func TestEventHubStopIsIdempotent(t *testing.T) {
	hub := newEventHub()
	hub.stop()
	hub.stop()
	select {
	case <-hub.done:
	default:
		t.Fatal("event hub stop must close the shutdown channel")
	}
	hub.publish("team", liveEvent{Type: "message.created"})
}
