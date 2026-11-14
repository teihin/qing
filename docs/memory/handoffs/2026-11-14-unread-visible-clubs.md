# 未读红点只统计当前可见俱乐部（2026-11-14）

## 问题

消息底部有红点，但消息列表里没有未读会话。

生产数据定位（用户 121500）：`GET /api/direct/unread` 汇总到俱乐部 `567671` 有 1 条未读，但该俱乐部已不存在，用户 `tbl_Account.sm_club_join` 只剩 `267493`；`/conversations` 的 `conversationView` 会因 `GetClub`/`viewerForClub` 失败跳过这些会话，于是红点和列表不一致。

## 修复

- `ChatTool/server/internal/directchat/service.go` 的 `Unread()`：
  - 按俱乐部逐个调用 `viewerForClub`，与会话列表同一可见性口径。
  - `CLUB_NOT_FOUND` / `NOT_CLUB_MEMBER` 的俱乐部不再计入 `total`/`byClub`。
  - 其他数据库错误仍向上返回，避免故障时静默清零。
- `service_test.go` 新增 `TestUnreadIgnoresClubsUserCannotView`：发消息后退出俱乐部，列表和未读都必须消失。
- `ChatTool/docs/api.md` 补充 `/unread` 口径。

## 部署

- 2026-11-14 22:15 已部署 ChatTool：二进制 sha256 `854d01e6…`；备份 `bin/chattool.previous-unread-visible-20261114-221553`（旧 `92572d4d…`）；启动后 health ok。
- 客户端无需改动；下次 `LoadUnread`（登录、回前台、实时消息、已读回包）会清除这类历史红点。

## 验证

- `go vet ./...`、`go test ./...`、`go build ./...` 通过。
- 未登录 `conversations` 仍 401；真实账号的客户端红点消失待主人复验。