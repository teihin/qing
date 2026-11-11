# 后台玩家管理：BOSS 号行标红 + BOSS 号筛选（2026-11-12）

## 目录 / 分支

- 工作目录：`/Volumes/SSD/qing`
- 分支：`codex/club-ui`
- 改动文件：`XuanManager/server/internal/api/players.go`、`players_test.go`、`XuanManager/web/src/pages/PlayersPage.tsx`、`web/src/types.ts`、`web/src/styles.css`、`XuanManager/新后台管理系统接口文档.md`

## 需求与口径（用户确认）

- 玩家列表中，当前玩家是 BOSS 时整行改为浅红底。
- 条件查询新增「BOSS号」条件；用户明确：该条件就是**筛出 `level >= 99` 的玩家**。
- BOSS 行标红口径：`sm_level >= 99` 或 `sm_role` 含「董事长/总裁」（对齐客户端 `GameDataManager.IsBossAccount()`）。
- 由于筛选按用户口径只看 `level >= 99`，行标红与筛选在「董事长/总裁但等级未到 99」的账号上会有差异；线上当前 BOSS 账号 4 个全部是 99 级，暂无实际差异。

## 实现

- 后端 `GET /api/game/players`：
  - 返回每行新增 `isBoss`（SQL 计算，不改表结构）。
  - 新增查询参数 `boss`，`1`/`true` 时追加 `a.sm_level >= 99`；其他值不生效。
- 前端：
  - 更多条件里新增「BOSS号」下拉（全部玩家 / 只看 BOSS 号），空值不拼参数。
  - 列表行按 `isBoss` 加 `player-row--boss` 类，底色 `#fff1f0`、悬停 `#ffe6e3`，并带 title 说明口径。
- 单测新增 `TestBuildPlayerWhereBossOnly`。

## 验证与部署

- 本地：`go vet ./...`、`go test ./...`、`go build` 通过；`eslint`、`tsc -b`、`vite build` 通过。
- 产物核对：二进制含 `a.sm_level >= 99`；JS 含「BOSS号」；CSS 含 `player-row--boss`。
- 已部署正式 8891（2026-11-12 00:05）：
  - 二进制 `aa0aa0f8d4624a0347e98b7d0debec7bd19abcb38daccb679a9847c617067066`（10,293,432 字节）。
  - 前端 `index-DFRw6LXi.js`（872,371 字节）+ `index-B03dpufV.css`（239,752 字节）；线上 JS/CSS 200 且大小与本地一致。
  - health 200、`/api/game/players` 未登录 401；端口仅 8890/8891/8893 正常监听。
  - 回滚：二进制 `backups/xuanmanager.20261112-0005-rollback`；前端 `web.previous-player-boss-20261112-0005`。
- 部署前已确认工作区并行改动（`agent_rewards.go` / `AgentRewardsPage.tsx`）是 2026-11-11 23:06 已上线的版本，本次未夹带新内容。
- 只读 SQL 回读：`sm_level >= 99` 4 个账号（383393 / 718968 / 237737 / 648425），角色均为「老板」。

## 待验证

- 未登录后台做页面实操；行标红与「只看 BOSS 号」筛选的视觉/交互由主人验收。
- 未提交 Git，保留为未提交修改。
