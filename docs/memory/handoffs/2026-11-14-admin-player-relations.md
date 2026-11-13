# 后台玩家管理：关联账号 / 重复玩家识别

- 日期：2026-11-14
- 目录/分支：`/Volumes/SSD/qing`，`codex/club-ui`
- 依据：`服务器文档整理/重复玩家识别-IP设备关联方案.md` §6

## 目标

玩家列表显示「关联账号数量」，右侧新增「关联账号」按钮；点开列出全部关联账号及关联方式（同设备 / 同 GPS 网格 / 同公网 IP）、强度与最近关联时间。

## 改动文件

| 文件 | 改动 |
| --- | --- |
| `XuanManager/server/internal/api/relations.go`（新增） | 批量聚合：设备 90 天（100 分）、GPS 网格 7 天（60 分）、公网 IP 7 天（30 分），封顶 100；单 IP >20 人、单网格 >50 人不参与；`GET /api/game/players/{playerId}/relations` 最多返回 200 条 + 真实 `total`。 |
| `XuanManager/server/internal/api/players.go` | `playerItem` 增加 `relatedCount` / `relatedVisible`；列表按当前页玩家批量聚合，失败只降级不阻断列表；保留 `ipCode` 检索。 |
| `XuanManager/server/internal/api/server.go` | 注册 `GET /api/game/players/{playerId}/relations`，权限 `game.player.view`。 |
| `XuanManager/server/internal/api/relations_test.go`（新增） | `ipCode` 筛选解析、`sm_ip` 条件、非法短码、分块函数单测。 |
| `XuanManager/web/src/types.ts` | `PlayerItem.relatedCount/relatedVisible`；`PlayerRelationItem` / `PlayerRelationsResponse`。 |
| `XuanManager/web/src/pages/PlayersPage.tsx` | 列表新增「关联账号数量」列和行内「关联账号」按钮；`PlayerRelationsModal` 展示关联玩家、方式标签、强度、最近时间与按方式统计。 |
| `XuanManager/web/src/styles.css` | 关联表、方式标签、强度颜色。 |
| `XuanManager/新后台管理系统接口文档.md` | §4.1 增加返回字段；新增 §4.5.6 关联账号接口。 |

## 口径

- 关联只作排查线索：同设备高置信、同 GPS 网格中置信、同公网 IP 弱线索；不返回原始 IP/GPS/设备码。
- 权限沿用 `game.player.view`（所有能看玩家列表的账号可见摘要与明细）；未按 `admin999` 收口。若要收紧，可在列表与 detail 路由改成 `p.IsProtectedRoot`。
- 数据源：`kbedm.usr_player_device_info`、`kbedm.usr_login_ip_info`；列表页按当前页批量查询，不做 N+1。
- 设备共享人数不隐藏（方案口径），GPS/IP 超阈值不展开。

## 验证

- `gofmt`、`go build ./...`、`go vet ./...`、`go test ./internal/api/` 通过。
- `npx eslint src/pages/PlayersPage.tsx src/types.ts`、`npm run build` 通过。
- 正式库只读核对：两张表结构与索引与方案一致；关联 SQL 全部可执行且返回 0 行（当前无数据）。
- 线上现状（2026-11-14 00:27/00:29）：两张表已创建，baseapp 已重启；`usr_login_ip_info` / `usr_player_device_info` 均为 0 行，等待登录/GPS 上报写入。

## 部署（2026-11-14 00:35 / 修正 00:38，正式 8891）

- 首次部署（00:35）误把关联查询挂在 `s.db`（webcm 库），线上报 `Table 'webcm.usr_player_device_info' doesn't exist`，列表显示「—」、弹窗报「读取关联账号失败」。
- 修正：`relations.go` 全部改用 `s.gameDB`（kbedm），`tbl_Account` 去掉多余库名前缀；`go build/vet/test` 通过。
- 最终二进制：`6a5db2561987ea3d9fbc7af056d188fbf889a100399693535ab1f1727d504516`；前端仍为 `index-CNGGKNet.js` + `index-DLU69bPo.css`。
- 备份：`backups/xuanmanager.20261114-003532-rollback`（首版）、`backups/xuanmanager.20261114-003842-rollback`（修正前）。
- 验收：health 200；`/relations` 未登录 401；00:37 后再无 1146 报错。
- 采集端已开始写入：`usr_player_device_info` / `usr_login_ip_info` 各 1 行（玩家 718968，00:36:56，web、IP 127.0.0.1 非公网、GPS 空）；该账号暂无其他账号同设备，所以关联数为 0。

## 2026-11-14 00:51 列顺序调整

- 「关联账号数量」列从 IP 短码后移到「玩家」列后面（第二列）；表头与单元格同步移动。
- 仅前端变更：`index-D9o9KDVh.js`（CSS 不变），备份 `web.previous-20261114-005117`；health 200，公网已加载新 JS。

## 2026-11-14 00:55 追加：关联账号数量排序

- 表头「关联账号数量」改为可点击排序，顺序：默认 → 降序 → 升序 → 默认；切换时回到第 1 页。
- 列表接口新增 `sort=relatedCount&order=desc|asc`：先取筛选后的全部玩家 ID（上限 2000，超出返回 400 `SORT_TOO_MANY`），批量聚合关联数量后排序再分页；不是只排当前页。
- 后端重构：列表 SELECT/扫描抽成 `playerListSelectSQL` / `queryAndScanPlayerItems`；新增 `matchingPlayerIDs`、`queryPlayerItemsByIDs`、`sortPlayerIDsByRelations`、`playerIDPage`；单测覆盖排序与分页。
- 已部署：二进制 `bb8bdf37156f…`、前端 `index-magx5XK-.js` + `index-DeSwv4Lg.css`；备份 `backups/xuanmanager.20261114-005539-rollback`、`web.previous-20261114-005539`。
- 验收：health 200；公网已加载新 JS（含「按关联账号数量排序」）；`sort=relatedCount` 未登录 401；日志无 ERROR。

## 2026-11-14 00:58 追加：关联数量可点击

- 列表「关联账号数量」数字改为链接样式按钮，点击直接打开同一个关联列表弹窗；0 也可点开查看空状态。
- 仅前端：`index-CmWOABMd.js` + `index-D91Ihw5d.css`，备份 `web.previous-20261114-005758`；health 200，公网包内含 `relation-count-link`。

## 未完成

- 未做登录态页面实操（列显示、弹窗、空状态）；用户需刷新页面确认「—」变为 0。
- 正式设备表没有 `last_ip` / `last_ip_public` 两列，与方案 §4.2/§5.3 的建表/upsert 不一致；当前登录写入未报错，说明游戏服实现已避开这两列，后续修服务端时不要按文档原样加。
- 大页（100 人）关联查询的 p95 未压测；IP 表数据增长后建议按方案关注慢查询与共享阈值告警。
