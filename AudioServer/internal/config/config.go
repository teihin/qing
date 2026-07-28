package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Config struct {
	Server   ServerConfig   `json:"server"`
	Audio    AudioConfig    `json:"audio"`
	Storage  StorageConfig  `json:"storage"`
	Security SecurityConfig `json:"security"`
	Limits   LimitsConfig   `json:"limits"`
}

type ServerConfig struct {
	HTTPAddress               string   `json:"http_address"`
	HTTPSAddress              string   `json:"https_address"`
	TLSCertFile               string   `json:"tls_cert_file"`
	TLSKeyFile                string   `json:"tls_key_file"`
	AllowedOrigins            []string `json:"allowed_origins"`
	ReadHeaderTimeoutSeconds  int      `json:"read_header_timeout_seconds"`
	IdleTimeoutSeconds        int      `json:"idle_timeout_seconds"`
	ShutdownTimeoutSeconds    int      `json:"shutdown_timeout_seconds"`
	WebSocketReadTimeoutSecs  int      `json:"websocket_read_timeout_seconds"`
	WebSocketWriteTimeoutSecs int      `json:"websocket_write_timeout_seconds"`
}

type AudioConfig struct {
	FFmpegPath    string `json:"ffmpeg_path"`
	SampleRate    int    `json:"sample_rate"`
	Channels      int    `json:"channels"`
	Bitrate       string `json:"bitrate"`
	MinDurationMS int64  `json:"min_duration_ms"`
	MaxDurationMS int64  `json:"max_duration_ms"`
	MaxFrameBytes int64  `json:"max_frame_bytes"`
}

type StorageConfig struct {
	RootDirectory         string `json:"root_directory"`
	RetentionHours        int    `json:"retention_hours"`
	CleanupIntervalMins   int    `json:"cleanup_interval_minutes"`
	PartialMaxAgeMinutes  int    `json:"partial_max_age_minutes"`
	MetadataDirectoryName string `json:"metadata_directory_name"`
}

type SecurityConfig struct {
	VoiceIDSecret string `json:"voice_id_secret"`
}

type LimitsConfig struct {
	MaxConnections      int `json:"max_connections"`
	MaxActiveRecordings int `json:"max_active_recordings"`
}

func Default() Config {
	return Config{
		Server: ServerConfig{
			HTTPAddress:               ":8080",
			AllowedOrigins:            []string{"*"},
			ReadHeaderTimeoutSeconds:  5,
			IdleTimeoutSeconds:        60,
			ShutdownTimeoutSeconds:    10,
			WebSocketReadTimeoutSecs:  20,
			WebSocketWriteTimeoutSecs: 5,
		},
		Audio: AudioConfig{
			FFmpegPath:    "ffmpeg",
			SampleRate:    16000,
			Channels:      1,
			Bitrate:       "24k",
			MinDurationMS: 300,
			MaxDurationMS: 10000,
			MaxFrameBytes: 32768,
		},
		Storage: StorageConfig{
			RootDirectory:         "./data",
			RetentionHours:        7 * 24,
			CleanupIntervalMins:   10,
			PartialMaxAgeMinutes:  15,
			MetadataDirectoryName: "metadata",
		},
		Limits: LimitsConfig{
			MaxConnections:      1000,
			MaxActiveRecordings: 100,
		},
	}
}

func Load(path string) (Config, error) {
	cfg := Default()
	baseDir, err := os.Getwd()
	if err != nil {
		return Config{}, fmt.Errorf("get working directory: %w", err)
	}

	if path != "" {
		data, readErr := os.ReadFile(path)
		if readErr != nil {
			return Config{}, fmt.Errorf("read config %q: %w", path, readErr)
		}
		if err := json.Unmarshal(data, &cfg); err != nil {
			return Config{}, fmt.Errorf("decode config %q: %w", path, err)
		}
		absPath, absErr := filepath.Abs(path)
		if absErr != nil {
			return Config{}, fmt.Errorf("resolve config path: %w", absErr)
		}
		baseDir = filepath.Dir(absPath)
	}

	applyEnvironment(&cfg)
	cfg.Storage.RootDirectory = resolvePath(baseDir, cfg.Storage.RootDirectory)
	cfg.Server.TLSCertFile = resolveOptionalPath(baseDir, cfg.Server.TLSCertFile)
	cfg.Server.TLSKeyFile = resolveOptionalPath(baseDir, cfg.Server.TLSKeyFile)

	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func applyEnvironment(cfg *Config) {
	setStringFromEnv(&cfg.Security.VoiceIDSecret, "AUDIO_SERVER_ID_SECRET")
	setStringFromEnv(&cfg.Server.HTTPAddress, "AUDIO_SERVER_HTTP_ADDR")
	setStringFromEnv(&cfg.Server.HTTPSAddress, "AUDIO_SERVER_HTTPS_ADDR")
	setStringFromEnv(&cfg.Server.TLSCertFile, "AUDIO_SERVER_TLS_CERT_FILE")
	setStringFromEnv(&cfg.Server.TLSKeyFile, "AUDIO_SERVER_TLS_KEY_FILE")
	setStringFromEnv(&cfg.Storage.RootDirectory, "AUDIO_SERVER_DATA_DIR")
	setStringFromEnv(&cfg.Audio.FFmpegPath, "AUDIO_SERVER_FFMPEG_PATH")
}

func setStringFromEnv(target *string, name string) {
	if value, ok := os.LookupEnv(name); ok {
		*target = value
	}
}

func resolvePath(baseDir, path string) string {
	if filepath.IsAbs(path) {
		return filepath.Clean(path)
	}
	return filepath.Clean(filepath.Join(baseDir, path))
}

func resolveOptionalPath(baseDir, path string) string {
	if strings.TrimSpace(path) == "" {
		return ""
	}
	return resolvePath(baseDir, path)
}

func (cfg Config) Validate() error {
	var problems []string

	if cfg.Server.HTTPAddress == "" && cfg.Server.HTTPSAddress == "" {
		problems = append(problems, "at least one of server.http_address or server.https_address is required")
	}
	if cfg.Server.HTTPSAddress != "" {
		if cfg.Server.TLSCertFile == "" || cfg.Server.TLSKeyFile == "" {
			problems = append(problems, "TLS certificate and key files are required when server.https_address is enabled")
		}
	}
	if cfg.Audio.SampleRate != 16000 {
		problems = append(problems, "audio.sample_rate must be 16000 in protocol version 1")
	}
	if cfg.Audio.Channels != 1 {
		problems = append(problems, "audio.channels must be 1 in protocol version 1")
	}
	if cfg.Audio.MinDurationMS <= 0 || cfg.Audio.MaxDurationMS <= cfg.Audio.MinDurationMS {
		problems = append(problems, "audio duration limits are invalid")
	}
	if cfg.Audio.MaxFrameBytes < 320 || cfg.Audio.MaxFrameBytes > 1<<20 {
		problems = append(problems, "audio.max_frame_bytes must be between 320 and 1048576")
	}
	if strings.TrimSpace(cfg.Audio.Bitrate) == "" {
		problems = append(problems, "audio.bitrate is required")
	}
	if strings.TrimSpace(cfg.Storage.RootDirectory) == "" {
		problems = append(problems, "storage.root_directory is required")
	}
	if cfg.Storage.RetentionHours <= 0 {
		problems = append(problems, "storage.retention_hours must be positive")
	}
	if cfg.Storage.CleanupIntervalMins <= 0 || cfg.Storage.PartialMaxAgeMinutes <= 0 {
		problems = append(problems, "storage cleanup intervals must be positive")
	}
	if len(cfg.Security.VoiceIDSecret) < 32 {
		problems = append(problems, "security.voice_id_secret must contain at least 32 characters")
	}
	if cfg.Limits.MaxConnections <= 0 || cfg.Limits.MaxActiveRecordings <= 0 {
		problems = append(problems, "connection and recording limits must be positive")
	}
	if cfg.Server.ReadHeaderTimeoutSeconds <= 0 ||
		cfg.Server.IdleTimeoutSeconds <= 0 ||
		cfg.Server.ShutdownTimeoutSeconds <= 0 ||
		cfg.Server.WebSocketReadTimeoutSecs <= 0 ||
		cfg.Server.WebSocketWriteTimeoutSecs <= 0 {
		problems = append(problems, "all server timeouts must be positive")
	}

	if len(problems) > 0 {
		return errors.New(strings.Join(problems, "; "))
	}
	return nil
}

func (cfg Config) ReadHeaderTimeout() time.Duration {
	return time.Duration(cfg.Server.ReadHeaderTimeoutSeconds) * time.Second
}

func (cfg Config) IdleTimeout() time.Duration {
	return time.Duration(cfg.Server.IdleTimeoutSeconds) * time.Second
}

func (cfg Config) ShutdownTimeout() time.Duration {
	return time.Duration(cfg.Server.ShutdownTimeoutSeconds) * time.Second
}

func (cfg Config) WebSocketReadTimeout() time.Duration {
	return time.Duration(cfg.Server.WebSocketReadTimeoutSecs) * time.Second
}

func (cfg Config) WebSocketWriteTimeout() time.Duration {
	return time.Duration(cfg.Server.WebSocketWriteTimeoutSecs) * time.Second
}

func (cfg Config) Retention() time.Duration {
	return time.Duration(cfg.Storage.RetentionHours) * time.Hour
}

func (cfg Config) CleanupInterval() time.Duration {
	return time.Duration(cfg.Storage.CleanupIntervalMins) * time.Minute
}

func (cfg Config) PartialMaxAge() time.Duration {
	return time.Duration(cfg.Storage.PartialMaxAgeMinutes) * time.Minute
}
