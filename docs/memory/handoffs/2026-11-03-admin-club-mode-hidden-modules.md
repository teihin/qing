# 2026-11-03 俱乐部模式隐藏代理管理/交易记录/交易黑名单

## 目标与范围

- 目录：`/Volumes/SSD/qing/XuanManager`（分支 `codex/club-ui`）。
- 目标：当前是俱乐部模式，后台不再显示「代理管理」「交易记录」「交易黑名单」三个模块；模块和权限定义保留，切回标准模式可自动恢复。
- 本次只改后端导航过滤，前端无需变更；已部署正式，已随 `3d0f9ad` 提交并推送到 `origin/codex/club-ui`。

## 改动

- `server/internal/api/auth.go`
  - 新增 `clubModeHiddenModules`：`game.agents`、`game.transactions`、`game.transaction_blacklist`。
  - 新增 `filterModulesForGameMode(items, mode)`：`mode == "club"` 时过滤上述模块，其他模式原样返回。
  - `allowedNavigation` 在读取 `mgr_module` 后、按角色/超级管理员返回前统一过滤，因此所有角色（含 super_admin）都看不到这三个入口。
- `server/internal/api/auth_test.go`
  - 新增 `TestClubModeHidesStandardOnlyModules`：俱乐部模式只保留非隐藏模块，standard 模式保留全部。
- 不修改 `mgr_module` / `mgr_permission` 数据，不新增迁移；模块管理页仍能看到定义，便于切回标准模式。

## 验证

- `gofmt`、`go vet ./...`、`go test ./...` 通过。
- Linux amd64 静态二进制（`-trimpath -ldflags "-s -w"`），SHA-256 `402929a68d56e90b8241f836353180c1230c5ff3ba08551e9180ead26db13fe1`，9670840 字节。
- `/api/health` 200；三个隐藏模块的接口仍注册且未登录 401（`/api/game/agents`、`/api/game/transactions`、`/api/game/transaction-blacklist`），属于权限保护而非删除。
- 前端未变，线上仍是 `index-Dvwrp3Q8.js` / `index-DMjExv8d.css`。
- **未验证**：登录态菜单实际显示（没有管理员登录凭据）。现有会话下一次 `/api/auth/me` 刷新或重新登录后生效；若仍看到入口，先强制刷新页面。

## 部署与回滚

- 部署时间：2026-11-03 09:59 CST。
- 回滚点：`/www/html/.xuanmanager/backups/xuanmanager.20261103-0958-rollback`（旧 `8a3f2627…`）。
- 回滚：`install` 回该文件后执行 `/www/html/.xuanmanager/start.sh`。
- 前端回滚点仍为上一版 `web.previous-union-management-20261103-0952`，本次未动前端。

## 下一步

1. 用管理员登录确认左侧菜单只剩俱乐部模式相关模块。
2. 如需连模块管理页也不显示，可另加 `visible=0` 迁移；当前方案是模式级隐藏，不影响 standard 模式。
