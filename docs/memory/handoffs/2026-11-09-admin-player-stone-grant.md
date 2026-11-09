# 2026-11-09 后台玩家管理：发放钻石与发放记录

## 目录与范围

- 工作目录：`/Volumes/SSD/qing`，分支 `codex/club-ui`（工作区另有其他任务未提交改动）。
- 目标：玩家管理按玩家发放钻石，并提供可追溯的发放记录（哪个后台账号、给谁、多少、何时）。
- 发布范围：**只包含本功能**。构建使用 `git archive HEAD XuanManager` 干净副本叠加本次改动，排除了工作区里未提交的「业绩核心共享占比」改动。

## 改动

- 新增 `XuanManager/server/internal/api/player_stone_grants.go`
  - `POST /api/game/players/{playerId}/stone-grants`：校验 6 位玩家ID、1–1,000,000 整数、2–120 字原因、`confirm` 和 `expectedStone`；调用游戏服 `异步_增加_玩家_钻石`（`guuid`、正数 `stone_number`、`context`），成功后回读 `tbl_Account.sm_stone` 与目标一致；成功/失败写 `mgr_audit_log`（`game.player.grant_stone`）。
  - `GET /api/game/players/stone-grants`：读审计成功记录，按关键词和北京时间日期筛选、分页；返回操作账号、玩家、数量、前/后余额、原因、操作号、时间。
- `server/internal/api/balance_adjustments.go`：抽出 `normalizeAdjustmentReasonText`，金币加减原因文案保持不变。
- `server/internal/api/server.go`：注册上述两个路由，均要求 `game.player.grant_stone`。
- 迁移 `053_player_stone_grants.sql`：新增权限（**不写死 id**，避免与既有权限撞号）并授予已有 `game.player.balance_adjust` 的角色及角色 1。
- 迁移 `054_fix_player_stone_grant_permission.sql`：修复首版 053 误用 id=2103 的问题。
- 前端 `web/src/pages/PlayersPage.tsx`：行内「发放钻石」按钮与弹窗（当前钻石、数量、原因、确认）；工具栏「发放记录」弹窗（筛选/分页）；`types.ts` 增加类型；`styles.css` 增加工具栏动作与日期输入样式。
- 文档：`XuanManager/README.md`、`XuanManager/新后台管理系统接口文档.md` §4.5.3。

## 权限事故与修复（重要）

- 首版 053 显式使用 `id=2103`，但该 id 已被迁移 018 的 `game.player.reset_password` 占用。`ON DUPLICATE KEY UPDATE` 把「重置玩家密码」的名称/动作/说明覆盖成了钻石发放，同时因主键冲突没有插入新权限。
- 线上已执行 053 后，054 恢复 2103 为 `重置玩家密码` / `reset_password` / 原说明，并以自增 id（当前 5815）插入 `game.player.grant_stone`，再按 `game.player.balance_adjust` 的角色补齐授权。
- 053 源码已改为不写死 id；**后续新增权限必须先查 `MAX(id)` 与目标 id 是否已占用**。

## 部署与验证

- 线上：`/www/html/.xuanmanager/`，8891 健康检查 200；前端资源 `assets/index-BL3MOz60.js`、`assets/index-DCd0vLpS.css`。
- 最终二进制：`97ebc41900c1b67629f8bc643e112c0ae2758fff30679236baa3205652d770f4`；回滚备份 `backups/xuanmanager.20261109-2153-rollback`（另有 2149/2150/2152 中间版本）。
- 验证：`go vet ./...`、`go test ./...`、`tsc -b`、`eslint`、`vite build` 全过；线上首页 JS 含「发放钻石」「钻石发放记录」；未登录访问两个新接口均返回 401；`mgr_schema_migration` 有 053/054；`mgr_permission` 中 2103 已恢复、5815 为 `game.player.grant_stone`，角色 1/2/3 均有授权。
- **未验证**：没有管理员登录凭据，未做页面实际点击和真实发放；未做真实扣款/发放写操作。
- 游戏服 8890 在 21:54 复核时已停止监听（KBE 进程不在），因此最后一次命令探测无法执行；21:44/21:51 服务可用时，`异步_增加_玩家_钻石` 返回 `ret_code=769` 且 `ret_result` 为空（已部署的 `查询_玩家_钻石流水` 返回 1280），据此判定命令尚未注册。

## 未完成 / 下一步

- **游戏服命令 `异步_增加_玩家_钻石` 仍未生效**：2026-11-09 探测 `/hall/command` 返回 `ret_code=769` 且 `ret_result` 为空（已知已部署命令返回 1280 或带 `error` 文本），按《俱乐部金币与钻石设计说明》§12 该命令状态仍是「待部署」。需在游戏服完成 `scripts/base/Hall.py`（`_actAddPlayerStone` + 注册行）与 `scripts/data/d_halls.py`（`player_stone_add_max`）后重启；当前游戏脚本目录为 root 权限，`client_update` 无法读取/写入。
- 后台已对未部署命令给出明确提示：「游戏服尚未开放钻石发放命令…」。
- 游戏服命令生效后再做一次真实发放冒烟（在线/离线玩家、超限、目标 boss、余额不足）并核对 `usr_cash_water` 的 `平台授钻` 流水。
