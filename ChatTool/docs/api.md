# ChatTool API 摘要

所有浏览器接口同源提供 JSON；写接口要求对应会话、同源和 CSRF。错误统一为：

```json
{"ok":false,"error":{"code":"ERROR_CODE","message":"可读错误"}}
```

## 玩家接口

- `POST /api/player/session`：提交含 `channel` 的客户端 AES 加密资料并建立HttpOnly会话；缺省通道兼容为 `general`。响应含非敏感 `sessionRef`，允许同一浏览器标签页并行保持不同通道会话。游戏内请求可提交 `embedded:true`，响应额外返回只供当前 WebView `sessionStorage` 保存的 `embeddedToken`，后续玩家接口通过 `X-Player-Embedded-Token` 发送，以兼容跨站 iframe 禁用第三方 Cookie。
- `GET /api/player/me`：玩家、会话、在线客服数和 CSRF。
- `GET /api/player/events`：SSE 实时事件。
- `GET/POST /api/player/messages`：聊天记录与文字发送；本通道没有在线客服时仍接受发送，会话保持排队，客服上线后自动接入。
- `POST /api/player/uploads`：图片、视频或文件；没有在线客服时同样接受上传并进入排队。
- `GET /api/player/media/{id}/ticket`：游戏内嵌会话领取30分钟媒体票据；票据只对应当前会话中的单个媒体。
- `POST /api/player/typing`、`POST /api/player/read`：输入和已读。
- `POST /api/player/clear`：清除玩家这一侧的客服聊天记录（只记录 `player_cleared_at`，消息保留，客服工作台仍可见）。
- `POST /api/player/end`：玩家结束咨询。
- `POST /api/player/satisfaction`：结束后 1～5 分评价。

## 客服接口

- `POST /api/agent/auth/login`、`GET /api/agent/auth/me`、`POST /api/agent/auth/logout`；同账号新登录会撤销旧会话并推送 `session.replaced`。
- `POST /api/agent/presence`（保留兼容旧页面，登录中的客服一律保持在线）、`POST /api/agent/heartbeat`、`GET /api/agent/events`。
- `GET /api/agent/dashboard`、`GET /api/agent/conversations`。会话项/详情的 `avatarUrl` 由游戏库 `tbl_Account.sm_photo`（1~100）映射为客服站 `/avatars/avatarNN.png`，不再依赖客户端上传。
- `GET /api/agent/conversations/{id}`、`GET /messages`。
- `POST /messages`、`POST /uploads`、`POST /typing`、`POST /read`。
- `POST /claim`、`POST /transfer`、`POST /close`。
- `DELETE /api/agent/conversations/{id}/messages`：请求 `{confirm:true}` 后永久清空双方聊天与媒体，保留玩家备忘。
- `GET/POST /api/agent/players/{playerId}/memos`、`DELETE /api/agent/players/{playerId}/memos/{memoId}`：仅客服可见的玩家备忘。
- `GET /api/agent/quick-replies`；`POST /api/agent/quick-replies`（`{title,content,category}`）、`PUT/DELETE /api/agent/quick-replies/{id}`：全团队共享的常用话术，托管会话与普通客服会话共用；托管页点击话术直接发送，普通会话点击填入输入框。
- 主管：`GET/POST /api/agent/team`、`PUT /api/agent/team/{id}`；创建/更新客服包含 `channelCode`。
- 聊天托管：`GET /api/agent/hosted/groups`、`GET /api/agent/hosted/conversations`、`GET/POST /api/agent/hosted/conversations/{id}/messages`、`GET .../balance`、`POST .../gold`。取消托管只把记录置为停用并保留历史，群组项带 `enabled`；停用账号只能只读，代发/上下分返回不可用。
- `POST /api/agent/hosted/conversations/{id}/uploads?guuid=<托管账号>`：客服代发图片，`multipart/form-data` 的 `file` 字段，仅 JPEG/PNG/WebP、单张 ≤10MB、边长 ≤4096。服务端按文件头重新识别格式与尺寸，走直聊附件链路（建附件→落盘→绑定消息），落库后以托管账号身份发出，返回 `{message}`，与 `.../messages` 的 `message` 结构一致。
- 托管列表三级都带置顶：分组项（`GET /hosted/groups` 的 `items[].pinned`/`pinnedAt`，一级联盟/俱乐部）、托管账号项（`items[].items[].pinned`/`pinnedAt`，二级盟主/群主）、会话项（`pinned`/`pinnedAt`）。置顶对象固定排最前；全团队共享，存在 `chat_direct_player_remark` / `chat_direct_hosted_pin_target`（`target_type` = `group`/`owner`/`conversation`）。
- `PUT /api/agent/hosted/conversations/{id}/remark`：请求 `{guuid,remark}`，备注按玩家（会话对方）保存，留空即清除，最长 20 字；返回 `{remark,peerGuuid}`。工作台显示口径为「原名（备注）」，原名始终保留。
- `POST /api/agent/hosted/pin`：统一置顶入口，请求 `{type,id,guuid,pinned}`；`type` 取 `group`（`id` 为 `club:<id>` / `union:<id>`）、`owner`（`id` 为托管账号 guuid）、`conversation`（`id` 为会话 ID，`guuid` 为托管账号用于归属校验）。返回 `{pinned,peerGuuid}`。
- `POST /api/agent/hosted/conversations/{id}/pin`：请求 `{guuid,pinned}`，等价于上一接口的 `type=conversation`，保留兼容。
- `DELETE /api/agent/hosted/conversations/{id}?guuid=<托管账号>`：永久删除单条托管会话及消息、图片、语音，托管记录保留；重复删除返回 `CONVERSATION_NOT_FOUND`。
- `DELETE /api/agent/hosted/owners/{guuid}`（仅主管）：永久删除该托管账号的直聊会话、消息和媒体，托管记录一并删除；开启中的托管需先在游戏内关闭。
- `GET /api/agent/hosting/ledger?date=YYYY-MM-DD&owner=&agentId=&player=&page=&pageSize=`：托管上下分账本；返回当日/所选日期汇总（up/down/give/received/count）和逐笔记录（含 `agentId`/`agentName`）。主管返回全部并按 `agentId` 筛选，普通客服只返回 `agent_id` 为自己的记录。
- `GET /api/agent/hosting/ledger/owners?date=YYYY-MM-DD`：当前可见范围内的盟主选项。
- `GET /api/agent/hosting/ledger/agents?date=YYYY-MM-DD`：当前可见范围内的客服选项；普通客服始终只返回自己。
- `POST .../gold` 请求新增 `clientRequestId`（≤64 字符）幂等键；同一编号重复提交不会重复执行，成功重复返回 `duplicate=true`，处理中/失败返回 409。

## 俱乐部直聊接口

直聊使用独立的 `/api/direct/*` 路由、`chat_direct_*` 数据表和游戏库只读连接，与客服会话、客服 SSE 和客服权限相互隔离。

- `POST /api/direct/session`：使用游戏端生成的一次性 `dc1` 票据建立直聊会话；`POST /api/direct/session/dev` 仅在本地联调开关开启时允许用 `guuid` 换会话。
- `GET /api/direct/me`、`GET /api/direct/clubs`、`GET /api/direct/unread`：读取当前玩家资料、所属俱乐部和未读汇总。
- `GET /api/direct/clubs/{clubId}/members`：读取俱乐部成员；`GET/POST /api/direct/clubs/{clubId}/conversations`：读取或创建一对一会话。联盟总群主可读取/创建联盟内任意俱乐部的成员会话，跨俱乐部会话按对方所在 `clubId` 归属。
- `GET /api/direct/conversations`：读取当前账号参与的全部会话（含联盟总群主的跨俱乐部会话）；消息使用 `GET/POST /api/direct/conversations/{conversationId}/messages`，支持 `before`、`after` 游标。
- `POST /api/direct/conversations/{conversationId}/attachments`、`.../{attachmentId}/upload`、`.../{attachmentId}/complete`：图片、语音附件创建、上传和确认；`POST .../{conversationId}/read` 已读，`DELETE .../{conversationId}` 隐藏可删除会话，`POST .../{conversationId}/clear` 单方清除本人这一侧的聊天记录（消息行保留，对方和客服仍可见）。
- `POST /api/direct/ws-ticket`：为当前直聊会话签发一次性 WebSocket 票据；`GET /api/direct/ws?ticket=...`：建立长连接。消息落库成功后推送 `message.new`，发送方收到 `message.sent`；事件只携带游标，客户端按 `after` 补拉完整消息。
- WebSocket 不可用、超时或回包丢失时，客户端使用同一 `clientMessageId` 回退 HTTP，服务端按该 ID 幂等，避免重复消息。断线重连使用指数退避，恢复后按游标补偿。
- 会话中的 `peer.role` 使用 `owner`、`leader`、`agent`、`manager`、`member`，联盟总群主在其它俱乐部会话里为 `union_owner`；客户端将 `owner` 显示为“老板”、`union_owner` 显示为“大群主”、代理统一显示“代理”。`peer.note` 只在当前玩家位于目标成员的俱乐部上级链时返回。
- 固定联系人（默认对话）：本俱乐部创建者（盟主，未入盟显示群主）、俱乐部所在联盟总群主（大盟主），按 guuid 去重；直属上级合伙人等代理链条上的其他层级不生成固定入口，与他们的会话按普通会话处理。固定会话服务端返回 `canDelete=false`，删除请求返回 `DIRECT_DELETE_FORBIDDEN`。

## 媒体

- `GET /api/media/{id}`：玩家只可访问当前标签页会话媒体，或持有当前媒体的短期游戏内票据；普通客服只可访问自己且同通道的会话；主管只可访问主管所属通道现存会话媒体。视频支持 HTTP Range。

SSE 事件包括 `message.created`、`conversation.assigned`、`conversation.requeued`、`conversation.transferred`、`conversation.closed`、`conversation.cleared`、`conversation.changed`、`player.memo.changed`、`team.changed`、`typing` 和客服单点登录事件 `session.replaced`。玩家事件按会话、客服事件按通道分发；事件只用于刷新提示，数据库记录始终是权威数据。
