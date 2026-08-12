# ChatTool API 摘要

所有浏览器接口同源提供 JSON；写接口要求对应会话、同源和 CSRF。错误统一为：

```json
{"ok":false,"error":{"code":"ERROR_CODE","message":"可读错误"}}
```

## 玩家接口

- `POST /api/player/session`：提交含 `channel` 的客户端 AES 加密资料并建立HttpOnly会话；缺省通道兼容为 `general`。响应含非敏感 `sessionRef`，允许同一浏览器标签页并行保持不同通道会话。
- `GET /api/player/me`：玩家、会话、在线客服数和 CSRF。
- `GET /api/player/events`：SSE 实时事件。
- `GET/POST /api/player/messages`：聊天记录与文字发送；本通道没有在线客服时发送返回409 `NO_AGENT_ONLINE`。
- `POST /api/player/uploads`：图片、视频或文件；本通道没有在线客服时上传返回409 `NO_AGENT_ONLINE`。
- `POST /api/player/typing`、`POST /api/player/read`：输入和已读。
- `POST /api/player/end`：玩家结束咨询。
- `POST /api/player/satisfaction`：结束后 1～5 分评价。

## 客服接口

- `POST /api/agent/auth/login`、`GET /api/agent/auth/me`、`POST /api/agent/auth/logout`；同账号新登录会撤销旧会话并推送 `session.replaced`。
- `POST /api/agent/presence`、`POST /api/agent/heartbeat`、`GET /api/agent/events`。
- `GET /api/agent/dashboard`、`GET /api/agent/conversations`。
- `GET /api/agent/conversations/{id}`、`GET /messages`。
- `POST /messages`、`POST /uploads`、`POST /typing`、`POST /read`。
- `POST /claim`、`POST /transfer`、`POST /close`。
- `DELETE /api/agent/conversations/{id}/messages`：请求 `{confirm:true}` 后永久清空双方聊天与媒体，保留玩家备忘。
- `GET/POST /api/agent/players/{playerId}/memos`、`DELETE /api/agent/players/{playerId}/memos/{memoId}`：仅客服可见的玩家备忘。
- `GET /api/agent/quick-replies`。
- 主管：`GET/POST /api/agent/team`、`PUT /api/agent/team/{id}`；创建/更新客服包含 `channelCode`。

## 媒体

- `GET /api/media/{id}`：玩家只可访问当前标签页会话媒体；普通客服只可访问自己且同通道的会话；主管只可访问主管所属通道现存会话媒体。视频支持 HTTP Range。

SSE 事件包括 `message.created`、`conversation.assigned`、`conversation.requeued`、`conversation.transferred`、`conversation.closed`、`conversation.cleared`、`conversation.changed`、`player.memo.changed`、`team.changed`、`typing` 和客服单点登录事件 `session.replaced`。玩家事件按会话、客服事件按通道分发；事件只用于刷新提示，数据库记录始终是权威数据。
