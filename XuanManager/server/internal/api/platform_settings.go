package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

// 平台级开关（后台可改、立即生效、不需重启服务）。
//
// 存在 mgr_platform_setting 里，读取带 10 秒内存缓存：
// 注册是低频操作，10 秒延迟对后台改完立即生效的体感没影响，
// 但能把每条注册请求一次查库降成基本不查。
const (
	settingRegistrationCaptcha = "registration.captcha.enabled"
	platformSettingCacheTTL    = 10 * time.Second
)

type platformSecuritySettings struct {
	CaptchaEnabled bool `json:"captchaEnabled"`
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
	})
}

type updatePlatformSecurityRequest struct {
	CaptchaEnabled *bool `json:"captchaEnabled"`
}

func (s *Server) handleUpdatePlatformSecurity(w http.ResponseWriter, r *http.Request, p principal) {
	var req updatePlatformSecurityRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "请求格式错误")
		return
	}
	if req.CaptchaEnabled == nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "缺少 captchaEnabled")
		return
	}
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
	s.invalidatePlatformSettings()
	s.audit(r.Context(), &p, "configuration.security.update", "platform_setting", settingRegistrationCaptcha,
		map[string]any{"captchaEnabled": *req.CaptchaEnabled}, nil,
		map[string]any{"captchaEnabled": *req.CaptchaEnabled}, 0, "", clientIP(r))
	writeData(w, http.StatusOK, platformSecuritySettings{CaptchaEnabled: *req.CaptchaEnabled})
}
