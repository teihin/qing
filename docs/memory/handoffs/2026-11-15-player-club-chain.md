# 后台玩家详情「所在俱乐部」显示完整代理链（2026-11-15）

## 目录 / 分支
- 项目根 `/Volumes/SSD/qing`，分支 `codex/club-ui`（保留其他任务未提交改动）
- 后台 `XuanManager/`（Go + React/Vite）

## 需求
玩家管理 → 查看详情弹窗 →「所在俱乐部」页签里，**每个俱乐部**都要显示该玩家在这家俱乐部的**完整代理链**
（本人 → 直属上级 → … → 群主/盟主 → 大盟主），不再只显示一个直属上级。

## 改动文件
### 后端 `XuanManager/server/internal/api/player_clubs.go`
- `playerClubMembership` 增 `chain`；新增 `playerClubChainNode`（`playerId/name/role/roleLabel/upperId/isSelf/depth/missing`）。
- `handleGetPlayerClubs`：在原有「读俱乐部成员」基础上，追加
  - `readUserDataClubMetas`（复用 `user_data.go` 现有查询，拿 `union_id`、`union_name`、`owner_guuid`、创建者 `sm_guuid`）；
  - `readUserDataNames` 批量补大盟主昵称（大盟主通常不是该俱乐部成员）。
- 新增 `buildPlayerClubChain`：从本人在 `club_agent_info`（`readClubMembers` 已给出的 `upperId`）逐级向上回溯，最多 16 环；
  - 成环 → 截断，不重复追加；
  - 上级账号不在本俱乐部成员里 → 追加一个 `missing=true`、`roleLabel=上级账号缺失` 的节点并**停止**，不伪造上级；
  - 关系表不全 → 末尾补俱乐部创建者（有联盟记 `盟主`，无联盟记 `群主`）与联盟 `大盟主`；
  - 成员表角色只到「群主/代理」，创建者/大盟主的角色以俱乐部归属统一改写。
- 单测 `player_clubs_test.go` 新增 4 个：正常回溯到创建者+大盟主、断链、成环截断、独立群主只有本人。

### 前端 `XuanManager/web/src/`
- `types.ts`：`PlayerClubMembership.chain`、新增 `PlayerClubChainNode`。
- `pages/PlayersPage.tsx`：新增 `PlayerClubChainCard`，插在俱乐部卡片「俱乐部金币/上级/模式」之后、
  「俱乐部下级玩家」之前；呈上下链路（↑ 连接），本人高亮、断链节点红底并在底部给出核对提示。
- `styles.css`：`.player-club-chain*` 一组样式。

## 验证结果
- 本地：`go build ./...`、`go vet`、`go test ./internal/api/` 全通过；`npm run lint`、`npm run build` 通过。
- 正式部署（2026-11-15 17:40 CST，8891 已切换）
  - 二进制 sha256 `5352ea1f30aaf7b90ec71f7e1bd6000e03cbe853923fa3238cdf6d8d62ce103e`，`/proc/<pid>/exe` 同哈希；
  - 前端 `index-BuFYhlh_.js` / `index-D2TbASBz.css`，公网 `http://154.37.155.17/xuanmanager/` 已换新资源；
  - `health` 返回 ok；未登录 `GET /api/game/players/<id>/clubs` 返回 401。
- 只读核对 `kbedm.club_agent_info`：主流俱乐部成员基本都带 `upper_guuid`（如 885399 共 10 人、9 人有上级），代理链会有真实深度。

## 回滚点
- `bin/xuanmanager.previous-playerchain-20261115-1740`
- `web.previous-playerchain-20261115-1740`（完整目录）
- 部署脚本 `/www/html/.xuanmanager/deploy-playerchain-20261115-1740.sh`
- 回滚：`stop.sh` → 恢复二进制和 web → `start.sh` → 健康检查。本次无迁移。

## 未完成 / 下一步
- 登录态页面的人工验收（换一个多级代理玩家看链路是否与游戏内一致）未做。
- 「基本资料」页签的「所在俱乐部」仍是俱乐部名 chip，未带链路（页签里俱乐部数据是懒加载的，避免多打一份请求）。
