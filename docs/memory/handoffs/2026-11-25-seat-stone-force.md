# 「强制带入钻石」后台按俱乐部/联盟开关

- 日期：2026-11-25
- 目录/分支：`/Volumes/SSD/qing`，`codex/club-ui`
- 状态：后台代码已改并**部署测试服**（`154.37.155.17:/www/html/.xuanmanager`）；**正式服未动**；客户端代码已改，未构建/未真机

## 目标

后台对指定俱乐部或联盟提供「强制带入钻石」开关（默认关闭）。打开后该俱乐部创建房间规则时，
「同步带入钻石」自动打开且玩家不能关闭。

## 存储（与暗抽同构，未新增表）

`kbedm.usr_hash_info`：

| key | 值 | 语义 |
| --- | --- | --- |
| `强制入座扣钻_俱乐部_<clubId>` | `1` / `0` | 缺行/空/非法 = 关闭 |
| 联盟开关 | 写联盟总群主俱乐部（`club_union_info.club_guuid`）的同一个 key | 客户端只读自己 clubId |

## 改动

后台后端（`XuanManager/server`）：

- `internal/api/club_dark_setting.go`：抽出通用 `readBoolHashSetting` / `readBoolHashSettings` / `writeBoolHashSetting`；
  `readClubDarkSetting` / `readClubDarkSettings` / `writeClubDarkSetting` 改为薄封装，行为不变。
- `internal/api/club_seat_stone_force.go`（新增）：`readClubSeatStoneForce(s)` / `writeClubSeatStoneForce`、
  请求校验（`enabled` + `expectedEnabled` + `note` 2–120 字 + `confirm`）、
  `PUT /api/game/clubs/{clubId}/seat-stone-force`、`PUT /api/game/unions/{unionId}/seat-stone-force`；
  写后回读校验、失败按行快照恢复；审计 `game.club.seat_stone_force.update` / `game.union.seat_stone_force.update`。
  已入盟俱乐部在俱乐部页拒绝（`CLUB_IN_UNION`）；联盟无 owner club 拒绝（`UNION_OWNER_CLUB_MISSING`）。
- `internal/api/club_seat_stone_force_test.go`（新增）：key 生成、校验、缺确认、原因过短。
- `internal/api/clubs.go`：`clubListItem.SeatStoneForced`；列表批量读、详情单读。
- `internal/api/unions.go`：`unionListItem.SeatStoneForced`；按 `ownerClubId` 批量/单读。
- `internal/api/server.go`：注册两条路由，权限 `game.club.seat_stone_force` / `game.union.seat_stone_force`。
- `migrations/076_club_seat_stone_force.sql`：两条权限（module 取 `game.clubs` / `game.unions`）+ 从暗抽权限继承角色 + role 1。

后台前端（`XuanManager/web`）：

- `src/components/SeatStoneForceModal.tsx`（新增）：照暗抽弹窗结构；额外读取
  `/api/configuration/club-seat-stone-ratio` 展示当前兑换比例，**为 0 时红字警告但仍允许保存**；
  无 `configuration.stone_consume.view` 权限时提示去找有权限的同事确认比例。
- `src/pages/ClubsPage.tsx`：表头/状态列加「带入钻石」，操作区加「带入钻石」按钮（入盟俱乐部禁用）。
- `src/pages/UnionsPage.tsx`：同上，按 `ownerClubId` 判断可用。
- `src/types.ts`：`ClubListItem.seatStoneForced`、`UnionListItem.seatStoneForced`、`SeatStoneForceState`。

客户端（Cocos `assets/scripts/UI/panelGameSettings.ts`）：

- 新增 `SEAT_STONE_FORCE_HASH_PREFIX = "强制入座扣钻_俱乐部_"`、`SEAT_STONE_FORCE_CONTEXT_PREFIX = "强制带入钻石_"`、5 秒超时。
- 新增 `seatStoneForced` / `seatStoneForceClubId` / `seatStoneForcePendingContext`。
- `onEnable` 与 `openCreateDialog` 各补拉一次（`requestSeatStoneForce(true)`）；`onUserHashInfo` / `onUserHashError` 先判强制 key 再走暗抽。
- `applySeatStoneForced(true)` → `createSeatStone = true`；`refreshSeatStoneRow` 强制时恒显「开」、`cc.Button.interactable = false`、opacity 150、文案改「运营已强制开启（不可关闭）…」暖金色。
- `toggleCreateSeatStone` 在强制态只提示不动状态；`submitCreate` 改为 `createSeatStone || seatStoneForced` 才带 `special_rule`。
- 读取失败/超时按「未强制」放行（服务端会兜底），不影响正常建房。

## 验证

- `go build ./...`、`go vet ./internal/api/` 通过；`go test ./internal/api/ -run 'SeatStoneForce|Dark'` 通过。
- `go test ./internal/api/` 仍有一个**既有失败** `TestGameRegistrationHoneypotRejectsAndBansIP`（返回 `REGISTRATION_MOVED`），与本次无关（该文件未改）。
- 前端 `tsc -b` 通过；`npm run build` 产物 `index-BThf3wkY.js` 1,104,748 B / `index-DfAyHqgH.css`。
- 客户端 `ts.transpileModule` 0 诊断（只查语法）。
- 测试服（23:34–23:36）：
  - 二进制 11,800,760 B、sha `0f5c72c8…`，`strings | grep seat-stone-force` = 2（两条路由在）。
  - `/api/health` 200；未登录新路由 401、不存在路由 404（确认路由已注册）；`dark-setting` 仍 401。
  - 迁移 076 已应用：`game.club.seat_stone_force` / `game.union.seat_stone_force` 均 `enabled`，角色 `1,4`（与暗抽一致）。
  - 前端已切 `index-BThf3wkY.js`，公网 200 且引用新包；回滚点 `backups/web.previous-seatstone-20261125-233507/`。
  - 当前 `kbedm.usr_hash_info` 里 `强制入座扣钻_俱乐部_%` 命中 0 条 → 默认关闭符合预期。

## 注意 / 待验证

- **测试服存在并发部署**：23:34:05 线上二进制在我本地编译的同一秒被替换（`-trimpath` 可复现，同源码同 sha），
  另有 22:17–23:03 一连串 `xm_web_*.tgz`。部署前已核对 `strings` 含本功能路由，但不是本会话上传的；
  后续若另一个会话回退/重编，可能覆盖本次后端改动。
- 客户端未 Creator 导入、未构建、未真机：强制态开关置灰效果、`cc.Button` 是否存在于「同步带入钻石开关」节点、
  说明文案换行都需实机确认（该节点点击已由 `toggleCreateSeatStone` 拦截，即使没有 Button 组件也关不掉）。
- **服务端白干风险**：游戏服尚未读这个 key。在游戏服加校验前，客户端锁只是表现层，改包可绕；
  建议游戏服在 `创建_俱乐部_玩法` 与 `BuildClubPlayRoomSetting` 读取并强制追加 `入座扣钻`。
- 比例 0 的处理是「警告 + 允许保存」（用户 2026-11-25 确认）。
- 关闭开关不会摘掉已有规则的 `入座扣钻`，也不影响已开着的房间。

## 23:40 改名与醒目提示（用户要求）

- 后台按钮/弹窗/权限名统一改成「**强制开房带钻石**」（原「带入钻石」容易误解）；表头显示「强制带钻」（完整名称放 `title`）。
- 列表里**已开启**的俱乐部/联盟改成红字标识：`.club-force-on`（`.styles.css`，`#b02a37` 字 + `#fdeced` 底 + 1px 浅红边 + 700），关闭态仍是灰色文字。
- 后端 `seatStoneForceMessage` 文案同步：「已对…开启强制开房带钻石」/「已取消…的强制开房带钻石」。
- 测试服重新部署（23:40:45）：二进制 sha `adfc2703…`（磁盘=进程），health 200，前端 `index-C5ZkeWYK.js` 1,105,180 B / `index-D0Wf5v9H.css`；
  权限表 name 已 UPDATE 为「强制开房带钻石」；两条路由未登录 401；回滚点 `bin/xuanmanager.previous-seatstonename-20261125-234045` +
  `backups/web.previous-seatstonename-20261125-234045`。**正式服仍未动。**
- 部署前发现线上 bin 已被并发部署换成 `32ed6cca…`（23:36 之后），本次已覆盖为 `adfc2703…`；再有人重编会再次覆盖，核对请用 `sha256sum /proc/<pid>/exe`。

## 23:51 正式服发布（用户验收后）

- 部署 `8.153.70.197:/www/.xuanmanager`，二进制 sha `adfc2703…`（与测试服同一份），pid 8175 @23:51:04，
  磁盘 sha = 进程 `/proc/<pid>/exe` sha；单 supervisor（8168）+ 单 bin 进程，日志无报错。
- 前端切 `index-C5ZkeWYK.js` 1,105,180 B / `index-D0Wf5v9H.css`，Caddy（Host `8.153.70.197:28800`）200，
  JS 内含「强制开房带钻石」、CSS 含 `club-force-on`。
- 迁移 076 已随启动执行：两条权限 enabled、name「强制开房带钻石」、module 54/55；正式服只有 role 1，已授权。
- 路由：`PUT .../seat-stone-force` 两条未登录 401，不存在路由 404（确认真实注册）。
- 回滚点：`bin/xuanmanager.previous-seatstonename-20261125-235103` + `backups/web.previous-seatstonename-20261125-235103`；
  回滚 = `./stop.sh` → 还原两处 → `bash ./start.sh || true`。
- **发布范围提醒**：正式服此前停在 16:51 版本（`e0744d9b…`），本次按「最新工作区」全量构建，
  连带把今天下午起未提交的自动化模块改动（`automation_stream` / `realtime` / 机器人 profile 等）一起上了正式服，
  这些改动在测试服已跑数小时、无 TODO/调试残留。若要只回退本功能，不要回滚整个二进制。
- 正式服 `start.sh` 末尾仍调用已禁用的 `install-caddy-route.sh`，用 `bash start.sh || true` 执行，按 health/pid 判定。
