# 聊天托管交接（2026-11-05）

## 目录与分支

- 工作目录 `/Volumes/SSD/qing`，分支 `codex/club-ui`（基于 `3f262ad`）。
- 服务端与客服站已部署（2026-11-05 13:26）；游戏客户端未构建/未热更；改动未提交。

## 目标

- 消息首页右上角增加「聊天托管」开关，对大群主、盟主和普通俱乐部群主开放。
- 开启后，客服工作台可以按俱乐部或联盟分组折叠查看托管账号的私聊，并以该账号身份回复；对方收到的消息与本人发送一致。
- 客服后台以托管为主：托管页签排第一并默认进入；新消息有声音与红点，多个客服可同时处理。

## 实现

- 服务端 `ChatTool/server/internal/directchat`：
  - `migrations/007_direct_hosting.sql`：`chat_direct_hosting(guuid, group_type union/club, group_id, group_name, club_id, role, enabled_at, updated_at)`，关闭即删除该行。
  - `migrations/008_direct_hosting_read.sql`：`chat_direct_hosting_read(conversation_id, last_message_id, updated_at)`，多个客服共享的托管会话已读游标，不改变托管账号在游戏内的已读。
  - `service.go` 的 `roleDisplayName`：与游戏内统一角色称谓（联盟创始人=大盟主、已入盟俱乐部创始人=盟主、未入盟=群主、代理=合伙人），并随 `PeerView.roleName` 返回给网页。
  - `HostedBalance`：读取会话对方在当前俱乐部的积分；按 `club_guuid_info.club_mode` 选择 `sm_club_gold2` 或 `sm_club_gold`，兼容数字/JSON 两种历史形态，`-99` 视为无数据。
  - `service_hosting.go`：资格判定（联盟总群主优先归联盟，已入盟俱乐部创建者归俱乐部，未入盟俱乐部群主同样开放并归俱乐部）、状态/开关、托管分组、会话摘要、历史消息、代发；每次读取/代发都重新校验资格，失效自动删除托管记录。读取最新页时推进客服共享已读游标；未读只统计对方发来的消息。
  - `handlers.go`：`GET/POST /api/direct/hosting`；托管账号收、发消息都通过 `HostedMessageNotice` 回调交给客服 SSE（`Incoming` 区分方向），`PublishMessageNew` 通知对方和托管账号本人。
  - `api/hosting.go`：`/api/agent/hosted/groups`、`/api/agent/hosted/conversations`、`/api/agent/hosted/conversations/{id}/balance`（GET）、`/api/agent/hosted/conversations/{id}/messages`（GET/POST）；复用客服 Cookie + CSRF；代发后推送 `message.new` 并写 `chat_audit_log`。
  - `api/hosting_gold.go`：托管上下分只调用后台服务 `POST http://127.0.0.1:8891/api/service/clubs/{clubId}/members/{userId}/gold`（Bearer 服务令牌），不再直连 8890；成功后以托管账号发 `玩家 <对方> 上分/下分 <金额> 成功（客服托管）` 系统通报，并推送双方与客服 SSE。
  - XuanManager `service_gold.go` + `serviceAuthorized`：只接受本机直连（无 X-Forwarded-For）且令牌正确，执行 `添加_俱乐部_成员_积分` 并写 `mgr_audit_log`；公网 `/xuanmanager/api/service/*` 返回 403。
  - `api/auth.go`：客服 SSE 增加 `hosted` 订阅；`hosted.message`（收/发新消息）和 `hosted.read`（已读同步）广播给所有在线客服。
- 客户端：`panelMessage.prefab` 根节点新增右上角「聊天托管」按钮（Widget top/right），`DirectChatManager` 增加 `HostingStatus/SetHosting`，`panelMessage.ts` 首屏和切回页查询状态，按钮走 `panelMsgView` 双按钮确认开/关。
- 客服工作台：`AgentApp.tsx` 的「聊天托管」页签排第一并默认进入，按联盟/俱乐部折叠，展开托管账号后列会话；点会话查看历史并以托管账号发文字。新消息 SSE 先用事件内容本地更新列表（来消息才响声音），再向服务端对账；首次点击/按键解锁 AudioContext，轮询未读增加时兜底提示；`hosted.read` 让其他客服同步清红点。图片点击放大（复用现有预览层），语音用 `attachment.url` 直接播放；会话输入区提供「上分/下分」，按钮旁显示对方当前俱乐部积分，选中会话、轮询、消息事件和上下分成功后都会刷新；提交后刷新系统通报；联盟/俱乐部、托管账号、会话三级都显示未读红标。修正托管页签误请求普通会话接口导致的「会话筛选条件不正确」。

## 部署

- ChatTool：Linux amd64 二进制 SHA-256 `9c6f9554e339ef8b9a017d85e3a851c3cefa79f49975d6b7f848fe60053e44ff`，备份 `bin/chattool.previous-hosted-balance-20261105-140146`；重启后健康 200。
- XuanManager：本轮未改，仍为 `6ec67c80…`（备份 `backups/xuanmanager.20261105-133145-rollback`）。
- 服务令牌：服务器上生成 64 位十六进制随机串，分别写入 `/www/html/.xuanmanager/runtime.env` 的 `XUAN_SERVICE_TOKEN` 与 `/www/html/.chattool/deploy/centos7-user/runtime.env` 的 `CHAT_XUAN_SERVICE_TOKEN`（未记录明文）。
- 迁移：启动时自动执行，已确认 `chat_schema_migration` 记录 `007_direct_hosting.sql`、`008_direct_hosting_read.sql`，两张表均存在。
- 客服站：`index-BI2MvCs1.js` / `index-DD1cWlSp.css` 已原子替换，旧目录备份 `web.previous-hosted-balance-20261105-140146`。
- 公网验收：`/chattool/api/health` 200，`/chattool/agent` 200，托管接口未授权 401；`POST /xuanmanager/api/service/clubs/x/members/y/gold` 经 Caddy 返回 403，本机带令牌 `delta=0` 返回 400（鉴权通过、参数校验拦截），说明公网无法调用后台服务通道。
- 单测：ChatTool `TestCallXuanMemberGold`/`TestCallXuanMemberGoldRejected`、`TestClubGoldFrom`、`HostedBalance`；XuanManager `TestServiceAuthorizedOnlyLoopbackWithToken`（本机+令牌通过、代理/远程/错令牌拒绝）。
- 游戏库只读核验：`tbl_Account.sm_club_gold` 非空 59 行、`club_guuid_info.club_mode` 非空 7 行，客服库账号可读。
- ChatTool 回滚：`cp /www/html/.chattool/bin/chattool.previous-hosted-balance-20261105-140146 /www/html/.chattool/bin/chattool && cd /www/html/.chattool && deploy/centos7-user/stop.sh && deploy/centos7-user/start.sh`。
- XuanManager 回滚：`cp /www/html/.xuanmanager/backups/xuanmanager.20261105-133145-rollback /www/html/.xuanmanager/bin/xuanmanager && /www/html/.xuanmanager/stop.sh && /www/html/.xuanmanager/start.sh`。
- 前端回滚：`mv web web.broken-<ts> && mv web.previous-hosted-balance-20261105-140146 web`。

## 验证

- `go build ./...`、`go vet ./...`、`go test ./...` 通过；`service_hosting_test.go` 覆盖身份分组、开关、托管会话、代发身份、未托管拒绝、托管新消息通知（自己发送不通知）和共享未读清零、托管账号自己发送也同步客服（`Incoming=false`）、角色称谓与游戏内一致、未入盟俱乐部群主可托管并显示群主、托管上下分与「（客服托管）」通报。
- `ChatTool/web` 的 `npm run build`（tsc + vite）通过。
- 客户端两个 TS 文件语法检查通过；`panelMessage.prefab` 的 JSON、节点/组件回指、fileId 唯一性检查通过。
- 未做：Creator 导入/构建、真机；客服后台未用真实托管账号联调；图片放大与语音播放未在浏览器实测；语音/图片地址沿用 `http://154.37.155.17/...`，用 HTTPS 域名访问客服站时会受混合内容限制；客服代发仍只支持文字。

## 下一步

1. 用大群主/盟主账号验证开关、分组、代发、声音、红点、已读同步和图片/语音（需先构建并热更游戏客户端）。
2. 如需客服代发图片/语音，在 hosted 接口补附件上传与绑定。
