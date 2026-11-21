# 2026-11-21 大厅排行榜入口：后台按俱乐部/联盟开关

## 目录 / 分支

- 项目根：`/Volumes/SSD/qing`
- 分支：`codex/club-ui`（俱乐部版，不要合到 main）
- 未提交：本次改动全部留在工作区（另有 11-21 之前未提交的 iOS 音频恢复 3 个 TS 文件，未触碰）

## 目标

大厅「发现」页的「排行榜」按钮原来一直显示。改为后台按俱乐部放行：打开才显示、关闭隐藏；
独立俱乐部自己设置，已入盟的俱乐部由联盟统一设置；玩家切换俱乐部后按新俱乐部重新判定。
同时去掉俱乐部管理 / 联盟管理列表右边的旧「荣耀榜」按钮（荣耀榜配置仍在独立模块「排行榜」）。

## 存储与契约

- `kbedm.usr_hash_info`：`排行榜_俱乐部_<clubId>` / `排行榜_联盟_<unionId>`，值 `1`/`0`，与暗抽开关同一机制，**不需要改游戏服命令**。
- 客户端读 `查询_哈希_信息`（`UserHashInfo` 推送）；后台后端直接读写哈希表并回读校验。
- 详见 `服务器文档整理/大厅排行榜入口开关-客户端与后台接口文档.md`。

## 改动文件

后端（XuanManager Go）：
- `server/internal/api/club_leaderboard_entry.go`（新增）：俱乐部/联盟两条 PUT，校验 `enabled/expectedEnabled/note/confirm`、已入盟俱乐部拒绝单独设置、写入后回读、失败恢复快照、审计 `game.club|union.leaderboard_entry.update`。
- `server/internal/api/club_leaderboard_entry_test.go`（新增）：key 口径、入盟取联盟 key、参数校验。
- `server/internal/api/clubs.go` / `unions.go`：列表新增 `leaderboardEnabled`；俱乐部在列表里给的是**生效值**（入盟读联盟 key）。
- `server/internal/api/server.go`：`PUT /api/game/{clubs|unions}/{id}/leaderboard-entry`。
- `server/migrations/074_club_leaderboard_entry.sql`：`game.club.leaderboard_entry` / `game.union.leaderboard_entry` 权限，按暗抽权限给角色授权 + role 1 兜底。

后台前端：
- `web/src/components/LeaderboardEntryModal.tsx`（新增）：照暗抽弹窗结构，开关 + 原因（2–120 字）+ 确认。
- `web/src/pages/ClubsPage.tsx`：新增「排行榜」状态列（入盟显示「随联盟」）+ 行内「排行榜」按钮（入盟禁用，提示去联盟设置）；**删除「荣耀榜」按钮与弹窗**。
- `web/src/pages/UnionsPage.tsx`：同上（联盟维度，影响联盟下所有俱乐部）。
- `web/src/components/HonorRankModal.tsx`：**删除**（旧行内入口专用，独立模块用 `HonorRankActivityModal`）。
- `web/src/types.ts`：`leaderboardEnabled`、`LeaderboardEntryState`。

客户端（Cocos `assets/scripts/UI/panelMain.ts`）：
- 新增 `RefreshLeaderboardEntry` / `LeaderboardEntryKey` / `ApplyLeaderboardEntry` / `OnLeaderboardEntryHash`；只切 `Main/发现/排行榜` 的 `active`，不动 Prefab。
- 判定：无俱乐部 → 隐藏；`union_id` 非空 → 读联盟 key；确认未入盟 → 读俱乐部 key；归属未知 → 隐藏 + 补查 `查询_俱乐部_信息`，回包后重算。
- 触发：进大厅（含 1 秒补核）、进「发现」页、切换俱乐部、`ClubUnionQuota` 身份更新、`OnClubMembershipChanged`、`club:info` 回包。
- 回包按 key 与 `leaderboardEntryActiveKey` 比对，切俱乐部后迟到的回包只写缓存不改按钮；查询 5 秒超时按隐藏；同 key 10 秒节流。

## 验证结果

- `go build ./...` 通过；`go test ./internal/api/ -run "Leaderboard|DarkSetting"` 通过。
- `go test ./internal/api/` 有一个**既有失败** `TestGameRegistrationHoneypotRejectsAndBansIP`（返回 `REGISTRATION_MOVED` 400），与本次改动无关（该文件未改）。
- `npx tsc --noEmit`（XuanManager/web）通过。
- 客户端 `panelMain.ts` `ts.transpileModule` 0 诊断（只查语法，本机无完整 Cocos 类型环境）。
- 后台**已部署**（2026-11-21 22:15）：`154.37.155.17:/www/html/.xuanmanager`，二进制 sha256 `9c76aa1d4da130f02d790843022a60cbf250041a120f8762c8a29a2182b70536`（本地=线上），进程 22:15:27 起，`/api/health` 200，未登录 `/api/game/clubs` 401，两条新路由 401（存在，非 404）。
- 迁移 `074_club_leaderboard_entry.sql` 已应用；`game.club.leaderboard_entry` / `game.union.leaderboard_entry` 均为 `enabled`，授权角色 `1,4`（与 `game.club.dark_setting` 完全一致）。
- 公网页面已指向新包 `assets/index-BD8zmkfA.js`，响应 sha256 与本地一致；旧 bundle `index-DwHG_91z.js` 保留未删。
- 回滚点：`/www/html/.xuanmanager/backups/20261121-2218-rollback/`（旧二进制 + 旧 web 全量）；回滚 = stop.sh → 还原两处 → start.sh。
- **正式服同步部署**（2026-11-21 22:17）：`8.153.70.197:/www/.xuanmanager`（测试服是 `/www/html/.xuanmanager`），同一二进制 `9c76aa1d…`，pid 19521 @22:17:21，health 200、未登录 `/api/game/clubs` 401、新路由 PUT 401。
  - 迁移 `074` 已在远程库 `172.22.161.126` 应用（本机无 mysql 客户端，用 python3+pymysql 核过），两条权限 `enabled`；正式服只有 `super_admin`（role 1）一个角色，已授权。
  - 前端 `index-BD8zmkfA.js` 已替换，旧包 `index-DwHG_91z.js` 保留；服务器内 Caddy 路由（Host: 8.153.70.197:28800）实测 200 并引用新包。
  - **坑**：正式服 `start.sh` 末尾仍调用已改名 `.disabled` 的 `install-caddy-route.sh`，服务起来后脚本会非 0 退出；部署时用 `bash start.sh || true` 再按 health/pid 判定。
  - 回滚点：`bin/xuanmanager.previous-leaderboardentry-20261121-2220` + `web.previous-leaderboardentry-20261121-2220/`。
  - 外网直连 `8.153.70.197:28800` 仍是 000，走阿里云转发域名回 403「Non-compliance ICP Filing」（备案拦截，与本次部署无关）。
- 离屏 / Creator / 构建 / 热更 / 真机均**未做**。

## 未完成 / 下一步

1. 用有权限的账号（角色 1/4）实测：独立俱乐部开关、入盟俱乐部禁用提示、联盟开关对成员俱乐部生效；注意默认全隐藏，需先放开才有玩家看到入口。
2. 客户端构建后实测：默认隐藏 → 后台开启后进发现页出现；切到另一家俱乐部按新归属变化；入盟俱乐部跟随联盟开关。
3. 若线上 `查询_哈希_信息` 对不存在的 key 回 `0x301` 而非空内容，表现仍是隐藏（5 秒超时），但会多等一次超时，可按需在 `panelMain` 注册 `UserHashError` 立即收尾。
