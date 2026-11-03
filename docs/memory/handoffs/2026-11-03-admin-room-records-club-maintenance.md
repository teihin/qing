# 2026-11-03 房间战绩俱乐部信息 + 房间维护按俱乐部只读展示

## 目标与范围

- 目录：`/Volumes/SSD/qing/XuanManager`（分支 `codex/club-ui`）。
- 房间战绩：列表和详情增加俱乐部名称、俱乐部 ID、创建者、创建者邀请码；支持按俱乐部 ID/名称和创建者邀请码筛选。
- 房间维护：当前所有活跃房间都是俱乐部内部房间。页面改为按俱乐部聚合，俱乐部展开二级显示该俱乐部房间；只做展示，移除解散房间、全部解散和全局创建开关等操作。支持按俱乐部/创建者/邀请码查询。
- 2026-11-03 10:21 CST 已部署正式；已随 `3d0f9ad` 提交并推送到 `origin/codex/club-ui`；未做登录态页面验收。

## 后端改动

- `server/internal/api/club_lookup.go`（新增）
  - `lookupClubInfo` 批量查 `club_guuid_info.club_name`、`tbl_Account.sm_club_make/sm_club_make2` 反查创建者、`club_invite_code_info` 中创建者在本俱乐部最新一条 `used` 邀请码。
  - `lookupClubOwners` 用 `FIND_IN_SET` 批量反查，不逐俱乐部查询。
- `server/internal/api/room_records.go`
  - 列表项和详情返回 `clubId / clubName / creatorId / creatorName / creatorInviteCode`。
  - 列表查询从 `usr_total_score.club_guuid` 取房间俱乐部，按页批量补齐俱乐部信息；详情取首条非空俱乐部。
  - 新增筛选：`club`（6 位数字精确匹配俱乐部 ID，否则按名称模糊）和 `inviteCode`（只匹配该俱乐部创建者的 `used` 邀请码）。
- `server/internal/api/room_maintenance.go`
  - 新增 `GET /api/game/room-maintenance/clubs`：读取 KB 大厅全部活跃房间，按 `club_id` 聚合；支持 `keyword`（俱乐部 ID/名称、创建者 ID/名称、创建者邀请码）和按俱乐部分页。
  - 每个俱乐部返回房间数、玩家/观战/等待带入汇总和 `rooms` 二级列表；空/`0` 俱乐部归入「未归属俱乐部」。
  - 俱乐部分组不再返回任何操作接口：`server.go` 已移除创建开关读写、解散全部、解散指定房间的路由；旧 handler 保留但不再注册，便于未来恢复。
- 测试：新增 `club_lookup_test.go`（ID 规范化、俱乐部/邀请码匹配）；扩展 `room_records_test.go`（俱乐部/邀请码筛选、精确俱乐部 ID）。

## 前端改动

- `web/src/pages/RoomRecordsPage.tsx`
  - 筛选增加「俱乐部 ID / 名称」「创建者邀请码」，请求参数 `club` / `inviteCode`。
  - 列表新增「俱乐部」列（名称、ID、邀请码）；详情首屏显示俱乐部、创建者、邀请码。
- `web/src/pages/RoomMaintenancePage.tsx`
  - 重写为只读：移除解散、全部解散、创建开关及对应弹窗/权限判断。
  - 一级为俱乐部卡片，点击展开二级房间表格；搜索框支持俱乐部/邀请码，按俱乐部分页。
  - 保留刷新、页大小、KB 实时数据来源与失败清空列表口径。
- `web/src/types.ts`
  - 新增 `ClubRoomGroup`、`ClubRoomsResponse`；`RoomRecordOverview` / `RoomRecordListItem` 增加俱乐部字段。
- `web/src/styles.css`
  - 房间战绩筛选项改为可换行布局，新增俱乐部单元格、详情俱乐部行。
  - 新增俱乐部房间筛选、俱乐部折叠组、二级房间表格与状态样式；移动端自适应。

## 验证

- `gofmt`、`go vet ./...`、`go test ./...` 通过。
- `tsc -b`、`eslint src`、`vite build` 通过；产物 `index-efi7NGCa.js`（747195 字节）、`index-BJt7iv_1.css`（214951 字节）。
- 线上库只读核对：`usr_total_score.club_guuid` 可取到 535696/479053/567671/710701；`club_invite_code_info` 中创建者邀请码查询得到 535696→895742→928882、479053→237737→563557。
- **未验证**：未登录后台做页面交互；当前 KB 大厅实时房间为 0，俱乐部折叠/房间二级展示需要在有活跃俱乐部房间时验收。

## 部署记录（2026-11-03 10:21 CST）

- 后端：Linux amd64 静态二进制（`-trimpath -ldflags "-s -w"`），SHA-256 `2865d24c8329cbbfa7e6c16eea70f9e69afadbe549853c24789889758fb44ecc`，9654456 字节；回滚点 `backups/xuanmanager.20261103-1020-rollback`（旧 `402929a6…`，9670840 字节）。
- 前端：`index-efi7NGCa.js`（747195 字节）+ `index-BJt7iv_1.css`（214951 字节）；回滚目录 `web.previous-room-clubs-20261103-1020`。
- 验证：`/api/health` 200；`GET /api/game/room-maintenance/clubs`、`GET /api/game/room-records`、`GET /api/admin/hall/rooms` 未登录均 401；已移除的 `GET /api/game/room-maintenance/creation-control`、`POST .../dissolve-all`、`POST .../{roomId}/dissolve` 均 404；线上 JS/CSS 200 且字节数与本地一致；JS 命中「按俱乐部展示」「创建者邀请码」「查询俱乐部」「未归属俱乐部」。
- 本次无新迁移；`042_game_unions.sql` 已在此前部署执行。KB 实时房间当前为 0，房间维护页显示空列表属于数据现状。

## 下一步

1. 用管理员登录验收：房间战绩俱乐部列/筛选、房间维护俱乐部折叠与邀请码查询。
2. 若以后恢复房间操作，需要重新注册 `game.room_maintenance.dissolve*` / `creation_control` 路由并恢复前端入口，不能仅凭旧文档认为仍然可用。
3. 前端回滚：`rm -rf web && mv web.previous-room-clubs-20261103-1020 web`；后端回滚：`install` 回 `backups/xuanmanager.20261103-1020-rollback` + `start.sh`。
