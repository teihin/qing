# ChatTool 客服系统谷歌验证（TOTP）实施交接

- 日期：2026-11-12
- 目录/分支：`/Volumes/SSD/qing`，`codex/club-ui`
- 范围：ChatTool 客服工作台（`/chattool/agent`）；XuanManager 已完成并部署
- 状态：**已部署正式 8893（2026-11-12 14:48）**；迁移 014/015 已执行；隐藏账号 admin999 已创建并验证登录

## 目标

客服账号密码通过后再校验 6 位动态码；支持自助绑定/解绑/恢复码；主管可查看成员绑定状态并重置普通客服。

## 设计要点

1. 登录两阶段：`POST /api/agent/auth/login` 密码通过且已绑定 TOTP 时，只返回 5 分钟一次性 `challengeToken`，**不下发 Cookie、不建会话、不删旧会话**；`POST /api/agent/auth/login/totp/verify` 通过后才执行原登录副作用（删旧会话、建新会话、presence=online、推送 `session.replaced`、派单、重平衡）。
2. 挑战落 `chat_agent_login_challenge`（只存 SHA-256），同账号新挑战作废旧挑战；5 次失败销毁；IP 维度另有 20 次/10 分钟限流（`totpLimiter`）。
3. TOTP：RFC 6238，SHA-1 / 30 秒 / 6 位 / ±30 秒；`totp_last_step` 防重放；同窗口重复码不累计失败次数。
4. 密钥加密：`DeriveTOTPKey(CHAT_TOTP_KEY)` + AES-256-GCM；`CHAT_TOTP_KEY` 未配置时从 `CHAT_PLAYER_LINK_KEY` 派生。**配置后必须保持稳定**，否则已绑定验证器全部失效。
5. 恢复码 10 个、10 位 Base32、只存 SHA-256、一次性；也可用于关闭验证/重生成。
6. 主管重置：`POST /api/agent/team/{id}/totp/reset`，仅主管且目标必须是普通客服；不能重置自己或其他主管。重置会清空密钥/恢复码/挑战、踢会话、置离线、重排接待中的会话、推送下线事件并写审计。
7. 团队列表/转接选项返回 `totpEnabled`；团队弹窗显示已绑定/未绑定与「重置验证」。
8. 前端每次密码登录后，未绑定账号弹一次「建议开启谷歌验证」，可选稍后；普通刷新不重复弹。

## 改动文件

后端：

- `server/internal/security/totp.go`、`seal.go`、`totp_test.go`（新增；RFC 向量、恢复码、AES-GCM 往返）
- `server/internal/api/agent_totp.go`（新增：verify/status/setup/confirm/disable/recovery）
- `server/internal/api/auth.go`（登录分叉、`createAgentSession`/`completeAgentLogin` 抽公共逻辑）
- `server/internal/api/server.go`（路由、`totpKey`、`totpLimiter`、`agentPrincipal.totpEnabled`、会话查询带 `totp_enabled`）
- `server/internal/api/agent.go`（团队列表/选项带 `totpEnabled`、`handleTeamResetTOTP`）
- `server/internal/config/config.go`（`CHAT_TOTP_KEY`，缺省从 `CHAT_PLAYER_LINK_KEY` 派生）
- `server/migrations/014_agent_totp.sql`（新增列/恢复码表/挑战表）

前端：

- `web/src/AgentApp.tsx`（登录二步/恢复码/倒计时、登录提醒、顶栏「安全」、团队绑定状态与重置）
- `web/src/SecuritySettingsModal.tsx`（新增：绑定二维码、确认、恢复码、关闭、重生成）
- `web/src/api.ts`（登录与 `totp/verify` 不带客服身份头、不广播会话失效）
- `web/src/types.ts`（`Agent.totpEnabled`、`TOTPStatus`、`TOTPSetup`）
- `web/src/styles.css`（TOTP/安全弹窗/团队状态样式）
- `web/package.json`、`package-lock.json`（`qrcode-generator` + 类型，零运行时依赖）

## 验证结果

- `go build ./...`、`go test ./...`、`go vet ./...` 通过。
- `npm run lint`、`npm run build` 通过；当前产物 `index-C-PD461x.js` + `index-CQrYCdd7.css`。
- 本地 mock API + 浏览器走通：密码登录 → 未绑定提醒 → 安全弹窗 → 密码确认 → 二维码 → 动态码确认 → 10 个恢复码 → 二步登录（倒计时/恢复码切换）→ 团队弹窗显示「已绑定」→ 重置普通客服后变「未绑定」且按钮消失。
- **未验证**：MySQL 5.7 实库执行 014、真实验证器扫码、真实接口失败/限流分支、正式 8893 发布与回读。

## 部署记录（2026-11-12 14:48）

- 二进制 `ca7715…`（8,814,776 字节，Linux x86-64 静态）；回滚 `backups/chattool.20261112-1449-rollback`。
- 前端 `index-uUI-ueET.js` + `index-BOAGUKXL.css`；回滚 `web.previous-totp-super-20261112-1448`。
- 迁移 014（TOTP 表/列）与 015（`is_super`/`hidden`）已执行；`/api/health` 200；公网新 JS 200、大小一致、`建议开启谷歌验证/重置验证` 均命中。
- 隐藏账号：`admin999`，id=5，role=supervisor，`is_super=1`、`hidden=1`、channel=general、display_name=客服z；前端按普通客服展示（团队行显示「客服」，顶栏显示「在线客服」，不出现特殊头衔）。密码由主人指定，**未写入文档**。
- 验证：admin999 登录成功且返回 `isSuper=true`；团队列表只能看到 4 个可见账号 + 自己；用另一主管（id=1）的可见性条件查询确认 admin999 不可见；测试后已退出，presence=offline、会话数 0。
- 2026-11-12 14:57 按主人要求去掉特殊头衔：显示名改为 `客服z`，团队行按普通客服展示、顶栏显示「在线客服」，代码中不再出现「超级客服」；前端 `index-DjuST7cE.js`，回滚 `web.previous-no-super-label-20261112-1457`。
- 注意：隐藏范围是团队列表、转接候选和在线人数；如果 admin999 实际接待会话，会话记录/聊天里仍会显示处理人名字。若要连工作记录也完全隐蔽，需要另做数据脱敏。

## 部署注意

1. 二进制必须交叉编译：`GOOS=linux GOARCH=amd64 CGO_ENABLED=0`，并用 `file` 确认 ELF x86-64。
2. 迁移 014 随二进制启动自动执行；新列可空，旧代码兼容。
3. 后端与前端同批发布；否则已绑定客服会停在「验证后仍回登录页」。
4. 生产 `CHAT_TOTP_KEY` 可继续不配（从 `CHAT_PLAYER_LINK_KEY` 派生）；一旦配置就必须长期保持。
5. 回滚：回退二进制和 `web` 目录；014 新增列/表不影响旧代码。
6. 正式 8893 前端目录与 Caddy 路由按 ChatTool 部署说明操作（`/chattool/`）。

## 下一步

- 主人用真实账号实测绑定/二步登录/恢复码；admin999 首次登录会提示绑定验证器。
- 两套系统都稳定后，再决定是否加强制开关与「管理员一次性绑定令牌」。
