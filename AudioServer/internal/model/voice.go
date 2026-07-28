package model

import "time"

const VoiceStatusReady = "ready"

type VoiceMetadata struct {
	VoiceID    string    `json:"voiceId"`
	RequestID  string    `json:"requestId"`
	UserID     string    `json:"userId"`
	RoomID     string    `json:"roomId"`
	DurationMS int64     `json:"durationMs"`
	FileSize   int64     `json:"fileSize"`
	SHA256     string    `json:"sha256"`
	StorageKey string    `json:"storageKey"`
	Status     string    `json:"status"`
	CreatedAt  time.Time `json:"createdAt"`
	ExpiresAt  time.Time `json:"expiresAt"`
}

type PublicVoice struct {
	VoiceID    string    `json:"voiceId"`
	DurationMS int64     `json:"durationMs"`
	FileSize   int64     `json:"fileSize"`
	CreatedAt  time.Time `json:"createdAt"`
	ExpiresAt  time.Time `json:"expiresAt"`
}

func Public(meta VoiceMetadata) PublicVoice {
	return PublicVoice{
		VoiceID:    meta.VoiceID,
		DurationMS: meta.DurationMS,
		FileSize:   meta.FileSize,
		CreatedAt:  meta.CreatedAt,
		ExpiresAt:  meta.ExpiresAt,
	}
}
