# 2026-11-05 聊天托管（自 CURRENT 归档）

归档时间：2026-11-07（`CURRENT.md` 再次触顶 16 KiB 预算，移出已部署条目；状态未变）。

## 2026-11-05 聊天托管（服务端/客服站已部署，客户端未构建）

- 消息首页右上角新增「聊天托管」开关，俱乐部群主/盟主/大盟主均可开；客服工作台「聊天托管」为第一个页签并默认进入，按联盟/俱乐部折叠查看私聊，以其身份代发文字。
- 收发经 `hosted.message` SSE 双向实时同步，三级未读徽标走共享已读游标（migration 008）；上下分经 XuanManager（不直连 8890），成功后发「（客服托管）」系统通报；对方角色由服务端 `roleName` 统一。另有语音播放、图片放大、AudioContext 首次交互解锁、多客服并发。
- 服务端新增 `GET/POST /api/direct/hosting`、`/api/agent/hosted/*`；代发以托管账号落库并向双方推送 `message.new`；客服查看不改游戏内已读。细节见[交接](../handoffs/2026-11-05-chat-hosting.md)。
- 已部署 14:01：ChatTool `9c6f9554…`、客服站 `index-BI2MvCs1.js`（备份 `…hosted-balance-…`）；XuanManager 仍为 `6ec67c80…`；上下分经 XuanManager，公网 service 403。客户端未构建。
