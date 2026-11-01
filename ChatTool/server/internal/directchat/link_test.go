package directchat

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"os"
	"testing"
	"time"
)

// encryptLinkForTest 用与客户端 Tool.encrypt() 完全相同的算法加密资料：
// 口令 → SHA1 十六进制前 16 字符 → AES-128-ECB + PKCS7 → 十六进制字符串。
func encryptLinkForTest(t *testing.T, passphrase string, payload map[string]any) string {
	t.Helper()
	plain, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha1.Sum([]byte(passphrase))
	keyHex := hex.EncodeToString(digest[:])
	block, err := aes.NewCipher([]byte(keyHex[:16]))
	if err != nil {
		t.Fatal(err)
	}
	padding := aes.BlockSize - len(plain)%aes.BlockSize
	buffer := bytes.NewBuffer(plain)
	buffer.Write(bytes.Repeat([]byte{byte(padding)}, padding))
	ciphertext := make([]byte, buffer.Len())
	for offset := 0; offset < buffer.Len(); offset += aes.BlockSize {
		block.Encrypt(ciphertext[offset:offset+aes.BlockSize], buffer.Bytes()[offset:offset+aes.BlockSize])
	}
	return hex.EncodeToString(ciphertext)
}

func linkEnv(t *testing.T) *testEnv {
	t.Helper()
	store := newFakeStore()
	store.addClub("111111", "测试俱乐部一", "100004",
		Member{Guuid: "100001", Name: "玩家一", Role: RoleMember},
		Member{Guuid: "100002", Name: "代理二", Role: RoleAgent},
	)
	media := NewMediaStorage(t.TempDir(), []byte("media-key-for-tests"), "http://127.0.0.1:8893/chattool")
	voice := NewAudioVoiceProvider("", 300, 10000)
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
	service := NewService(store, store, NewTicketVerifier(nil, time.Minute), media, voice, nil, Options{
		SessionTTL: time.Hour,
		CursorKey:  []byte("cursor-key-for-tests"),
		LinkKey:    "b2R1o7o3c5e23T48mRl2rhC9o5ao039F",
		LinkTTL:    15 * time.Minute,
	}, logger)
	return &testEnv{service: service, store: store, tokens: map[string]string{}, media: media}
}

func TestLinkSessionAcceptsValidPayload(t *testing.T) {
	env := linkEnv(t)
	const passphrase = "b2R1o7o3c5e23T48mRl2rhC9o5ao039F"
	payload := encryptLinkForTest(t, passphrase, map[string]any{
		"playerId": "100002",
		"nickname": "代理二",
		"platform": "android",
		"ts":       time.Now().Unix(),
	})
	token, session, err := env.service.CreateLinkSession(context.Background(), payload)
	if err != nil {
		t.Fatalf("valid link rejected: %v", err)
	}
	if token == "" || session.Guuid != "100002" || session.Name != "代理二" {
		t.Fatalf("unexpected session: %+v", session)
	}
	// 拿到的令牌可以直接鉴权，身份来自密文而不是请求体字段。
	authed, err := env.service.Authenticate(context.Background(), token)
	if err != nil || authed.Guuid != "100002" {
		t.Fatalf("authenticate failed: %v %+v", err, authed)
	}
}

func TestLinkSessionRejectsExpiredAndForgedPayload(t *testing.T) {
	env := linkEnv(t)
	const passphrase = "b2R1o7o3c5e23T48mRl2rhC9o5ao039F"
	expired := encryptLinkForTest(t, passphrase, map[string]any{
		"playerId": "100002", "nickname": "代理二", "ts": time.Now().Add(-time.Hour).Unix(),
	})
	if _, _, err := env.service.CreateLinkSession(context.Background(), expired); err == nil {
		t.Fatal("expired link must be rejected")
	}
	forged := encryptLinkForTest(t, "wrong-passphrase-0000000", map[string]any{
		"playerId": "100002", "nickname": "代理二", "ts": time.Now().Unix(),
	})
	if _, _, err := env.service.CreateLinkSession(context.Background(), forged); err == nil {
		t.Fatal("payload encrypted with another key must be rejected")
	}
	noTS := encryptLinkForTest(t, passphrase, map[string]any{"playerId": "100002"})
	if _, _, err := env.service.CreateLinkSession(context.Background(), noTS); err == nil {
		t.Fatal("payload without ts must be rejected")
	}
	// 未配置 LinkKey 时一律拒绝，不能退化为信任客户端 guuid。
	bare := &Service{opts: Options{}}
	if _, _, err := bare.CreateLinkSession(context.Background(), noTS); err == nil {
		t.Fatal("service without link key must reject")
	}
}
