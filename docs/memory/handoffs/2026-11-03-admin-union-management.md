# 2026-11-03 后台联盟管理与「调整群主额度」

## 目标与范围

- 目录：`/Volumes/SSD/qing/XuanManager`（分支 `codex/club-ui`）。
- 目标：后台新增联盟管理模块，查看全部联盟与联盟信息；点「详情」跳到俱乐部管理并过滤该联盟下的俱乐部；俱乐部管理列表行增加「调整群主额度」。
- 额度口径（2026-11-03 用户确认）：V2 下平台后台只给**联盟池**注资，调用游戏命令 `增加_联盟_额度`（仅 boss、只能增加）；俱乐部额度仍由联盟总群主在游戏内 `授信_联盟_额度` 下发，后台不直接改 `club_guuid_info.union_quota`。
- 2026-11-03 09:53 CST 已部署正式；已随 `3d0f9ad` 提交并推送到 `origin/codex/club-ui`；未做登录态页面验收。

## 后端改动

- `server/internal/api/unions.go`（新增）
  - `GET /api/game/unions`（`game.union.view`）：keyword 精确联盟 ID 或模糊名称，分页返回联盟、总群主、总群主俱乐部、联盟池 `poolQuotaFen`、已分配 `totalClubQuotaFen`、成员俱乐部数、状态、创建时间。
  - `GET /api/game/unions/{unionId}`（`game.union.view`）：返回联盟本体与该联盟下俱乐部（含各俱乐部 `union_quota`、群主、人数、抽成）。
  - `POST /api/game/unions/{unionId}/quota-adjustments`（`game.union.quota_adjust`，写操作需 CSRF）：只接受 `action=add`，元转分，原因 2–120 字，显式确认，可选 `expectedPoolQuotaYuan` 并发校验；串行化后调用 `增加_联盟_额度`，回读 `club_union_info.union_quota`；回读失败返回 `verified=false`。审计动作 `game.union.quota_adjust`。
  - 联盟状态读取：注资只接受 `status='used'`；列表/详情排除 `init`，保留 `del` 供查看。
- `server/internal/api/clubs.go`
  - 俱乐部列表/详情增加 `union_id`、`union_quota`、联盟名称和联盟池字段；`ownerQuotaFen` 改读 `club_guuid_info.union_quota`（未入盟为 `null`）。
  - 新增 `unionId` 过滤（必须 6 位数字）。
  - 成员树只给群主显示俱乐部额度，其他节点不再展示已停用的 `club_agent_info.quota`。
  - 删除旧的俱乐部额度写接口 `POST /api/game/clubs/{clubId}/quota-adjustments` 及 `增加_俱乐部_额度` 调用。
- `server/internal/api/server.go`：注册三个联盟接口，移除旧俱乐部额度路由。
- `server/migrations/042_game_unions.sql`：新增模块 `game.unions`（id 55）、权限 `game.union.view` / `game.union.quota_adjust`；给拥有 `game.club.view` / `game.club.quota_adjust` 的角色补发新权限，然后删除旧的 `game.club.quota_adjust` 权限。
- 测试：`unions_test.go` 覆盖联盟 ID、关键字长度、原因规范化和注资前置校验；`clubs_test.go` 增加 `unionId` 非法值与精确绑定测试，移除旧额度接口测试。

## 前端改动

- `web/src/pages/UnionsPage.tsx`（新增）：联盟列表、搜索、分页；行内「详情」跳 `/game/clubs?unionId=...&unionName=...`。
- `web/src/App.tsx`：注册 `/game/unions` 路由与 `game.union.view` 权限；`navigate` 改为 `useCallback` 并去掉查询串后再匹配路由。
- `web/src/components/Layout.tsx`：菜单图标 `unions: 盟`。
- `web/src/pages/ClubsPage.tsx`
  - 从 hash 读取 `unionId/unionName`，显示联盟筛选横幅和「查看全部俱乐部」；hash 变化时同步过滤。
  - 列表新增「联盟」列（联盟名 + 联盟池），「群主额度」改读 V2 俱乐部额度；未入盟显示「未加入联盟」。
  - 行内新增「调整群主额度」；未入盟禁用。弹窗先读取联盟详情，展示当前联盟池与本俱乐部额度，提交只走联盟池注资；详情树里的群主入口复用同一弹窗。
- `web/src/types.ts`：新增联盟列表/详情/注资响应类型，更新 `ClubListItem`。
- `web/src/styles.css`：联盟表格、联盟筛选横幅、联盟池当前值样式与禁用按钮样式。

## 验证

- `gofmt`、`go vet ./...`、`go test ./...` 全部通过。
- Linux amd64 交叉编译通过（`/tmp/xm_union_test`，13487976 字节，未部署）；二进制内命中 `增加_联盟_额度`、`game.union.quota_adjust`。
- `tsc -b`、`eslint src`、`vite build` 通过；产物 `index-Dvwrp3Q8.js`、`index-DMjExv8d.css`。
- 线上库只读核对：`club_union_info` 真实存在，字段为 `union_id/union_name/owner_guuid/owner_name/club_guuid/union_quota/status/date`；`club_guuid_info` 有 `union_id/union_quota/union_apply`；当前联盟表 **0 行**，新列表查询返回空属正常。新增的联盟列表与俱乐部列表 SQL 已在线上库只读执行，无语法/字段错误。
- **未验证**：未登录后台做页面交互、未对真实联盟提交注资。真实联盟产生后需补：联盟列表/详情、俱乐部联盟筛选、注资成功与回读、无权限/未入盟/已解散联盟分支。

## 部署记录（2026-11-03 09:53 CST）

- 后端：Linux amd64 静态二进制（`-trimpath -ldflags "-s -w"`），SHA-256 `8a3f262729d32e4e7962c887a8710e76de397b82f2b6b31cb3c6a6dc2f713edd`，9666744 字节；回滚点 `backups/xuanmanager.20261103-0952-rollback`（旧 `6cb80fd0…`，9654456 字节）。
- 前端：`index-Dvwrp3Q8.js`（750127 字节）+ `index-DMjExv8d.css`（210999 字节）；回滚目录 `web.previous-union-management-20261103-0952`。
- 迁移：启动时自动执行 `042_game_unions.sql`（`2026-11-03 09:53:43`）；模块 `game.unions`(55)、权限 `game.union.view`(5601)/`game.union.quota_adjust`(5602) 已入库；旧 `game.club.quota_adjust` 已删除；当前仅角色 1（super_admin）持有两项新权限。
- 验证：`/api/health` 200；`GET /api/game/unions`、`GET /api/game/unions/123456`、`POST /api/game/unions/123456/quota-adjustments` 未登录均 401（非 404）；线上 JS/CSS 200 且字节数与本地一致；线上 JS 命中「联盟管理」「调整群主额度」「增加_联盟_额度」「当前只显示该联盟下的俱乐部」；端口 8890/8891/8893 正常。
- 线上 `club_union_info` 当前 0 行，所以联盟列表为空属于数据现状，不是接口异常。

## 下一步

1. 用真实管理员登录验收：「联盟管理」列表与「详情」跳转、俱乐部联盟筛选、未入盟按钮禁用。
2. 注资是生产资金写入，必须先得到用户明确授权；有测试联盟后先用最小金额验证回读与审计 `game.union.quota_adjust`。
3. 回滚：后端 `install` 回 `backups/xuanmanager.20261103-0952-rollback` + `start.sh`；前端 `rm -rf web && mv web.previous-union-management-20261103-0952 web`。
