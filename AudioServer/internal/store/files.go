package store

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type FileStorage struct {
	root       string
	tempRoot   string
	voicesRoot string
}

func NewFileStorage(root string) (*FileStorage, error) {
	storage := &FileStorage{
		root:       root,
		tempRoot:   filepath.Join(root, "tmp"),
		voicesRoot: filepath.Join(root, "voices"),
	}
	for _, directory := range []string{storage.root, storage.tempRoot, storage.voicesRoot} {
		if err := os.MkdirAll(directory, 0o750); err != nil {
			return nil, fmt.Errorf("create storage directory %q: %w", directory, err)
		}
	}
	return storage, nil
}

func (s *FileStorage) NewTempPath(voiceID string) (string, error) {
	if err := ValidateVoiceID(voiceID); err != nil {
		return "", err
	}
	suffix, err := randomHex(8)
	if err != nil {
		return "", err
	}
	return filepath.Join(s.tempRoot, voiceID+"-"+suffix+".m4a.part"), nil
}

func (s *FileStorage) Commit(tempPath, voiceID string, createdAt time.Time) (string, error) {
	if err := ValidateVoiceID(voiceID); err != nil {
		return "", err
	}
	cleanTemp := filepath.Clean(tempPath)
	relativeTemp, err := filepath.Rel(s.tempRoot, cleanTemp)
	if err != nil || relativeTemp == ".." || strings.HasPrefix(relativeTemp, ".."+string(filepath.Separator)) {
		return "", errors.New("temporary file is outside storage temp directory")
	}

	datePath := createdAt.UTC().Format("2006/01/02")
	relativeKey := filepath.Join("voices", datePath, voiceID[:2], voiceID[2:4], voiceID+".m4a")
	finalPath := filepath.Join(s.root, relativeKey)
	if err := os.MkdirAll(filepath.Dir(finalPath), 0o750); err != nil {
		return "", fmt.Errorf("create voice storage shard: %w", err)
	}
	if err := os.Rename(cleanTemp, finalPath); err != nil {
		return "", fmt.Errorf("commit voice file: %w", err)
	}
	return filepath.ToSlash(relativeKey), nil
}

func (s *FileStorage) Open(storageKey string) (*os.File, fs.FileInfo, error) {
	path, err := s.resolveKey(storageKey)
	if err != nil {
		return nil, nil, err
	}
	file, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil, os.ErrNotExist
	}
	if err != nil {
		return nil, nil, fmt.Errorf("open voice file: %w", err)
	}
	info, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return nil, nil, fmt.Errorf("stat voice file: %w", err)
	}
	return file, info, nil
}

func (s *FileStorage) Remove(storageKey string) error {
	path, err := s.resolveKey(storageKey)
	if err != nil {
		return err
	}
	err = os.Remove(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("remove voice file: %w", err)
	}
	return nil
}

func (s *FileStorage) RemoveTemp(path string) {
	cleanPath := filepath.Clean(path)
	if relative, err := filepath.Rel(s.tempRoot, cleanPath); err == nil &&
		relative != ".." &&
		!strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		_ = os.Remove(cleanPath)
	}
}

func (s *FileStorage) CleanupTemp(olderThan time.Time) (int, error) {
	removed := 0
	err := filepath.WalkDir(s.tempRoot, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.ModTime().Before(olderThan) {
			if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
			removed++
		}
		return nil
	})
	return removed, err
}

func (s *FileStorage) resolveKey(storageKey string) (string, error) {
	if strings.TrimSpace(storageKey) == "" {
		return "", errors.New("storage key is empty")
	}
	cleanKey := filepath.Clean(filepath.FromSlash(storageKey))
	if cleanKey == "." || filepath.IsAbs(cleanKey) ||
		cleanKey == ".." || strings.HasPrefix(cleanKey, ".."+string(filepath.Separator)) {
		return "", errors.New("invalid storage key")
	}
	if cleanKey != "voices" && !strings.HasPrefix(cleanKey, "voices"+string(filepath.Separator)) {
		return "", errors.New("storage key is outside voice directory")
	}
	path := filepath.Join(s.root, cleanKey)
	relative, err := filepath.Rel(s.root, path)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", errors.New("invalid storage key")
	}
	return path, nil
}
