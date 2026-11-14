# BF 聊天关闭后普通成员隐藏大盟主默认入口（2026-11-14）

## 目标与口径

- 后台关闭某俱乐部的 BF 聊天后，该俱乐部的普通合伙人和玩家在消息页的默认对话只剩「所属盟主（本俱乐部老板）」。
- 盟主账号（本俱乐部老板）仍保留「大盟主」默认入口。
- 重新开启 BF 聊天后恢复「盟主 + 大盟主」。
- 只调整默认对话（固定入口）；已有真实会话仍按普通会话显示，与 2026-11-06 的口径一致。
- 开关仍复用 `chat_direct_bf_club`（没有记录时回落到旧版创建者记录，再没有默认开启）。

## 改动

- `ChatTool/server/internal/directchat/service.go`
  - `defaultTargets()`：联盟大盟主入口增加 `unionOwnerTargetAllowed()` 判定。
  - `isFixedTarget()`：同步口径，BF 关闭时普通成员与大盟主的会话不再标记为固定入口。
  - `unionOwnerTargetAllowed()`：本俱乐部老板恒放行；其余成员读俱乐部 BF 开关，读取失败按开启处理。
- `ChatTool/server/internal/directchat/service_test.go`
  - 新增 `TestBFEntryOffHidesUnionOwnerFromOrdinaryMembers`：覆盖玩家、合伙人、盟主、全局消息首页和重新开启。
- 客户端 `assets/scripts/UI/panelMessage.ts`：`LIST_CACHE_VERSION` 2→3，作废旧缓存里的大盟主入口行；显示逻辑仍只认服务端 `isDefaultTarget`。
- 后台 `XuanManager/web/src/components/BFChatModal.tsx`、`ClubsPage.tsx`：BF 开关说明补充新影响。
- 文档：`ChatTool/docs/api.md`、`ChatTool/docs/qa-checklist.md`、`服务器文档整理/1对1私聊消息-详细设计实施方案-v5.md`。

## 验证与部署

- ChatTool：`go vet ./...`、`go test ./...`、`go build ./...` 通过。
- XuanManager 前端：`npm run build` 通过（仅文案/提示变更）。
- 2026-11-14 21:56 已部署 ChatTool：Linux amd64 二进制 sha256 `61b90c69…`（8,814,776 字节），备份 `bin/chattool.previous-bf-union-owner-20261114-215646`（旧 `4d88de9a…`）；21:56:57 启动，`127.0.0.1:8893/api/health` 与公网 `/chattool/api/health` 均 ok，未登录 `conversations` 401。
- 2026-11-14 21:57 已部署 XuanManager 前端：`index-C3HoOUg9.js` + `index-D91Ihw5d.css`，备份 `web.previous-bf-union-owner-20261114-215646`；公网 `/xuanmanager/` 已引用新资源，JS 内可检索到新文案；后端未改、未重启。
- 未做：客户端 Creator 编译/构建/热更/真机。

## 下一步

1. 用测试俱乐部验证：关闭 BF 后玩家/合伙人只剩盟主入口，盟主仍见大盟主；重新开启恢复。
2. 客户端构建热更后确认旧缓存不残留大盟主入口。
