package main

import (
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"math"
	"net/http"
	"os"
	"time"

	"github.com/gorilla/websocket"
)

type controlMessage struct {
	Type          string          `json:"type"`
	SessionID     string          `json:"sessionId,omitempty"`
	MaxDurationMS int64           `json:"maxDurationMs,omitempty"`
	Voice         json.RawMessage `json:"voice,omitempty"`
	Code          string          `json:"code,omitempty"`
	Message       string          `json:"message,omitempty"`
}

func main() {
	var endpoint string
	var origin string
	flag.StringVar(&endpoint, "ws", "ws://127.0.0.1:8080/v1/stream", "WebSocket endpoint")
	flag.StringVar(&origin, "origin", "", "optional Origin header")
	flag.Parse()

	headers := http.Header{}
	if origin != "" {
		headers.Set("Origin", origin)
	}
	connection, response, err := websocket.DefaultDialer.Dial(endpoint, headers)
	if err != nil {
		if response != nil {
			exitError("connect failed: HTTP %s: %v", response.Status, err)
		}
		exitError("connect failed: %v", err)
	}
	defer connection.Close()
	deadline := time.Now().Add(20 * time.Second)
	_ = connection.SetReadDeadline(deadline)
	_ = connection.SetWriteDeadline(deadline)

	requestID := fmt.Sprintf("smoke_%d", time.Now().UnixNano())
	writeJSON(connection, map[string]string{
		"type":      "start",
		"requestId": requestID,
	})
	started := expectType(connection, "started")
	if started.SessionID == "" {
		exitError("started response did not include a sessionId")
	}

	const (
		sampleRate      = 16000
		frameDuration   = 100 * time.Millisecond
		samplesPerFrame = sampleRate / 10
		frameCount      = 10
	)
	for sequence := 0; sequence < frameCount; sequence++ {
		frame := make([]byte, 14+samplesPerFrame*2)
		frame[0] = 1
		frame[1] = 1
		binary.BigEndian.PutUint32(frame[2:6], uint32(sequence))
		binary.BigEndian.PutUint64(
			frame[6:14],
			uint64((time.Duration(sequence)*frameDuration)/time.Millisecond),
		)
		for sampleIndex := 0; sampleIndex < samplesPerFrame; sampleIndex++ {
			absoluteSample := sequence*samplesPerFrame + sampleIndex
			phase := 2 * math.Pi * 440 * float64(absoluteSample) / sampleRate
			sample := int16(math.Sin(phase) * 8000)
			binary.LittleEndian.PutUint16(
				frame[14+sampleIndex*2:],
				uint16(sample),
			)
		}
		if err := connection.WriteMessage(websocket.BinaryMessage, frame); err != nil {
			exitError("write PCM frame %d: %v", sequence, err)
		}
	}

	writeJSON(connection, map[string]string{"type": "finish"})
	ready := expectType(connection, "ready")
	if len(ready.Voice) == 0 {
		exitError("ready response did not include voice metadata")
	}
	fmt.Println(string(ready.Voice))
}

func writeJSON(connection *websocket.Conn, value any) {
	if err := connection.WriteJSON(value); err != nil {
		exitError("write control message: %v", err)
	}
}

func expectType(connection *websocket.Conn, expected string) controlMessage {
	var message controlMessage
	if err := connection.ReadJSON(&message); err != nil {
		exitError("read %s response: %v", expected, err)
	}
	if message.Type == "error" {
		exitError("server error %s: %s", message.Code, message.Message)
	}
	if message.Type != expected {
		exitError("expected %s response, received %s", expected, message.Type)
	}
	return message
}

func exitError(format string, arguments ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", arguments...)
	os.Exit(1)
}
