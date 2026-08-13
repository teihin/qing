package config

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
)

type Config struct {
	HTTPAddr                   string
	StaticDir                  string
	CookieSecure               bool
	SessionTTL                 time.Duration
	DBHost                     string
	DBPort                     string
	DBName                     string
	DBUser                     string
	DBPassword                 string
	GameDBHost                 string
	GameDBPort                 string
	GameDBName                 string
	GameDBUser                 string
	GameDBPassword             string
	GameAdminURL               string
	GameExchangeSign           string
	NotificationCarouselWorker bool
	BootstrapAdminUser         string
	BootstrapAdminPass         string
	BootstrapAdminName         string
}

func Load() (Config, error) {
	ttl, err := time.ParseDuration(env("XUAN_SESSION_TTL", "8h"))
	if err != nil || ttl < 30*time.Minute || ttl > 7*24*time.Hour {
		return Config{}, fmt.Errorf("XUAN_SESSION_TTL 必须在 30m 到 168h 之间")
	}

	secure, err := strconv.ParseBool(env("XUAN_COOKIE_SECURE", "false"))
	if err != nil {
		return Config{}, fmt.Errorf("XUAN_COOKIE_SECURE 必须是 true 或 false")
	}

	carouselWorker, err := strconv.ParseBool(env("XUAN_NOTIFICATION_CAROUSEL_WORKER", "false"))
	if err != nil {
		return Config{}, fmt.Errorf("XUAN_NOTIFICATION_CAROUSEL_WORKER 必须是 true 或 false")
	}

	cfg := Config{
		HTTPAddr:                   env("XUAN_HTTP_ADDR", "127.0.0.1:8891"),
		StaticDir:                  env("XUAN_STATIC_DIR", "../web/dist"),
		CookieSecure:               secure,
		SessionTTL:                 ttl,
		DBHost:                     env("XUAN_DB_HOST", "127.0.0.1"),
		DBPort:                     env("XUAN_DB_PORT", "3306"),
		DBName:                     env("XUAN_DB_NAME", "webcm"),
		DBUser:                     strings.TrimSpace(os.Getenv("XUAN_DB_USER")),
		DBPassword:                 os.Getenv("XUAN_DB_PASSWORD"),
		GameDBHost:                 env("XUAN_GAME_DB_HOST", "127.0.0.1"),
		GameDBPort:                 env("XUAN_GAME_DB_PORT", "3306"),
		GameDBName:                 env("XUAN_GAME_DB_NAME", "kbedm"),
		GameDBUser:                 strings.TrimSpace(os.Getenv("XUAN_GAME_DB_USER")),
		GameDBPassword:             os.Getenv("XUAN_GAME_DB_PASSWORD"),
		GameAdminURL:               env("XUAN_GAME_ADMIN_URL", "http://127.0.0.1:8890"),
		GameExchangeSign:           strings.TrimSpace(os.Getenv("XUAN_GAME_EXCHANGE_SIGN")),
		NotificationCarouselWorker: carouselWorker,
		BootstrapAdminUser:         strings.TrimSpace(os.Getenv("XUAN_BOOTSTRAP_ADMIN_USERNAME")),
		BootstrapAdminPass:         os.Getenv("XUAN_BOOTSTRAP_ADMIN_PASSWORD"),
		BootstrapAdminName:         env("XUAN_BOOTSTRAP_ADMIN_NAME", "超级管理员"),
	}

	if cfg.DBUser == "" || cfg.DBPassword == "" {
		return Config{}, fmt.Errorf("必须通过运行环境提供 XUAN_DB_USER 和 XUAN_DB_PASSWORD")
	}
	if cfg.DBHost != "127.0.0.1" && cfg.DBHost != "localhost" {
		return Config{}, fmt.Errorf("XUAN_DB_HOST 只允许 127.0.0.1 或 localhost")
	}
	if cfg.DBName != "webcm" {
		return Config{}, fmt.Errorf("XUAN_DB_NAME 必须是 webcm")
	}
	if cfg.GameDBUser == "" || cfg.GameDBPassword == "" {
		return Config{}, fmt.Errorf("必须通过运行环境提供 XUAN_GAME_DB_USER 和 XUAN_GAME_DB_PASSWORD")
	}
	if cfg.GameDBHost != "127.0.0.1" && cfg.GameDBHost != "localhost" {
		return Config{}, fmt.Errorf("XUAN_GAME_DB_HOST 只允许 127.0.0.1 或 localhost")
	}
	if cfg.GameDBName != "kbedm" {
		return Config{}, fmt.Errorf("XUAN_GAME_DB_NAME 必须是 kbedm")
	}
	if err := validateGameAdminURL(cfg.GameAdminURL); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func validateGameAdminURL(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "http" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return fmt.Errorf("XUAN_GAME_ADMIN_URL 必须是服务器本机 HTTP 地址")
	}
	if parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost" {
		return fmt.Errorf("XUAN_GAME_ADMIN_URL 只允许 127.0.0.1 或 localhost")
	}
	if parsed.Port() != "8890" || (parsed.Path != "" && parsed.Path != "/") {
		return fmt.Errorf("XUAN_GAME_ADMIN_URL 必须使用本机 8890 端口且不能包含路径")
	}
	return nil
}

func (c Config) MySQLDSN() string {
	return mysqlDSN(c.DBUser, c.DBPassword, c.DBHost, c.DBPort, c.DBName)
}

func (c Config) GameMySQLDSN() string {
	return mysqlDSN(c.GameDBUser, c.GameDBPassword, c.GameDBHost, c.GameDBPort, c.GameDBName)
}

func mysqlDSN(user, password, host, port, name string) string {
	mc := mysql.NewConfig()
	mc.User = user
	mc.Passwd = password
	mc.Net = "tcp"
	mc.Addr = host + ":" + port
	mc.DBName = name
	mc.ParseTime = true
	mc.Loc = time.Local
	mc.Timeout = 5 * time.Second
	mc.ReadTimeout = 10 * time.Second
	mc.WriteTimeout = 10 * time.Second
	mc.Collation = "utf8mb4_unicode_ci"
	return mc.FormatDSN()
}

func env(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}
