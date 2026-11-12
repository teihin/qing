# 后台「业绩股」总览模块（2026-11-12）

## 目录 / 分支

- 工作目录：`/Volumes/SSD/qing`
- 分支：`codex/club-ui`
- 改动文件：
  - 新增 `XuanManager/server/internal/api/club_perf.go`、`club_perf_test.go`
  - 新增 `XuanManager/server/migrations/058_club_perf.sql`
  - 新增 `XuanManager/web/src/pages/ClubPerfPage.tsx`
  - 修改 `XuanManager/server/internal/api/server.go`、`XuanManager/web/src/App.tsx`、`XuanManager/web/src/styles.css`

## 目标

后台新增只读「业绩股」总览：以联盟为单位，选择联盟后展示整个联盟的代理树（上级下级）、
每个人的业绩股开通状态与我/下放/剩/业绩占比。客户端只能看到自己的 frontier（已授权下级），
后台要能看到全部代理及未开通状态。

## 数据来源与接口

- 联盟列表：`GET /api/game/club-perf/unions`
  - `kbedm.club_union_info`（status <> 'init'）+ 俱乐部数。
- 联盟总览：`GET /api/game/club-perf/overview?union_id=...&date=YYYY-MM-DD`
  - 联盟/总群主/总群主俱乐部：`kbedm.club_union_info`
    （`club_guuid` 是联盟根 A1）。
  - 俱乐部/创建者：`kbedm.club_guuid_info` + `kbedm.tbl_Account`（`account_id`）。
  - 代理树/上级：`kbedm.club_agent_info`（`status='used'`，`upper_guuid`），
    按 `ca.id` 顺序建树，上级只认已出现的节点，避免环。
  - 开通状态/次数：游戏服 `异步_查询_俱乐部_业绩_报表`，`union_id` 视角，`date`
    转相对天数（昨天 = -1）；报表只含已开通代理，未命中的树节点即未开通。
  - 报表不含 `club_id`，按 `(guuid, 俱乐部名)` 匹配；匹配不到再按 guuid 唯一命中，
    仍不行则挂到该俱乐部盟主/联盟根下，避免已开通代理丢失。

## 口径

- 联盟根（总群主）：`我` = 报表 `all_count`（联盟池总次数）；
  `下放` = A1 的 `granted_count` + 已开通成员盟主的整俱乐部 `M_c`；
  `剩` = 我 - 下放；占比 = 剩/联盟总次数。
- 盟主/代理：用报表的 `my/granted/left/left_percent`，与客户端业绩股页一致。
- 未开通节点：`enabled=false`，次数/占比显示 `—`；未授权盟主的下级按各自授权行生效，不级联。
- 联盟根默认开通（v7：只有联盟根创建者默认开通）。

## 菜单 / 权限

- 迁移 058：`mgr_module` 在「游戏管理」(id=20) 下新增 `game.club_perf`「业绩股」，
  路由 `/game/club-perf`，sort 40。
- 权限 `game.club_perf.view`「查询业绩股」；只读，不提供后台授权/取消入口。
- 默认只授予 role_id=1（超级管理员）；其他角色需在「角色权限」里分配。

## 验证

- `go build ./...`、`go test ./...` 通过（新增 2 个单测：报表解析、联盟树/不级联）。
- 前端 `tsc -b` + `vite build` 通过（dist 被 gitignore）。
- `go vet ./internal/api`、`gofmt`、`git diff --check` 通过。

## 部署（2026-11-12 16:29）

- 后端二进制 `e173c8b2…`（10,457,272 字节，stripped，含本地全部未提交改动），
  线上备份 `backups/xuanmanager.20261112-1627-rollback`。
- 前端 `index-Dz_DYocB.js` + `index-BObRf0tm.css`；旧目录
  `web.previous-club-perf-20261112-1627`。
- 迁移 058 启动时自动执行并回读：`mgr_module`（game.club_perf / 业绩股 / route 40）、
  `game.club_perf.view`、role_id=1 授权均存在。
- health 200；未登录 `/api/game/club-perf/unions` 401；8891 为 xuanmanager 进程，
  8890/8893 不受影响。
- 前端服务产物大小与本地一致（JS 916,820 / CSS 244,017 字节），内容命中
  `CLUB PERFORMANCE SHARES`、`club-perf/overview`、`club-perf-table`。
- 回滚：`install` 回 `backups/xuanmanager.20261112-1627-rollback` + `start.sh`；
  前端 `rm -rf web && mv web.previous-club-perf-20261112-1627 web`。

## 未验证 / 下一步

- 未做登录态页面视觉验收；需用真实联盟确认报表命令已部署 v7、后台游戏账号有报表权限。
- 非超级管理员角色需在「角色权限」里分配 `game.club_perf.view` 才能看到菜单。
- 游戏服报表命令需已部署 v7 且后台游戏账号有报表权限；否则页面会显示
  「读取业绩报表失败」。
- 报表缺 `club_id`，同名俱乐部可能匹配错；如出现同名，建议服务端在报表 `list`
  增加 `club_id`（或后台改为按 `club_id` 逐俱乐部调用）。
- 代理树依赖 `club_agent_info.status='used'`；已退会/未加载的代理不出现。
- 页面默认展开联盟根和盟主层，更深的代理需手动展开。
