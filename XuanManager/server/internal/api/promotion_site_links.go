package api

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
)

// 推广落地站（/webhome/）的两个跳转地址。
//
// 落地页是纯静态页：以前改地址要动 WebHome/site-config.json 再整站上传一次。
// 现在多一层后台配置：写进 mgr_platform_setting 的 promotion.site.* 两条，
// 落地页每次打开先请求公开只读接口 GET /api/public/promotion-links（经 Caddy 为
// /xuanmanager/api/public/promotion-links），拿到 https 地址就用，
// 取不到或不是 https 就回退到站点自带的 site-config.json / 内置默认值。
//
// 读取沿用 platformSetting 的 10 秒内存缓存，保存时立即失效，运营改完刷新即生效。
const (
	promotionSiteIOSURLKey     = "promotion.site.ios_url"
	promotionSiteAndroidURLKey = "promotion.site.android_url"
	promotionSiteURLAudit      = "configuration.promotion_site_links.update"
	promotionSiteURLMaxLength  = 512
)

type promotionSiteLinks struct {
	IOSURL     string `json:"iosUrl"`
	AndroidURL string `json:"androidUrl"`
}

type updatePromotionSiteLinksRequest struct {
	IOSURL     string `json:"iosUrl"`
	AndroidURL string `json:"androidUrl"`
	Confirm    bool   `json:"confirm"`
}

func (s *Server) currentPromotionSiteLinks(ctx context.Context) promotionSiteLinks {
	return promotionSiteLinks{
		IOSURL:     strings.TrimSpace(s.platformSetting(ctx, promotionSiteIOSURLKey)),
		AndroidURL: strings.TrimSpace(s.platformSetting(ctx, promotionSiteAndroidURLKey)),
	}
}

// handlePublicPromotionSiteLinks 给落地页用的只读接口：不带 Cookie、不需要登录。
// 只暴露这两个本来就是公开的下载地址，不带任何内部信息。
//
// 生产上这层不对外露 /xuanmanager 前缀：Caddy 把 /webhome/links.json 改写到本接口，
// 玩家侧只会看到落地站自己路径下的一个 JSON。同源请求，所以不加 CORS 头。
func (s *Server) handlePublicPromotionSiteLinks(w http.ResponseWriter, r *http.Request) {
	links := s.currentPromotionSiteLinks(r.Context())
	w.Header().Set("Cache-Control", "no-store, max-age=0")
	writeData(w, http.StatusOK, links)
}

func (s *Server) handleGetPromotionSiteLinks(w http.ResponseWriter, r *http.Request, p principal) {
	writeData(w, http.StatusOK, s.currentPromotionSiteLinks(r.Context()))
}

func (s *Server) handleUpdatePromotionSiteLinks(w http.ResponseWriter, r *http.Request, p principal) {
	var input updatePromotionSiteLinksRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if !input.Confirm {
		writeError(w, http.StatusBadRequest, "CONFIRM_REQUIRED", "请先勾选确认再保存")
		return
	}
	iosURL, err := normalizePromotionSiteURL(input.IOSURL, "苹果安装地址")
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PROMOTION_SITE_URL", err.Error())
		return
	}
	androidURL, err := normalizePromotionSiteURL(input.AndroidURL, "安卓下载地址")
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PROMOTION_SITE_URL", err.Error())
		return
	}

	before := s.currentPromotionSiteLinks(r.Context())
	for _, item := range []struct{ key, value string }{
		{promotionSiteIOSURLKey, iosURL},
		{promotionSiteAndroidURLKey, androidURL},
	} {
		if _, err := s.db.ExecContext(r.Context(), `INSERT INTO mgr_platform_setting (setting_key, setting_value, updated_by)
VALUES (?, ?, ?)
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
			item.key, item.value, p.Username); err != nil {
			s.logger.Error("save promotion site links", "error", err, "key", item.key)
			writeError(w, http.StatusInternalServerError, "WRITE_FAILED", "保存失败")
			return
		}
	}
	s.invalidatePlatformSettings()

	after := s.currentPromotionSiteLinks(r.Context())
	s.audit(r.Context(), &p, promotionSiteURLAudit, "platform_setting", "promotion.site.links",
		map[string]any{"iosUrl": iosURL, "androidUrl": androidURL},
		before, after, 0, "", clientIP(r))
	writeData(w, http.StatusOK, after)
}

// normalizePromotionSiteURL 允许留空（表示回退到站点自带的 site-config.json），
// 非空时必须是 https 的完整地址 —— 落地页脚本本身也拒绝 http 目标，这里提前拦住。
func normalizePromotionSiteURL(value, label string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", nil
	}
	if len(trimmed) > promotionSiteURLMaxLength {
		return "", errors.New(label + "太长，请控制在 512 个字符以内")
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Host == "" {
		return "", errors.New(label + "不是完整的地址")
	}
	if !strings.EqualFold(parsed.Scheme, "https") {
		return "", errors.New(label + "必须以 https:// 开头")
	}
	return trimmed, nil
}
