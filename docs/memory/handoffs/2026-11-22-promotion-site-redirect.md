# 推广下载站改为按平台跳转（2026-11-22）

## 目标

推广站原来站内直接发 APK / 苹果描述文件。改成：苹果打开即跳转苹果安装页，安卓点击跳转安卓下载页。

- 苹果：`https://dgwsd.yycdzx.com/UMuGWv`
- 安卓：`https://www.gulubase.com/bf888`

## 改了什么

| 文件 | 改动 |
|---|---|
| `WebHome/app.js` | 删掉 iOS 安装弹层、浏览器引导、描述文件下载、剪贴板复制；iOS 与安卓都是**点主按钮才跳**（`location.assign`，120ms 后执行），桌面两个平台按钮；`navigating` 防连点 |
| `WebHome/index.html` | 删 `#iosSheet`、`#browserSheet`、`#sheetBackdrop`；主按钮/提示/三步说明/`noscript` 文案改成跳转口径 |
| `WebHome/site-config.json` | 只留 `siteName/gameName/versionText/promotionSiteUrl/iosInstallUrl/androidInstallUrl` |
| `tools/upload_promotion_site.py` | 跳转模式（见下）+ `--public-url` |
| `9-4上传推广网站-正式服.command` | 新增，走 `.hot-update-upload-config.prod.json` |
| `WebHome/README.md` | 同步跳转口径与两个上传脚本 |

`downloads/BF.mobileconfig` 和 `scripts/generate_mobileconfig.py` 保留在目录里但不参与发布：
只有 `site-config.json` 里重新写上相对的 `androidApkUrl` / `iosProfileUrl` / `iosGameUrl`，脚本才回到原「站内文件」流程
（找 `build/jsb-link/.../app/release` 唯一 APK、比对远端 SHA、校验 mobileconfig 字段）。

## 上传脚本的跳转模式

- `androidApkUrl` / `iosProfileUrl` 缺省或为空 → 不打包 APK、不校验描述文件。
- 远端部署脚本里的 APK / 描述文件断言改成条件生成（无 APK 时用 `:` 占位），其余原子切换逻辑未变。
- 本地 dry-run：8 文件、1.43 MB ZIP（旧版要带 150 MB APK）。
- `--public-url` 只影响打印的公网地址，正式服命令传
  `http://72679781.tjkdplus.com.cname.hcnamedns.com.:28800/webhome/`（带尾点，转发层只认这个 Host）。

## 验证

- `python3 tools/upload_promotion_site.py --dry-run`：打包与 ZIP 完整性检查通过。
- 生成的两份远端脚本（有/无 APK）`sh -n` 通过。
- headless Chrome + CDP（第二轮改成点击跳转后复测）：`?platform=ios` 与 `?platform=android` 打开后**停留在落地页**（`stayedOnLanding: true`），点 `#primaryAction` 后分别落到目标页；线上公网地址同样停在落地页、按钮文案为「前往苹果安装页」；
  390×844（CDP 设备模拟）与 500×900 两档 `scrollWidth - clientWidth = 0`，无裁切重叠。
- 正式服 `8.153.70.197:/www/html/webhome` 已发布：8 文件，`index.html` sha256 `cd66f81fec1d3330b711a74c9af681d9c03742d06f8cb81d04ccae90598a4885`；
  服务器本机 `http://127.0.0.1:28800/webhome/` 200，公网转发域名 200 且返回同一份 HTML。
  该机 Caddy 只有 `:28800` 一个站点块，默认 `handle` 的 `root /www/html` 直接吃 `/webhome/`，无需新增路由。

## 2026-11-22 二次调整：取消自动跳转

用户反馈手机上落地页一闪而过看不到，要求改成「用户点一下才跳」。已改为两端都只在点击主按钮后
`location.assign`；删除 `scheduleIOSAutoRedirect` / `IOS_AUTO_REDIRECT_DELAY` / `redirectTimer`，
文案改成「点击后前往安装」「点击按钮跳转到…」。重新发布正式服（index sha `7f613e65…`、app.js `10d16b05…`，本地/线上一致）。

## 2026-11-22 三次调整：安全排查（公网不再留测试服地址）

排查发现两处公网泄露，已修：

- `downloads/BF.mobileconfig` 被一起发布，里面写着 `https://154-37-155-17.nip.io/web-mobile/` 和
  `io.sslip.154-37-155-17...` 三个串 → 上传脚本在跳转模式下**整个 `downloads/` 不打包**，线上已 404。
- `site-config.json` 的 `promotionSiteUrl` 是测试服地址 → 该字段改成可选并从这里删除，公网地址改用 `--public-url` 传；
  `4上传推广网站.command` 已补 `--public-url "https://154-37-155-17.nip.io/webhome/"`。
- `app.js` 只接受 `https:` 目标（`safeHttpsUrl`），配置被改成 http 时忽略并回退内置 https 默认值，控制台留警告；
  实测把 config 改成 `http://evil.example/a.apk` 后点击仍跳 `https://www.gulubase.com/bf888`。
- `index.html` 补 `<meta name="referrer" content="no-referrer">`（响应头本来就有）。

排查结论（无问题的项）：公网 7 个文件里**没有**真实 IP `8.153.70.197`、内网 `172.22.161.x`、
SSH 用户、`/www` 路径、密钥名；目录列举关闭（`/webhome/downloads/`、`/`、`/up/`、`/_incoming/`、
`/.xuanmanager/`、`/.webhome.previous/` 全 404 空响应）；TRACE/PUT 405；文件 644、目录 755；
`Referrer-Policy: no-referrer` + `X-Content-Type-Options: nosniff`。
**遗留风险：落地页只有明文 HTTP（28800 无 TLS，`https://...:28800` 连不上），中间人可篡改 HTML/JS 本身，
JS 的 https 校验挡不住这一层；要根治得用备案域名 + 证书走 443。** 另 `Server: Caddy` 头未隐藏（只暴露软件，不暴露 IP）。

## 2026-11-22 四次调整：安全头（隐藏 Server / CSP / X-Frame-Options）

正式服 `/etc/caddy/Caddyfile` 在 `:28800` 块里 `import security_headers` 之后新增（**只匹配 `/webhome`、`/webhome/*`，不动后台/客服/语音/热更**）：

```
@webhome path /webhome /webhome/*
header @webhome {
    -Server
    Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; object-src 'none'"
    X-Frame-Options "SAMEORIGIN"
}
```

- 改前备份 `/etc/caddy/Caddyfile.bak.sec-20261122-105504`；`caddy validate` → `caddy reload` 均 OK。
- 实测：`/webhome/` 与 `/webhome/app.js` 不再有 `Server` 头，CSP/XFO 对公网转发域名同样生效；
  `/xuanmanager/`、`/chattool/agent`、`/audio/healthz` 仍 200；`/webhome`（无斜杠）仍 308 → `/webhome/`。
- 浏览器实测（390×844）：无 CSP 违规、无 console 报错，样式/粒子/配置加载正常，点按钮落到 `https://www.gulubase.com/bf888`。
- 回滚：`cp /etc/caddy/Caddyfile.bak.sec-20261122-105504 /etc/caddy/Caddyfile && caddy reload --config /etc/caddy/Caddyfile`。
- 仍**明文 HTTP**（用户决定暂不上 TLS）：中间人可篡改 HTML/JS 本身，本轮安全头挡不住这一层。

## 未做 / 注意

- **测试服 `154.37.155.17:/www/html/webhome` 没动**：仍是旧下载页（含旧 APK）。要同步双击 `4上传推广网站.command`；
  注意同步后服务器上那份旧 APK 会被新目录替换掉，历史直链 `/webhome/downloads/*.apk` 会 404。
- 未真机验证（iPhone Safari / 安卓系统浏览器 / 微信内置浏览器）。微信内可能拦截外跳。
- 未提交 git（用户未要求）。
