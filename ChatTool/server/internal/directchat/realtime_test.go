package directchat

import (
	"encoding/json"
	"testing"
	"time"
)

func TestRealtimeHubPublishesOnlyToTargetAccount(t *testing.T) {
	hub := newRealtimeHub()
	target := &realtimeClient{session: Session{Guuid: "target"}, hub: hub, send: make(chan []byte, 1), done: make(chan struct{})}
	other := &realtimeClient{session: Session{Guuid: "other"}, hub: hub, send: make(chan []byte, 1), done: make(chan struct{})}
	hub.register(target)
	hub.register(other)
	hub.publish("target", RealtimeEvent{Type: "message.new", Data: map[string]string{"messageId": "m1"}})

	select {
	case body := <-target.send:
		var event RealtimeEvent
		if err := json.Unmarshal(body, &event); err != nil {
			t.Fatalf("decode event: %v", err)
		}
		if event.Type != "message.new" {
			t.Fatalf("event type = %q", event.Type)
		}
	case <-time.After(time.Second):
		t.Fatal("target did not receive event")
	}
	select {
	case <-other.send:
		t.Fatal("event was sent to another account")
	case <-time.After(20 * time.Millisecond):
	}
}
