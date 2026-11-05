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
	GameDBHost        string
	GameDBPort        string
	GameDBName        string
	GameDBUser        string
	GameDBPassword    string
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

	// 俱乐部 1 对 1 私聊（direct chat）配置。
	DirectSessionTTL     time.Duration
	DirectRetention      time.Duration
	DirectTicketKey      string
	DirectMediaBaseURL   string
	DirectAudioBaseURL   string
	DirectMinVoiceMS     int
	DirectMaxVoiceMS     int
	DirectAllowDevLogin  bool
	DirectMediaTicketTTL time.Duration
	DirectCORSOrigins    []string

	// 后台服务通道：客服托管上下分只调用 XuanManager，不直接访问游戏管理通道。
	XuanManagerURL   string
	XuanServiceToken string
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
	// 直聊保留期独立于客服的 48 小时强清，默认 30 天。
	directRetention, err := duration("CHAT_DIRECT_RETENTION", "720h", time.Hour, 365*24*time.Hour)
	if err != nil {
		return Config{}, err
	}
	directSessionTTL, err := duration("CHAT_DIRECT_SESSION_TTL", "168h", 30*time.Minute, 30*24*time.Hour)
	if err != nil {
		return Config{}, err
	}
	directMediaTTL, err := duration("CHAT_DIRECT_MEDIA_TICKET_TTL", "10m", time.Minute, 24*time.Hour)
	if err != nil {
		return Config{}, err
	}
	directDevLogin, err := strconv.ParseBool(env("CHAT_DIRECT_ALLOW_DEV_LOGIN", "false"))
	if err != nil {
		return Config{}, fmt.Errorf("CHAT_DIRECT_ALLOW_DEV_LOGIN 必须是 true 或 false")
	}
	directCORSOrigins, err := originList("CHAT_DIRECT_CORS_ORIGINS", "http://localhost:7456,http://127.0.0.1:7456,https://154-37-155-17.nip.io")
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
		GameDBHost:        env("CHAT_GAME_DB_HOST", "127.0.0.1"),
		GameDBPort:        env("CHAT_GAME_DB_PORT", "3306"),
		GameDBName:        env("CHAT_GAME_DB_NAME", "kbedm"),
		GameDBUser:        strings.TrimSpace(os.Getenv("CHAT_GAME_DB_USER")),
		GameDBPassword:    os.Getenv("CHAT_GAME_DB_PASSWORD"),
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

		DirectSessionTTL:     directSessionTTL,
		DirectRetention:      directRetention,
		DirectTicketKey:      os.Getenv("CHAT_DIRECT_TICKET_KEY"),
		DirectMediaBaseURL:   baseURL,
		DirectAudioBaseURL:   env("CHAT_DIRECT_AUDIO_BASE_URL", "http://154.37.155.17/audio"),
		DirectMinVoiceMS:     int(int64Value("CHAT_DIRECT_MIN_VOICE_MS", 300)),
		DirectMaxVoiceMS:     int(int64Value("CHAT_DIRECT_MAX_VOICE_MS", 10000)),
		DirectAllowDevLogin:  directDevLogin,
		DirectMediaTicketTTL: directMediaTTL,
		DirectCORSOrigins:    directCORSOrigins,
		XuanManagerURL:       env("CHAT_XUAN_MANAGER_URL", "http://127.0.0.1:8891"),
		XuanServiceToken:     strings.TrimSpace(os.Getenv("CHAT_XUAN_SERVICE_TOKEN")),
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
	if cfg.GameDBUser == "" || cfg.GameDBPassword == "" {
		return Config{}, fmt.Errorf("必须通过运行环境提供 CHAT_GAME_DB_USER 和 CHAT_GAME_DB_PASSWORD")
	}
	if cfg.GameDBHost != "127.0.0.1" && cfg.GameDBHost != "localhost" {
		return Config{}, fmt.Errorf("CHAT_GAME_DB_HOST 只允许 127.0.0.1 或 localhost")
	}
	if cfg.GameDBName != "kbedm" {
		return Config{}, fmt.Errorf("CHAT_GAME_DB_NAME 必须是 kbedm")
	}
	if len(cfg.PlayerLinkKey) < 16 || len(cfg.PlayerLinkKey) > 128 {
		return Config{}, fmt.Errorf("CHAT_PLAYER_LINK_KEY 必须为 16 到 128 个字符")
	}
	if cfg.MaxImageBytes <= 0 || cfg.MaxVideoBytes <= 0 || cfg.MaxFileBytes <= 0 {
		return Config{}, fmt.Errorf("媒体文件大小上限必须大于 0")
	}
	// 直聊票据密钥缺失时直聊整体不可用（返回 DIRECT_AUTH_REQUIRED），
	// 绝不能退化为信任客户端自报的 guuid。
	if cfg.DirectTicketKey != "" && len(cfg.DirectTicketKey) < 16 {
		return Config{}, fmt.Errorf("CHAT_DIRECT_TICKET_KEY 至少需要 16 个字符")
	}
	if cfg.DirectMaxVoiceMS <= cfg.DirectMinVoiceMS {
		return Config{}, fmt.Errorf("CHAT_DIRECT_MAX_VOICE_MS 必须大于 CHAT_DIRECT_MIN_VOICE_MS")
	}
	if err := validateXuanManagerURL(cfg.XuanManagerURL); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// validateXuanManagerURL 只允许本机后台服务，ChatTool 不直接访问游戏管理通道。
func validateXuanManagerURL(raw string) error {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme != "http" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return fmt.Errorf("CHAT_XUAN_MANAGER_URL 必须是完整的本机 HTTP 地址")
	}
	if parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost" {
		return fmt.Errorf("CHAT_XUAN_MANAGER_URL 只允许 127.0.0.1 或 localhost")
	}
	if parsed.Port() != "8891" {
		return fmt.Errorf("CHAT_XUAN_MANAGER_URL 必须使用本机 8891 端口")
	}
	if parsed.Path != "" && parsed.Path != "/" {
		return fmt.Errorf("CHAT_XUAN_MANAGER_URL 不能包含路径")
	}
	return nil
}

func publicPath(value string) string {
	value = strings.TrimRight(value, "/")
	if value == "" {
		return "/"
	}
	return value
}

func originList(name, fallback string) ([]string, error) {
	value := env(name, fallback)
	items := strings.Split(value, ",")
	origins := make([]string, 0, len(items))
	for _, item := range items {
		origin := strings.TrimSpace(item)
		if origin == "" {
			continue
		}
		parsed, err := url.Parse(origin)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
			return nil, fmt.Errorf("%s 包含无效来源：%s；必须是完整的 http 或 https 源，如 http://localhost:7456", name, origin)
		}
		origins = append(origins, parsed.Scheme+"://"+parsed.Host)
	}
	if len(origins) == 0 {
		return nil, fmt.Errorf("%s 至少需要配置一个来源", name)
	}
	return origins, nil
}

func (c Config) MySQLDSN() string {
	return c.mysqlDSN(c.DBUser, c.DBPassword, c.DBHost, c.DBPort, c.DBName)
}

// GameMySQLDSN 连接游戏库；直聊只使用该连接执行 SELECT。
func (c Config) GameMySQLDSN() string {
	return c.mysqlDSN(c.GameDBUser, c.GameDBPassword, c.GameDBHost, c.GameDBPort, c.GameDBName)
}

func (c Config) mysqlDSN(user, password, host, port, name string) string {
	mc := mysql.NewConfig()
	mc.User = user
	mc.Passwd = password
	mc.Net = "tcp"
	mc.Addr = host + ":" + port
	mc.DBName = name
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
