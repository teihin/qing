# 2026-11-04 后台玩家管理：移除加减钻石

## 范围与目录

- 目录：`/Volumes/SSD/qing/XuanManager`（分支 `codex/club-ui`）。
- 目标：玩家管理不再提供加减钻石入口，后端也不再注册该写接口。

## 改动文件

- `web/src/pages/PlayersPage.tsx`：移除列表「加减钻石」按钮、`adjusting` 状态和 `StoneAdjustmentModal`；页头说明去掉加减钻石。
- `web/src/types.ts`：移除 `PlayerStoneAdjustmentResult`。
- `server/internal/api/server.go`：删除 `POST /api/game/players/{playerId}/stone-adjustments` 路由。
- `server/internal/api/stone_adjustments.go`：整文件删除（含 `stone_adjust` 审计与回读逻辑）。
- `server/internal/api/player_clubs_test.go`：删除 `TestStoneAdjustmentConflict`，其余俱乐部测试保留。
- `新后台管理系统接口文档.md`：删除 §4.5.2 玩家加减钻石，原 §4.5.3 顺延为 4.5.2。
- `README.md`：删除加减钻石功能说明，改为“不提供入口、后端不注册接口”。

## 保留项

- 玩家列表与详情仍只读展示钻石余额。
- `game.player.balance_adjust` 权限与旧金币 `balance-adjustments` 接口未动（页面本就不暴露金币加减）。
- 俱乐部群主钻石池加减不受影响，仍走 `stone-pool-adjustments`。

## 验证结果

- 前端 eslint、`tsc -b`、`vite build` 通过；产物 `index-Cy3VHBNX.js` / `index-DPiy3zG7.css`。
- 后端 `go vet ./...`、`go test ./...` 通过；Linux 二进制 SHA-256 `e055e98ac1929aed4c927eaa3b4718273762709512b3d50da3001d0f81c0fbf4`。
- 部署前同源核对：HEAD 基线二进制 9679032 字节，与线上旧二进制完全一致；HEAD 基线前端 `index-B77sPvpw.js` 与线上一致。
- **未验证**：真实管理员登录后的页面视觉；未对真实玩家执行写操作（接口已不存在）。

## 部署记录（2026-11-04 00:16 CST）

- 后端已替换 `/www/html/.xuanmanager/bin/xuanmanager`，回滚 `backups/xuanmanager.20261104-0016-rollback`；健康检查 200，8891 仅监听 127.0.0.1。
- 前端已替换，回退目录 `web.previous-player-diamond-removal-20261104-0016`；线上 `index-Cy3VHBNX.js` 200、749062 字节，与本地一致。
- 内容校验：线上 JS 中「加减钻石」「stone-adjustments」计数均为 0；「重置密码」「查看详情」仍在；`POST /api/game/players/123456/stone-adjustments` 返回 404。
