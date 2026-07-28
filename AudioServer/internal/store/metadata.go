package store

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"qing-audio-server/internal/model"
)

var ErrMetadataNotFound = errors.New("voice metadata not found")

type MetadataStore interface {
	Get(voiceID string) (model.VoiceMetadata, error)
	Put(metadata model.VoiceMetadata) error
	Delete(voiceID string) error
	ForEachExpired(now time.Time, fn func(model.VoiceMetadata) error) error
}

type FileMetadataStore struct {
	root string
}

func NewFileMetadataStore(root string) (*FileMetadataStore, error) {
	if err := os.MkdirAll(root, 0o750); err != nil {
		return nil, fmt.Errorf("create metadata directory: %w", err)
	}
	return &FileMetadataStore{root: root}, nil
}

func (s *FileMetadataStore) Get(voiceID string) (model.VoiceMetadata, error) {
	path, err := s.pathFor(voiceID)
	if err != nil {
		return model.VoiceMetadata{}, err
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return model.VoiceMetadata{}, ErrMetadataNotFound
	}
	if err != nil {
		return model.VoiceMetadata{}, fmt.Errorf("read voice metadata: %w", err)
	}
	var metadata model.VoiceMetadata
	if err := json.Unmarshal(data, &metadata); err != nil {
		return model.VoiceMetadata{}, fmt.Errorf("decode voice metadata: %w", err)
	}
	if metadata.VoiceID != voiceID {
		return model.VoiceMetadata{}, errors.New("voice metadata ID mismatch")
	}
	return metadata, nil
}

func (s *FileMetadataStore) Put(metadata model.VoiceMetadata) error {
	path, err := s.pathFor(metadata.VoiceID)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return fmt.Errorf("create metadata shard: %w", err)
	}

	randomSuffix, err := randomHex(8)
	if err != nil {
		return err
	}
	tempPath := path + "." + randomSuffix + ".tmp"
	file, err := os.OpenFile(tempPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("create metadata temp file: %w", err)
	}

	encoder := json.NewEncoder(file)
	encoder.SetIndent("", "  ")
	writeErr := encoder.Encode(metadata)
	if writeErr == nil {
		writeErr = file.Sync()
	}
	closeErr := file.Close()
	if writeErr != nil {
		_ = os.Remove(tempPath)
		return fmt.Errorf("write voice metadata: %w", writeErr)
	}
	if closeErr != nil {
		_ = os.Remove(tempPath)
		return fmt.Errorf("close voice metadata: %w", closeErr)
	}
	if err := os.Rename(tempPath, path); err != nil {
		_ = os.Remove(tempPath)
		return fmt.Errorf("commit voice metadata: %w", err)
	}
	return nil
}

func (s *FileMetadataStore) Delete(voiceID string) error {
	path, err := s.pathFor(voiceID)
	if err != nil {
		return err
	}
	err = os.Remove(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("delete voice metadata: %w", err)
	}
	return nil
}

func (s *FileMetadataStore) ForEachExpired(now time.Time, fn func(model.VoiceMetadata) error) error {
	return filepath.WalkDir(s.root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("read metadata during cleanup: %w", err)
		}
		var metadata model.VoiceMetadata
		if err := json.Unmarshal(data, &metadata); err != nil {
			return fmt.Errorf("decode metadata during cleanup: %w", err)
		}
		if !metadata.ExpiresAt.After(now) {
			return fn(metadata)
		}
		return nil
	})
}

func (s *FileMetadataStore) pathFor(voiceID string) (string, error) {
	if err := ValidateVoiceID(voiceID); err != nil {
		return "", err
	}
	return filepath.Join(s.root, voiceID[:2], voiceID[2:4], voiceID+".json"), nil
}

func ValidateVoiceID(voiceID string) error {
	if len(voiceID) != 64 {
		return errors.New("voice ID must contain exactly 64 hexadecimal characters")
	}
	if _, err := hex.DecodeString(voiceID); err != nil {
		return errors.New("voice ID must contain exactly 64 hexadecimal characters")
	}
	return nil
}

func randomHex(byteCount int) (string, error) {
	value := make([]byte, byteCount)
	if _, err := rand.Read(value); err != nil {
		return "", fmt.Errorf("generate random value: %w", err)
	}
	return hex.EncodeToString(value), nil
}
