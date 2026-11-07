# 客服登录即在线 + 托管跳转游戏后台（2026-11-07）

- 目录/分支：`/Volumes/SSD/qing`，`codex/club-ui`（改动全部未提交）
- 只改 `ChatTool/**`，未动客户端、XuanManager

## 背景

1. 客服登录后仍提示「当前接待量已达上限或客服不在线」，接不了会话。
2. 托管聊天要有和客服一样的「在游戏后台查看 / 处理」跳转。

## 根因（现场数据）

线上 `chat_agent`：`kefuadmin` 为 `presence=offline`、`last_seen_at` 停在 16:07、`active=0`，
所以不是接待量满，而是被判离线。链路缺陷：

- `handleAgentHeartbeat` 原本是 `UPDATE ... SET last_seen_at=NOW() WHERE id=? AND presence<>'offline'`：
  一旦被超时判成 offline，心跳既不刷新时间也不能恢复在线 → 客服必须重新登录才能接单。
- `runMaintenance` 每 30s 按 `AgentOfflineAfter`（默认 90s）扫 `last_seen_at`，把客服置 offline。
  与 auth.go「后台已取消上下线切换，登录中的客服始终在线」的口径冲突。

## 改动

- `server/internal/api/auth.go`：心跳无条件 `presence='online', last_seen_at=NOW()` 并触发分配/重平衡。
- `server/internal/api/player.go`：维护任务判离线增加 `NOT EXISTS(有效 chat_agent_session)` 前提，
  即只有登录会话过期才踢下线。
- `server/internal/api/agent.go`：claim 区分 `AGENT_OFFLINE`（不在线）与 `AGENT_CAPACITY`
  （接待量已达上限 x/y），不再混用一句文案。
- `web/src/AgentApp.tsx`：心跳补 `visibilitychange`/`focus`/`online` 触发，切回页面立即恢复在线；
  托管「账号资料」面板头部加「在游戏后台查看 / 处理」（`gameAdminPlayerURL(owner.guuid)`），
      当前会话「对方」增加「对方后台 → 在游戏后台查看」。
- `web/src/styles.css`：新增 `.inline-admin-link`。

## 验证

- `go build ./...`、`go vet ./internal/api`、`go test ./internal/api ./internal/directchat` 全绿；
  `tsc --noEmit`、`eslint src` 无输出；`vite build` 成功。
- 部署（2026-11-07 16:32 +08）：二进制 `6257112114dfb4d3…`（8,716,472 B），
  回滚点 `bin/chattool.previous-onlinelogin-20261107-1632`（旧 `c7f6cd15…`）；
  前端 `index-DWH6KahC.js` / `index-Cuvnyvkw.css`，回滚点 `web.previous-onlinelogin-20261107-1632`。
- 重启后 `127.0.0.1:8893/api/health` = 200，日志 16:32:47「客服服务已启动」，无 ERROR。
- 部署后 `kefuadmin` 由 offline 自动回到 `presence=online`（16:32:58 心跳），
  会话 `expires_at` 2026-11-08 03:56 有效。
- 公网 `http://154.37.155.17/chattool/` 已指向 `index-DWH6KahC.js`。
- 离线判定实测：16:35 把 `kefuadmin.last_seen_at` 手工改成 1 小时前，跨过 30s 维护周期与 90s 阈值后
  （16:36:26 复查）presence 仍为 `online`，旧实现此时会变 offline。验证后未回填（下一次心跳自然覆盖）。

## 未完成 / 待确认

- 真实登录态目视未做：需客服打开工作台确认右上角在线、能正常接入排队会话，
  并确认托管页两个后台链接可打开 XuanManager 玩家页（hash 带 `playerId=`）。
- 取舍：客服关掉页面但不登出，会话 12h 有效期内仍算在线（玩家消息会继续分配）。
  若要"关页面即离线"，需另加页面卸载时主动离线的接口。
