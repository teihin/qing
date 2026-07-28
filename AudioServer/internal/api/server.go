package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"os"
	"path"
	"strings"
	"time"

	"qing-audio-server/internal/config"
	"qing-audio-server/internal/metrics"
	"qing-audio-server/internal/model"
	"qing-audio-server/internal/service"
	"qing-audio-server/internal/store"
)

type Server struct {
	config         config.Config
	voices         *service.VoiceService
	metrics        *metrics.Metrics
	logger         *log.Logger
	allowedOrigin  map[string]struct{}
	allowAnyOrigin bool
	connectionSem  chan struct{}
}

func NewServer(
	cfg config.Config,
	voices *service.VoiceService,
	serviceMetrics *metrics.Metrics,
	logger *log.Logger,
) *Server {
	server := &Server{
		config:        cfg,
		voices:        voices,
		metrics:       serviceMetrics,
		logger:        logger,
		allowedOrigin: make(map[string]struct{}),
		connectionSem: make(chan struct{}, cfg.Limits.MaxConnections),
	}
	for _, origin := range cfg.Server.AllowedOrigins {
		origin = strings.TrimSpace(origin)
		if origin == "*" {
			server.allowAnyOrigin = true
			continue
		}
		if origin != "" {
			server.allowedOrigin[origin] = struct{}{}
		}
	}
	return server
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.handleHealth)
	mux.HandleFunc("GET /readyz", s.handleHealth)
	mux.HandleFunc("GET /metrics", s.handleMetrics)
	mux.HandleFunc("GET /v1/files/{voiceID}", s.handleDownload)
	mux.HandleFunc("POST /v1/voices", s.handleFallbackUpload)
	mux.HandleFunc("/v1/stream", s.handleWebSocket)
	return s.recoverMiddleware(s.corsMiddleware(mux))
}

func (s *Server) handleHealth(writer http.ResponseWriter, _ *http.Request) {
	writeJSON(writer, http.StatusOK, map[string]any{
		"status": "ok",
		"time":   time.Now().UTC(),
	})
}

func (s *Server) handleMetrics(writer http.ResponseWriter, _ *http.Request) {
	writer.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	s.metrics.WritePrometheus(writer)
}

func (s *Server) handleFallbackUpload(writer http.ResponseWriter, request *http.Request) {
	mediaType, _, err := mime.ParseMediaType(request.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/octet-stream" {
		writeAPIError(writer, http.StatusUnsupportedMediaType, "unsupported_media_type", "Content-Type must be application/octet-stream")
		return
	}
	requestID := request.Header.Get("X-Request-ID")
	startResult, err := s.voices.Start(request.Context(), requestID)
	if err != nil {
		s.writeServiceError(writer, err)
		return
	}
	if startResult.Existing != nil {
		writeJSON(writer, http.StatusOK, responseEnvelope{
			OK:   true,
			Data: model.Public(*startResult.Existing),
		})
		return
	}

	recording := startResult.Recording
	finished := false
	defer func() {
		if !finished {
			recording.Abort()
		}
	}()

	maxBytes := s.voices.MaxPCMBytes()
	request.Body = http.MaxBytesReader(writer, request.Body, maxBytes)
	pcm, err := io.ReadAll(request.Body)
	if err != nil {
		if strings.Contains(err.Error(), "request body too large") {
			writeAPIError(writer, http.StatusRequestEntityTooLarge, "recording_too_long", "PCM body exceeds maximum recording duration")
		} else {
			writeAPIError(writer, http.StatusBadRequest, "read_failed", "failed to read PCM request body")
		}
		return
	}
	if len(pcm)%2 != 0 {
		writeAPIError(writer, http.StatusBadRequest, "invalid_pcm", "PCM body must contain complete signed 16-bit samples")
		return
	}

	frameSize := int(s.voices.MaxFrameBytes())
	if frameSize%2 != 0 {
		frameSize--
	}
	var sequence uint32
	var consumed int
	bytesPerSecond := s.voices.SampleRate() * s.voices.Channels() * 2
	for consumed < len(pcm) {
		end := min(consumed+frameSize, len(pcm))
		timestampMS := uint64(int64(consumed) * 1000 / int64(bytesPerSecond))
		if err := recording.WriteFrame(sequence, timestampMS, pcm[consumed:end]); err != nil {
			s.writeServiceError(writer, err)
			return
		}
		consumed = end
		sequence++
	}

	metadata, err := recording.Finish()
	finished = true
	if err != nil {
		s.writeServiceError(writer, err)
		return
	}
	writeJSON(writer, http.StatusCreated, responseEnvelope{
		OK:   true,
		Data: model.Public(metadata),
	})
}

func (s *Server) handleDownload(writer http.ResponseWriter, request *http.Request) {
	voiceID := request.PathValue("voiceID")
	if err := store.ValidateVoiceID(voiceID); err != nil {
		writeAPIError(writer, http.StatusNotFound, "not_found", "voice was not found")
		return
	}
	metadata, err := s.voices.Get(voiceID)
	if errors.Is(err, store.ErrMetadataNotFound) {
		writeAPIError(writer, http.StatusNotFound, "not_found", "voice was not found")
		return
	}
	if err != nil {
		s.logger.Printf("download metadata error voice_id=%s error=%v", voiceID, err)
		writeAPIError(writer, http.StatusInternalServerError, "internal_error", "failed to read voice metadata")
		return
	}

	etag := `"` + metadata.SHA256 + `"`
	if request.Header.Get("If-None-Match") == etag {
		writer.WriteHeader(http.StatusNotModified)
		return
	}
	file, info, err := s.voices.Open(metadata)
	if errors.Is(err, os.ErrNotExist) {
		writeAPIError(writer, http.StatusNotFound, "not_found", "voice was not found")
		return
	}
	if err != nil {
		s.logger.Printf("download file error voice_id=%s error=%v", voiceID, err)
		writeAPIError(writer, http.StatusInternalServerError, "internal_error", "failed to open voice file")
		return
	}
	defer file.Close()

	writer.Header().Set("Content-Type", "audio/mp4")
	writer.Header().Set("Cache-Control", "private, max-age=300")
	writer.Header().Set("ETag", etag)
	writer.Header().Set("X-Content-Type-Options", "nosniff")
	writer.Header().Set("Content-Disposition", fmt.Sprintf(`inline; filename="%s.m4a"`, voiceID))
	http.ServeContent(writer, request, path.Base(info.Name()), metadata.CreatedAt, file)
}

func (s *Server) writeServiceError(writer http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, service.ErrBusy):
		writeAPIError(writer, http.StatusServiceUnavailable, "server_busy", "too many active recordings")
	case errors.Is(err, service.ErrConflict):
		writeAPIError(writer, http.StatusConflict, "recording_conflict", err.Error())
	case errors.Is(err, service.ErrInvalidRequestID):
		writeAPIError(writer, http.StatusBadRequest, "invalid_request_id", "X-Request-ID must contain 8 to 128 URL-safe characters")
	case errors.Is(err, service.ErrInvalidPCM):
		writeAPIError(writer, http.StatusBadRequest, "invalid_pcm", "invalid PCM audio frame")
	case errors.Is(err, service.ErrTooShort):
		writeAPIError(writer, http.StatusUnprocessableEntity, "recording_too_short", "recording is shorter than the configured minimum")
	case errors.Is(err, service.ErrTooLong):
		writeAPIError(writer, http.StatusRequestEntityTooLarge, "recording_too_long", "recording exceeds the configured maximum")
	case service.IsClientError(err):
		writeAPIError(writer, http.StatusBadRequest, "invalid_recording", err.Error())
	default:
		s.logger.Printf("voice service error: %v", err)
		writeAPIError(writer, http.StatusInternalServerError, "internal_error", "voice processing failed")
	}
}

func (s *Server) corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		origin := request.Header.Get("Origin")
		if origin != "" && s.originAllowed(origin) {
			writer.Header().Set("Access-Control-Allow-Origin", origin)
			writer.Header().Set("Vary", "Origin")
			writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Request-ID")
			writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			writer.Header().Set("Access-Control-Expose-Headers", "ETag, Content-Length, Content-Range")
			writer.Header().Set("Access-Control-Max-Age", "600")
		}
		if request.Method == http.MethodOptions {
			if origin != "" && !s.originAllowed(origin) {
				writeAPIError(writer, http.StatusForbidden, "origin_denied", "origin is not allowed")
				return
			}
			writer.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(writer, request)
	})
}

func (s *Server) recoverMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				s.logger.Printf("panic method=%s path=%s error=%v", request.Method, request.URL.Path, recovered)
				writeAPIError(writer, http.StatusInternalServerError, "internal_error", "internal server error")
			}
		}()
		next.ServeHTTP(writer, request)
	})
}

func (s *Server) originAllowed(origin string) bool {
	if s.allowAnyOrigin {
		return true
	}
	_, allowed := s.allowedOrigin[origin]
	return allowed
}

type responseEnvelope struct {
	OK    bool      `json:"ok"`
	Data  any       `json:"data,omitempty"`
	Error *apiError `json:"error,omitempty"`
}

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeAPIError(writer http.ResponseWriter, status int, code, message string) {
	writeJSONStatus(writer, status, responseEnvelope{
		OK: false,
		Error: &apiError{
			Code:    code,
			Message: message,
		},
	})
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writeJSONStatus(writer, status, value)
}

func writeJSONStatus(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	writer.Header().Set("X-Content-Type-Options", "nosniff")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}
