# XuanManager 谷歌验证（TOTP）实施交接

- 日期：2026-11-12
- 目录/分支：`/Volumes/SSD/qing`，`codex/club-ui`
- 范围：**只改 XuanManager 后台**；ChatTool 客服系统未动
- 状态：**已部署正式 8891（2026-11-12 14:14）**；迁移 057 已执行；待主人用真实账号完成绑定/二步登录验收

## 目标

后台账号密码通过后再校验 6 位动态码（Google Authenticator 等标准 TOTP）；支持自助绑定/解绑/恢复码，管理员可重置他人绑定。

## 设计要点

1. 登录分两阶段：`POST /api/auth/login` 密码通过且已绑定 TOTP 时，只返回 5 分钟一次性 `challengeToken`，**不下发 Cookie、不建会话、不踢旧会话**；`POST /api/auth/login/totp` 校验通过后才走原 `replaceUserSession`，保持单点登录语义。
2. 挑战落 `mgr_login_challenge`（只存 SHA-256），同一账号新挑战作废旧挑战；5 次失败销毁；失败计入现有「5 次 / 15 分钟」账号锁定。
3. TOTP：RFC 6238，SHA-1 / 30 秒 / 6 位 / 前后 ±30 秒；`totp_last_step` 拒绝同码重放（同窗口重复码不累计失败次数，提示等下一个码）。
4. 密钥用 `DeriveTOTPKey(XUAN_CREDENTIAL_KEY)` + AES-256-GCM 加密落 `mgr_user.totp_secret`，不存明文。
5. 恢复码 10 个、10 位 Base32（去掉 0/O/1/I）、只存 SHA-256、一次性；恢复码也可用于关闭验证/重生成，避免手机丢失又还登录着时卡死。
6. 管理员重置走 `user.reset_totp` 权限：清空密钥与恢复码、删除该用户全部会话，写审计；受保护根账号与超级管理员不允许通过用户管理重置。
7. 本轮**没有实现强制开关**（`XUAN_TOTP_ENFORCE`）。原因是强制后未绑定账号会被锁死，需要先确认「管理员发一次性绑定令牌」的严格流程；默认行为与升级前完全一致。

## 改动文件

后端：

- `server/internal/security/totp.go`、`totp_test.go`（新增，含 RFC 6238 测试向量）
- `server/internal/security/credential.go`（新增 `DeriveTOTPKey`）
- `server/internal/api/totp.go`（新增登录校验、状态、绑定、确认、关闭、重生成恢复码）
- `server/internal/api/auth.go`（登录分叉、`/auth/me` 返回 `totpEnabled`）
- `server/internal/api/server.go`（路由、`totpKey`、会话查询带 `totp_enabled`）
- `server/internal/api/users.go`（列表 `totpEnabled`、重置二次验证）
- `server/internal/api/models.go`（`principal.TOTPEnabled`、`userItem.totpEnabled`）
- `server/migrations/057_totp.sql`（新增列/表 + `user.reset_totp` 权限，权限不写死 id）

前端：

- `web/src/pages/LoginPage.tsx`（两步登录、动态码/恢复码切换、5 分钟倒计时）
- `web/src/components/SecuritySettingsModal.tsx`（新增：绑定二维码、确认、恢复码、关闭、重生成）
- `web/src/components/Layout.tsx`、`web/src/App.tsx`（顶栏「安全」入口）
- `web/src/pages/UsersPage.tsx`（「二次验证」列 + 重置按钮）
- `web/src/types.ts`、`web/src/api.ts`（类型；控制台日志脱敏 `code/secret/otpauth/recoveryCodes`）
- `web/src/styles.css`（TOTP 相关样式）
- `web/package.json`、`package-lock.json`（新增 `qrcode-generator` + `@types/qrcode-generator`，零运行时依赖；未用 `qrcode` 包）

## 验证结果

- `go build ./...` 通过。
- `go test ./internal/security ./internal/api` 通过（TOTP RFC 向量、±30 秒窗口、恢复码去重/规范化）。
- `go vet ./...` 无输出。
- `npm run lint` 通过；`npm run build` 通过（tsc + vite）。
- 浏览器交互（本地 mock API，未连数据库/未连正式环境）已走通：密码登录 → 安全弹窗「未开启」→ 立即绑定 → 密码确认 → 二维码生成（data URI SVG）→ 动态码确认 → 10 个恢复码展示 → 二步登录（倒计时、动态码/恢复码切换）→ 关闭验证 → 用户列表「已绑定/未绑定」与「重置验证」即时刷新 → 重置成功提示。
- 测试环境注意：`web/.env.local` 默认把 7458 代理指向正式 `154.37.155.17/xuanmanager`；浏览器联调时用环境变量覆盖到本地 mock。

## 部署记录（2026-11-12 14:14）

- 迁移 057 已执行：`mgr_user` 四个 totp 字段、`mgr_login_challenge`、`mgr_user_recovery_code` 均已建；`user.reset_totp` 权限 id=5818（自增），已授 1 个角色。
- 二进制：`195001be…`，10,404,024 字节，Linux x86-64 静态；回滚点 `backups/xuanmanager.20261112-1413-rollback`。
- 前端：`index-BehUNmlq.js`（910,096 字节）+ `index-TdYFIh1F.css`（241,987 字节）；回滚点 `web.previous-totp-20261112-1415`。
- 2026-11-12 14:22 前端补充：每次密码登录成功后，未绑定账号弹一次「建议开启谷歌验证」，可选「稍后再说 / 立即绑定」；只在登录后弹，不在普通刷新时重复打扰。新前端 `index-CKjxC5v_.js`（911,141 字节），回滚点 `web.previous-totp-prompt-20261112-1422`；公网 200、大小一致、文案命中。
- 2026-11-12 14:36 前端样式修正：把动态码输入框选择器改为 `input.totp-code-input`，避免被 `.field > input` 的低优先级覆盖导致字号偏小。产物 `index-Zr6oThDd.js` + `index-CLU3S7Gn.css`，回滚点 `web.previous-totp-css-20261112-1436`；公网 200、大小一致。
- 验证：`/api/health` 200；公网 `/xuanmanager/` 已指向新 JS；新 JS 200 且大小一致，`谷歌验证` 命中 4 处；`/api/auth/login/totp` 伪造挑战返回 401 `CHALLENGE_EXPIRED`；未登录访问 status/reset 均 401；新日志无 ERROR。
- **事故与教训**：第一次构建漏了 `GOOS=linux GOARCH=amd64`，把 macOS 二进制装上线，服务约 1 分钟不可用（`cannot execute binary file`）；已用备份+正确交叉编译恢复。之后构建必须显式设置 GOOS/GOARCH 并 `file` 确认 ELF x86-64。
- **未验证**：真实账号绑定、验证器扫码、二步登录、恢复码、管理员重置、失败/锁定分支；需主人登录实操。

## 上线注意

1. 迁移随二进制启动自动执行（057），新列可空，旧代码兼容；**先发后端，再发前端**。
2. 已绑定用户遇到旧前端会看到「登录后仍是登录页」；因此后端与前端要同批发布。
3. 生产 `XUAN_CREDENTIAL_KEY` 若为空会回退数据库口令；更换任一来源会导致已绑定的 TOTP 密钥解不开，必须全部重新绑定。部署前确认密钥已备份。
4. 当前两端仍是纯 HTTP，TOTP 只能防密码泄露/撞库，防不了链路窃听。
5. 回滚：回退二进制与前端即可；057 的新增列/表不影响旧代码，无需回滚数据库。

## 下一步

- 主人用真实账号完成：绑定 → 退出 → 二步登录 → 恢复码/关闭验证；管理员账号测一次「重置验证」。
- 决定是否加强制开关与「管理员一次性绑定令牌」流程。
- 同一套设计移植到 ChatTool（`chat_agent`、`chat_agent_login_challenge`、`014_agent_totp.sql`）。
