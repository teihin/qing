# BF 聊天入口改为默认关闭（2026-11-15）

## 目标与口径

- 后台「俱乐部管理 → BF聊天」入口开关，默认值由**开启**改为**关闭**：没有俱乐部级记录的俱乐部、以及没有俱乐部的账号，都看不到消息页置顶的 BF 聊天入口。
- 需要时仍由后台按俱乐部逐个开启；俱乐部级记录优先于旧版按创建者账号的历史记录。
- 存量数据一并关停：`chat_direct_bf_club` 10 条原本就是 0；旧表 `chat_direct_bf_entry` 2 条 `enabled=1` 置 0（2026-11-15 13:53:54，服务端时间）。
- 客户端无需改动：`panelMessage` 只读 `GET /api/direct/bf-entry` 的 `visible`，服务端返回 false 即隐藏入口，同时隐藏非盟主的大盟主固定对话。

## 改动

- ChatTool 服务端：
  - `internal/directchat/service_bf_entry.go`：`BFEntryStatus` 默认 `enabled=false, visible=false`，无俱乐部直接关；`bfEntryEnabledForClub` 无记录（含无群主、旧表无记录）一律返回 false。
  - `internal/directchat/store_bf_entry.go`：注释口径改为「没有记录时按关闭处理」。
  - `internal/directchat/service_bf_entry_test.go`：重写为默认关闭、后台开启可见、俱乐部级优先、旧表回退四段。
  - `internal/directchat/service_test.go`：`unionEnv` 显式开启两个俱乐部的 BF 开关，否则默认关闭会让「大盟主固定入口」用例失效（行为变化本身是预期）。
- XuanManager 服务端：
  - `internal/api/club_bf_chat.go`：`readClubBFChatStates` 初始值改 false；`readClubBFChatState` 两处兜底改 false。
  - `internal/api/clubs.go`：`BFChatEnabled` 注释改「默认关闭」。
- XuanManager 前端：
  - `components/BFChatModal.tsx`：说明文案改「新建俱乐部默认关闭，需要时逐个开启」。
  - `pages/ClubsPage.tsx`：列表状态与弹窗初值改 `=== true` 判定（原来 `!== false` 会把 undefined 当开启），title 文案改默认关闭。
  - `types.ts`：字段注释同步。

## 验证

- ChatTool：`go build ./...`、`go test ./...` 全部通过。
- XuanManager：`go build ./...`、`go test ./...`；前端 `npm run lint`、`npm run build` 通过。
- 已部署正式机（2026-11-15 13:53，服务器时间）：
  - ChatTool 二进制 sha256 `b1ba8f54b0a5…`（8,814,776 字节）；health 200，`GET /api/direct/bf-entry` 未登录 401。
  - XuanManager 二进制 sha256 `580586bf4f84…`（10,858,680 字节）；health 200、本机首页 200。
  - 前端 `index-Ccu1-Dt0.js` + `index-BTxbi2Xv.css`，公网 `http://154.37.155.17/xuanmanager/` 已加载新资源（200）。
  - 数据：`chat_direct_bf_club` 10 行 `enabled=1` 计 0；`chat_direct_bf_entry` 2 行全部 0。
  - 备份：`/www/html/.chattool/backups/chattool.20261115-135308-pre-bf-chat-off`、`/www/html/.xuanmanager/backups/xuanmanager.20261115-135308-pre-bf-chat-off`、`/www/html/.xuanmanager/backups/xuanmanager.20261115-135308-web-pre-bf-chat-off.tgz`、旧静态目录 `web.previous-20261115-135308`。
- 未执行：后台登录态实操（列表「BF聊天」列应全为关闭）、客户端构建/热更/真机。客户端本身未改代码，部署只需服务端。

## 剩余风险 / 待确认

1. 客户端 `panelMessage.LoadBFEntryStatus` 在首次请求失败时仍兜底显示入口（`ApplyBFVisibility(true)`）。默认关闭口径下这段兜底会短暂露出入口；要改必须构建热更，按需再定。
2. 客户端有 `bfEntryInfo` 会话缓存（force=false 复用），后台改开关后需下拉刷新或重进消息页才生效，属既有行为。
