# 后台俱乐部管理：钻石池展示与群主额度加/减

## 目录 / 分支

- `/Volumes/SSD/qing`，分支 `codex/club-ui`。
- 只改 `XuanManager/`；未改 `assets/` 与游戏客户端。

## 目标

1. 俱乐部管理界面显示俱乐部钻石池数量。
2. 增加调整群主钻石池功能，支持增加和扣减。
3. 俱乐部管理的「调整群主额度」原先只能增加，补齐扣减。

## 数据口径

- 群主钻石池不是 `tbl_Account.sm_stone`，而是 `club_agent_info` 中该俱乐部创建者那一行的 `stone`（`club_guuid + user_guuid` 唯一）。
- 线上核对：`club_agent_info` 只有 6 行 `stone` 非空，均为群主行且值为 0；`club_stone_exchange_info` 当前为空。
- 增加的官方命令是 `增加_俱乐部_钻石`；客户端接口文档 v1.4 写“只能正数”，本次扣减按负数 `stone_number` 传入，需正式服验证。

## 改动文件

- `XuanManager/server/internal/api/clubs.go`
  - `clubListItem` 新增 `stonePool`；列表批量读 `club_agent_info.stone`（`clubStonePools`），详情读 `readClubStonePool`。
  - 有群主但没有 agent 行时按 0 展示；没有群主时返回 `null`。
- `XuanManager/server/internal/api/club_stone_pool.go`（新增）
  - `POST /api/game/clubs/{clubId}/stone-pool-adjustments`：`action=add/subtract`、整数钻石 1–1,000,000、原因 2–120 字、`expectedStone` 基准校验、扣减不得超过当前池。
  - 增加/扣减都调用 `增加_俱乐部_钻石`，扣减传负数；回读 `club_agent_info.stone`，未回读成功返回 `verified=false` 并提示刷新核对、不要重复提交。
  - 写 `mgr_audit_log`（前后值含群主 ID 与池数量）。
- `XuanManager/server/internal/api/club_stone_pool_test.go`（新增）
  - 动作归一化与请求参数校验测试。
- `XuanManager/server/internal/api/server.go`
  - 新路由，权限 `game.club.stone_pool_adjust`。
- `XuanManager/server/migrations/043_club_stone_pool.sql`（新增）
  - 新增权限 5503；授予已有 `game.union.quota_adjust` 的角色和超级管理员。
- `XuanManager/web/src/types.ts`
  - `ClubListItem.stonePool`、`ClubStonePoolAdjustmentResponse`。
- `XuanManager/web/src/pages/ClubsPage.tsx`
  - 列表新增「钻石池」列、行内「调整钻石池」按钮；详情新增钻石池卡片和群主行按钮。
  - 新增 `ClubStonePoolModal`，支持增加/扣减。
  - `UnionQuotaModal` 增加增加/扣减切换，提交 `action`，补扣减上限、预计值、结果正负号。
- `XuanManager/web/src/styles.css`
  - 俱乐部表格最小宽度 1180px；详情摘要改 5 列。
- `XuanManager/新后台管理系统接口文档.md`
  - 补充 `stonePool`、新接口、权限与负数扣减注意项。

## 验证

- `cd XuanManager/server && go test ./...` 通过；`go vet ./...` 无输出。
- `cd XuanManager/web && npm run lint` 通过；`npm run build` 通过（仅 chunk 体积提示）。
- 只读核对线上库：`club_agent_info.stone` 查询可用，现有群主池均为 0；未做任何写操作。

## 已部署（2026-11-03 20:37）

- 正式 8891 已切换：二进制 `18351c52e8095c969fc0f7d713acca981b04a0b0144bc224a7b007b43c1683dc`，前端 `index-DzEoybUS.js`。
- 迁移 `043_club_stone_pool.sql` 已执行；`mgr_permission` 已有 `game.club.stone_pool_adjust`（5503），当前授予角色 1。
- 健康检查 200；新路由未登录返回 401（路由存在）。旧二进制、旧前端和权限表已备份到 `/www/html/.xuanmanager/backups/`。
- 回滚点：`backups/xuanmanager.20261103-2035-replaced`、`backups/web.20261103-2035-rollback`、`backups/webcm-permissions.20261103-2035.sql`。

## 未验证 / 下一步

- **游戏服 `增加_俱乐部_钻石` 是否接受负数 `stone_number` 未验证**；文档写的是只能正数。若服务端拒绝，需服务端放开负数或新增扣减命令，否则后台扣减会返回 400。
- 未做登录态接口联调；未在浏览器实际点击新增弹窗，前端只做了 lint/build。
- 权限 5503 目前只授予角色 1；如其他运营角色需要调整钻石池，需到「角色与权限」单独勾选「调整群主钻石池」。
