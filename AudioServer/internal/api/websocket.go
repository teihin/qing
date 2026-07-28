package api

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"

	"qing-audio-server/internal/model"
	"qing-audio-server/internal/service"
)

const (
	protocolVersion  = byte(1)
	audioFrameType   = byte(1)
	audioHeaderBytes = 14
)

type clientControl struct {
	Type      string `json:"type"`
	RequestID string `json:"requestId,omitempty"`
}

type serverControl struct {
	Type          string             `json:"type"`
	SessionID     string             `json:"sessionId,omitempty"`
	MaxDurationMS int64              `json:"maxDurationMs,omitempty"`
	Voice         *model.PublicVoice `json:"voice,omitempty"`
	Code          string             `json:"code,omitempty"`
	Message       string             `json:"message,omitempty"`
	Retryable     bool               `json:"retryable,omitempty"`
}

func (s *Server) handleWebSocket(writer http.ResponseWriter, request *http.Request) {
	origin := request.Header.Get("Origin")
	if origin != "" && !s.originAllowed(origin) {
		writeAPIError(writer, http.StatusForbidden, "origin_denied", "origin is not allowed")
		return
	}
	select {
	case s.connectionSem <- struct{}{}:
	default:
		writeAPIError(writer, http.StatusServiceUnavailable, "server_busy", "too many active connections")
		return
	}
	defer func() { <-s.connectionSem }()

	upgrader := websocket.Upgrader{
		ReadBufferSize:  4096,
		WriteBufferSize: 4096,
		CheckOrigin: func(_ *http.Request) bool {
			return true
		},
		EnableCompression: false,
	}
	connection, err := upgrader.Upgrade(writer, request, nil)
	if err != nil {
		return
	}
	defer connection.Close()

	s.metrics.ConnectionOpened()
	defer s.metrics.ConnectionClosed()

	connection.SetReadLimit(s.voices.MaxFrameBytes() + audioHeaderBytes + 4096)
	readTimeout := s.config.WebSocketReadTimeout()
	_ = connection.SetReadDeadline(time.Now().Add(readTimeout))
	connection.SetPongHandler(func(string) error {
		return connection.SetReadDeadline(time.Now().Add(readTimeout))
	})

	stopPing := make(chan struct{})
	defer close(stopPing)
	go s.pingConnection(connection, stopPing)

	var (
		recording *service.Recording
	)
	defer func() {
		if recording != nil {
			recording.Abort()
		}
	}()

	for {
		messageType, message, err := connection.ReadMessage()
		if err != nil {
			if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				s.logger.Printf("websocket read closed remote=%s error=%v", request.RemoteAddr, err)
			}
			return
		}
		_ = connection.SetReadDeadline(time.Now().Add(readTimeout))

		switch messageType {
		case websocket.TextMessage:
			var control clientControl
			if err := json.Unmarshal(message, &control); err != nil {
				if !s.writeWSError(connection, "invalid_json", "control message is not valid JSON", false) {
					return
				}
				continue
			}
			control.Type = strings.ToLower(strings.TrimSpace(control.Type))
			switch control.Type {
			case "start":
				if recording != nil {
					if !s.writeWSError(connection, "recording_active", "this connection already has an active recording", false) {
						return
					}
					continue
				}
				result, err := s.voices.Start(request.Context(), control.RequestID)
				if err != nil {
					if !s.writeWSServiceError(connection, err) {
						return
					}
					continue
				}
				if result.Existing != nil {
					publicVoice := model.Public(*result.Existing)
					if !s.writeWSJSON(connection, serverControl{
						Type:  "ready",
						Voice: &publicVoice,
					}) {
						return
					}
					continue
				}
				recording = result.Recording
				if !s.writeWSJSON(connection, serverControl{
					Type:          "started",
					SessionID:     recording.VoiceID(),
					MaxDurationMS: s.config.Audio.MaxDurationMS,
				}) {
					return
				}

			case "finish":
				if recording == nil {
					if !s.writeWSError(connection, "no_recording", "there is no active recording", false) {
						return
					}
					continue
				}
				finishedRecording := recording
				recording = nil
				metadata, err := finishedRecording.Finish()
				if err != nil {
					if !s.writeWSServiceError(connection, err) {
						return
					}
					continue
				}
				publicVoice := model.Public(metadata)
				if !s.writeWSJSON(connection, serverControl{
					Type:  "ready",
					Voice: &publicVoice,
				}) {
					return
				}

			case "cancel":
				if recording != nil {
					recording.Abort()
					recording = nil
				}
				if !s.writeWSJSON(connection, serverControl{Type: "cancelled"}) {
					return
				}

			case "ping":
				if !s.writeWSJSON(connection, serverControl{Type: "pong"}) {
					return
				}

			default:
				if !s.writeWSError(connection, "unknown_message", "unsupported control message type", false) {
					return
				}
			}

		case websocket.BinaryMessage:
			if recording == nil {
				if !s.writeWSError(connection, "no_recording", "start a recording before sending audio", false) {
					return
				}
				continue
			}
			if len(message) <= audioHeaderBytes ||
				message[0] != protocolVersion ||
				message[1] != audioFrameType {
				recording.Abort()
				recording = nil
				if !s.writeWSError(connection, "invalid_audio_frame", "invalid binary audio frame header", false) {
					return
				}
				continue
			}
			sequence := binary.BigEndian.Uint32(message[2:6])
			timestampMS := binary.BigEndian.Uint64(message[6:14])
			if err := recording.WriteFrame(sequence, timestampMS, message[audioHeaderBytes:]); err != nil {
				recording.Abort()
				recording = nil
				if !s.writeWSServiceError(connection, err) {
					return
				}
			}
		}
	}
}

func (s *Server) pingConnection(connection *websocket.Conn, stop <-chan struct{}) {
	interval := s.config.WebSocketReadTimeout() / 2
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			err := connection.WriteControl(
				websocket.PingMessage,
				[]byte("ping"),
				time.Now().Add(s.config.WebSocketWriteTimeout()),
			)
			if err != nil {
				return
			}
		}
	}
}

func (s *Server) writeWSJSON(connection *websocket.Conn, value serverControl) bool {
	_ = connection.SetWriteDeadline(time.Now().Add(s.config.WebSocketWriteTimeout()))
	return connection.WriteJSON(value) == nil
}

func (s *Server) writeWSError(connection *websocket.Conn, code, message string, retryable bool) bool {
	return s.writeWSJSON(connection, serverControl{
		Type:      "error",
		Code:      code,
		Message:   message,
		Retryable: retryable,
	})
}

func (s *Server) writeWSServiceError(connection *websocket.Conn, err error) bool {
	switch {
	case errors.Is(err, service.ErrBusy):
		return s.writeWSError(connection, "server_busy", "too many active recordings", true)
	case errors.Is(err, service.ErrConflict):
		return s.writeWSError(connection, "recording_conflict", err.Error(), true)
	case errors.Is(err, service.ErrInvalidRequestID):
		return s.writeWSError(connection, "invalid_request_id", "requestId must contain 8 to 128 URL-safe characters", false)
	case errors.Is(err, service.ErrInvalidPCM):
		return s.writeWSError(connection, "invalid_pcm", "invalid PCM audio frame", false)
	case errors.Is(err, service.ErrTooShort):
		return s.writeWSError(connection, "recording_too_short", "recording is shorter than the configured minimum", false)
	case errors.Is(err, service.ErrTooLong):
		return s.writeWSError(connection, "recording_too_long", "recording exceeds the configured maximum", false)
	case service.IsClientError(err):
		return s.writeWSError(connection, "invalid_recording", err.Error(), false)
	default:
		s.logger.Printf("websocket voice service error: %v", err)
		return s.writeWSError(connection, "internal_error", "voice processing failed", true)
	}
}
