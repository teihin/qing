package config

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
)

// beijingLocation 固定北京时间。XuanManager 一律按北京时间解释库里的墙上时间，
// 不能依赖 time.Local（服务器系统时区被改成 UTC 时会把返回给前端的偏移整体算错 8 小时）。
var beijingLocation = time.FixedZone("Asia/Shanghai", 8*60*60)

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
	ServiceToken               string
	GameMode                   string
	GameExchangeSign           string
	CredentialKey              string
	NotificationCarouselWorker bool
	BootstrapAdminUser         string
	BootstrapAdminPass         string
	BootstrapAdminName         string

	// 注册防护配额。0 表示关闭该维度，用于「先观察再收紧」。
	RegAttempts10Min    int
	RegIPHourly         int
	RegIPDaily          int
	RegDeviceDaily      int
	RegGlobalDaily      int
	RegHoneypotBanHours int
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

	// 数据库与应用分离部署时显式打开；默认关闭，保持「只允许本机数据库」的原有安全基线。
	allowRemoteDB, err := strconv.ParseBool(env("XUAN_DB_ALLOW_REMOTE", "false"))
	if err != nil {
		return Config{}, fmt.Errorf("XUAN_DB_ALLOW_REMOTE 必须是 true 或 false")
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
		ServiceToken:               strings.TrimSpace(os.Getenv("XUAN_SERVICE_TOKEN")),
		GameMode:                   strings.ToLower(env("XUAN_GAME_MODE", "club")),
		GameExchangeSign:           strings.TrimSpace(os.Getenv("XUAN_GAME_EXCHANGE_SIGN")),
		CredentialKey:              strings.TrimSpace(os.Getenv("XUAN_CREDENTIAL_KEY")),
		NotificationCarouselWorker: carouselWorker,
		BootstrapAdminUser:         strings.TrimSpace(os.Getenv("XUAN_BOOTSTRAP_ADMIN_USERNAME")),
		BootstrapAdminPass:         os.Getenv("XUAN_BOOTSTRAP_ADMIN_PASSWORD"),
		BootstrapAdminName:         env("XUAN_BOOTSTRAP_ADMIN_NAME", "超级管理员"),

		// 单 IP 一小时/一天最多成功注册几个号；同设备 24 小时几个；全服一天总量兜底。
		// 默认只开 IP 两档：一个 IP 一小时注册 20 个号已经明显不正常，而网吧/同一 WiFi
		// 短时间多人注册也很少到 20。设备维度和全局兜底默认关闭，等真被打时
		// 再用环境变量打开，避免误伤正常玩家。
		RegAttempts10Min:    envInt("XUAN_REG_ATTEMPTS_10MIN", 20),
		RegIPHourly:         envInt("XUAN_REG_IP_HOURLY", 20),
		RegIPDaily:          envInt("XUAN_REG_IP_DAILY", 20),
		RegDeviceDaily:      envInt("XUAN_REG_DEVICE_DAILY", 0),
		RegGlobalDaily:      envInt("XUAN_REG_GLOBAL_DAILY", 0),
		RegHoneypotBanHours: envInt("XUAN_REG_HONEYPOT_BAN_HOURS", 24),
	}

	if cfg.DBUser == "" || cfg.DBPassword == "" {
		return Config{}, fmt.Errorf("必须通过运行环境提供 XUAN_DB_USER 和 XUAN_DB_PASSWORD")
	}
	if cfg.DBHost != "127.0.0.1" && cfg.DBHost != "localhost" {
		if err := validateRemoteDBHost("XUAN_DB_HOST", cfg.DBHost, allowRemoteDB); err != nil {
			return Config{}, err
		}
	}
	if cfg.DBName != "webcm" {
		return Config{}, fmt.Errorf("XUAN_DB_NAME 必须是 webcm")
	}
	if cfg.GameDBUser == "" || cfg.GameDBPassword == "" {
		return Config{}, fmt.Errorf("必须通过运行环境提供 XUAN_GAME_DB_USER 和 XUAN_GAME_DB_PASSWORD")
	}
	if cfg.GameDBHost != "127.0.0.1" && cfg.GameDBHost != "localhost" {
		if err := validateRemoteDBHost("XUAN_GAME_DB_HOST", cfg.GameDBHost, allowRemoteDB); err != nil {
			return Config{}, err
		}
	}
	if cfg.GameDBName != "kbedm" {
		return Config{}, fmt.Errorf("XUAN_GAME_DB_NAME 必须是 kbedm")
	}
	if err := validateGameAdminURL(cfg.GameAdminURL); err != nil {
		return Config{}, err
	}
	if err := validateGameMode(cfg.GameMode); err != nil {
		return Config{}, err
	}
	if cfg.ServiceToken != "" && len(cfg.ServiceToken) < 32 {
		return Config{}, fmt.Errorf("XUAN_SERVICE_TOKEN 至少需要 32 个字符")
	}
	// 机器人登录密码的落库密钥：优先 XUAN_CREDENTIAL_KEY，没配就退到数据库口令。
	// 退到数据库口令是为了让已有部署不额外加环境变量也能用；更换任一来源都会让旧密文解不开。
	if cfg.CredentialKey == "" {
		cfg.CredentialKey = cfg.DBPassword
	}
	return cfg, nil
}

// validateRemoteDBHost 在 XUAN_DB_ALLOW_REMOTE=true 时放行局域网私有地址，
// 其余情况保持原有「只允许本机」限制，避免把公网地址误配成数据库主机。
func validateRemoteDBHost(name, host string, allowRemote bool) error {
	if !allowRemote {
		return fmt.Errorf("%s 只允许 127.0.0.1 或 localhost；数据库分离部署请显式设置 XUAN_DB_ALLOW_REMOTE=true", name)
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsPrivate() {
		return fmt.Errorf("%s 在 XUAN_DB_ALLOW_REMOTE=true 时只允许局域网私有地址（10.x / 172.16-31.x / 192.168.x）", name)
	}
	return nil
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

func validateGameMode(mode string) error {
	if mode != "club" && mode != "standard" {
		return fmt.Errorf("XUAN_GAME_MODE 必须是 club 或 standard")
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
	// 固定用北京时间解释库里的 DATETIME：MySQL 会话时区为 SYSTEM（Asia/Shanghai），
	// 库里 DATETIME、NOW()、CURRENT_TIMESTAMP、FROM_UNIXTIME() 存的都是北京时间墙上时间，
	// 因此 SQL 里不得再叠加 +8 小时，这里也不能用 time.Local。
	mc.Loc = beijingLocation
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

// envInt 读整数配置：非法值或负数静默回退到默认值，避免一个笔误让服务起不来。
func envInt(name string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 0 {
		return fallback
	}
	return value
}
