package config

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
)

type Config struct {
	HTTPAddr          string
	StaticDir         string
	UploadDir         string
	PublicBaseURL     string
	CookiePath        string
	CookieSecure      bool
	SessionTTL        time.Duration
	PlayerSessionTTL  time.Duration
	PlayerLinkTTL     time.Duration
	DBHost            string
	DBPort            string
	DBName            string
	DBUser            string
	DBPassword        string
	PlayerLinkKey     string
	BootstrapUser     string
	BootstrapPassword string
	BootstrapName     string
	MaxImageBytes     int64
	MaxVideoBytes     int64
	MaxFileBytes      int64
	AgentOfflineAfter time.Duration
	ConversationIdle  time.Duration
	MessageRetention  time.Duration
}

func Load() (Config, error) {
	secure, err := strconv.ParseBool(env("CHAT_COOKIE_SECURE", "false"))
	if err != nil {
		return Config{}, fmt.Errorf("CHAT_COOKIE_SECURE 必须是 true 或 false")
	}
	sessionTTL, err := duration("CHAT_AGENT_SESSION_TTL", "12h", 30*time.Minute, 7*24*time.Hour)
	if err != nil {
		return Config{}, err
	}
	playerTTL, err := duration("CHAT_PLAYER_SESSION_TTL", "24h", 30*time.Minute, 30*24*time.Hour)
	if err != nil {
		return Config{}, err
	}
	playerLinkTTL, err := duration("CHAT_PLAYER_LINK_TTL", "15m", time.Minute, 24*time.Hour)
	if err != nil {
		return Config{}, err
	}
	offlineAfter, err := duration("CHAT_AGENT_OFFLINE_AFTER", "90s", 30*time.Second, 10*time.Minute)
	if err != nil {
		return Config{}, err
	}
	idleAfter, err := duration("CHAT_CONVERSATION_IDLE", "24h", time.Hour, 30*24*time.Hour)
	if err != nil {
		return Config{}, err
	}
	messageRetention, err := duration("CHAT_MESSAGE_RETENTION", "48h", time.Hour, 365*24*time.Hour)
	if err != nil {
		return Config{}, err
	}
	baseURL := strings.TrimRight(env("CHAT_PUBLIC_BASE_URL", "http://127.0.0.1:8893"), "/")
	parsed, err := url.Parse(baseURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return Config{}, fmt.Errorf("CHAT_PUBLIC_BASE_URL 必须是有效的 http 或 https 地址")
	}
	if secure && parsed.Scheme != "https" {
		return Config{}, fmt.Errorf("CHAT_COOKIE_SECURE=true 时 CHAT_PUBLIC_BASE_URL 必须使用 https")
	}

	cfg := Config{
		HTTPAddr:          env("CHAT_HTTP_ADDR", "127.0.0.1:8893"),
		StaticDir:         filepath.Clean(env("CHAT_STATIC_DIR", "../web/dist")),
		UploadDir:         filepath.Clean(env("CHAT_UPLOAD_DIR", "../data/uploads")),
		PublicBaseURL:     baseURL,
		CookiePath:        publicPath(parsed.Path),
		CookieSecure:      secure,
		SessionTTL:        sessionTTL,
		PlayerSessionTTL:  playerTTL,
		PlayerLinkTTL:     playerLinkTTL,
		DBHost:            env("CHAT_DB_HOST", "127.0.0.1"),
		DBPort:            env("CHAT_DB_PORT", "3306"),
		DBName:            env("CHAT_DB_NAME", "webcm"),
		DBUser:            strings.TrimSpace(os.Getenv("CHAT_DB_USER")),
		DBPassword:        os.Getenv("CHAT_DB_PASSWORD"),
		PlayerLinkKey:     os.Getenv("CHAT_PLAYER_LINK_KEY"),
		BootstrapUser:     strings.TrimSpace(os.Getenv("CHAT_BOOTSTRAP_USERNAME")),
		BootstrapPassword: os.Getenv("CHAT_BOOTSTRAP_PASSWORD"),
		BootstrapName:     env("CHAT_BOOTSTRAP_NAME", "客服主管"),
		MaxImageBytes:     int64Value("CHAT_MAX_IMAGE_BYTES", 10<<20),
		MaxVideoBytes:     int64Value("CHAT_MAX_VIDEO_BYTES", 100<<20),
		MaxFileBytes:      int64Value("CHAT_MAX_FILE_BYTES", 25<<20),
		AgentOfflineAfter: offlineAfter,
		ConversationIdle:  idleAfter,
		MessageRetention:  messageRetention,
	}
	if cfg.DBUser == "" || cfg.DBPassword == "" {
		return Config{}, fmt.Errorf("必须通过运行环境提供 CHAT_DB_USER 和 CHAT_DB_PASSWORD")
	}
	if cfg.DBHost != "127.0.0.1" && cfg.DBHost != "localhost" {
		return Config{}, fmt.Errorf("CHAT_DB_HOST 只允许 127.0.0.1 或 localhost")
	}
	if cfg.DBName != "webcm" {
		return Config{}, fmt.Errorf("CHAT_DB_NAME 必须是 webcm")
	}
	if len(cfg.PlayerLinkKey) < 16 || len(cfg.PlayerLinkKey) > 128 {
		return Config{}, fmt.Errorf("CHAT_PLAYER_LINK_KEY 必须为 16 到 128 个字符")
	}
	if cfg.MaxImageBytes <= 0 || cfg.MaxVideoBytes <= 0 || cfg.MaxFileBytes <= 0 {
		return Config{}, fmt.Errorf("媒体文件大小上限必须大于 0")
	}
	return cfg, nil
}

func publicPath(value string) string {
	value = strings.TrimRight(value, "/")
	if value == "" {
		return "/"
	}
	return value
}

func (c Config) MySQLDSN() string {
	mc := mysql.NewConfig()
	mc.User = c.DBUser
	mc.Passwd = c.DBPassword
	mc.Net = "tcp"
	mc.Addr = c.DBHost + ":" + c.DBPort
	mc.DBName = c.DBName
	mc.ParseTime = true
	mc.Loc = time.Local
	mc.Timeout = 5 * time.Second
	mc.ReadTimeout = 15 * time.Second
	mc.WriteTimeout = 15 * time.Second
	mc.Collation = "utf8mb4_unicode_ci"
	return mc.FormatDSN()
}

func duration(name, fallback string, min, max time.Duration) (time.Duration, error) {
	value, err := time.ParseDuration(env(name, fallback))
	if err != nil || value < min || value > max {
		return 0, fmt.Errorf("%s 必须在 %s 到 %s 之间", name, min, max)
	}
	return value, nil
}

func int64Value(name string, fallback int64) int64 {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return -1
	}
	return parsed
}

func env(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}
