# 俱乐部 1 对 1 私聊（direct chat）实施交接

日期：2026-10-31。依据：根目录 `1对1私聊消息-详细设计实施方案-v5.md`（v5.2）、`AGENTS.md`、`docs/memory/CURRENT.md`。
状态：**客户端代码仍未正式构建、未真机/双账号完整联调、未提交；服务端已改为游戏库直读并部署，客户端空会话 ID问题已修复**。

## 目标与范围

- 在游戏内新增基于俱乐部的 1 对 1 私聊：同俱乐部即可互聊，角色只影响入口、成员列表「聊天」按钮和详情右上角「删除」。
- 会话唯一键 `(club_id, pair_key)`，`pair_key` 为两个 guuid 排序后拼接，跨俱乐部不合并。
- 删除＝只写当前参与者 `hidden_at`（单边隐藏），收到新消息自动恢复，不物理删除、不清空历史。
- 与客服完全隔离：独立路由 `/api/direct/*`、独立表 `chat_direct_*`、独立令牌与清理任务；客服入口与接口未改行为。
- 一期消息类型：文字、图片、语音；支持 Android、iOS 和 Web 游戏运行时，不做独立网页版登录/聊天、群聊、好友、金币/转账、视频与通用文件。

## 基线

- 客户端：Cocos Creator 2.4.13，`/Volumes/SSD/qing`，`assets/scripts`、`assets/resources/UI`。
- 服务端：`ChatTool/server`（Go 1.23，module `chattool`），MySQL 5.7，迁移目录已到 `005`，本次新增 `006`。
- 客服链路保持原样：`/api/player/*`、`/api/agent/*`、`panelKefu`、`CHAT_MESSAGE_RETENTION=48h`。

## 改动与来源

### 服务端（新增，未改动客服 SQL）

- `ChatTool/server/migrations/006_direct_chat.sql`：`chat_direct_club`、`chat_direct_club_member`、`chat_direct_session`、`chat_direct_conversation`、`chat_direct_participant`、`chat_direct_message`、`chat_direct_attachment`。会话/消息/附件的时间列用 `DATETIME(3)`（文件头已注明：仅为 `(created_at,id)` 游标排序精度细化）。
- `internal/directchat/`：`model.go`（错误码、角色、视图）、`ids.go`（ID/`PairKey`/签名游标）、`ticket.go`（`dc1.` 票据）、`link.go`（与客服入口同格式的 AES 轻量资料换票）、`session.go`、`store.go`（全部 SQL）、`service.go`（业务规则）、`handlers.go`（路由）、`game_directory.go`（直接查询游戏库关系，不保存俱乐部快照）、`media.go`（图片存储 + AudioServer 语音校验）、`maintenance.go`（保留期清理）。
- `internal/api/server.go`：`routesDirect()` 挂载直聊并注入配置；`runMaintenance` 每 30 分钟单独清理直聊（不与客服 48h 共用条件）；新增仅针对 `/api/direct/*` 的 CORS 白名单与 `OPTIONS` 预检响应，不放开客服接口和其他 API。
- `internal/config/config.go` + `ChatTool/.env.example` + `deploy/centos7-user/runtime.env.example`：除直聊配置外新增 `CHAT_GAME_DB_HOST/PORT/NAME/USER/PASSWORD`，服务端用独立只读连接直查游戏库；不再配置俱乐部目录同步密钥。密钥短于 16 字符直接报错。
- `cmd/directticket`：联调用的票据签发票据命令行（正式票据应由 KB 登录服签发，属服务端改造，未做）。

### 接口（`/api/direct/*`，与文档第 8 章一致）

`POST /session`（`ticket` 或 `payload`）、`POST /session/dev`（仅显式开关）、`DELETE /session`、`GET /me`、`/clubs`、`/unread`、`POST /ws-ticket`、`GET /ws`、`/clubs/{clubId}/members`、`/clubs/{clubId}/conversations`（GET/POST）、`/conversations/{id}/messages`（GET 含 `before`/`after`、POST）、`/attachments`、`/attachments/{id}/upload`、`/attachments/{id}/complete`、`/read`、`DELETE /conversations/{id}`、`GET /media/{attachmentId}`（签名临时地址）。俱乐部和成员关系由游戏数据库实时查询，不再提供目录同步接口。
错误码与文档第 9 章逐条对应；关系服务不可用时返回 `DIRECT_RELATION_UNAVAILABLE`，不降级放行。

### 客户端（新增）

- `assets/scripts/logic/DirectChatManager.ts`：单实例；令牌与 `accountGeneration`、俱乐部上下文、会话/成员缓存、未读汇总、长连接与前后台、发送重试、图片上传、录音与播放、`clientMessageId`、断线退避；所有请求集中在这里，页面不自建 XHR/定时器。
- `assets/scripts/common/DirectChatTime.ts`：列表时间、分割线、语音时长、录音计时。
- `assets/scripts/UI/panelMessage.ts`（会话列表 + 俱乐部切换 + 新建）、`panelMessageMembers.ts`（成员 + 聊天按钮）、`panelMessageChat.ts`（气泡/分页/已读/图片/按住说话/右上删除/大图预览）。
- `panelMessageChat.ts` 的参数解析必须在 `start` 执行：Cocos 实例化时 `onLoad` 早于 `UIManager.setPanelInfo`，在 `onLoad` 读取 `strUserData` 会让会话 ID 为空并请求 `/conversations//messages`；发送前和统一请求层也拒绝空会话 ID。
- 聊天消息区已按确认效果图调整：`消息-左` 为对方头像 + 绿色九宫格圆角气泡，`消息-右` 为自己金色九宫格圆角气泡 + 头像；文字根据内容宽度和换行高度撑开背景，语音在气泡内显示白色播放标识与时长；头像模板增加头像 1 占位，异步加载真实头像后覆盖。气泡素材为 `assets/ImagesLuck/聊天/消息左气泡.png` 和 `消息右气泡.png`，不依赖运行时 `cc.Graphics`。
- 单行文字气泡统一固定高度 72px，多行文字根据换行高度自动增加；本次调整只改 `panelMessageChat.ts`，不覆盖用户在 `panelMessageChat.prefab` 中的手动布局修改。
- 聊天输入框原为 `cc.EditBox` 数字模式（`inputMode=2`），现改为 `InputMode.ANY`，Prefab 与脚本同时设置，允许中英文、数字、空格和常用符号。
- `assets/scripts/common/GameDef.ts`：`DIRECT_CHAT_HTTP_BASE`（原生 `http://154.37.155.17/chattool/api/direct`）、`WEB_DIRECT_CHAT_HTTP_BASE`、WebSocket 地址、连接超时和退避常量。
- `assets/scripts/mobile/MobileManager.ts`：新增 `SetVoiceRecordResultHandler()`；设置后录音上传结果交给私聊，**不再走 `reqSay("@@语音@@")`**，房间语音行为不变。
- `assets/scripts/UI/panelMain.ts`：底栏「客服」按钮改为打开 `panelMessage`（用户 2026-10-31 确认「消息就是客服」），并在 `Down/客服` 下挂总未读红点；发现页不再另设入口。
- Prefab：`assets/resources/UI/panelMessage.prefab`、`panelMessageMembers.prefab`、`panelMessageChat.prefab`（含 item 模板、ScrollView、EditBox、录音浮层、大图预览节点）；`panelMain.prefab` 只在 `Down/客服` 下加 `红点`（未改底栏布局）。

### 布局（2026-10-31 按竞品截图重排，当天二次修正）

- 列表页：左上金色「消息」大标题 + 右上「新建聊天」+ 标题下俱乐部胶囊；会话行是 722×140 描边卡片（外层浅描边 + 内层深底）、左侧 100 圆角头像、姓名/预览上下两行、右侧时间与未读红点。
- 详情页：左上「<」返回、居中金色对方昵称、右上删除图标；自己消息右对齐（金色气泡 + 右侧头像），对方左对齐（深灰蓝气泡 + 左侧头像），气泡靠头像一侧锚定；时间分割线居中；底部「圆形语音 + 输入框 + 发送图标」+ 下方「发送图片」图标行。
- **修正 1（背景）**：原来只有 `遮罩` 半透明（alpha 175），点进消息页能看见大厅。现改为根节点下的 `背景`（不透明深底 `#0D0E13`，alpha 255），并用 Widget 拉满全屏。
- **修正 2（适配）**：原布局按 1334 固定坐标写死，在高分屏上顶部元素被推到屏幕中部。现全部改 Widget：标题/新建/俱乐部/未读 `TOP`，列表 `TOP+BOT+LEFT+RIGHT` 拉伸填满中间（底部留 40），输入行/语音/发送/图片/新消息 `BOT`，弹窗类 `CENTER`；`view`、`content` 也加 Widget（content 只吸顶 + 左右拉宽，高度仍由脚本算）。
- **修正 3（脚本）**：三处 `content.y = 0` 已删除——content 的纵向位置交给 Widget(TOP)，否则会把列表整体下移半个视口。
- 美术全部用项目自带资源（圆角矩形/弹窗底/输入框/发送/删除/语音按钮），未引入竞品配色与素材。


### 2026-10-31 晚二次调整（按用户口头确认）

- **消息页不再是弹窗，而是 Main 的第 5 个分页**：点底栏「客服」→ `cc.loader.loadRes("UI/panelMessage")` 实例化后挂到 `Main` 下、命名「消息」，再走 `switchTabSel("消息")`；再切回来直接复用同一节点。因此**去掉「返回」按钮**（靠底栏切换），并删掉「新建聊天」按钮及其分支。
- **聊天入口改到俱乐部成员列表**：`panelMain.prefab` 的 `俱乐部成员弹窗/面板/列表/view/content/行模板` 里新增 `对话` 按钮（150×48，栏目标题框底）；`ClubManagementView.fillMemberRow → bindDirectChat()` 控制显隐与点击：群主/盟主/代理可见、自己那行不显示；点击先 `OpenConversation(clubId, peerId)` 再进 `panelMessageChat`。管理员/普通成员不显示，服务端仍二次校验。
- **俱乐部直属上级固定入口**：服务端按每个所属俱乐部的 `club_agent_info.upper_guuid` 生成直属上级代理入口（缺失或已退出不返回），不读取平台模式的 `tbl_Account.sm_agentID`；所有有直属上级的成员（含代理/盟主）都可见，该入口即使已有真实会话也标记为默认入口。客户端 `panelMessage` 按行渲染并显示「开始聊天」。固定入口详情不显示删除按钮，服务端同步拒绝删除。
- **美术**：背景统一为用户指定的 `ImagesLuck/公用/背景.png`；会话行/成员行/俱乐部行改用 `imagesKK/公用/框底.png`（上/下 25px 九宫格），按钮改用 `imagesKK/公用/栏目标题框.png`（左/右 19/20px 九宫格）；会话行加 `头像框` 描边、行高收到 136、标题下加金色装饰线。
- **「消息」美术字未落地**：imagegen 两次生成的中文都被拆成碎块不可用（每次消耗约 5–10 credits），当前是 58 号金色 Label + 3px 深棕 `cc.LabelOutline` 占位；需要美术出透明 PNG 或换思路再生成。
- **规则**：美术出图以后只用内置 imagegen 技能，不再用 Seedream（已写入项目 `MEMORY.md`）。


### 2026-10-31 夜：聊天详情页按竞品重做（美术由 imagegen 出图）

- 版式（`panelMessageChat.prefab` 整页重建，168 个对象）：顶栏左 `返回`（箭头图标）+ 居中金色 `标题` + 右 `删除`；消息区左右气泡（自己金色、对方绿色，头像在外侧）；底部一行「语音 + 输入框 + 发送」，下面一行图标按钮「拍照上传 / 发送图片」带文字；`新消息`、`录音浮层`、`大图预览` 保留。
- 全部按钮换成新出的美术（目录 `assets/ImagesLuck/聊天/`，均为 imagegen 生成后切图 + 去白底）：
  `返回箭头`(96)、`删除图标`(96)、`语音按钮`(128 方形麦克风底板)、`拍照上传`(128)、`发送图片`(128)、`输入框`(600×168 胶囊，9 宫格左右 150)、`发送按钮`(同款胶囊)。
- 布局全部 Widget 自适应：顶栏 `TOP`、消息列表 `TOP+BOT`、输入行 `BOT`、图标行 `BOT`；750×1334 与 750×1624 两种屏高自检无越界、相邻控件不重叠。
- 脚本 `panelMessageChat.ts` 同步：文字宽度 400、气泡宽 400+32；`图片/发送图片/拍照上传` 统一走选图流程。
- 生成过程中 imagegen 出的胶囊与图标带灰白棋格底，已用「高亮度 + 低饱和」抠图规则去掉；`删除图标` 另外去掉了图标底板的深蓝填充，只留金色线条。

## 验证

已执行：

1. `go build ./...`、`go vet ./...`、`go test ./...` 全绿（`internal/directchat` 含协议、游标、票据、媒体、服务层与链接换票测试；`internal/api`、`internal/config`、`internal/security` 保持通过）。
2. 客户端 8 个改动脚本用 `typescript.transpileModule` 做语法检查，0 诊断。
3. 三个新 Prefab 用脚本校验：`__id__` 引用全部有效、组件与节点互相引用一致、顶层节点无越界（修正了返回按钮与「按住说话」提示的 2 处越界）。

未验证（不得当作已通过）：

- 数据库迁移实际执行（本机无 MySQL：`mysql`/`mysqld`/`docker` 均不存在，3306 未监听），SQL 路径未跑真库。
- Creator 导入与运行预览：`library/` 未重新导入，`panelMain.prefab` 的新按钮未在编辑器确认。
- 双账号双俱乐部联调、图片上传/大图/失败重试、真机录音与播放、构建与热更包。
- 三端图片选择已接入：Web 使用 `<input type=file>` + `FileReader`，Android 使用 `org/cocos2dx/javascript/DirectChatImageBridge.Pick(String)` 调系统文档选择器，iOS 使用 `DirectChatImageBridge.Pick:` 调系统相册；两端原生选择结果先复制到应用临时目录，再统一回调 `window.DirectChatImagePicked({requestId,path,mime,width,height,size})`，JS 层统一转换为 ArrayBuffer 后走同一套附件上传接口。
- 俱乐部目录同步已从运行方案移除；服务端直接查询游戏库。迁移中遗留的 `chat_direct_club`、`chat_direct_club_member` 仅未被运行时使用，后续可单独安排清理迁移。

## 下一步

1. 用真库跑 `006_direct_chat.sql`，并按文档 P5 准备 A–E 五个账号、两个俱乐部做联调。
2. 生成 Android/iOS 正式包并在真机跑通选图→上传→确认→图片消息；同时跑通三端按住录音 → `voiceId` → 附件 → 消息。
3. 在 KB 登录服接入：签发 `dc1.` 票据；接好后关闭 `CHAT_DIRECT_ALLOW_DEV_LOGIN`。不再推送俱乐部目录，关系继续由游戏库直读。
4. Creator 导入三套 Prefab，按真机像素复核行高、气泡宽度与输入区（键盘弹起）。
5. AudioServer 语音保留期与 `CHAT_DIRECT_RETENTION` 对齐（文档第 13 章二选一）。

## 决策点

- 2026-10-31 用户确认：**「消息」就是「客服」**，点底栏「客服」直接出现消息页。已按此实现：底栏按钮不改名、不改图，只改跳转与红点；发现页临时加的「消息」入口已删除（子树一并从 Prefab 中压缩回收）。
- 原网页客服 `panelKefu` 代码与 Prefab 保留、未删除，仍可从「举报反馈」「钱包/VIP 充值」「牌桌联系客服」「排行榜」进入；首页底部不再是网页客服入口。若之后要恢复，只需把 `panelMain.ts` 的「客服」分支指回 `panelKefu`。

### 2026-10-31 服务端游戏库直读、CORS 与客户端请求修复

- 本地 `go build ./...`、`go vet ./...`、`go test ./...` 通过；最新 Linux amd64 静态二进制 SHA-256：`0472c2663c1c2f916f04939ec5a5657a3b813bd92b00d981d5a8f961e5946c49`。
- 已部署至 `/www/html/.chattool/bin/chattool`，旧版本备份为 `bin/chattool.previous-game-db-20261031-224153`；远端 `/api/health` 返回 `status=ok`。远端运行环境通过 `CHAT_GAME_DB_*` 连接游戏库，当前使用已有数据库账号的只读查询路径，代码只执行 `SELECT`。
- 通过 `https://154-37-155-17.nip.io/chattool/api/direct/session` 实测：来自 `http://localhost:7456` 的 `OPTIONS` 返回 `204`，包含 `Access-Control-Allow-Origin`、允许方法和请求头；无有效票据的 POST 返回 `401 DIRECT_AUTH_REQUIRED` 且同样带 CORS 头。原先的预检 404 已消失。
- 远端访问日志确认创建会话返回 `200`，修复后聊天历史请求 `/conversations/{真实ID}/messages` 返回 `200`；此前的 `/conversations//messages` 404 属于客户端在 `onLoad` 过早读取参数产生的历史请求。
- `CHAT_DIRECT_CORS_ORIGINS` 当前远端未显式写入运行环境，服务使用代码默认的两个本地调试来源；后续若网页调试端口变化，只需在远端 `runtime.env` 增加该变量并重启 ChatTool。

### 2026-11-01 图片发送 409、弹窗关闭与三端兼容

- 图片发送 409 的根因是 `internal/directchat/service.go` 校验附件类型时比较了尚未赋值的 `msg.MessageType`，导致已上传图片被错误判定为 `MEDIA_UPLOAD_INCOMPLETE`。已改为使用请求中的标准化 `messageType`，补充图片完整链路测试；Linux amd64 二进制已部署并重启，远端健康检查正常。
- `panelMsgView.ts` 原来无论提示框挂在 `Canvas/Top` 还是 `Canvas/Normal` 都按普通层关闭，导致聊天错误弹窗点击“确定”没有反应。现在根据当前父节点选择 `ClosePanelMode.Top/Normal`，确认、取消和关闭都能销毁正确节点。
- `DirectChatManager.ts` 的媒体上传统一把原生 `Uint8Array`/TypedArray 转成完整 `ArrayBuffer`；Android 新增系统文档选择器桥，iOS 新增系统相册选择器桥，未知相册格式在原生侧转 JPEG，避免 HEIC 原始数据伪装成 JPEG。
- Android 和 iOS 原生工程分别由 `tools/sync_android_chat_webview.py`、`tools/sync_ios_chat_webview.py` 重复同步；Android `:qing:compileDebugJavaWithJavac` 通过，iOS 直聊桥 `clang++ -fsyntax-only` 通过，Xcode 工程 `-list` 通过。完整 iOS 模拟器构建因先重编 Cocos 底层库被主动停止，未把它记为完整 iOS 包构建通过。
- 当前仍未完成 Android/iOS 真机、正式 Web 包和三端双账号媒体实测；这些属于后续验收门，不把静态编译结果当作真机验收。

### 2026-11-01 附件创建 500、列表摘要与聊天滚动

- 复现并定位图片 `POST /api/direct/conversations/{id}/attachments` 的 500：生产库旧图片记录的 `external_media_id` 是空字符串，`(provider, external_media_id)` 唯一索引把后续图片附件也判为重复，服务端只对外返回 `INTERNAL_ERROR`。`SQLStore.CreateAttachment` 已改为通过 `nullIfEmpty` 传 SQL `NULL`，图片的外部媒体编号不再写空字符串；未知内部错误同时记录服务端原始数据库错误，客户端仍不暴露数据库细节。
- 最新 Linux amd64 二进制 SHA-256：`8961470ef76f88c76e70bc57d1ab9f39323ec8ee84cbc988271ba0f6a3b75c19`，已部署到 `/www/html/.chattool/bin/chattool` 并重启；远端 `/api/health` 正常。用真实换票会话回放创建附件、上传图片、确认附件，三个接口均返回 200，测试附件及文件随后清理。
- `assets/scripts/UI/panelMessage.ts` 的会话摘要现在把换行压成空格，长文本截取为单行并追加 `…`，同时运行时约束摘要 Label 宽度和 `CLAMP`，避免长消息冲出卡片；未改 `panelMessage.prefab`。
- `assets/scripts/UI/panelMessageChat.ts` 增加 `PrepareScrollLayout`：动态消息 content 按当前 view 宽高和顶部锚点维护，停用会把动态高度压回固定稿尺寸的 content Widget；到底部滚动延迟到下一帧执行，历史消息仍按顶部游标加载并保留高度差。未改 `panelMessageChat.prefab`，已在 Edge 调试页点击 Recompile。
- 本次静态验证：直聊相关 Go 测试通过，三个客户端脚本 TypeScript 转译无诊断，`git diff --check` 通过。未做 Android/iOS 真机和正式包验证。

### 2026-11-01 新消息增量滚动与图片预览蒙版

- `panelMessageChat.ts` 的新消息轮询不再调用整段 `scrollToBottom(0.2)`；收到消息前记录当前 offset 和最大 offset，渲染后只按 `getMaxScrollOffset` 的新增高度直接定位，避免 ScrollView 先回弹再上移。主动发送在距离底部 180px 内也走直接定位，只有首次进入且距离底部较远时才保留到底部动画。
- 自动跟随底部的阈值收紧到 12px。用户正在上翻历史消息时保留当前位置，继续使用新消息提示；首次进入、主动发送和点击新消息仍使用原有到底部逻辑。
- 大图预览在现有预览节点下运行时增加 `cc.Graphics` 黑色半透明蒙版，置于图片与关闭按钮之前，确保图片放大时背景变暗；没有修改 `panelMessageChat.prefab`，保留用户手动调整。
- TypeScript 转译通过，已在 Edge Cocos 调试页重新 Recompile 并确认按钮恢复；未做真机动画手感和正式包验证。

### 2026-11-01 二次修复滚动位置与自己的头像

- 根因确认：`PrepareScrollLayout()` 每次消息重绘都把 `content.y` 重置到视口初始位置，ScrollView 随后重新校正到底部，造成整页先跳再回弹。新增 `scrollLayoutReady`，只在首次初始化设置 `content.y`，后续重绘保留当前滚动位置；新消息仍按新增高度直接补滚。
- 自己头像错误的根因是直聊代码读取 `account.avatar`，游戏实际头像字段为 `account.photo`。`BuildLinkPayload()` 与 `Me()` 现优先读取 `photo`，旧字段只作为兼容回退；对方头像链路不变。
- TypeScript 转译通过，Edge Cocos 调试页已重新 Recompile 并恢复；未改用户手动调整的 `panelMessageChat.prefab`，未做真机动画手感验证。

### 2026-11-01 未读通知与列表自动刷新（已由长连接替换）

- 现象：接收方能在服务端产生未读，也能在手动进入消息页时看到红点和新列表，但大厅停留期间不会主动更新。
- 根因：`DirectChatManager` 已有 `/unread` 轮询实现，但 `panelMain` 只执行一次 `LoadUnread()`，没有调用 `StartUnreadPolling()`；聊天详情的 4 秒增量轮询只覆盖已打开的会话，不能替代大厅未读摘要轮询。
- 修复：该阶段曾由大厅 `onEnable` 启动常驻未读轮询，并对 `ApplyUnread` 做并发与变化检测；随后在 2026-11-01 长连接改造中移除固定周期请求，改为 WebSocket `message.new` 事件触发摘要和消息补偿。局部已读回写只扣除已知会话的未读，不会误清除尚未加载的其他俱乐部红点。
- 验证：Go 全量测试通过；`DirectChatManager.ts`、`panelMain.ts`、`panelMessage.ts`、`panelMessageChat.ts`、`GameDef.ts` 使用 TypeScript 5.9.3 `transpileModule` 无诊断；`git diff --check` 和 `check_memory.py check` 通过。未完成 Creator 运行预览、双账号实时联调、正式包和真机验证。

### 2026-11-01 直聊轮询替换为 WebSocket 长连接

- 服务端新增 `internal/directchat/realtime.go`：独立于客服 SSE 和游戏二进制连接的 WebSocket Hub；先通过 `POST /api/direct/ws-ticket` 获取一次性 60 秒票据，再用 `GET /api/direct/ws?ticket={oneTimeTicket}` 升级，避免把长期聊天令牌写入 URL。连接具备 Ping/Pong、读写超时、64 KiB 帧上限、32 条有限发送队列和队列溢出主动断开，避免慢客户端拖垮进程或无限堆积内存。
- 消息先经过原有权限、俱乐部成员和媒体校验并成功落库，再广播 `message.new` 给接收方；发送方收到 `message.sent`。事件不携带发送方媒体签名，接收方用自己的 `after` 游标请求完整消息。HTTP `POST /messages` 保留，并与 WebSocket 共用广播路径，避免两种发送入口行为不一致。
- `DirectChatManager.ts` 改为全局单 WebSocket、指数退避重连（1 秒起、30 秒封顶）、账号代际保护、前后台关闭/恢复和实时事件后的 `/unread`/`after` 补偿。文字、图片消息完成附件上传后优先走长连接发送；连接不可用、超时或回包丢失时使用同一 `clientMessageId` 回退 HTTP。聊天详情不再启动 4 秒消息轮询，收到 `message.new` 后按游标补拉，列表和大厅红点按事件触发刷新。
- `GameDef.ts` 新成长连接地址和超时/退避常量；`panelMain.ts` 启动 `StartRealtime()`；`panelMessageChat.ts` 监听 `realtimeMessage`。`ChatTool/server/go.mod` 增加 `github.com/gorilla/websocket v1.5.3`；Caddy 示例注释更新为 SSE/WebSocket 直通。
- 设计文档第 4、8.6、8.10、10.1、10.5.2、10.5.4、P3 与验收条款已同步改为长连接方案，说明 HTTP 保留边界、事件格式、TLS/query token 要求和断线幂等补偿。

验证：Go `test ./...`、`vet ./...` 通过；新增 Hub 定向投递测试；5 个直聊客户端脚本用 TypeScript 5.9.3 `transpileModule` 无诊断。未验证 Creator 运行、双账号真实 WebSocket、Caddy/WSS 生产反代、正式 Web/Android/iOS 构建和真机。生产发布前必须先部署 Go 二进制与反代配置，再用双账号完成“在线接收、后台重连、断线补偿、发送幂等、媒体消息签名”验收。

### 2026-11-01 长连接后端部署

- 构建并部署 Linux amd64 ChatTool 二进制，SHA-256：`e225076f8cea21ddeda24c935e27e96781d87a3cce5145416283f2a003561b21`。远端路径：`/www/html/.chattool/bin/chattool`；通过 `deploy/centos7-user/stop.sh`、原子替换、`start.sh` 重启，守护进程 PID 由 7814 变为 20532，子进程 `/www/html/.chattool/bin/chattool` 已指向当前文件。
- 回滚副本：`/www/html/.chattool/bin/chattool.previous-long-connection-20261101-0857`，SHA-256 为部署前的 `8961470ef76f88c76e70bc57d1ab9f39323ec8ee84cbc988271ba0f6a3b75c19`。本次未执行数据库迁移、未替换 ChatTool 网页静态目录。
- 验证：远端本机与公网 `/chattool/api/health` 返回 200；HTTPS `POST /chattool/api/direct/ws-ticket` 无令牌返回 `401 DIRECT_AUTH_REQUIRED` 并带 `https://154-37-155-17.nip.io` CORS；WSS `/chattool/api/direct/ws?ticket=invalid-test-ticket` 返回 `401 DIRECT_AUTH_REQUIRED`。说明新服务、Caddy 路由、一次性票据入口和 WSS Upgrade 前鉴权均已到位。
- 当前测试边界：Cocos 客户端长连接代码仍在 `/Volumes/SSD/qing` 工作区，尚未生成或发布 Web/Android/iOS 客户端包/热更；用户需要用包含最新 `DirectChatManager.ts` 的客户端测试双账号在线接收、发送确认、断网重连、after 补偿和图片/语音媒体。

### 2026-11-01 双客户端实时问题修复

- 复核发现全局消息页此前没有接入实时会话摘要事件，且 `ApplyLocalRead` 只清理按俱乐部缓存；从全局列表打开会话时，服务端已读成功但内存中的全局会话仍保留红点。现新增 `allConversationCache`，已读同时更新全部已加载缓存，并在服务端回写后补拉 `/unread`；`panelMessage` 监听 `allConversations` 和 `conversationRead`，消息到达后同步刷新摘要、排序、红点和未读数。
- 详情页此前只在收到 `message.new` 时执行 `after`。现同时监听 `realtimeState=open`，连接恢复后即使断线期间事件不可见，也会按最后消息 ID 补齐；多个实时事件在同一补偿请求期间会合并，消息按 ID 去重。用户在历史位置时保留滚动位置并显示新消息提示，贴近底部时自动已读。
- 失败消息重试不再绕过长连接，统一调用 `SendText`/`SendAttachmentMessage`，仍复用原 `clientMessageId`，连接不可用时由管理器回退 HTTP。WebSocket `error` 主动关闭，进入统一指数退避重连流程。
- 本轮验证：5 个直聊客户端脚本使用 TypeScript 5.9.3 转译无诊断；`git diff --check` 通过；直聊服务层测试通过。服务端已读游标修复后的 Linux amd64 二进制 SHA-256 为 `caf1f3d408b6a71f746056904e8b09756e085def38c5fa4089c3c48eae04407d`，已部署至 `/www/html/.chattool/bin/chattool`，旧版本备份为 `chattool.previous-read-order-20261101-0915`；公网健康检查 200，未授权票据接口仍返回 401/CORS 正常。尚未执行 Creator 实际双账号实时连接、断网恢复和正式客户端构建/热更。
- 追加需求：新消息由大厅 `panelMain` 复用新俱乐部申请提示音 `Audio/eff/申请提示.wav`，音量跟随现有 `AudioEff` 设置；消息入口和会话行数量超过 99 显示 `99+`。已补充代码与验收条款，仍需双账号实际收到消息、关闭音效和 100+ 未读场景验证。
- 追加需求：消息列表每个所属俱乐部固定保留通过俱乐部邀请码关系确定的直属上级代理对话；服务端不使用平台账号代理字段，所有有直属上级的成员都生成入口，已有真实会话也标记为固定入口，并在全局排序中优先保证固定入口可见；固定入口详情页按服务端 `canDelete=false` 隐藏删除按钮。新增 `club_agent_info.note` 读取与上级链可见性过滤：上级可见下级备注，下级/同级不可见；消息列表显示“昵称（备注） 俱乐部名称”。已补充代理/盟主入口、无历史全局列表、固定会话删除和备注权限回归测试；Go 全量测试、vet、TypeScript 转译通过。Linux amd64 二进制 SHA-256 `d20e5c642309f2946e7b65908a02ef419915573710c713b50444cebed30c8b99` 已部署，旧版本备份 `chattool.previous-club-superior-note-20261101-1030`，线上健康检查通过；Creator 已刷新运行预览，真实账号备注和入口显示待实测。
- 追加需求：玩家信息弹窗的「下级成员」行补齐同款「对话」按钮；原因是统一行逻辑已绑定 `bindDirectChat`，但下级行模板缺少节点。已在 `panelMain.prefab` 复制正式按钮资源，继续沿用上级角色判断和服务端会话权限校验；静态 Prefab 引用检查通过，Creator 预览刷新后待双账号点击验收。
- 追加需求：消息列表中群主/盟主的俱乐部名称后增加“（群主）/（盟主）”提示，复用 `DirectPeer.role` 判断，代理和普通成员不追加角色文案。
- 配置与文档同步：`ChatTool/docs/api.md` 增加直聊 HTTP/WebSocket 接口、事件、游标、角色和备注权限说明；`ChatTool/docs/deployment.md`、`ChatTool/deploy/centos7-user/runtime.env.example` 补齐票据、游戏库只读连接、语音、媒体票据、CORS 和开发开关配置；架构图与 QA 清单同步更新。提交前仍需执行最终全量测试和推送核验。
