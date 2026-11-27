package api

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"log/slog"
	"strings"
	"sync"
	"time"

	"xuanmanager/internal/config"
)

// 注册事件的 result 取值，同时用于限流口径：
// 只有 ok 计入配额，被拒的请求不会把配额占满（否则攻击者能把自家 IP 刷到"正常用户也注册不了"）。
const (
	registrationResultOK          = "ok"
	registrationResultRateLimited = "rate_limited"
	registrationResultHoneypot    = "honeypot"
	registrationResultRejected    = "rejected"
)

// registrationGuard 负责「一个 IP / 一台设备 / 全服一天」能注册多少个号。
//
// 和 registrationRateLimiter 的分工：
//   - limiter 管「尝试次数」，防连点、防刷接口，10 次 / 10 分钟，纯内存；
//   - guard 管「成功数配额」，防批量建号，落库计数，重启不清零。
//
// 数据库不可用时一律放行（fail open）：注册本身要写 third_marketing_info，
// 库挂了注册也成功不了，这时候再用 500 挡住用户没有意义。
type registrationGuard struct {
	db     *sql.DB
	logger *slog.Logger

	ipHourly    int
	ipDaily     int
	deviceDaily int
	globalDaily int
	honeypotBan time.Duration

	mu        sync.Mutex
	memory    map[string][]time.Time
	banMemory map[string]time.Time

	// globalCount 是「全服日上限」的计数来源。默认按注册事件流水统计，
	// 但运营清理垃圾账号时只删账号、不删流水，会让配额永远卡住；
	// 所以服务端会注入「今日真实账号数」的实现（见 countTodayRegisteredAccounts）。
	globalCount func(context.Context) (int, error)
}

func newRegistrationGuard(db *sql.DB, cfg config.Config, logger *slog.Logger) *registrationGuard {
	guard := &registrationGuard{
		db:          db,
		logger:      logger,
		ipHourly:    cfg.RegIPHourly,
		ipDaily:     cfg.RegIPDaily,
		deviceDaily: cfg.RegDeviceDaily,
		globalDaily: cfg.RegGlobalDaily,
		honeypotBan: time.Duration(cfg.RegHoneypotBanHours) * time.Hour,
		memory:      make(map[string][]time.Time),
		banMemory:   make(map[string]time.Time),
	}
	// 0 表示关闭蜜罐 IP 封禁（高防后面接时源 IP 全是节点地址，按 IP 封会误伤整节点）。
	if guard.honeypotBan < 0 {
		guard.honeypotBan = 0
	}
	return guard
}

// registrationIPHash 把 IP 压成 16 位十六进制摘要：够用做计数，又不至于把明文 IP 铺满数据库。
func registrationIPHash(ip string) string {
	sum := sha256.Sum256([]byte("xuanmanager:registration:ip:" + strings.TrimSpace(ip)))
	return hex.EncodeToString(sum[:8])
}

// registrationDeviceKey 把设备标识压成计数用 key；设备标识由客户端上报、可伪造，
// 所以它只是配额的一个维度，不能当成身份。
func registrationDeviceKey(deviceID string) string {
	deviceID = strings.TrimSpace(deviceID)
	if deviceID == "" {
		return ""
	}
	sum := sha256.Sum256([]byte("xuanmanager:registration:device:" + deviceID))
	return hex.EncodeToString(sum[:16])
}

type registrationBlockReason string

const (
	registrationBlockNone        registrationBlockReason = ""
	registrationBlockIPBanned    registrationBlockReason = "ip_banned"
	registrationBlockIPHourly    registrationBlockReason = "ip_hourly"
	registrationBlockIPDaily     registrationBlockReason = "ip_daily"
	registrationBlockDeviceDaily registrationBlockReason = "device_daily"
	registrationBlockGlobalDaily registrationBlockReason = "global_daily"
)

func (g *registrationGuard) blocked(ctx context.Context, ipHash, deviceKey string, globalDaily int) (registrationBlockReason, time.Duration, error) {
	// 蜜罐封禁默认开启；honeypotBan=0 时跳过（见 newRegistrationGuard）。
	if g.honeypotBan > 0 {
		if until, banned := g.bannedUntil(ctx, ipHash); banned {
			return registrationBlockIPBanned, time.Until(until), nil
		}
	}

	now := time.Now()
	if g.ipHourly > 0 {
		count, oldest, err := g.countOK(ctx, registrationDimensionIP, ipHash, now.Add(-time.Hour))
		if err != nil {
			return registrationBlockNone, 0, err
		}
		if count >= g.ipHourly {
			return registrationBlockIPHourly, oldest.Add(time.Hour).Sub(now), nil
		}
	}
	if g.ipDaily > 0 {
		count, _, err := g.countOK(ctx, registrationDimensionIP, ipHash, startOfToday(now))
		if err != nil {
			return registrationBlockNone, 0, err
		}
		if count >= g.ipDaily {
			return registrationBlockIPDaily, startOfTomorrow(now).Sub(now), nil
		}
	}
	if g.deviceDaily > 0 && deviceKey != "" {
		count, oldest, err := g.countOK(ctx, registrationDimensionDevice, deviceKey, now.Add(-24*time.Hour))
		if err != nil {
			return registrationBlockNone, 0, err
		}
		if count >= g.deviceDaily {
			return registrationBlockDeviceDaily, oldest.Add(24 * time.Hour).Sub(now), nil
		}
	}
	// 全服日上限由调用方传入（后台可实时改），0 表示不限。
	if globalDaily <= 0 {
		globalDaily = g.globalDaily
	}
	if globalDaily > 0 {
		count, err := g.countGlobal(ctx, now)
		if err != nil {
			return registrationBlockNone, 0, err
		}
		if count >= globalDaily {
			return registrationBlockGlobalDaily, startOfTomorrow(now).Sub(now), nil
		}
	}
	return registrationBlockNone, 0, nil
}

// countGlobal 统计今天全服已注册数量。优先用注入的「真实账号数」口径，
// 没注入或查询失败时退回事件流水——宁可多算，也不能让上限失效。
func (g *registrationGuard) countGlobal(ctx context.Context, now time.Time) (int, error) {
	if g.globalCount != nil {
		count, err := g.globalCount(ctx)
		if err == nil {
			return count, nil
		}
		if g.logger != nil {
			g.logger.Warn("registration global counter failed, falling back to events", "error", err)
		}
	}
	count, _, err := g.countOK(ctx, registrationDimensionGlobal, "", startOfToday(now))
	return int(count), err
}

type registrationDimension string

const (
	registrationDimensionIP     registrationDimension = "ip"
	registrationDimensionDevice registrationDimension = "device"
	registrationDimensionGlobal registrationDimension = "global"
)

// countOK 统计窗口内成功注册的条数，并返回其中最早一条的时间（用来算精确的解禁时刻）。
func (g *registrationGuard) countOK(ctx context.Context, dimension registrationDimension, value string, since time.Time) (int, time.Time, error) {
	if g.db == nil {
		return g.memoryCount(dimension, value, since)
	}

	const base = `SELECT COUNT(*), MIN(created_at) FROM mgr_registration_event WHERE result = 'ok' AND created_at >= ?`
	query := base
	args := []any{since}
	switch dimension {
	case registrationDimensionIP:
		query = `SELECT COUNT(*), MIN(created_at) FROM mgr_registration_event WHERE result = 'ok' AND ip_hash = ? AND created_at >= ?`
		args = []any{value, since}
	case registrationDimensionDevice:
		query = `SELECT COUNT(*), MIN(created_at) FROM mgr_registration_event WHERE result = 'ok' AND device_key = ? AND created_at >= ?`
		args = []any{value, since}
	}

	var count int
	var oldest sql.NullTime
	if err := g.db.QueryRowContext(ctx, query, args...).Scan(&count, &oldest); err != nil {
		return 0, time.Time{}, err
	}
	return count, oldest.Time, nil
}

func (g *registrationGuard) memoryCount(dimension registrationDimension, value string, since time.Time) (int, time.Time, error) {
	g.mu.Lock()
	defer g.mu.Unlock()

	key := "all"
	switch dimension {
	case registrationDimensionIP:
		key = "ip:" + value
	case registrationDimensionDevice:
		key = "dev:" + value
	}
	count := 0
	var oldest time.Time
	for _, at := range g.memory[key] {
		if at.Before(since) {
			continue
		}
		count++
		if oldest.IsZero() || at.Before(oldest) {
			oldest = at
		}
	}
	return count, oldest, nil
}

type registrationEvent struct {
	IPHash    string
	DeviceKey string
	LoginName string
	Result    string
	RiskScore int
}

func (g *registrationGuard) record(ctx context.Context, event registrationEvent) {
	if g.db == nil {
		g.mu.Lock()
		key := "all"
		if event.Result == registrationResultOK {
			if event.IPHash != "" {
				g.memory["ip:"+event.IPHash] = append(g.memory["ip:"+event.IPHash], time.Now())
			}
			if event.DeviceKey != "" {
				g.memory["dev:"+event.DeviceKey] = append(g.memory["dev:"+event.DeviceKey], time.Now())
			}
			g.memory[key] = append(g.memory[key], time.Now())
		}
		g.mu.Unlock()
		return
	}
	if event.Result == "" {
		event.Result = registrationResultRejected
	}
	if event.IPHash == "" {
		return
	}
	writeCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if _, err := g.db.ExecContext(writeCtx, `INSERT INTO mgr_registration_event
(ip_hash, device_key, login_name, result, risk_score) VALUES (?, ?, ?, ?, ?)`,
		event.IPHash, event.DeviceKey, event.LoginName, event.Result, event.RiskScore); err != nil {
		g.logger.Warn("record registration event failed", "error", err, "result", event.Result)
	}
}

func (g *registrationGuard) ban(ctx context.Context, ipHash, reason string, now time.Time) {
	if g.honeypotBan <= 0 {
		return
	}
	until := now.Add(g.honeypotBan)
	if g.db == nil {
		g.mu.Lock()
		g.banMemory[ipHash] = until
		g.mu.Unlock()
		return
	}
	writeCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if _, err := g.db.ExecContext(writeCtx, `INSERT INTO mgr_registration_ip_ban (ip_hash, reason, banned_at, expire_at)
VALUES (?, ?, ?, ?)
ON DUPLICATE KEY UPDATE reason = VALUES(reason), banned_at = VALUES(banned_at), expire_at = VALUES(expire_at)`,
		ipHash, reason, now, until); err != nil {
		g.logger.Error("ban registration ip failed", "error", err)
	}
}

func (g *registrationGuard) bannedUntil(ctx context.Context, ipHash string) (time.Time, bool) {
	if ipHash == "" {
		return time.Time{}, false
	}
	now := time.Now()
	if g.db == nil {
		g.mu.Lock()
		defer g.mu.Unlock()
		until, ok := g.banMemory[ipHash]
		if !ok || until.Before(now) {
			return time.Time{}, false
		}
		return until, true
	}
	var until time.Time
	err := g.db.QueryRowContext(ctx, `SELECT expire_at FROM mgr_registration_ip_ban WHERE ip_hash = ? AND expire_at > ? LIMIT 1`,
		ipHash, now).Scan(&until)
	if err != nil {
		if err != sql.ErrNoRows {
			g.logger.Warn("check registration ip ban failed", "error", err)
		}
		return time.Time{}, false
	}
	return until, true
}

// cleanup 每天清一次：事件留 7 天，过期的封禁直接删。
func (g *registrationGuard) cleanup(ctx context.Context) error {
	if g.db == nil {
		g.mu.Lock()
		cutoff := time.Now().Add(-7 * 24 * time.Hour)
		for key, times := range g.memory {
			kept := times[:0]
			for _, at := range times {
				if at.After(cutoff) {
					kept = append(kept, at)
				}
			}
			g.memory[key] = kept
		}
		g.mu.Unlock()
		return nil
	}
	if _, err := g.db.ExecContext(ctx, `DELETE FROM mgr_registration_event WHERE created_at < ?`, time.Now().Add(-7*24*time.Hour)); err != nil {
		return err
	}
	_, err := g.db.ExecContext(ctx, `DELETE FROM mgr_registration_ip_ban WHERE expire_at < ?`, time.Now())
	return err
}

// RunRegistrationJanitor 每天跑一次清理；启动时先跑一次，避免表在首次启动后一直涨。
func RunRegistrationJanitor(ctx context.Context, db *sql.DB, logger *slog.Logger) {
	guard := newRegistrationGuard(db, config.Config{}, logger)
	run := func() {
		cleanupCtx, cancel := context.WithTimeout(ctx, time.Minute)
		defer cancel()
		if err := guard.cleanup(cleanupCtx); err != nil {
			logger.Warn("registration event cleanup failed", "error", err)
		}
	}
	run()
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			run()
		}
	}
}

func startOfToday(now time.Time) time.Time {
	year, month, day := now.Date()
	return time.Date(year, month, day, 0, 0, 0, 0, now.Location())
}

func startOfTomorrow(now time.Time) time.Time {
	return startOfToday(now).Add(24 * time.Hour)
}
