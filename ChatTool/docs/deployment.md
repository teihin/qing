# ChatTool 部署说明

## 前置条件

- Linux amd64；Go 二进制为无 CGO 静态构建。
- MySQL 5.7，本机 `webcm` 库。
- 公网访问地址固定为 `http://154.37.155.17/chattool/`。
- Caddy 将 `/chattool/*` 剥离前缀后代理到 `127.0.0.1:8893`，不要直接开放 8893。
- Caddy 反代默认支持 WebSocket Upgrade；直聊使用 `/chattool/api/direct/ws`，不能在代理层缓冲或改写 Upgrade 请求。浏览器端使用 `wss`，因此承载 Cocos Web/PWA 的公网域名必须有可用 TLS；原生客户端使用原生 `ws/wss` 地址。
- 媒体目录位于持久磁盘，并纳入备份和容量告警。

用户已明确选择不启用 HTTPS。客服密码、玩家身份、聊天内容和上传媒体在 HTTP 下可能被明文窃听或篡改；运行配置必须使用 `CHAT_COOKIE_SECURE=false`，其余 HttpOnly、SameSite、CSRF 和同源保护继续保留。条件允许时仍建议限制管理端来源 IP、内网或 VPN。

## 数据库权限

建议为 ChatTool 使用独立本机账号，只授权：

- `webcm.chat_schema_migration`
- `webcm.chat_%`

所需操作为 `SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX`。迁移不使用外键，不需要 `REFERENCES`。不要复用游戏 `kbedm` 写账号。

## 构建和安装

1. 在 `web/` 执行 `npm ci && npm run lint && npm run build`；`web/.env.production` 会把静态资源、API、SSE 和媒体地址统一构建为 `/chattool/` 前缀。
2. 在 `server/` 执行测试和 Linux 静态构建。
3. 上传 `server/bin/chattool`、`web/dist/`、`deploy/centos7-user/`。
4. 复制 `runtime.env.example` 为权限 `0600` 的 `runtime.env` 并填写真实值。
5. 设置 `CHAT_PLAYER_LINK_KEY`，其值必须与Cocos现有 `Tool.encrypt()` 最终实际使用的口令一致；客户端调用传空字符串时要使用 `Tool.aesKeyBytes()` 的有效默认口令，不可把服务端配置留空。不要打印到日志或写入部署文档。
6. 配置直聊：`CHAT_DIRECT_TICKET_KEY` 至少 16 字符，且必须与游戏服一致；生产保持 `CHAT_DIRECT_ALLOW_DEV_LOGIN=false`。`CHAT_GAME_DB_*` 使用只读账号，仅授予游戏库查询权限。
7. 媒体目录权限设为 `0700`，服务运行用户需要读写权限。
8. 首次启动后确认主管创建成功，然后从运行环境中移除 `CHAT_BOOTSTRAP_PASSWORD`。
9. 把 `Caddyfile.example` 的 ChatTool 规则合并进现有 `http://154.37.155.17` 站点块，不能重复声明同一个 IP 站点。
10. 验证 `/chattool` 308跳转、加密玩家资料进入、客服端、`/chattool/api/health`、SSE、直聊 `ws-ticket → WebSocket → message.new/message.sent` 和100 MB视频上传。

## 备份和保留

- 每日备份全部 `chat_*` 表和媒体目录；数据库与文件必须使用同一恢复点。
- 监控磁盘容量、5xx、数据库连接、待接入数、首响时间和心跳离线数。
- `CHAT_MESSAGE_RETENTION` 默认 `48h`。服务每5分钟自动清理到期聊天和对应媒体文件；客服也可在会话页二次确认后立即清空双方记录。调整保留期前需同步确认业务要求。
- 自动/手动清理是永久删除，不进入回收站；会话状态、派单日志、审计、评价和玩家备忘继续保留。备份介质应采用相同的48小时内容保留策略，否则历史聊天仍可能从备份恢复。
- 当前版本使用文件头白名单、大小限制、不可执行内联和鉴权下载，但没有内置恶意文件扫描引擎。若正式开放 ZIP/PDF 文件发送，应在反向代理或上传流水线接入杀毒扫描，并在扫描完成前隔离附件；未接入前可在前后端移除对应 MIME，只保留图片和视频。
- 多实例部署前增加 Redis/NATS 实时总线和共享对象存储；当前为单实例可靠运行方案。
- `CHAT_MESSAGE_RETENTION` 仅控制客服聊天；直聊使用独立的 `CHAT_DIRECT_RETENTION`、`CHAT_DIRECT_SESSION_TTL` 和 `CHAT_DIRECT_MEDIA_TICKET_TTL`。修改直聊语音上下限时，必须同时核对 AudioServer 的实际限制。

## 发布前验证

按 `qa-checklist.md` 完整检查，尤其是真实 iOS Safari/Android 浏览器的相册、拍摄、视频、后台切换、弱网重连和软键盘。
