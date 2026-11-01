# 2026-11-01 后台俱乐部管理模块（列表 / 成员树 / 群主额度）

## 范围

- 目录：`/Volumes/SSD/qing/XuanManager`；分支：`codex/club-ui`；未提交。
- 只改后台（Go + React）。**未触碰客户端** `assets/`：工作区当时已存在他人在做的 4 个客户端改动
  （`panelMain.prefab`、`panelMain.ts`、`ClubManagementView.ts`、`ClubManagementApi.ts`，围绕俱乐部列表
  显示积分/额度两行），全程保留未动。

## 目标

后台新增「俱乐部管理」：

1. 列出所有俱乐部；
2. 点进去看该俱乐部的**成员代理树**；
3. 给**群主**调整俱乐部额度。

## 改动文件

### 新增

- `server/migrations/041_game_clubs.sql` — 模块 `game.clubs`（`/game/clubs`，挂在「游戏管理」下，排序 25）
  + 权限 `game.club.view`(5501) / `game.club.quota_adjust`(5502)，默认只授予 `super_admin`。
- `server/internal/api/clubs.go` — 三个接口与树构造、积分解析、额度校验。
- `server/internal/api/clubs_test.go` — 11 个用例（树、积分、额度入参、回包解析）。
- `web/src/pages/ClubsPage.tsx` — 俱乐部列表 + 成员树弹窗 + 额度调整弹窗。

### 修改

- `server/internal/api/server.go` — 注册三条路由。
- `web/src/App.tsx` — 路由 `/game/clubs`。
- `web/src/components/Layout.tsx` — 侧栏图标 `clubs: "俱"`。
- `web/src/types.ts` — 追加 `ClubListItem` / `ClubMemberNode` / `ClubMemberTree` / `ClubDetailResponse` / `ClubQuotaState` / `ClubQuotaAdjustmentResponse`。
- `web/src/styles.css` — 追加俱乐部列表、树、额度弹窗样式；修正 `.form-grid` 内勾选框被撑成 44px 的既有隐患。
- `新后台管理系统接口文档.md` — 新增 §9.12 记录三条**已实施**接口（与旧的「建议接口」区分）。
- `部署说明.md` — 041 迁移说明与游戏服依赖。
- `README.md` — 功能说明与额度写入约束各一条。

## 接口

| 方法 | 路径 | 权限 |
| --- | --- | --- |
| GET | `/api/game/clubs?keyword=&page=&pageSize=` | `game.club.view` |
| GET | `/api/game/clubs/{clubId}` | `game.club.view` |
| POST | `/api/game/clubs/{clubId}/quota-adjustments` | `game.club.quota_adjust` + CSRF |

## 关键设计决定

1. **群主来源**：`club_guuid_info` **没有 owner 列**，只能按 `tbl_Account.sm_club_make` / `sm_club_make2`
   用 `FIND_IN_SET` 反查。`LIKE` 会把 123456 命中 1234567，已排除。
2. **角色口径**与客户端一致：`club_make` → 群主；`club_invite_code_info.status='used'` → 代理；
   `sm_club_manage` → 管理员；盟主 = 上级为群主的代理。
3. **不伪造关系**：上级不在本俱乐部 / 指向自己 / 成环 → 进 `orphan` 并给提示，不挂进树。
   `upper_guuid` 为空时按游戏服口径兜底挂群主，但**必须**在 `warnings` 里写明是推断。
4. **积分**兼容三种历史形态：数字、`{"俱乐部ID":积分}` JSON 串、`-99` 哨兵（`-99` 返回 `null`，
   界面显示「暂无数据」，**不是 0**）。茶楼/带分模式（`club_mode` 2/3）优先读 `*_2` 列。
5. **额度不落后台表**：唯一真相在游戏服。后台只发 `增加_俱乐部_额度`（单位分）+ 回读 + 审计。
   - 只允许该俱乐部群主，其他身份 `400 CLUB_OWNER_REQUIRED`；
   - 前端输入元、后端换算分；
   - 扣减后可能为负时直接拒绝（`INSUFFICIENT_QUOTA`）；
   - 回读不到额度时返回 `verified=false` + 界面提示人工确认，**不假装成功**；
   - 全程串行（`clubQuotaMutationMu`），避免并发叠加算错。

## 验证

| 项 | 结果 |
| --- | --- |
| `go build ./...` / `go vet ./...` | 通过 |
| `go test ./...`（含新增 11 例） | 通过 |
| `npx tsc --noEmit` / `npm run lint` | 通过 |
| `npm run build` | 通过 |
| 本地 mock 渲染 + Playwright 截图 | 列表、树、折叠、额度表单、额度结果均正常，控制台 0 error |
| 只读角色（非超管、无 quota_adjust） | 「调整额度」按钮为 0 个 |

测试中发现并修掉两个真实缺陷：自引用成员被重复报成「循环引用」；兜底挂群主时没有披露推断关系。
渲染验证发现并修掉勾选框被 `.form-grid input` 撑高的样式污染。

## 未验证 / 待办

- **未连真实游戏库与游戏服**：`club_agent_info` / `club_invite_code_info` 的真实列与数据形态未实测，
  上线前需在测试库跑一次列表 + 树 + 额度。
- **游戏服未部署额度命令**（接口文档 §15 写明服务端代码已改、未部署）：额度调整会失败；
  列表与树不受影响。回读依赖 `查询_俱乐部_额度` 同步返回 `ret_result`，若游戏服只推异步
  `GetClubQuota`、同步回包为空，后台会一直 `verified=false`——需要服务端确认同步通道形态。
- 群主查自己时 `is_agent` 返回 0 还是 1 仍未与服务端确认（影响客户端额度行是否显示，不影响本后台）。
- 未构建 Linux 二进制、未部署、未在真实后台页面登录验证。
- 客户端「俱乐部列表显示积分/额度两行」是他人并行在做，不在本次范围。

## 下一步

1. 在测试库验证两条查询与额度命令真实回包；
2. 与服务端确认 `查询_俱乐部_额度` 的同步返回形态；
3. 需要的话补 ×9.11 的俱乐部操作历史页面（当前文档只是建议接口，未实施）。

## 部署（2026-11-01 已完成）

正式后台 `http://154.37.155.17/xuanmanager/`，Go 仍只监听 `127.0.0.1:8891`，Caddy 路由未改。

- 迁移 `041` 已执行（`mgr_schema_migration` 记录时间 `2026-11-01 14:35:49`），模块 `game.clubs`(54) 与权限 `game.club.view`(5501)/`game.club.quota_adjust`(5502) 已入库。
- 二进制 `bin/xuanmanager` SHA-256 `78f3e41632b7d6c6a8507f19fb7e70192c7ab9c3df71f1efc03adf559720b4c5`；前端 `index.html` `f095e6c8…`、`assets/index-B5Hspszf.js` `032e022d…`、`assets/index-DaFTumKU.css` `3fb12c05…`。公网三个资源哈希与本地构建逐字节一致。
- 回滚点：原二进制 `bin/xuanmanager.previous-club-management-20261101`（`0c602dbd…`，10-30 线上版）+ 原静态目录 `web.previous-club-management-20261101`。中间产物另存 `…-v2-20261101`，可直接删除。

### 部署中发现并修复的契约错误

**游戏服 `查询_俱乐部_额度` 只走 `GetClubQuota` 异步推送，同步回包是空壳**，后台收不到推送，按原实现会永远 `verified=false`。
实测确认真实落库点是 `kbedm.club_agent_info.quota`（bigint，单位**分**），服务端自己读写该列。已改为：
先读该列作为权威值；`quota IS NULL` = 未被授信（`queried=false`，界面显示未确认，**不是 0**）；库里没有代理行时才退回命令。
成员树同时增加 `quotaFen` 字段并在行内展示「额度 x 元」。

### 真实数据验证（正式实例）

- 俱乐部列表：4 个真实俱乐部，群主全部正确反查（`645463`→354326 匿名、`567671`→718968 abc11、`535696`→895742、`479053`→237737）。
- 成员树 `567671`：9 名成员、1 个根、0 orphan、0 warning；三层代理嵌套正确（718968 → 496702 → 580629 → 121500 → 166258/671273/885695）。
- 额度：群主 900000 分（9000 元）、a2 100000 分；未授信成员 `quotaFen=null` 而非 0。
- 写操作真实跑通：群主额度 +1 元 → 900000→900100，`verified=true` 且回库一致；随后扣回 1 元还原到 **900000**（已核对）。留 2 条 `game.club.quota_adjust` 审计（id 479/480），属真实操作留痕，未删。
- 防护验证：非群主 `400 CLUB_OWNER_REQUIRED`；超额扣减 `409 INSUFFICIENT_QUOTA`；写接口无 CSRF `403 BAD_CSRF`；新接口未登录 `401`。
- 验证用的临时会话按 `user_agent` 造、用完即删，未改任何业务配置。

### 仍未验证

- 未在真实浏览器登录态点击页面（只做了接口级 + 公网资源哈希验证）。
- 群主查自己时 `is_agent` 的服务端口径未单独确认（当前后台以 `club_agent_info` 行 + `upper_guuid` 判，不依赖该字段）。
- 客户端 `assets/` 全程未改动。

## 2026-11-01 追加：多维查询 + 性能修复（已部署）

### 查询维度

`GET /api/game/clubs` 新增 `mode=club|player` 两种维度，默认 `club`：

- **俱乐部维度**：`keyword`（ID/名称模糊）、`clubId`（精确）、`name`（模糊）、`ownerId`（按创建者反查）、`status`、`clubMode`、`taxMin/taxMax`、`minMembers/maxMembers`。
- **玩家维度**：`playerId`（精确）、`playerName`（模糊），可再叠 `clubId` 限定范围。语义是「这个人以群主/成员/管理员任一身份所在的所有俱乐部」，用 `EXISTS` 子查询实现，分页仍作用在俱乐部上，同一人多俱乐部不会重复出行。

前端 `ClubsPage` 加了维度切换 + 「更多条件」折叠面板，切维度时清掉另一维度的残留条件。CSP 禁止 eval，验证脚本改用 locator 等待。

### 性能：3.8s → 7ms（约 500 倍）

线上列表实测稳定 **3.8 秒**。逐条计时定位到两个独立瓶颈：

| 瓶颈 | 原因 | 修复 | 效果 |
| --- | --- | --- | --- |
| 列表主查询 3.7s | `WHERE COALESCE(c.club_status,'') NOT IN (...)` 让 `club_status` 索引失效，`possible_keys` 为空，沿主键扫 89 万行再 filesort | 改成直接比较 `c.club_status NOT IN (...)`（该列 `NOT NULL`） | 3.7s → 24ms |
| COUNT 309ms | 同上 | 同上 | 309ms → 19ms |
| 前端 JS 741KB 未压缩 | Caddy `handle_path /xuanmanager/*` 没有 `encode`，Caddy v2 默认不压缩 | 加 `encode gzip` 并 reload | 741KB → 200KB，下载 1.39s → 0.52s |

- 端到端：列表接口 **7–13ms**，玩家维度 **8ms**，页面内「查询→渲染」**57ms**。
- `club_invite_code_info`（90 万行）的代理数聚合本身只要 18–23ms，不是瓶颈，未改。
- 首屏 3.87s → 2.81s（剩余主要是 741KB JS 解析，如需更快可做 code splitting）。

### 本次部署产物

- 二进制 SHA-256 `fa2efa5030cddb727fc1c498ee7cff0d67b3c51de1184b5afe642f52087d7c06`
- 前端 `index.html` `68e9f90e…`、`assets/index-BbpWcchF.js` `fc55d684…`、`assets/index-ap1CGWJx.css` `1770f916…`，公网哈希一致
- 回滚点：`bin/xuanmanager.previous-club-filter-20261101`（上一版）、`web.previous-club-filter-20261101`；Caddy 原配置备份在 `/tmp/Caddyfile.bak-*`

### 真实数据验证

四种维度组合在正式实例上用真实数据跑通：无条件 4 个俱乐部、`keyword=sef`→1、`clubId=567671`→1、`playerId=496702`→1、`playerId=718968`（群主）→1、不存在的玩家→0、`playerId+错误clubId`→0、`ownerId=718968`→1、`minMembers>=9`→1；非法维度与非法 clubId 均 400。

## 2026-11-01 追加：列表显示群主当前额度（已部署）

### 实现

`clubListItem` 新增 `ownerQuotaFen`（分，`null` 表示读不到）：

- 数据源仍是 `kbedm.club_agent_info.quota`，按 `(club_guuid, user_guuid) = (俱乐部, 群主)` 取，`status='used'`。
- 批量查询：用元组 `IN ((?,?),(?,?),...)` **一次查完**，不按行 N+1；`EXPLAIN` 走 `club_user` 索引，4 个俱乐部约 20ms。
- 键用 `clubID + "\x00" + ownerID`，避免不同俱乐部同一人串值。
- `quota IS NULL` 或没有代理行 → 指针为 `nil` → 前端显示「未授信」（灰色小字），**不显示 0**。
- 前端表格在「代理」与「抽成」之间插入「群主额度」列，按 `amountFormatter.format(fen/100) + " 元"` 显示。

### 验证

- 正式实例接口 11–12ms（加列前 7–13ms，基本无变化）。
- 4 个真实俱乐部群主额度与数据库逐条一致：645463→1000000、567671→1040000、535696→1000000、479053→1000000。
- 页面截图确认列已显示、控制台 0 error。
- 补了单测 `TestClubOwnerQuotaKeySeparatesClubsAndPlayers`：确认键能区分俱乐部/群主，且「无数据」与「额度 0」可区分。

### 产物与回滚

- 二进制 SHA-256 `4493434a23d52fd3f41709fa0ce1817e025ffae25f4300f01dc162196efa876e`
- 前端 `index.html` `2599f775…`、`assets/index-DXCDHCfI.js` `d3e3f814…`、`assets/index-CtoOqAi7.css` `f996ba5d…`；公网哈希一致。
- 回滚点：`bin/xuanmanager.previous-club-ownerquota-20261101` + `web.previous-club-ownerquota-20261101`。

### 注意

`567671` 的群主额度在部署时读到 **1040000**，比 2026-11-01 14:40 我验证后还原的 900000 多了 140000。
不是我这次写入的（本次只加只读列），说明期间有其他人/其他入口调过额度；如实记录，未做改动。
