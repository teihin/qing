package directchat

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"
	"time"
)

func TestPairKeyIsStableAndClubScoped(t *testing.T) {
	low, high, key := PairKey("100002", "100001")
	if low != "100001" || high != "100002" || key != "100001:100002" {
		t.Fatalf("unexpected pair key: %s %s %s", low, high, key)
	}
	// 反向传入必须得到同一个键（唯一索引依赖这一点）。
	low2, high2, key2 := PairKey("100001", "100002")
	if low != low2 || high != high2 || key != key2 {
		t.Fatal("pair key must not depend on argument order")
	}
}

func TestCursorRoundTripAndTamper(t *testing.T) {
	key := []byte("cursor-key-for-tests")
	at := time.UnixMilli(1761900000123).In(time.Local)
	token := EncodeCursor(key, at, "abcdef0123456789")
	cursor, err := DecodeCursor(key, token)
	if err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if cursor.ID != "abcdef0123456789" || cursor.At.UnixMilli() != at.UnixMilli() {
		t.Fatalf("cursor mismatch: %#v", cursor)
	}
	// 篡改任意字符都必须被拒绝。
	tampered := token[:len(token)-2] + "AA"
	if _, err := DecodeCursor(key, tampered); err == nil {
		t.Fatal("tampered cursor must be rejected")
	}
	if _, err := DecodeCursor([]byte("another-key"), token); err == nil {
		t.Fatal("cursor signed with another key must be rejected")
	}
	// 客户端自行拼接的游标必须被拒绝。
	if _, err := DecodeCursor(key, base64.RawURLEncoding.EncodeToString([]byte("c1|1|abc|deadbeef"))); err == nil {
		t.Fatal("hand-crafted cursor must be rejected")
	}
}

func TestTicketLifecycle(t *testing.T) {
	key := []byte("0123456789abcdef-ticket")
	issuer := NewTicketIssuer(key, 5*time.Minute)
	verifier := NewTicketVerifier(key, 10*time.Minute)

	ticket, err := issuer.Issue("100001", "玩家一", "")
	if err != nil {
		t.Fatal(err)
	}
	user, err := verifier.Verify(nil, ticket)
	if err != nil {
		t.Fatalf("verify failed: %v", err)
	}
	if user.Guuid != "100001" || user.Name != "玩家一" {
		t.Fatalf("unexpected user: %#v", user)
	}

	// 伪造身份：改签名后必须失败。
	parts := []string{}
	for _, part := range bytes.Split([]byte(ticket), []byte(".")) {
		parts = append(parts, string(part))
	}
	forged := parts[0] + "." + parts[1] + "." + parts[2][:len(parts[2])-2] + "zz"
	if _, err := verifier.Verify(nil, forged); err == nil {
		t.Fatal("forged ticket must be rejected")
	}

	// 过期票据返回 DIRECT_AUTH_EXPIRED。
	expiredIssuer := NewTicketIssuer(key, -time.Minute)
	expiredTicket, err := expiredIssuer.Issue("100002", "玩家二", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := verifier.Verify(nil, expiredTicket); err == nil || AsError(err).Code != CodeAuthExpired {
		t.Fatalf("expired ticket must return %s, got %v", CodeAuthExpired, err)
	}

	// 未配置密钥时不能放行。
	disabled := NewTicketVerifier(nil, time.Minute)
	if _, err := disabled.Verify(nil, ticket); err == nil {
		t.Fatal("verifier without key must reject everything")
	}
}

func TestSniffImageAcceptsCommonFormats(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 40, 30))
	img.Set(1, 1, color.RGBA{R: 200, A: 255})
	var jpegBuf, pngBuf bytes.Buffer
	if err := jpeg.Encode(&jpegBuf, img, nil); err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(&pngBuf, img); err != nil {
		t.Fatal(err)
	}
	info, err := SniffImage(jpegBuf.Bytes())
	if err != nil || info.MimeType != "image/jpeg" || info.Width != 40 || info.Height != 30 {
		t.Fatalf("jpeg sniff failed: %#v %v", info, err)
	}
	info, err = SniffImage(pngBuf.Bytes())
	if err != nil || info.MimeType != "image/png" || info.Width != 40 {
		t.Fatalf("png sniff failed: %#v %v", info, err)
	}
	// SVG/HTML 等可执行内联内容必须拒绝。
	if _, err := SniffImage([]byte("<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>")); err == nil {
		t.Fatal("svg must be rejected")
	}
}

func TestMediaTicketSignature(t *testing.T) {
	storage := NewMediaStorage(t.TempDir(), []byte("media-sign-key"), "http://127.0.0.1:8893/chattool")
	if storage.MediaURL("attachment-1", "100001", "thumb", time.Minute) == "" {
		t.Fatal("expected media url")
	}
	valid := mediaTicketForTest(storage, "attachment-1", "100001", "thumb", time.Minute)
	variant, ok := storage.ValidateMediaTicket("attachment-1", valid)
	if !ok || variant != "thumb" {
		t.Fatalf("valid ticket rejected: %q %v", variant, ok)
	}
	if _, ok := storage.ValidateMediaTicket("attachment-2", valid); ok {
		t.Fatal("ticket bound to another attachment must fail")
	}
	expired := mediaTicketForTest(storage, "attachment-1", "100001", "", -time.Minute)
	if _, ok := storage.ValidateMediaTicket("attachment-1", expired); ok {
		t.Fatal("expired ticket must fail")
	}
}

// mediaTicketForTest 复用 MediaURL 的签名格式，直接取出 ticket 参数。
func mediaTicketForTest(storage *MediaStorage, attachmentID, guuid, variant string, ttl time.Duration) string {
	url := storage.MediaURL(attachmentID, guuid, variant, ttl)
	index := bytes.Index([]byte(url), []byte("ticket="))
	if index < 0 {
		return ""
	}
	return url[index+len("ticket="):]
}

func TestParseM4ADuration(t *testing.T) {
	build := func(timescale, duration uint32) []byte {
		buf := make([]byte, 64)
		copy(buf[8:], []byte("mvhd"))
		buf[12] = 0 // version 0
		binary.BigEndian.PutUint32(buf[12+12:], timescale)
		binary.BigEndian.PutUint32(buf[12+16:], duration)
		return buf
	}
	ms, ok := parseM4ADuration(build(1000, 1200))
	if !ok || ms != 1200 {
		t.Fatalf("unexpected duration: %d %v", ms, ok)
	}
	if _, ok := parseM4ADuration([]byte("not an mp4 file")); ok {
		t.Fatal("garbage must not parse")
	}
}
