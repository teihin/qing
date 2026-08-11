package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

type liveEvent struct {
	Type           string `json:"type"`
	ConversationID string `json:"conversationId,omitempty"`
	Payload        any    `json:"payload,omitempty"`
}

type eventHub struct {
	mu          sync.RWMutex
	subscribers map[string]map[chan liveEvent]struct{}
	done        chan struct{}
	stopOnce    sync.Once
}

func newEventHub() *eventHub {
	return &eventHub{subscribers: map[string]map[chan liveEvent]struct{}{}, done: make(chan struct{})}
}

func (h *eventHub) stop() {
	h.stopOnce.Do(func() { close(h.done) })
}

func (h *eventHub) subscribe(key string) (<-chan liveEvent, func()) {
	ch := make(chan liveEvent, 32)
	h.mu.Lock()
	if h.subscribers[key] == nil {
		h.subscribers[key] = map[chan liveEvent]struct{}{}
	}
	h.subscribers[key][ch] = struct{}{}
	h.mu.Unlock()
	return ch, func() {
		h.mu.Lock()
		delete(h.subscribers[key], ch)
		if len(h.subscribers[key]) == 0 {
			delete(h.subscribers, key)
		}
		h.mu.Unlock()
	}
}

func (h *eventHub) publish(key string, event liveEvent) {
	select {
	case <-h.done:
		return
	default:
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for ch := range h.subscribers[key] {
		select {
		case ch <- event:
		default:
		}
	}
}

func streamEvents(w http.ResponseWriter, r *http.Request, ch <-chan liveEvent, shutdown <-chan struct{}) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "STREAM_UNAVAILABLE", "当前环境不支持实时消息")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	fmt.Fprint(w, "retry: 3000\n\n")
	flusher.Flush()
	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-shutdown:
			return
		case <-r.Context().Done():
			return
		case <-ticker.C:
			fmt.Fprint(w, ": heartbeat\n\n")
			flusher.Flush()
		case event := <-ch:
			body, _ := json.Marshal(event)
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event.Type, body)
			flusher.Flush()
		}
	}
}
