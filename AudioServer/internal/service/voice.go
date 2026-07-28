package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"
	"time"

	"qing-audio-server/internal/audio"
	"qing-audio-server/internal/auth"
	"qing-audio-server/internal/metrics"
	"qing-audio-server/internal/model"
	"qing-audio-server/internal/store"
)

var (
	ErrBusy             = errors.New("voice server is busy")
	ErrConflict         = errors.New("recording request is already active")
	ErrUserRecording    = errors.New("user already has an active recording")
	ErrInvalidRequestID = errors.New("invalid request ID")
	ErrInvalidPCM       = errors.New("invalid PCM audio")
	ErrTooShort         = errors.New("recording is too short")
	ErrTooLong          = errors.New("recording exceeds maximum duration")
	ErrSequence         = errors.New("audio frame sequence mismatch")
	ErrTimestamp        = errors.New("audio frame timestamp moved backwards")
	ErrForbidden        = errors.New("voice does not belong to this room")
)

type Config struct {
	SampleRate          int
	Channels            int
	MinDurationMS       int64
	MaxDurationMS       int64
	MaxFrameBytes       int64
	Retention           time.Duration
	MaxActiveRecordings int
	IDSecret            string
}

type VoiceService struct {
	config       Config
	encoder      audio.EncoderFactory
	files        *store.FileStorage
	metadata     store.MetadataStore
	metrics      *metrics.Metrics
	recordingSem chan struct{}

	mu          sync.Mutex
	activeVoice map[string]struct{}
	activeUser  map[string]struct{}
}

type StartResult struct {
	Recording *Recording
	Existing  *model.VoiceMetadata
}

func NewVoiceService(
	config Config,
	encoder audio.EncoderFactory,
	files *store.FileStorage,
	metadata store.MetadataStore,
	serviceMetrics *metrics.Metrics,
) (*VoiceService, error) {
	if len(config.IDSecret) < 32 {
		return nil, errors.New("voice ID secret must contain at least 32 characters")
	}
	if config.SampleRate <= 0 || config.Channels != 1 {
		return nil, errors.New("invalid audio service format")
	}
	if config.MaxActiveRecordings <= 0 {
		return nil, errors.New("max active recordings must be positive")
	}
	return &VoiceService{
		config:       config,
		encoder:      encoder,
		files:        files,
		metadata:     metadata,
		metrics:      serviceMetrics,
		recordingSem: make(chan struct{}, config.MaxActiveRecordings),
		activeVoice:  make(map[string]struct{}),
		activeUser:   make(map[string]struct{}),
	}, nil
}

func (s *VoiceService) Start(ctx context.Context, claims auth.Claims, requestID string) (StartResult, error) {
	if err := validateRequestID(requestID); err != nil {
		return StartResult{}, err
	}
	voiceID := s.deriveVoiceID(claims.UserID, claims.RoomID, requestID)

	existing, err := s.metadata.Get(voiceID)
	if err == nil {
		if existing.Status == model.VoiceStatusReady && existing.ExpiresAt.After(time.Now().UTC()) {
			return StartResult{Existing: &existing}, nil
		}
		_ = s.files.Remove(existing.StorageKey)
		_ = s.metadata.Delete(voiceID)
	} else if !errors.Is(err, store.ErrMetadataNotFound) {
		return StartResult{}, err
	}

	select {
	case s.recordingSem <- struct{}{}:
	default:
		return StartResult{}, ErrBusy
	}

	if err := s.acquire(voiceID, claims.UserID); err != nil {
		<-s.recordingSem
		return StartResult{}, err
	}

	tempPath, err := s.files.NewTempPath(voiceID)
	if err != nil {
		s.release(voiceID, claims.UserID)
		<-s.recordingSem
		return StartResult{}, err
	}
	encoder, err := s.encoder.Start(ctx, tempPath)
	if err != nil {
		s.release(voiceID, claims.UserID)
		<-s.recordingSem
		s.files.RemoveTemp(tempPath)
		return StartResult{}, err
	}

	s.metrics.RecordingStarted()
	return StartResult{
		Recording: &Recording{
			service:   s,
			claims:    claims,
			requestID: requestID,
			voiceID:   voiceID,
			tempPath:  tempPath,
			encoder:   encoder,
			nextSeq:   0,
		},
	}, nil
}

func (s *VoiceService) GetForRoom(voiceID, roomID string) (model.VoiceMetadata, error) {
	metadata, err := s.metadata.Get(voiceID)
	if err != nil {
		return model.VoiceMetadata{}, err
	}
	if metadata.Status != model.VoiceStatusReady || !metadata.ExpiresAt.After(time.Now().UTC()) {
		return model.VoiceMetadata{}, store.ErrMetadataNotFound
	}
	if metadata.RoomID != roomID {
		return model.VoiceMetadata{}, ErrForbidden
	}
	return metadata, nil
}

func (s *VoiceService) Open(metadata model.VoiceMetadata) (*os.File, os.FileInfo, error) {
	return s.files.Open(metadata.StorageKey)
}

func (s *VoiceService) MaxPCMBytes() int64 {
	return s.maxPCMBytes()
}

func (s *VoiceService) MaxFrameBytes() int64 {
	return s.config.MaxFrameBytes
}

func (s *VoiceService) SampleRate() int {
	return s.config.SampleRate
}

func (s *VoiceService) Channels() int {
	return s.config.Channels
}

func (s *VoiceService) Cleanup(now time.Time, partialMaxAge time.Duration) (deletedVoices, deletedPartials int, err error) {
	err = s.metadata.ForEachExpired(now, func(metadata model.VoiceMetadata) error {
		if err := s.files.Remove(metadata.StorageKey); err != nil {
			return err
		}
		if err := s.metadata.Delete(metadata.VoiceID); err != nil {
			return err
		}
		deletedVoices++
		return nil
	})
	if err != nil {
		return deletedVoices, deletedPartials, err
	}
	deletedPartials, err = s.files.CleanupTemp(now.Add(-partialMaxAge))
	s.metrics.AddDeletedVoices(deletedVoices)
	return deletedVoices, deletedPartials, err
}

func (s *VoiceService) acquire(voiceID, userID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.activeVoice[voiceID]; exists {
		return ErrConflict
	}
	if _, exists := s.activeUser[userID]; exists {
		return ErrUserRecording
	}
	s.activeVoice[voiceID] = struct{}{}
	s.activeUser[userID] = struct{}{}
	return nil
}

func (s *VoiceService) release(voiceID, userID string) {
	s.mu.Lock()
	delete(s.activeVoice, voiceID)
	delete(s.activeUser, userID)
	s.mu.Unlock()
}

func (s *VoiceService) deriveVoiceID(userID, roomID, requestID string) string {
	mac := hmac.New(sha256.New, []byte(s.config.IDSecret))
	_, _ = io.WriteString(mac, "qing-voice-v1\x00")
	_, _ = io.WriteString(mac, userID)
	_, _ = io.WriteString(mac, "\x00")
	_, _ = io.WriteString(mac, roomID)
	_, _ = io.WriteString(mac, "\x00")
	_, _ = io.WriteString(mac, requestID)
	return hex.EncodeToString(mac.Sum(nil))
}

func validateRequestID(requestID string) error {
	if len(requestID) < 8 || len(requestID) > 128 {
		return ErrInvalidRequestID
	}
	for _, character := range requestID {
		if (character >= 'a' && character <= 'z') ||
			(character >= 'A' && character <= 'Z') ||
			(character >= '0' && character <= '9') ||
			character == '-' ||
			character == '_' {
			continue
		}
		return ErrInvalidRequestID
	}
	return nil
}

type Recording struct {
	mu            sync.Mutex
	service       *VoiceService
	claims        auth.Claims
	requestID     string
	voiceID       string
	tempPath      string
	encoder       audio.Encoder
	pcmBytes      int64
	nextSeq       uint32
	lastTimestamp uint64
	hasTimestamp  bool
	closed        bool
}

func (r *Recording) VoiceID() string {
	return r.voiceID
}

func (r *Recording) WriteFrame(sequence uint32, timestampMS uint64, payload []byte) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return errors.New("recording is closed")
	}
	if sequence != r.nextSeq {
		return fmt.Errorf("%w: expected %d, received %d", ErrSequence, r.nextSeq, sequence)
	}
	if r.hasTimestamp && timestampMS < r.lastTimestamp {
		return ErrTimestamp
	}
	if len(payload) == 0 || int64(len(payload)) > r.service.config.MaxFrameBytes || len(payload)%2 != 0 {
		return ErrInvalidPCM
	}
	maxPCMBytes := r.service.maxPCMBytes()
	if r.pcmBytes+int64(len(payload)) > maxPCMBytes {
		return ErrTooLong
	}
	if err := r.encoder.WritePCM(payload); err != nil {
		return err
	}
	r.pcmBytes += int64(len(payload))
	r.nextSeq++
	r.lastTimestamp = timestampMS
	r.hasTimestamp = true
	r.service.metrics.AddPCMBytes(len(payload))
	return nil
}

func (r *Recording) Finish() (metadata model.VoiceMetadata, err error) {
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		return model.VoiceMetadata{}, errors.New("recording is closed")
	}
	r.closed = true
	pcmBytes := r.pcmBytes
	r.mu.Unlock()

	defer r.release()
	durationMS := r.service.durationMS(pcmBytes)
	if durationMS < r.service.config.MinDurationMS {
		r.encoder.Abort()
		r.service.files.RemoveTemp(r.tempPath)
		r.service.metrics.UploadFailed()
		return model.VoiceMetadata{}, ErrTooShort
	}
	if durationMS > r.service.config.MaxDurationMS {
		r.encoder.Abort()
		r.service.files.RemoveTemp(r.tempPath)
		r.service.metrics.UploadFailed()
		return model.VoiceMetadata{}, ErrTooLong
	}
	if err := r.encoder.Finish(); err != nil {
		r.service.files.RemoveTemp(r.tempPath)
		r.service.metrics.UploadFailed()
		return model.VoiceMetadata{}, err
	}

	fileSize, checksum, err := inspectFile(r.tempPath)
	if err != nil {
		r.service.files.RemoveTemp(r.tempPath)
		r.service.metrics.UploadFailed()
		return model.VoiceMetadata{}, err
	}

	createdAt := time.Now().UTC()
	storageKey, err := r.service.files.Commit(r.tempPath, r.voiceID, createdAt)
	if err != nil {
		r.service.files.RemoveTemp(r.tempPath)
		r.service.metrics.UploadFailed()
		return model.VoiceMetadata{}, err
	}
	metadata = model.VoiceMetadata{
		VoiceID:    r.voiceID,
		RequestID:  r.requestID,
		UserID:     r.claims.UserID,
		RoomID:     r.claims.RoomID,
		DurationMS: durationMS,
		FileSize:   fileSize,
		SHA256:     checksum,
		StorageKey: storageKey,
		Status:     model.VoiceStatusReady,
		CreatedAt:  createdAt,
		ExpiresAt:  createdAt.Add(r.service.config.Retention),
	}
	if err := r.service.metadata.Put(metadata); err != nil {
		_ = r.service.files.Remove(storageKey)
		r.service.metrics.UploadFailed()
		return model.VoiceMetadata{}, err
	}

	r.service.metrics.UploadSucceeded()
	return metadata, nil
}

func (r *Recording) Abort() {
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		return
	}
	r.closed = true
	r.mu.Unlock()

	r.encoder.Abort()
	r.service.files.RemoveTemp(r.tempPath)
	r.service.metrics.UploadFailed()
	r.release()
}

func (r *Recording) release() {
	r.service.release(r.voiceID, r.claims.UserID)
	<-r.service.recordingSem
	r.service.metrics.RecordingStopped()
}

func (s *VoiceService) maxPCMBytes() int64 {
	return s.config.MaxDurationMS * int64(s.config.SampleRate*s.config.Channels*2) / 1000
}

func (s *VoiceService) durationMS(pcmBytes int64) int64 {
	bytesPerSecond := int64(s.config.SampleRate * s.config.Channels * 2)
	return pcmBytes * 1000 / bytesPerSecond
}

func inspectFile(path string) (int64, string, error) {
	file, err := os.Open(path)
	if err != nil {
		return 0, "", fmt.Errorf("open encoded voice file: %w", err)
	}
	defer file.Close()

	hasher := sha256.New()
	size, err := io.Copy(hasher, file)
	if err != nil {
		return 0, "", fmt.Errorf("hash encoded voice file: %w", err)
	}
	if size <= 0 {
		return 0, "", errors.New("encoded voice file is empty")
	}
	return size, hex.EncodeToString(hasher.Sum(nil)), nil
}

func IsClientError(err error) bool {
	return errors.Is(err, ErrInvalidRequestID) ||
		errors.Is(err, ErrInvalidPCM) ||
		errors.Is(err, ErrTooShort) ||
		errors.Is(err, ErrTooLong) ||
		errors.Is(err, ErrSequence) ||
		errors.Is(err, ErrTimestamp) ||
		errors.Is(err, ErrConflict) ||
		errors.Is(err, ErrUserRecording) ||
		strings.Contains(err.Error(), "recording is closed")
}
