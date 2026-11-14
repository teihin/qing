# 消息页按 roleName 显示盟主/群主（2026-11-14）

## 问题

已入盟俱乐部的创建者在消息列表、聊天标题和成员选择页被显示成“群主”。服务端 `PeerView` 已按俱乐部是否入盟返回 `roleName`（盟主/群主），但客户端没有解析该字段，三个界面都只用 `role` 本地换算，`owner` 一律变成“群主”。

## 改动

- `assets/scripts/logic/DirectChatManager.ts`
  - `DirectPeer` / `DirectMember` 增加 `roleName`。
  - 新增 `DisplayRoleName()`：优先服务端 `roleName`，旧回包才回退到 `RoleName(role)`。
  - 会话、全局列表、创建会话、消息详情、成员列表的解析全部保留 `roleName`。
- `assets/scripts/UI/panelMessage.ts`：列表身份后缀改用 `DisplayRoleName`；本地缓存带 `roleName`，`LIST_CACHE_VERSION` 3→4。
- `assets/scripts/UI/panelMessageChat.ts`：聊天标题改用 `DisplayRoleName`；入口参数保留 `roleName`。
- `assets/scripts/UI/panelMessageMembers.ts`：成员角色改用 `DisplayRoleName`。
- `ChatTool/server/internal/directchat/service.go`：`MemberView` 增加 `roleName` 并回填，供成员选择页使用。
- `ChatTool/server/internal/directchat/service_test.go`：新增 `TestMemberListRoleNameUsesUnionState`，覆盖未入盟=群主、已入盟=盟主。
- 文档：`ChatTool/docs/api.md`、`ChatTool/docs/qa-checklist.md` 明确显示身份以 `roleName` 为准。

## 验证与部署

- ChatTool：`go vet ./...`、`go test ./...`、`go build ./...` 通过。
- 客户端四个 TS 文件 `transpileModule` 0 诊断。
- 2026-11-14 22:07 已部署 ChatTool：二进制 sha256 `92572d4d…`，备份 `bin/chattool.previous-role-name-20261114-220756`（旧 `61b90c69…`）；health ok。
- 未做：客户端 Creator 编译/构建/热更/真机。本修复需要客户端重新构建后才能在游戏内看到。

## 下一步

1. 客户端构建热更后，用已入盟俱乐部的普通玩家查看消息列表、聊天标题和成员选择，创建者应显示“盟主”。
2. 用未入盟俱乐部复核仍显示“群主”。