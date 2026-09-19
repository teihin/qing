# XuanManager 时间口径修复（去掉多余的 +8 小时）

日期：2026-09-19
目录/分支：`/Volumes/SSD/qing`，`main`（未提交，改动留在工作区）

## 目标

修复后台管理系统「玩家管理」等页面时间比北京时间多 8 小时、北京时间 16:00 后跨到次日的问题。

## 根因

转换层建立在**错误前提**「MySQL 存的是 UTC」上。实测正式服务器：

- 操作系统时区 = `Asia/Shanghai`（`/etc/localtime -> ../usr/share/zoneinfo/Asia/Shanghai`，`date` 显示 CST）；
- MySQL `@@global.time_zone` / `@@session.time_zone` = `SYSTEM`，`NOW()=2026-09-19 23:16:46`、
  `UTC_TIMESTAMP()=15:16:46` → `NOW()`、`CURRENT_TIMESTAMP`、`FROM_UNIXTIME()` 拿到的**本来就是北京时间**；
- `webcm.mgr_*` 时间列全部是 `datetime DEFAULT CURRENT_TIMESTAMP` → 存的也是北京时间
  （实测 admin999 `last_login_at=23:08:49`，正是本人登录时刻）。

于是 `DATE_ADD(x, INTERVAL 8 HOUR)` 变成第二次 +8。实测对照：`FROM_UNIXTIME(lasttime)` 真实值
`2026-09-19 22:56:53`，面板拿到 `2026-09-20 06:56:53`，凡 16:00 后登录一律滚到次日。

前端无问题：线上 `/www/html/.xuanmanager/web/assets/index-Ch377lxc.js` 与本地 `web/dist` 同为
2026-09-15 15:59 构建（481126 B），含 `Asia/Shanghai` + `hourCycle:"h23"`，只是忠实显示后端给错的值。

## 改动文件

后端 `XuanManager/server/`（未提交）：

- `internal/api/players.go`：`FROM_UNIXTIME(NULLIF(k.lasttime,0))` 原值返回（原来包了 `DATE_ADD … +8`），并加时间口径注释。
- `internal/api/bans.go`：3 处（列表 `lasttime`、审计详情、审计最新记录）。
- `internal/api/anti_theft.go`：6 处（`device_bound_at` ×2、`m.date/m.time` ×2、`lasttime` ×2）。
- `internal/api/users.go`：`last_login_at`、`created_at` 原值返回。
- `internal/api/dashboard.go`：最近操作时间原值返回；**今日审计日界**由
  `beijingDayStart.UTC().Format(...)` 改为 `.In(dashboardLocation).Format(...)`（原写法窗口偏 8 小时）。
- `internal/api/visibility.go`、`configuration.go`：审计/公告记录时间原值返回。
- `internal/api/player_optimization.go`：3 处（发牌优化最近操作 ×2、审计详情）。
- `internal/api/transactions.go`：展示时间原值返回；筛选由
  `created_at >= DATE_SUB(?, INTERVAL 8 HOUR)` / `< DATE_SUB(DATE_ADD(?, INTERVAL 1 DAY), INTERVAL 8 HOUR)`
  改为 `created_at >= ?` / `< DATE_ADD(?, INTERVAL 1 DAY)`。
- `internal/api/platform_revenue.go`：`DATE_FORMAT(MAX(refreshed_at), …)` 原值。
- `internal/config/config.go`：`mc.Loc` 由 `time.Local` 改为包级 `beijingLocation`（`time.FixedZone("Asia/Shanghai", 8*60*60)`），并加注释说明库里时间已是北京时间。

保留未动的合法 `INTERVAL`：`auth.go:53` 锁定 15 分钟、`platform_revenue.go:373` 刷新 60 秒、`transactions.go:232` 的 `INTERVAL 1 DAY`。

文档同步（同样未提交）：`XuanManager/新后台管理系统接口文档.md`（§22 时区章节 + 2099 行的 `CURDATE()` 表述）、
`XuanManager/README.md`、`XuanManager/部署说明.md` 第 32 条、`docs/memory/topics/xuanmanager.md`。

## 验证结果

- `go vet ./...` 0 问题；`go test ./...` 四个包全部 ok。
- 线上旧二进制 `strings | grep -c "INTERVAL 8 HOUR"` = 21 行 / 22 处；新二进制 = 0。
- 本地构建未改动 HEAD 的二进制与线上部署版**体积逐字节一致**（12118054 B），全量字符串集合仅链接期打包位置不同
  → 确认本地源码与线上同源，部署不会带出额外差异。
- 序列化链路实测：MySQL 返回北京时间墙上值 → Go（`Loc=+08`）JSON 为 `2026-09-19T22:56:53+08:00` →
  按 `web/src/time.ts` 逻辑渲染为 `09/19 22:56`（修复前为 `09/20`）。
- 部署：备份 `backups/xuanmanager.20260919-2325-timefix-rollback`（sha256 `311526687e00…`）；
  新二进制 sha256 `b05e634447583a8c079563371acd32d70973360e21a717a29e20fc32b7163c7a`，上传后校验一致；
  `stop.sh` → `install` → `start.sh`；`/api/health` HTTP 200；日志 `23:25:34 XuanManager started`。
- 回读（只读 SQL）：玩家列表最近登录恢复为 `2026-09-19 22:56:53 / 22:42:48 / 22:31:47 …`（均 ≤ 现在）；
  `mgr_user.last_login_at = 23:08:49`、审计 `23:09:12` 均与北京时间一致；`ss -ltnp` 确认只有 8891 跑 xuanmanager。

## 未完成项与下一步

- **未登录后台页面做视觉复核**（无管理员凭据）：需主人刷新「玩家管理」等页确认显示。
- 改动**未提交**，工作区留有本次全部修改。
- 前端未重建（本就不需要动）。
