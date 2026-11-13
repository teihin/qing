# BF 聊天开关移到后台俱乐部管理（2026-11-13）

## 目标与口径

- 游戏内盟主/群主消息页不再显示「BF 聊天」开关；置顶 BF 聊天入口本身保留。
- 改为后台「俱乐部管理」行内「BF聊天」设置，按俱乐部开启/关闭，默认开启。
- 关闭后该俱乐部所有层级的代理和玩家在消息列表都看不到置顶 BF 入口；重新开启恢复。
- 俱乐部级记录优先；没有俱乐部记录时回落到旧版 `chat_direct_bf_entry`（按创建者），再没有则默认开启。
- 客户端只读 `GET /api/direct/bf-entry` 的 `visible`；`POST` 保留兼容但一律返回 `DIRECT_BF_ENTRY_FORBIDDEN`，服务端会把 `eligible` 恒设为 false，未更新的旧客户端也会自动隐藏顶部开关。

## 改动

- ChatTool 服务端：
  - `migrations/014_direct_bf_club.sql`：`chat_direct_bf_club(club_id, enabled, updated_at)`。
  - `store_bf_entry.go` / `service_bf_entry.go`：按账号所属俱乐部逐个判定可见性；俱乐部记录优先、旧创建者记录回退、默认开启。
  - `handlers.go` 路由不变，`POST /api/direct/bf-entry` 改为统一拒绝；`model.go` 错误文案更新。
  - `docs/api.md` 与 `service_bf_entry_test.go` 同步。
- XuanManager 服务端：
  - `internal/api/club_bf_chat.go`：列表批量读取、详情单读、写入回读、审计。
  - `clubs.go`：`clubListItem.bfChatEnabled`；列表和详情填充。
  - 路由 `PUT /api/game/clubs/{clubId}/bf-chat`，权限 `game.club.bf_chat`（迁移 `063_club_bf_chat.sql`，同时兜底建表）。
- XuanManager 前端：
  - `ClubsPage.tsx`：新增「BF聊天」列和行内按钮；`BFChatModal.tsx` 提供开启/关闭、二次确认，保存成功关闭弹窗并刷新。
  - `types.ts`、`styles.css` 同步。
- 客户端：
  - `panelMessage.ts` 移除 BF 开关节点绑定、二次确认和写接口调用；只保留入口显隐，列表顶部偏移固定为无开关状态。
  - `DirectChatManager.ts` 移除 `SetBFEntry`；保留 `BFEntryStatus`。

## 验证

- ChatTool：`go build ./...`、`go test ./...` 通过。
- XuanManager：`go build ./...`、`go test ./...` 通过；`npm run build`、ESLint 通过。
- 客户端：`tsc --noEmit` 在 `panelMessage.ts` 无新增错误；`DirectChatManager.ts` 仅有既有 `require`/`fileUtils.getDataFromFile` 环境错误。
- 2026-11-13 已部署正式机：
  - ChatTool 二进制 sha256 `4d88de9adf4c…`（8,814,776 字节）；迁移 `014_direct_bf_club.sql` 于 23:19:43 执行，`chat_direct_bf_club` 表存在；health 200，`POST/GET /api/direct/bf-entry` 未登录 401。
  - XuanManager 二进制 sha256 `c8c35967424a…`（10,715,320 字节）；迁移 `063_club_bf_chat.sql` 于 23:20:19 执行，权限 `game.club.bf_chat` id=5823，已授予角色 1/4；health 200，`PUT /api/game/clubs/111111/bf-chat` 未登录 401。
  - 后台前端 `index-DONYA8VO.js` + `index-D4vx8y2M.css`，公网 `/xuanmanager/` 已加载新资源。
  - 回滚：`/www/html/.chattool/backups/chattool.20261113-231921-pre-bf-chat`；`/www/html/.xuanmanager/backups/xuanmanager.20261113-231921-pre-bf-chat`、`web.previous-20261113-231921`。
- 未执行：客户端 Creator 导入/构建/热更、真机验收。后台登录态页面实操待主人验证。

## 下一步

1. 后台选一个测试俱乐部关闭 BF 聊天，确认列表「BF聊天」列变关闭；用该俱乐部成员与另一俱乐部成员分别进消息页核对入口显隐。
2. 客户端在 Creator 中确认消息页不再出现「BF聊天」开关、「聊天托管」仍然正常，列表顶部无额外空白；构建热更后真机验收。
