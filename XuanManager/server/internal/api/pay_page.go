package api

import (
	_ "embed"
	"net/http"
)

// 玩家付款页。内嵌在二进制里，不走 web/dist：这个页面给玩家用，
// 不能因为后台前端重新构建就把链接打成 404。
//
//go:embed pay_page.html
var payPageHTML []byte

func (s *Server) handlePayPage(w http.ResponseWriter, r *http.Request) {
	// 后台整体 CSP 是 script-src 'self'，内嵌页用内联脚本，这里单独放开。
	// 页面本身不读 cookie、不带凭据，放开只影响这一条路由。
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Referrer-Policy", "no-referrer")
	_, _ = w.Write(payPageHTML)
}

// 玩家页与后台接口都挂在根路径上（/pay、/api/pay/*）。后台经过 Caddy 的
// /xuanmanager 前缀剥离后落在同一套路由上；对外链接用哪个域名由
// 「付款链接域名」决定，见 payBaseURL。
func (s *Server) registerPayRoutes() {
	s.mux.HandleFunc("GET /pay", s.handlePayPage)

	s.mux.HandleFunc("GET /api/pay/public/link", s.handlePayPublicLink)
	s.mux.HandleFunc("POST /api/pay/public/orders", s.handlePayPublicCreateOrder)
	s.mux.HandleFunc("GET /api/pay/public/orders/{orderNo}", s.handlePayPublicOrderStatus)
	s.mux.HandleFunc("POST /api/pay/notify/{code}", s.handlePayNotify)

	s.mux.Handle("GET /api/pay/providers", s.authorized("game.pay_web.view", false, s.handleListPayProviders))
	s.mux.Handle("POST /api/pay/providers", s.authorized("game.pay_web.config", true, s.handleSavePayProvider))
	s.mux.Handle("PUT /api/pay/providers/{id}", s.authorized("game.pay_web.config", true, s.handleSavePayProvider))
	s.mux.Handle("PUT /api/pay/providers/{id}/channels", s.authorized("game.pay_web.config", true, s.handleSavePayChannels))
	s.mux.Handle("GET /api/pay/orders", s.authorized("game.pay_web.view", false, s.handleListPayOrders))
	s.mux.Handle("GET /api/pay/stats", s.authorized("game.pay_web.view", false, s.handlePayStats))
	s.mux.Handle("POST /api/pay/orders/{orderNo}/sync", s.authorized("game.pay_web.view", true, s.handleSyncPayOrder))
	s.mux.Handle("POST /api/pay/links", s.authorized("game.pay_web.link", true, s.handleCreatePayLink))
	s.mux.Handle("GET /api/pay/settings", s.authorized("game.pay_web.config", false, s.handleGetPaySettings))
	s.mux.Handle("PUT /api/pay/settings", s.authorized("game.pay_web.config", true, s.handleUpdatePaySettings))
}
