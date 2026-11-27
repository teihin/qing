package api

import (
	"bufio"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// SSE 通道：连上先收到 ready，之后一次 notifyChange 应该立刻推一条 change。
// 不需要数据库（处理函数只用 principal 与 hub），所以能在这里跑真 HTTP 流。
func TestAutomationStreamPushesChange(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		(&Server{}).handleAutomationStream(w, r, principal{})
	}))
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status %d", response.StatusCode)
	}
	if ct := response.Header.Get("Content-Type"); !strings.Contains(ct, "text/event-stream") {
		t.Fatalf("unexpected content type %q", ct)
	}

	reader := bufio.NewReader(response.Body)
	// 先读掉 ready 帧（两行 + 空行）。
	for index := 0; index < 3; index++ {
		if _, err := reader.ReadString('\n'); err != nil {
			t.Fatalf("read ready: %v", err)
		}
	}

	agentStreams.notifyChange("workers", map[string]any{"workerId": 42})

	type result struct {
		line string
		err  error
	}
	lines := make(chan result, 4)
	go func() {
		for {
			line, err := reader.ReadString('\n')
			lines <- result{line: line, err: err}
			if err != nil {
				return
			}
		}
	}()

	deadline := time.After(3 * time.Second)
	var payload string
	for payload == "" {
		select {
		case <-deadline:
			t.Fatalf("3 秒内没收到 change 事件")
		case item := <-lines:
			if item.err != nil {
				t.Fatalf("read: %v", item.err)
			}
			if strings.HasPrefix(item.line, "data: ") {
				payload = item.line
			}
		}
	}
	if !strings.Contains(payload, `"workers"`) || !strings.Contains(payload, "42") {
		t.Fatalf("unexpected payload: %s", payload)
	}
}

// 节点重复连接时后一条顶掉前一条，避免同一节点两条长连接抢命令。
func TestAgentHubReplacesStaleConnection(t *testing.T) {
	first := &agentStream{workerID: 9, out: make(chan []byte, 4), done: make(chan struct{})}
	second := &agentStream{workerID: 9, out: make(chan []byte, 4), done: make(chan struct{})}
	agentStreams.register(first)
	defer agentStreams.remove(second)
	if previous := agentStreams.register(second); previous != first {
		t.Fatalf("expected stale connection to be replaced")
	}
	select {
	case <-first.done:
	default:
		t.Fatal("stale connection should be closed")
	}
	if !agentStreams.connected(9) {
		t.Fatal("new connection should be registered")
	}
}
