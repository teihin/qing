# 交接：后台玩家管理改为「大小BOSS」= union_manage / club_manage

日期：2026-11-12
目录：`/Volumes/SSD/qing`　分支：`codex/club-ui`

## 目标

按《俱乐部管理权限范围-客户端与后台接口文档》的口径，把后台玩家管理的 BOSS 判定从「等级 99 / 董事长 / 总裁」改为「已配置可管理联盟或俱乐部」：

- 玩家列表整行浅红：`sm_union_manage` 或 `sm_club_manage` 非空。
- 「BOSS号」筛选改为同一条件，文案改为「大小BOSS」。
- 玩家管理新增「管理范围」配置，写 `union_manage` / `club_manage`。

游戏客户端两个入口（我的→数据统计、点头像进 BOSS 面板）的显示改造不在本交接范围，另做。

## 改动文件

### 后台 Go

- `XuanManager/server/internal/api/players.go`
  - `playerItem` 新增 `UnionManage` / `ClubManage` JSON 字段；私有 `clubManage` 改为导出的 `ClubManage`。
  - 列表 SELECT 增加 `sm_union_manage`，`isBoss` 改为两属性非空；`boss=1` 同条件。
  - 游戏服未部署 `sm_union_manage` 时自动退回只看 `sm_club_manage`，避免 `Unknown column` 让整个列表失败。
- `XuanManager/server/internal/api/player_clubs.go`
  - 俱乐部摘要改用 `item.ClubManage`。
- `XuanManager/server/internal/api/player_manage_scope.go`（新增）
  - 列探测、范围 ID 规范化（6 位数字、去重、上限 200）、命令调用、回读校验、审计。
- `XuanManager/server/internal/api/server.go`
  - `POST /api/game/players/{playerId}/manage-scope`，权限 `game.player.manage_scope`。
  - Server 增加列探测缓存字段。
- `XuanManager/server/migrations/059_player_manage_scope.sql`（新增）
  - 权限 `game.player.manage_scope`，挂模块 21（玩家管理）；授权给拥有 `game.player.balance_adjust` 的角色和 role 1。
- `players_test.go` / `player_manage_scope_test.go`
  - 更新 BOSS 筛选断言，新增 ID 规范化与集合比较测试。

### 后台前端

- `XuanManager/web/src/types.ts`：`PlayerItem` 增加 `unionManage`/`clubManage`；新增 `PlayerManageScopeResult`。
- `XuanManager/web/src/pages/PlayersPage.tsx`
  - 行标红/悬停文案改为大小BOSS，玩家单元格显示「联盟 N / 俱乐部 M」。
  - 筛选条件改为「大小BOSS」。
  - 行内新增「管理范围」按钮（`game.player.manage_scope`）+ 配置弹窗：两个逗号分隔输入、留空=清空、确认勾选、旧值并发校验。
  - 玩家详情基本资料增加「管理范围（大小BOSS）」只读区。
- `XuanManager/web/src/styles.css`：只改行标红注释。

### 文档

- `XuanManager/新后台管理系统接口文档.md`
  - `boss` / `isBoss` 口径改为两个属性；返回示例加 `unionManage`/`clubManage`。
  - 新增 §4.5.4 配置接口说明。
- `XuanManager/README.md`：新增管理范围配置说明。

## 实现口径

- 写入只调游戏服 `异步_设置_俱乐部_管理范围`（`guuid`、`union_ids`、`club_ids`、`context`），不直接改游戏库。
- 两个字段每次都提交：空数组=清空，对齐游戏服「不传=保持、传 `[]`=清空」的语义。
- 请求带页面旧值 `expectedUnionManage` / `expectedClubManage`，不一致返回 409，避免两个管理员互相覆盖。
- 命令成功后循环回读 `kbedm.tbl_Account.sm_union_manage / sm_club_manage`（8 次 × 250ms），一致才 `verified=true`。
- 命令未注册 / 列不存在时返回明确错误；成功失败都写 `mgr_audit_log`，`action=game.player.manage_scope`。

## 验证

- 已做：`gofmt`、`go vet ./...`、`go test ./...`、`go build ./...` 通过；`npm run lint`、`npm run build`（tsc + vite）通过。
- 已做：交叉编译 `GOOS=linux GOARCH=amd64`，`file` 确认 ELF x86-64 静态；二进制与前端产物哈希见部署记录。
- 未做：登录态页面实操；用真实账号写入范围。

## 部署（2026-11-12 21:22 / 21:28）

- 第一版（21:22）：二进制 `b820f414…`、前端 `index-BUQMgVQF.js` + `index-BObRf0tm.css`；迁移 059 执行，权限 id=5820、3 个角色授权；游戏服列与命令探测可用。
- 第二版（21:28，当前线上）：弹窗改为勾选联盟/独立俱乐部，新增 `GET /api/game/players/manage-scope/options`。
  - 二进制 `d38c4081…`（10,477,752 字节）；线上 `/proc/17493/exe` 哈希一致。
  - 前端 `index-Bg_ipyz7.js`（923,373 字节）+ `index-C9Avdp0p.css`（245,785 字节）；公网页面已引用，JS 命中「可管理独立俱乐部」。
  - options 接口未登录 401；联盟 4 个、独立俱乐部 2 个（只读统计）。
  - 回滚：二进制 `backups/xuanmanager.20261112-2128-rollback`（`b820f414…`）；前端 `web.previous-managescope2-20261112-2128`。
- health 200；8891 为 xuanmanager 进程，8890/8893 未动；当前库中满足两属性非空的账号为 0，需在页面配置后才出现浅红行。
- 第三版（21:31）：玩家列表和玩家详情按名称展示管理范围；后端批量补 `unionManageNames` / `clubManageNames`（`attachPlayerManageScopeNames`）。
- 第四版（22:29，仅前端）：行内按钮「管理范围」改为「设置管理员」，弹窗标题同步；二进制未动，直接切换 `web` 目录，服务未重启。
  - 前端 `index-CnQgFCHa.js`（923,903 字节），CSS 仍 `index-BXvdQkqt.css`；公网已引用，JS 命中「设置管理员」。
  - 回滚：前端 `web.previous-adminlabel-20261112-2229`（`index-BOk9m2Y6.js`）。
  - 二进制 `87a9b52a…`（10,485,944 字节）；线上 `/proc/18211/exe` 哈希一致。
  - 前端 `index-BOk9m2Y6.js`（923,900 字节）+ `index-BXvdQkqt.css`（245,888 字节）；公网已引用，JS 命中「大小BOSS ·」。
  - 回滚：二进制 `backups/xuanmanager.20261112-2131-rollback`（`d38c4081…`）；前端 `web.previous-scopenames-20261112-2131`。

## 未完成 / 风险

1. 页面只做了构建校验，行标红、筛选、弹窗保存、回显、清空和 409 并发提示待主人验收。
2. 当前没有账号配置范围，需要先在页面给目标账号配置联盟/俱乐部，才能看到标红与筛选效果。
3. 客户端两个入口改用 `union_manage`/`club_manage` 的改造另行处理，本批不包含。

## 下一步

1. 在玩家管理给测试账号配置联盟/俱乐部范围，确认列表标红、筛选、配置回显、清空后标红消失。
2. 打开另一后台账号同时编辑同一玩家，确认 409 并发提示。
3. 再做客户端「我的→数据统计」与「点头像进 BOSS 面板」的入口改造。
