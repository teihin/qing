# 2026-10-31 俱乐部 1 对 1 私聊（阶段归档）

来源：`docs/memory/CURRENT.md`，2026-11-03 因当前状态超过预算移入；原文未改。

## 2026-10-31 俱乐部 1 对 1 私聊（服务端已部署）

- 服务端 `/api/direct/*` + `chat_direct_*`（迁移 `006`），直聊关系改为 `CHAT_GAME_DB_*` 只读直查游戏库，不再用俱乐部同步副本。
- 客户端 `DirectChatManager` + 消息页（`Main` 第 5 分页）；已修 Cocos `onLoad` 早于 `setPanelInfo` 导致的空会话 ID 404。
- 轮询已改为独立 WebSocket（`ws-ticket` + `ws`，`message.new`/`message.sent` 只带游标），文本/语音优先 WS、断线用同一 `clientMessageId` 回退 HTTP；已读游标改为数据库条件更新，只允许向前。
- 固定上级代理入口按 `club_agent_info.upper_guuid` 生成、`canDelete=false`；`note` 只对上级链可见，列表显示“昵称（备注） [俱乐部名称]”。
- 服务端多轮部署（CORS 预检、图片附件空 `external_media_id`、长连接、已读并发、固定入口+备注）均已完成并通过 Go 全量测试；各版本 SHA-256、备份名与逐项验证见[交接](../handoffs/2026-10-31-direct-chat.md)。
- 客户端尚未正式构建/热更，双账号、断网恢复、真机图片与录音仍待实测。
- 2026-11-02 通过安卓 `192.168.3.100:9527` V8 Inspector 复现：`ws-ticket` HTTP 返回 200，但原生直聊 WebSocket 在 `OPEN` 前 `onerror → CLOSED`；同一临时票据由电脑连接公网 `ws://154.37.155.17/chattool/api/direct/ws` 可 `OPEN`。根因为服务端先用网页 Origin 白名单拒绝 Cocos 原生来源；修复为已带一次性 ticket 时跳过网页 Origin 校验，已部署到 `/www/html/.chattool`，公网健康 200，`Origin: file://` 无效 ticket 已进入 401 ticket 鉴权；真实双账号安卓回归仍待执行，见[安卓长连接交接](../handoffs/2026-11-02-android-direct-chat-ws-origin.md)。
- 2026-11-02 直聊图片：安卓/iOS 原生桥已补齐「相册选图 + 拍照」，回调增加 `error` 字段（`denied`/`unsupported`），TS 侧 `PickImage(source)` 与消息页「拍照上传」「发送图片」分别走相机与相册。Java 已过 `:qing:compileDebugJavaWithJavac`、iOS 过 `clang -fsyntax-only`、TS 过语法制检；**未出包、未真机验证**，见[图片与拍照交接](../handoffs/2026-11-02-direct-chat-image-camera.md)。
