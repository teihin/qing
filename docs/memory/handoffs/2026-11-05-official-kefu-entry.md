# 2026-11-05 消息列表置顶官方客服 BF

## 目录 / 分支

- 项目根：`/Volumes/SSD/qing`
- 分支：`codex/club-ui`
- 基线：`6b9120b`（工作区含其他任务未提交修改，本次只改下列文件）

## 目标

1. 客户端「消息 → 全部会话」列表固定置顶「官方客服」：名字 `BF`，头像用大厅房间列表同款盾牌（`assets/V7/shield_room_exact.png`）。
2. 点击置顶项进入游戏内直聊窗口（不是网页 `panelKefu`）。
3. 客服后台页签顺序保持「聊天托管」之后为「客服消息」。
4. 去掉之前提出的「后台配置官方联盟 hash」方案：当前代码/文档中没有该设置，本次不新增，也不引入按联盟 hash 识别官方客服。

## 实现口径

- 官方客服聊天复用现有 ChatTool 玩家端接口 `/chattool/api/player/*`（咨询会话、排队、客服工作台），底层仍是 `chat_conversation`/`chat_message`，所以客服在后台「客服消息」里按现有派单流程接待。
- 不走俱乐部直聊 `/api/direct`，也不新增服务端表或协议。
- 玩家端用 `/api/player/session` 的 `embedded:true` 返回的内嵌令牌走请求头（`X-Player-Embedded-Token` + `X-Player-Session-Ref`），不依赖 WebView Cookie。
- 当前只支持文字：图片/拍照/语音/删除/上下分/赠送入口在官方客服模式隐藏。
- 会话状态以服务端为准：没有在线客服或会话已结束时输入框禁用，并显示对应提示。
- 打开会话后每 2.5 秒拉一次消息，每 6 次同步一次会话状态；玩家在底部时自动跟随，离底部时显示「新消息」提示。

## 改动文件

- `assets/scripts/common/GameDef.ts`
  - 新增 `KEFU_CHAT_HTTP_BASE` / `WEB_KEFU_CHAT_HTTP_BASE`（`/chattool`）。
- `assets/scripts/logic/OfficialKefuManager.ts`（新增）
  - 建立/复用玩家客服会话、拉消息、发送文字、已读、刷新会话状态；字段映射到 `DirectMessage`。
- `assets/scripts/UI/panelMessage.ts`
  - 读取 Prefab 中的「官方客服」行，固定占据列表第一格；分页/合并/空态/错误态都保留置顶行。
  - 点击打开 `panelMessageChat`，参数 `{service:"official"}`；牌桌内继续透传「游戏内」。
- `assets/resources/UI/panelMessage.prefab`
  - `列表/view/content` 下新增「官方客服」行（复制会话行样式）：头像 `shield_room_exact`、昵称 `BF`、预览 `官方客服`、时间 `置顶`、红点关闭。
- `assets/scripts/UI/panelMessageChat.ts`
  - 新增 `officialMode`：标题 `BF · 官方客服`，左侧气泡头像固定用 `officialAvatar` 盾牌；仅保留文字输入。
  - 复用现有气泡/时间条/系统消息渲染；官方客服模式走 `OfficialKefuManager` 加载、发送、重试、已读和轮询。
- `assets/resources/UI/panelMessageChat.prefab`
  - 脚本组件新增 `officialAvatar`，引用 `shield_room_exact` 的 SpriteFrame（UUID `b8fe83ba-62f7-5920-8387-f36f7f061983`）。
- `ChatTool/web/src/AgentApp.tsx`
  - 页签「我的会话」改为「客服消息」，位置仍在「聊天托管」之后；侧栏标题同步。
- `ChatTool/README.md`
  - 同步页签说明。

## 验证

- 已做：
  - 两个 Prefab JSON 解析、`__id__` 引用范围、`fileId` 唯一性检查通过。
  - `shield_room_exact` 的 SpriteFrame UUID 与 Prefab 引用一致；置顶行头像按 69×80 保持 100:116 比例。
  - 用 `ChatTool/web` 的 TypeScript 对 `OfficialKefuManager.ts`、`panelMessage.ts`、`panelMessageChat.ts` 做定向 `--noEmit`，除工程既有的 `require` 声明错误外无新增类型错误。
  - `ChatTool/web` 的 `npm run build` 通过（前端 `dist/assets/index-BOBmfMkd.js`，未部署）。
- 已部署（2026-11-05 23:11）：
  - ChatTool 前端 `index-BOBmfMkd.js` / `index-DD1cWlSp.css` 已原子替换到 `/www/html/.chattool/web`，回滚点 `web.previous-kefu-messages-20261105-231118`。
  - 线上 `index.html`、JS、CSS 的 sha256 与本地 `dist` 一致；`/chattool/api/health`、`/chattool/player`、`/chattool/agent` 均 200；新包内「客服消息」关键字存在。未重启服务（静态目录动态读盘）。
- 未做：
  - Creator 导入 Prefab、编辑器目视、构建、真机/网页实际点击。
  - 真实玩家账号下的客服会话联调（排队、接入、客服回复、结束、无客服在线、会话过期）。
  - 官方客服未读红点/后台托盘提醒（当前只在聊天窗口打开时轮询）。
  - 游戏客户端未构建、未热更；客服工作台登录态页面与真实会话未实测。

## 2026-11-05 聊天托管改开关（同批未构建）

- 消息页右上角原来的「聊天托管：已开启/未开启」文字按钮改为 V8 深蓝金边胶囊：指示点 + 标题「聊天托管」+ 状态「已开启/未开启」+ `settings_v8_toggle_on/off` 开关。
- 开关开/关图直接放在 Prefab（`开关-开`/`开关-关`），脚本只切换 active 和文字/颜色，不运行时改 SpriteFrame；胶囊底用 `gs_chip` 九宫格。
- 用真实素材拼了离屏预览核对比例与配色；Creator 导入、构建、真机待验证。
- 会话行间距统一 16 设计像素（含置顶客服行与第一条会话、分页追加和顶部插入补偿），内容高度同步按行高+间距计算。

## 2026-11-05 本地预览 CORS（已部署服务端）

- 官方客服直聊在 Creator 预览（`http://localhost:7456`）调用 `https://154-37-155-17.nip.io/chattool/api/player/*` 时被 CORS 预检拦截；原服务端只给 `/api/direct/*` 放行。
- `server/internal/api/server.go` 把 CORS 中间件扩展为 `browserCORS`，同时覆盖 `/api/direct/*` 和 `/api/player/*`；玩家接口放行 `Content-Type, X-Player-Embedded-Token, X-Player-Session-Ref, Authorization, Accept`，方法与来源仍用同一白名单，`/api/agent/*` 继续不放行。测试同步更新并通过。
- 已部署 Linux 二进制 `201558f3…`（2026-11-05 23:41，回滚 `bin/chattool.previous-player-cors-20261105-233726`）；健康 200，玩家预检 204、实际 POST 带 `Access-Control-Allow-Origin`，未知来源 403，直聊预检与客服页正常。
- 运维口径：换 Go 二进制要用 `deploy/centos7-user/stop.sh` + `start.sh`；只 kill 子进程时它可能正常退出 0，导致 `supervise.sh` 按设计退出而不自动拉起。

## 2026-11-05 官方客服支持拍照/发图（服务端已部署，客户端未构建）

- 官方客服聊天保留「拍照上传」「发送图片」两个入口；图片走 `/api/player/uploads` multipart，服务端直接生成图片消息并派单。
- 客户端从 `/api/player/media/{id}/ticket` 换取带 ticket 的媒体地址，图片消息在气泡内显示、点击看大图；票据缓存 20 分钟，失败时退回「[图片]」文字占位。
- 语音、视频、文件仍只显示文字占位；图片上传失败不会留下本地假气泡。
- 服务端 `browserCORS` 同时放行 `/api/media/*`（GET/OPTIONS），供跨域图片加载；二进制已部署 `53dccc7a…`（2026-11-05 23:48，回滚 `bin/chattool.previous-player-media-20261105-234707`），健康 200，上传预检/媒体响应均带 Allow-Origin。
- 未验证：真实玩家上传图片 → 客服后台查看/回复 → 客户端显示与点开大图；原生相册/相机桥；媒体票据过期后的刷新。

## 2026-11-05 客服不在线也可先留言（已部署）

- 服务端去掉玩家文字/图片的在线客服前置检查：`insertMessage` 和 `saveUpload` 不再要求 `lockOnlineAgent`，`NO_AGENT_ONLINE` 从玩家发送路径移除；会话保持排队，客服登录/上线/心跳恢复时由分配器自动接入。
- 客户端 `OfficialKefuState.canSend` 只看会话是否结束；不在线时顶部提示“客服暂时不在线，可先留言，上线后会回复”，输入框和拍照/发图入口保持可用。
- 客服站玩家端同步：`canSend` 不再依赖 `onlineAgents`，横幅/占位文字改为可先留言；后台客服工作台不变。
- 已部署：服务端二进制 `513c5a44…`（2026-11-05 23:53，回滚 `chattool.previous-offline-send-20261105-235311`）；客服站前端 `index-BLGjAFAo.js`（回滚 `web.previous-offline-send-20261105-235353`）。健康/玩家端/客服端 200，新包含“客服暂时不在线，可先留言”。
- 未验证：真实玩家在无客服在线时发送 → 客服上线后自动接入并看到消息；已结束会话仍应拒绝发送。

## 2026-11-06 客服工作台去掉上下线与立即接入（已部署）

- 前端移除顶部在线状态下拉（在线接待/暂时离开/停止接待）和状态点；登录中的客服始终在线。`POST /api/agent/presence` 保留兼容但强制设为 online，`/api/agent/auth/me` 会把旧页面遗留的 offline 恢复为 online 并触发一次排队分配。
- 移除会话头「立即接入」和非主管的「接入此会话」提示；点开有待接入会话时自动调用 claim，切到「客服消息」并加载聊天记录，可直接回复。空会话（玩家尚未发消息）不自动接入，避免必然失败的提示。
- 已部署：服务端二进制 `7db76dcb…`（2026-11-06 00:02，回滚 `chattool.previous-auto-claim-20261106-000240`）；客服站前端 `index-Dh-vyT3v.js`（回滚 `web.previous-auto-claim-20261106-000306`）。健康/玩家端/客服端 200，新包已不含「立即接入/接入此会话/在线接待/暂时离开/停止接待」。
- 未验证：真实登录客服点开排队会话自动接入并回复；接待上限失败提示；主管查看全部会话时自动接入；旧缓存页面点击上下线后的恢复。

## 下一步

1. Creator 导入两个 Prefab，确认置顶行与聊天窗口显示正常。
2. 用真实玩家进消息页 → 点 BF → 发送 → 客服后台「客服消息」接入并回复 → 客户端 2.5 秒内收到。
3. 验证无客服在线、客服结束会话、重复打开续接、牌桌内半透明入口。
4. 如需支持图片/语音，再补玩家端上传接口和对应气泡。
