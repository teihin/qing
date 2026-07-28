package store

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"qing-audio-server/internal/model"
)

func TestFileStorageAndMetadataRoundTrip(t *testing.T) {
	root := t.TempDir()
	files, err := NewFileStorage(root)
	if err != nil {
		t.Fatal(err)
	}
	metadataStore, err := NewFileMetadataStore(filepath.Join(root, "metadata"))
	if err != nil {
		t.Fatal(err)
	}
	voiceID := strings.Repeat("a", 64)
	tempPath, err := files.NewTempPath(voiceID)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(tempPath, []byte("m4a-test"), 0o600); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Truncate(time.Second)
	key, err := files.Commit(tempPath, voiceID, now)
	if err != nil {
		t.Fatal(err)
	}
	metadata := model.VoiceMetadata{
		VoiceID:    voiceID,
		RequestID:  "request_0001",
		UserID:     "user-1",
		RoomID:     "room-1",
		StorageKey: key,
		Status:     model.VoiceStatusReady,
		CreatedAt:  now,
		ExpiresAt:  now.Add(time.Hour),
	}
	if err := metadataStore.Put(metadata); err != nil {
		t.Fatal(err)
	}
	loaded, err := metadataStore.Get(voiceID)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.StorageKey != key || loaded.RoomID != metadata.RoomID {
		t.Fatalf("metadata mismatch: %#v", loaded)
	}
	file, info, err := files.Open(key)
	if err != nil {
		t.Fatal(err)
	}
	_ = file.Close()
	if info.Size() != int64(len("m4a-test")) {
		t.Fatalf("file size = %d", info.Size())
	}
}

func TestExpiredMetadataIteration(t *testing.T) {
	root := t.TempDir()
	metadataStore, err := NewFileMetadataStore(root)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	expiredID := strings.Repeat("b", 64)
	futureID := strings.Repeat("c", 64)
	for _, metadata := range []model.VoiceMetadata{
		{VoiceID: expiredID, ExpiresAt: now.Add(-time.Minute)},
		{VoiceID: futureID, ExpiresAt: now.Add(time.Minute)},
	} {
		if err := metadataStore.Put(metadata); err != nil {
			t.Fatal(err)
		}
	}
	var found []string
	if err := metadataStore.ForEachExpired(now, func(metadata model.VoiceMetadata) error {
		found = append(found, metadata.VoiceID)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if len(found) != 1 || found[0] != expiredID {
		t.Fatalf("expired IDs = %#v", found)
	}
	if err := metadataStore.Delete(expiredID); err != nil {
		t.Fatal(err)
	}
	if _, err := metadataStore.Get(expiredID); !errors.Is(err, ErrMetadataNotFound) {
		t.Fatalf("expected missing metadata, got %v", err)
	}
}
