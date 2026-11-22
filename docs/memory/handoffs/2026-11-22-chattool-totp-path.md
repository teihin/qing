# 客服站两步验证登录报「接口不存在」——前后端接口路径不一致

- 日期：2026-11-22
- 目录/分支：`/Volumes/SSD/qing`，`codex/club-ui`
- 目标：客服账号 `kefuadmin` 在正式服 `/chattool/agent` 输入 6 位动态码后提示「接口不存在」，无法进入工作台。
- 影响服务：ChatTool 客服站（正式服 `8.153.70.197`，Caddy `:28800` → `handle_path /chattool/*`）。

## 根因

`ChatTool/web/src/AgentApp.tsx:199` 请求 `/api/agent/auth/login/totp/verify`，
而 `ChatTool/server/internal/api/server.go:322` 只注册了 `POST /api/agent/auth/totp/verify`
（`ChatTool/web/src/api.ts:66` 的免 CSRF 匿名白名单同样写的是 `/api/agent/auth/totp/verify`）。
多出的一段 `login/` 没有匹配路由，落进 `handleStatic` 的 `/api/` 兜底：
`404 {"error":{"code":"NOT_FOUND","message":"接口不存在"},"ok":false}`。

笔误由提交 `224be0de`（谷歌验证双因素）引入，此后客服站的两步验证登录路径从未打通过；
同一提交里 `SecuritySettingsModal` 用的 `/api/agent/auth/totp/{setup,confirm,disable,recovery}`
是对的，只有登录这一步多写了 `login/`。

## 改动文件

- `ChatTool/web/src/AgentApp.tsx`：该行路径改为 `/api/agent/auth/totp/verify`（唯一改动，未动后端）。
- `docs/memory/CURRENT.md`：加一行摘要。

## 部署与回滚

- 构建：`ChatTool/web` 下 `npm run build` → `dist/assets/index-DHoOetSD.js`（旧 `index-DjuST7cE.js`）。
- 正式服路径是 `/www/.chattool`（**没有 `html` 段**，测试服才是 `/www/html/.chattool`）。
- 只替换 `web/index.html` + `web/assets/`，**没有碰 `web/avatars`**（运行时头像，整体换目录会丢）；
  Go 服务动态读静态盘，**不用重启**。
- 回滚点：`/www/.chattool/backups/20261122-100719/{index.html,assets/}`，覆盖回去即恢复。

## 验证

- 本地与线上 sha256 一致：`index.html` `de413f28…`、`index-DHoOetSD.js` `0ef8a00b…`；
  `index.html` 引用已指向新包。
- 线上 `POST /chattool/api/agent/auth/totp/verify {}` → `400 MISSING_TOTP`（路由已通）；
  旧路径 `login/totp/verify` → `404 NOT_FOUND`（复现原症状）；`/chattool/api/health` → ok。
- 未做：真实账号 + 真实动态码的端到端登录（需客服本人操作，且要 `Ctrl+Shift+R` 强刷，
  否则旧 `index.html` 会去取已删除的旧 JS）。

## 未完成项 / 下一步

- 客服侧确认能否登录（强刷后）。
- 测试服 `154.37.155.17:/www/html/.chattool/web` 是同一个笔误版本，本次**未部署**，按需同步。
- 源码未提交 git（用户未要求提交）。
