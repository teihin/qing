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

// handlePayNotifyBrowser 处理「付款完成跳回来」的浏览器 GET，
// 不改变任何订单状态（到账只认 POST 回调），只给玩家一个明确交代。
func (s *Server) handlePayNotifyBrowser(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write([]byte(payNotifyBrowserHTML))
}

const payNotifyBrowserHTML = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>支付结果确认中</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#eef2f9;
       font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#0f172a}
  .card{width:min(430px,calc(100% - 28px));background:#fff;border:1px solid #dbe4f2;border-radius:18px;
        box-shadow:0 16px 40px rgba(23,43,77,.1);padding:38px 26px;text-align:center}
  .mark{width:52px;height:52px;margin:0 auto 16px;border-radius:50%;display:grid;place-items:center;
        background:#e7f7ee;color:#0f9d58;font-size:22px}
  h1{margin:0 0 10px;font-size:17px;font-weight:600}
  p{margin:0;font-size:13px;line-height:1.9;color:#64748b}
</style></head>
<body><div class="card">
  <div class="mark">&#10003;</div>
  <h1>支付结果确认中</h1>
  <p>如果已经完成付款，请稍等片刻后返回游戏查看余额；<br>如长时间未到账，请联系客服并提供订单截图。</p>
</div></body></html>`

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
	// 老链接（/pay、/api/pay/public/*）继续保留，已经发出去的链接不能失效。
	s.mux.HandleFunc("GET /pay", s.handlePayPage)

	s.mux.HandleFunc("GET /api/pay/public/link", s.handlePayPublicLink)
	s.mux.HandleFunc("POST /api/pay/public/orders", s.handlePayPublicCreateOrder)
	s.mux.HandleFunc("GET /api/pay/public/orders/{orderNo}", s.handlePayPublicOrderStatus)
	s.mux.HandleFunc("POST /api/pay/notify/{code}", s.handlePayNotify)

	// 新链接走独立前缀（默认 /pgw），玩家拿到的地址里不再出现后台的 /xuanmanager。
	// Caddy 这一层不做前缀剥离，所以后端按完整路径注册。
	prefix := s.payPagePath()
	if prefix != "" && prefix != "/pay" {
		s.mux.HandleFunc("GET "+prefix, s.handlePayPage)
		// 用 {$} 精确匹配结尾斜杠：不加的话 "/pgw/" 是子树模式，
		// 任何写错的 /pgw/xxx 都会返回 200 + 页面 HTML，接口挂掉也看不出来。
		s.mux.HandleFunc("GET "+prefix+"/{$}", s.handlePayPage)
		// 路径形状跟老接口保持一致（/api/pay/public/*），页面脚本不用两套分支：
		// 老链接在 /xuanmanager 下被 Caddy 剥掉前缀、正好命中同一组路径。
		s.mux.HandleFunc("GET "+prefix+"/api/pay/public/link", s.handlePayPublicLink)
		s.mux.HandleFunc("POST "+prefix+"/api/pay/public/orders", s.handlePayPublicCreateOrder)
		s.mux.HandleFunc("GET "+prefix+"/api/pay/public/orders/{orderNo}", s.handlePayPublicOrderStatus)
		s.mux.HandleFunc("POST "+prefix+"/notify/{code}", s.handlePayNotify)
		// 服务商的 successUrl 同时可能被当成「付款完成后跳转地址」，
		// 玩家浏览器会 GET 过来；给一页人话，别让人看到 JSON 404。
		s.mux.HandleFunc("GET "+prefix+"/notify/{code}", s.handlePayNotifyBrowser)
		// 前缀下其它路径一律 404：否则会落到静态兜底返回 200 + 后台 SPA 的 HTML，
		// 前端 resp.json() 解析失败后只能报「网络异常」，真实问题被藏起来。
		s.mux.HandleFunc("GET "+prefix+"/", func(w http.ResponseWriter, r *http.Request) {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "路径不存在")
		})
	}

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
