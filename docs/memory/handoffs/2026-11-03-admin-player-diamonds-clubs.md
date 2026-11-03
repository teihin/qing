# 2026-11-03 后台玩家管理：钻石余额 + 所在俱乐部

## 范围与目录

- 目录：`/Volumes/SSD/qing/XuanManager`（分支 `codex/club-ui`）。
- 目标：玩家列表去掉现金余额、等级/角色、直属代理；改为钻石余额和所在俱乐部。玩家详情去掉现金余额、平台金币流水和直属代理；新增所在俱乐部页签，显示每个俱乐部的角色、俱乐部金币、上级，并可按俱乐部查看该玩家的全部下级。
- 已完成正式部署；未执行 Git 提交或推送。

## 后端改动

- `server/internal/api/players.go`
  - `playerItem` 增加 `clubs`；新增五个未导出俱乐部关系列，主查询一并读取并在分页结果上批量补俱乐部名称。
  - `attachPlayerClubs` 汇总本页所有俱乐部 ID，一次查询 `club_guuid_info`，过滤 `club_status NOT IN ('init','del')`，避免逐玩家查询。
- `server/internal/api/player_clubs.go`（新增）
  - `GET /api/game/players/{playerId}/clubs`：返回玩家所在俱乐部的名称、状态、模式、角色、俱乐部金币、上级。
  - `GET /api/game/players/{playerId}/clubs/{clubId}/subordinates`：返回该玩家在该俱乐部的全部下级（含 `depth`）。
  - 角色和成员树复用 `clubs.go` 的 `readClubMembers` / `buildClubMemberTree`；`club_gold` 兼容数字与 `{"<clubId>": gold}`，`-99` 为 `null`。
- `server/internal/api/stone_adjustments.go`（新增）
  - `POST /api/game/players/{playerId}/stone-adjustments`，权限复用 `game.player.balance_adjust`。
  - 请求：`action/amount/reason/expectedStone/confirm`；互斥锁内重新读取 `sm_stone`，基准不一致或扣减超量返回 409。
  - 调用旧服务 `异步_设置_玩家_属性`（`name=stone`，传目标绝对值），接受 `512/1280` 后最多循环回读约 4.5 秒；只有回读一致才成功。
  - 审计动作 `game.player.stone_adjust`，避免与金币流水审计混淆。
- 路由登记：`server/internal/api/server.go`。
- 测试：`player_clubs_test.go` 覆盖俱乐部 ID 合并、角色标签、钻石冲突校验。

## 前端改动

- `web/src/pages/PlayersPage.tsx`
  - 列表列：玩家 / 登录账号 / 钻石余额 / 所在俱乐部 / 房间·客户端 / 注册时间 / 最近登录 / 操作。
  - 操作按钮和弹窗改为「加减钻石」，请求新接口；移除现金余额、等级/角色、直属代理及相关高级筛选。
  - 详情页签：基本资料 / 所在俱乐部 / 房间战绩；移除「资金情况」页签和全部平台金币展示。
  - 所在俱乐部卡片展示角色、俱乐部金币、上级，并按需加载该俱乐部的下级玩家表格。
- `web/src/types.ts`：新增 `PlayerStoneAdjustmentResult`、`PlayerClubRef`、`PlayerClubMembership`、`PlayerClubSubordinate`；`PlayerItem.clubs`。
- `web/src/styles.css`：钻石数值、俱乐部芯片、俱乐部卡片/指标/下级表格及响应式样式。

## 验证结果

- `gofmt`、`go build ./...`、`go vet ./...`、`go test ./...` 全部通过。
- `npm run lint`、`npm run build` 通过。
- **未验证**：真实数据库下俱乐部列拼装、真实旧服务 `异步_设置_玩家_属性` 写 `stone` 的返回与回读（尤其离线玩家，见接口文档 §15.2）、页面实际浏览器交互。

## 部署记录（2026-11-03 09:25 CST）

- 后端：Linux amd64 静态二进制，`-trimpath -ldflags "-s -w"`，SHA-256 `6cb80fd0768a7680bd7d18d47f0f85b4704cbdcca0f00f49033daf61a9446122`，已替换 `/www/html/.xuanmanager/bin/xuanmanager`。
- 回滚点：`backups/xuanmanager.20261103-0925-rollback`。
- 前端：`index-DJL003ny.js`（741654 字节）+ `index-DsxfhxqG.css`（209917 字节）；回滚目录 `web.previous-player-clubs-20261103-0927`。
- 验证：`/api/health` 200；新接口 `/clubs`、`/clubs/{clubId}/subordinates`、`/stone-adjustments` 未登录均返回 401（路由已注册，非 404）；线上 JS/CSS 哈希、字节数与本地构建一致；线上 JS 命中「所在俱乐部」「加减钻石」「查看下级玩家」。
- HEAD 基线二进制与线上旧二进制体积均为 9613496 字节；业务 SQL 字符串集合仅有一处 Go 字符串打包边界差异，未发现线上跑非 HEAD 的迹象。
- 未使用真实管理员登录做页面视觉验收；加减钻石未对真实玩家提交写操作。

## 2026-11-03 增加钻石无效果诊断（未修复）

- 线上审计 `mgr_audit_log` id=498：`game.player.stone_adjust`，请求为玩家 `718968` 增加 100000，`before stone=8700`，`after=NULL`，`result_code=500`，消息“加减钻石已提交但回读校验失败”。
- 直接调用旧服务验证：`异步_获取_玩家_属性(name=stone)` 返回 `8700`；`异步_设置_玩家_属性(name=stone, value=8701)` 无论 value 传字符串还是 JSON 数字，都返回 `512 {}`，但 `tbl_Account.sm_stone` 仍为 `8700`。
- 对照探测：`异步_设置_玩家_属性(name=__probe_unknown__)` 同样返回 `512 {}`。说明该命令对不在可写白名单/未实际处理的属性会返回“成功”空结果，不能只看 `ret_code`。
- 文档 §4.4 的 setter 白名单不含 `stone`，§15.2 也说明该命令面向在线实体。当前后台通过它写钻石不可行，回读校验已正确拦截，未把失败当成功。
- 可行方案：A) 后端直写 `tbl_Account.sm_stone`（复用 `gameDB` 写连接，事务 + `FOR UPDATE` + 基准值 + 回读；在线实体可能回写覆盖，需限制离线玩家或要求退出游戏）；B) 游戏服新增专用“增加玩家钻石”命令（最稳）；C) 只对俱乐部群主使用文档已有的 `增加_俱乐部_钻石`，不覆盖普通玩家。
- 本次探测的 +1 未生效，生产钻石仍为 `8700`；未提交新的写操作。

## 下一步

- 用真实玩家分别测试：无俱乐部、单俱乐部、多俱乐部、同一玩家在不同俱乐部角色不同。
- 用在线/离线各一个玩家测试加减钻石，确认 `sm_stone` 回读；若旧服务对 `stone` 属性不生效，需要改为服务端白名单直写并单独审批。
- 需要上线时再执行 XuanManager 后端和前端部署；部署前核对线上二进制与本地 HEAD 同源。
