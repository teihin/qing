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
- 联盟成员候选：`GET /api/game/club-perf/candidates?union_id=...`
  - 只返回**代理**：俱乐部创建者，或在本俱乐部持有可用邀请码
    （`club_invite_code_info.status='used'`，即 `is_agent=1`）；**所有层级都返回**。
  - **已开通的人不再返回**（俱乐部级/联盟层/联盟根默认都算），列表只留未开通的代理。
  - 普通玩家（无可用邀请码且非创建者）不出现；`percent=0` 也可能是代理，
    不能再用 `percent` 判断。按 guuid 去重、盟主优先。
  - 弹窗直接列出该列表，支持按玩家ID或昵称搜索；不支持跨联盟添加。
  - 身份：创建者=盟主（联盟根=大盟主），is_agent=合伙人，其余=玩家；
    总览树也按这个口径显示身份（不再直接用报表里的“合伙人”）。
- 核对玩家：`GET /api/game/club-perf/player?union_id=...&player_id=...`
  - 在联盟代理树中定位玩家，返回昵称/俱乐部/身份/是否已开通；
  - 已开通判断：联盟根创建者默认开通；否则查 `club_perf_grant_info`（used）
    或 `club_perf_union_grant_info`（used）。
- 授权：`POST /api/game/club-perf/grant`，`{union_id, player_id}`
  - 调用游戏服 `设置_俱乐部_业绩_授权`（`enabled=1`，`club_id` = 目标所在俱乐部，
    `context` 用 `p@`）；不做取消。
  - 权限 `game.club_perf.grant`；服务端仍按后台游戏账号的授权范围校验。
  - 只允许盟主/代理：创建者或 `is_agent=1`（有可用邀请码）；普通玩家返回
    `PLAYER_NOT_ELIGIBLE`，避免把玩家加成业绩股成员。
  - **限制**：按 v7 文档，联盟层只能授权盟主节点；其他俱乐部的普通代理会返回
    「联盟层只支持盟主节点，其他俱乐部代理请由该俱乐部盟主授权」。
    后台游戏账号自己所在俱乐部的代理可走俱乐部内授权。错误原样弹在弹窗里。
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
- **只展示已授权人员**：报表未命中的节点不展示；未授权盟主被删除后，其已授权下级提升到最近的已授权上级
  （无已授权上级时挂联盟根）。因此 `totalCount == enabledCount`。
- 联盟根默认开通（v7：只有联盟根创建者默认开通）。

## 菜单 / 权限

- 迁移 058：`mgr_module` 在「游戏管理」(id=20) 下新增 `game.club_perf`「业绩股」，
  路由 `/game/club-perf`，sort 40。
- 权限 `game.club_perf.view`「查询业绩股」+ `game.club_perf.grant`「授权业绩股」（059）。
- 页面详情右上「＋ 新增开通人员」：弹窗直接列出**当前联盟全部成员**（名称/ID/俱乐部/
  身份/开通状态），支持按 ID 或昵称搜索；点选后确认开通。成功后 1.2s/2.4s 各刷新一次。
  只有 `game.club_perf.grant` 显示按钮；联盟成员列表里没有的人不能添加。
- 默认只授予 role_id=1（超级管理员）；其他角色需在「角色权限」里分配。
- 后台不提供取消入口（与客户端一致：只授权不取消）。
- 迁移 060：旧「奖池业绩」模块 `visible=0`，菜单隐藏；模块/权限/历史数据保留，可在
  「功能模块」里恢复 visible。已登录会话需刷新/重新登录后菜单才更新。

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
- 2026-11-12 23:33 前端二次部署（联盟列表入口 + 默认只展开联盟根）：
  `index-BztC41gR.js` + `index-BuMkAbiz.css`；回滚目录
  `web.previous-club-perf-list-20261112-2333`。
- 2026-11-12 23:44 三次部署（只列已授权人员 + 过滤未授权节点）：
  后端 `2f4de954…`（10,498,232 字节，回滚 `backups/xuanmanager.20261112-2344-rollback`）；
  前端 `index-5C9MyG7D.js` + `index-OOw2MYcz.css`（JS 925,116 / CSS 246,219 字节，
  与本地一致，回滚 `web.previous-club-perf-auth-20261112-2344`）。
  health 200、未登录接口 401；线上命中「只列出已授权业绩股的人员」。
- 2026-11-12 23:49 四次部署（后台「新增开通人员」+ 059 授权权限）：
  后端 `3b9fe59b…`（10,518,712 字节，回滚 `backups/xuanmanager.20261112-2349-rollback`）；
  前端 `index-ByliZGGH.js` + `index-B64GuSTe.css`（927,764 / 246,672 字节，
  回滚 `web.previous-club-perf-grant-20261112-2349`）。
  迁移 059 已执行，`game.club_perf.grant` 与 role 1 已回读；health 200、
  player/grant 接口未登录 401；线上命中「新增开通人员 / club-perf/grant」。
- 2026-11-13 00:15 五次部署（新增联盟成员下拉选择）：
  后端 `039e896f…`（10,526,904 字节，回滚 `backups/xuanmanager.20261113-0015-rollback`）；
  前端 `index-CKTrwxjy.js` + `index-B64GuSTe.css`（928,700 / 246,672 字节，
  回滚 `web.previous-club-perf-select-20261113-0015`）。
  health 200、candidates 未登录 401；线上命中「从联盟成员选择 / club-perf/candidates」。
- 2026-11-13 00:29 六次部署（弹窗改为联盟成员列表 + ID/昵称搜索；隐藏奖池业绩菜单）：
  后端 `337884cf…`（10,531,000 字节，回滚 `backups/xuanmanager.20261113-0029-rollback`）；
  前端 `index-CAGjTSsD.js` + `index-CzBBGOYh.css`（928,686 / 247,713 字节，
  回滚 `web.previous-club-perf-search-20261113-0029`）。
  迁移 060 已执行：`game.jackpot` visible=0；health 200；线上命中
  「输入玩家ID或昵称 / 没有匹配的联盟成员 / club-perf-candidate-list」。
- 2026-11-13 00:37 七次部署（候选只留盟主/合伙人，修正身份）：
  后端 `4394d83c…`（10,531,000 字节，回滚 `backups/xuanmanager.20261113-0037-rollback`）；
  前端无改动（仍是 `index-CAGjTSsD.js`）。health 200、candidates 未登录 401。
  只读 SQL 复核：联盟 196102 的候选只剩 3 个盟主（percent=100），4 个普通玩家被过滤。
- 2026-11-13 00:43 八次部署（候选改为 is_agent 口径，包含所有层级）：
  后端 `ca078109…`（10,531,000 字节，回滚 `backups/xuanmanager.20261113-0043-rollback`）；
  前端无改动。health 200、candidates 未登录 401。
  只读 SQL 复核联盟 196102：候选为 3 个盟主 + a2/a4 两个各层级代理（共 5 人）；
  a5/z1 无可用邀请码，作为普通玩家被排除。`percent=0` 不再作为判定依据。
- 2026-11-13 00:48 九次部署（候选只留未开通）：
  后端 `9708117b…`（10,531,000 字节，回滚 `backups/xuanmanager.20261113-0048-rollback`）；
  前端 `index-OJTIozTJ.js` + `index-De6POb83.css`（928,452 / 247,535 字节，
  回滚 `web.previous-club-perf-available-20261113-0048`）。列表去掉业绩股状态列；
  health 200、candidates 未登录 401；线上命中「当前联盟没有可添加的代理」。

## 未验证 / 下一步

- 未做登录态页面视觉验收；需用真实联盟确认报表命令已部署 v7、后台游戏账号有报表权限。
- 非超级管理员角色需在「角色权限」里分配 `game.club_perf.view` 才能看到菜单。
- 游戏服报表命令需已部署 v7 且后台游戏账号有报表权限；否则页面会显示
  「读取业绩报表失败」。
- 报表缺 `club_id`，同名俱乐部可能匹配错；如出现同名，建议服务端在报表 `list`
  增加 `club_id`（或后台改为按 `club_id` 逐俱乐部调用）。
- 代理树依赖 `club_agent_info.status='used'`；已退会/未加载的代理不出现。
- 页面默认展开联盟根和盟主层，更深的代理需手动展开。
