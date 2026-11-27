package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// 平台级开关（后台可改、立即生效、不需重启服务）。
//
// 存在 mgr_platform_setting 里，读取带 10 秒内存缓存：
// 注册是低频操作，10 秒延迟对后台改完立即生效的体感没影响，
// 但能把每条注册请求一次查库降成基本不查。
const (
	settingRegistrationCaptcha    = "registration.captcha.enabled"
	settingRegistrationDailyLimit = "registration.global_daily_limit"
	platformSettingCacheTTL       = 10 * time.Second
	// 全服日注册上限的默认值与取值范围：后台没配置或配置非法时按默认 300 生效。
	defaultRegistrationDailyLimit = 300
	maxRegistrationDailyLimit     = 100000
)

type platformSecuritySettings struct {
	CaptchaEnabled bool `json:"captchaEnabled"`
	// DailyLimit 是全服每日允许成功注册的账号数；TodayCount 是今天已经成功的数量，
	// 后台用两者画进度条，运营能直观看到配额消耗情况。
	DailyLimit int `json:"registrationDailyLimit"`
	TodayCount int `json:"registrationTodayCount"`
}

func (s *Server) loadPlatformSettings(ctx context.Context) map[string]string {
	values := make(map[string]string)
	rows, err := s.db.QueryContext(ctx, `SELECT setting_key, setting_value FROM mgr_platform_setting`)
	if err != nil {
		s.logger.Warn("read platform settings failed", "error", err)
		return values
	}
	defer rows.Close()
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err == nil {
			values[key] = value
		}
	}
	return values
}

// platformSetting 读取单个开关，带短缓存。库不可用时按「关闭」处理（fail open），
// 避免数据库抖动导致全站注册被验证码卡住。
func (s *Server) platformSetting(ctx context.Context, key string) string {
	s.settingMu.Lock()
	if time.Since(s.settingLoadedAt) < platformSettingCacheTTL && s.settingValues != nil {
		value := s.settingValues[key]
		s.settingMu.Unlock()
		return value
	}
	s.settingMu.Unlock()

	values := s.loadPlatformSettings(ctx)

	s.settingMu.Lock()
	s.settingValues = values
	s.settingLoadedAt = time.Now()
	s.settingMu.Unlock()
	return values[key]
}

func (s *Server) registrationCaptchaEnabled(ctx context.Context) bool {
	return strings.EqualFold(s.platformSetting(ctx, settingRegistrationCaptcha), "true")
}

// registrationGlobalDailyLimit 返回全服日注册上限：后台配置优先，缺省或非法时回退默认 300。
func (s *Server) registrationGlobalDailyLimit(ctx context.Context) int {
	raw := strings.TrimSpace(s.platformSetting(ctx, settingRegistrationDailyLimit))
	if raw == "" {
		return defaultRegistrationDailyLimit
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return defaultRegistrationDailyLimit
	}
	if value > maxRegistrationDailyLimit {
		return maxRegistrationDailyLimit
	}
	return value
}

// registrationTodayCount 统计今天已成功注册的数量，用于后台进度条。
// 口径与全服日上限一致：数游戏库里的真实账号，而不是注册事件流水，
// 这样运营清理垃圾账号后计数会同步回落。
func (s *Server) registrationTodayCount(ctx context.Context) int {
	count, err := s.countTodayRegisteredAccounts(ctx)
	if err == nil {
		return count
	}
	if s.registrationGuard == nil {
		return 0
	}
	fallback, _, fallbackErr := s.registrationGuard.countOK(ctx, registrationDimensionGlobal, "", startOfToday(time.Now()))
	if fallbackErr != nil {
		return 0
	}
	return int(fallback)
}

// countTodayRegisteredAccounts 数游戏库里今天新建的账号（按北京时间算自然日）。
// third_marketing_info.date 是注册日期字符串，与注册流程写入的口径一致。
func (s *Server) countTodayRegisteredAccounts(ctx context.Context) (int, error) {
	db := s.gameDB
	if db == nil {
		return 0, errors.New("game database unavailable")
	}
	today := time.Now().In(dashboardLocation).Format("2006-01-02")
	var count int
	if err := db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM kbedm.third_marketing_info WHERE date = ?`, today).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

// invalidatePlatformSettings 让缓存立即失效，后台改完下一次请求就能读到新值。
func (s *Server) invalidatePlatformSettings() {
	s.settingMu.Lock()
	s.settingValues = nil
	s.settingLoadedAt = time.Time{}
	s.settingMu.Unlock()
}

func (s *Server) handleGetPlatformSecurity(w http.ResponseWriter, r *http.Request, p principal) {
	settings := s.loadPlatformSettings(r.Context())
	writeData(w, http.StatusOK, platformSecuritySettings{
		CaptchaEnabled: strings.EqualFold(settings[settingRegistrationCaptcha], "true"),
		DailyLimit:     s.registrationGlobalDailyLimit(r.Context()),
		TodayCount:     s.registrationTodayCount(r.Context()),
	})
}

type updatePlatformSecurityRequest struct {
	CaptchaEnabled *bool `json:"captchaEnabled"`
	// RegistrationDailyLimit 是全服日注册上限，不传表示只改验证码开关。
	RegistrationDailyLimit *int `json:"registrationDailyLimit"`
}

func (s *Server) handleUpdatePlatformSecurity(w http.ResponseWriter, r *http.Request, p principal) {
	var req updatePlatformSecurityRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "请求格式错误")
		return
	}
	if req.CaptchaEnabled == nil && req.RegistrationDailyLimit == nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "缺少需要修改的配置项")
		return
	}
	if req.RegistrationDailyLimit != nil {
		if *req.RegistrationDailyLimit <= 0 || *req.RegistrationDailyLimit > maxRegistrationDailyLimit {
			writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "日注册上限必须是 1 到 100000 之间的整数")
			return
		}
	}
	previous := platformSecuritySettings{
		CaptchaEnabled: s.registrationCaptchaEnabled(r.Context()),
		DailyLimit:     s.registrationGlobalDailyLimit(r.Context()),
	}
	changes := map[string]any{}
	if req.CaptchaEnabled != nil {
		value := "false"
		if *req.CaptchaEnabled {
			value = "true"
		}
		if _, err := s.db.ExecContext(r.Context(), `INSERT INTO mgr_platform_setting (setting_key, setting_value, updated_by)
VALUES (?, ?, ?)
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
			settingRegistrationCaptcha, value, p.Username); err != nil {
			writeError(w, http.StatusInternalServerError, "WRITE_FAILED", "保存失败")
			return
		}
		changes["captchaEnabled"] = *req.CaptchaEnabled
	}
	if req.RegistrationDailyLimit != nil {
		if _, err := s.db.ExecContext(r.Context(), `INSERT INTO mgr_platform_setting (setting_key, setting_value, updated_by)
VALUES (?, ?, ?)
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
			settingRegistrationDailyLimit, strconv.Itoa(*req.RegistrationDailyLimit), p.Username); err != nil {
			writeError(w, http.StatusInternalServerError, "WRITE_FAILED", "保存失败")
			return
		}
		changes["registrationDailyLimit"] = *req.RegistrationDailyLimit
	}
	s.invalidatePlatformSettings()
	current := platformSecuritySettings{
		CaptchaEnabled: s.registrationCaptchaEnabled(r.Context()),
		DailyLimit:     s.registrationGlobalDailyLimit(r.Context()),
	}
	if req.CaptchaEnabled != nil {
		current.CaptchaEnabled = *req.CaptchaEnabled
	}
	if req.RegistrationDailyLimit != nil {
		current.DailyLimit = *req.RegistrationDailyLimit
	}
	current.TodayCount = s.registrationTodayCount(r.Context())
	s.audit(r.Context(), &p, "configuration.security.update", "platform_setting", settingRegistrationCaptcha,
		nil, map[string]any{"captchaEnabled": previous.CaptchaEnabled, "registrationDailyLimit": previous.DailyLimit},
		changes, 0, "", clientIP(r))
	writeData(w, http.StatusOK, current)
}
