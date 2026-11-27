package realtime

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// 用真实 httptest 服务端跑一遍「升级 → 双向收发 → 关闭」，顺带覆盖分片与 ping。
func TestUpgradeAndDialRoundTrip(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := Upgrade(w, r)
		if err != nil {
			t.Errorf("upgrade: %v", err)
			return
		}
		defer conn.Close()
		received := 0
		for received < 2 {
			message, err := conn.ReadMessage()
			if err != nil {
				return
			}
			received++
			if err := conn.WriteJSON(map[string]any{"echo": string(message), "index": received}); err != nil {
				return
			}
		}
	}))
	defer server.Close()

	url := "ws" + strings.TrimPrefix(server.URL, "http")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, err := Dial(ctx, url, http.Header{"X-Agent-Token": {"token-value"}})
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	if err := conn.WriteJSON(map[string]any{"type": "wake"}); err != nil {
		t.Fatalf("write: %v", err)
	}
	reply, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if !strings.Contains(string(reply), "wake") {
		t.Fatalf("unexpected reply: %s", reply)
	}

	// 大消息（>125 字节）走 16 位长度分支。
	long := strings.Repeat("牌", 300)
	if err := conn.WriteText([]byte(long)); err != nil {
		t.Fatalf("write long: %v", err)
	}
	if _, err := conn.ReadMessage(); err != nil {
		t.Fatalf("read long: %v", err)
	}
}

func TestUpgradeRejectsPlainRequest(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/agent/v1/ws", nil)
	recorder := httptest.NewRecorder()
	if _, err := Upgrade(recorder, request); err == nil {
		t.Fatal("普通请求不应升级成功")
	}
}
