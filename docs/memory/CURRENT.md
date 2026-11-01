# qing 当前状态

更新时间：2026-11-01

规则见 `AGENTS.md`；版本与 UI 见 [决策](DECISIONS.md)、[专题](topics/v7-ui.md)。未发布与待验证汇总见[剩余问题清单](handoffs/2026-10-28-open-issues-backlog.md)。

## 2026-10-31 俱乐部 1 对 1 私聊（服务端已部署；客户端空会话请求已修复）

- 服务端新增 `/api/direct/*` 与 `chat_direct_*`（迁移 `006`，客服表未动、清理独立）；直聊关系已改为通过 `CHAT_GAME_DB_*` 只读连接直接查询游戏库，不再读取俱乐部同步副本，也不再提供目录同步运行路径。迁移遗留的快照表未参与运行时查询。
- 客户端 `DirectChatManager` + 消息页作为 `Main` 第 5 个分页，成员列表行尾加「对话」。本次 404 根因是 Cocos `onLoad` 早于 `UIManager.setPanelInfo`，聊天页在 `onLoad` 读取不到 `strUserData`，导致请求拼成 `/conversations//messages`；已将参数解析移到 `start`，并在创建会话、文字发送、语音发送和统一请求层增加空会话 ID保护。
- 聊天详情消息区已改为效果图结构：对方左侧绿色九宫格圆角气泡 + 头像，自己右侧金色九宫格圆角气泡 + 头像；文字支持多行自动换行并由背景完整包住，语音气泡显示播放标识和时长。
- 消息渲染已修正：所有单行文字统一 72px 气泡高度，只有真实多行文字才按行数增加高度，避免数字/英文宽度估算造成同为一行却高低不一致。
- 聊天 EditBox 已从数字模式改为 `InputMode.ANY`，允许中英文、数字、空格和符号输入；脚本启动时同步兜底设置，避免旧 library 缓存继续限制为数字。
- 服务端新增直聊 CORS 白名单与 `OPTIONS` 预检处理，只作用于 `/api/direct/*`；默认允许 Cocos 调试来源 `http://localhost:7456`、`http://127.0.0.1:7456`。Go 全量测试通过，Linux amd64 二进制已部署到正式 ChatTool，旧二进制备份为 `bin/chattool.previous-cors-20261031-1354`。公网预检返回 `204` 和 `Access-Control-Allow-Origin`，实际未授权请求返回带 CORS 头的 `401 DIRECT_AUTH_REQUIRED`。
- 最新游戏库直读版本已部署，二进制 SHA-256 为 `0472c2663c1c2f916f04939ec5a5657a3b813bd92b00d981d5a8f961e5946c49`；远端健康检查返回 `status=ok`。Edge 调试中已观察到创建会话成功、聊天历史请求 `200`；此前的双斜杠 404 是旧客户端代码产生的历史请求。
- 客户端尚未做正式构建、真机和双账号双俱乐部完整联调；图片发送服务端修复已部署，Android/iOS 原生选图桥已接入项目级原生工程，网页版继续走浏览器选图；三端真机图片发送和录音仍未验证。见[交接](handoffs/2026-10-31-direct-chat.md)。
- 2026-11-01 图片附件创建 500 的根因是生产库历史图片记录把 `external_media_id` 留成空字符串，唯一索引 `(provider, external_media_id)` 与新图片附件冲突；`SQLStore.CreateAttachment` 现把空值作为 SQL `NULL` 写入，已部署并用真实接口完成创建→上传→确认回放，三步均返回 200，测试附件已清理。
- 消息列表摘要现对长文字做单行截断并追加省略号；聊天详情动态 content 停用固定稿 Widget 的高度覆盖，按当前 ScrollView view 尺寸重新定位和拉宽，并延迟到底部滚动，解决超过一屏后无法上下滑动、最新消息被输入区遮住的问题。仅改脚本，保留用户手动 Prefab 修改。
- 新消息滚动已进一步改为按新增内容高度直接补滚：仅在距离底部 12px 内跟随，使用 `getMaxScrollOffset` 计算新增高度并关闭小段缓动；重绘时保留 `content.y`，不再把内容先重置到初始位置，避免 ScrollView 先回弹再上移。主动发送在距离底部 180px 内也直接定位到新底部，用户查看旧消息时不再整屏跳动。图片大图预览增加独立黑色半透明运行时蒙版，未改用户手动调整的 Prefab。
- 自己的聊天头像改为优先读取游戏账号的 `photo` 字段，服务端会话头像和旧 `avatar/avatarIndex` 字段只作为回退；对方头像仍使用俱乐部成员数据。
- 2026-11-01 长连接改造：上述直聊轮询已替换为独立 WebSocket（先 `POST /api/direct/ws-ticket`，再 `GET /api/direct/ws?ticket=...`）。服务端消息落库成功后才向接收方在线连接推送 `message.new`，发送方收到 `message.sent`；事件只带会话/消息游标，客户端再用自己的 `after` 请求读取完整消息和媒体签名。文本/语音消息优先走 WebSocket，断线、超时或回包丢失用同一个 `clientMessageId` 回退 HTTP，服务端幂等保证不重复。服务端增加有限发送队列、读写超时、Ping/Pong、指数退避重连和账号/前后台生命周期处理；HTTP 历史、附件、已读、删除和媒体接口保持不变。新增 `github.com/gorilla/websocket`，Caddy 反代继续直通 `/chattool/*`。
- 长连接本地验证：`go test ./...`、`go vet ./...` 通过，新增实时 Hub 定向投递测试；`GameDef.ts`、`DirectChatManager.ts`、`panelMain.ts`、`panelMessage.ts`、`panelMessageChat.ts` 使用 TypeScript 5.9.3 转译无诊断。尚未做 Creator 实际运行、双账号真连接、正式 Web/Android/iOS 构建、真机和生产反代升级；当前生产服务仍需先部署新 Go 二进制并确认 WSS 连接、发送、接收、断线补偿后再切换流量。
- 2026-11-01 长连接后端已部署：Linux amd64 二进制 SHA-256 `e225076f8cea21ddeda24c935e27e96781d87a3cce5145416283f2a003561b21` 已原子替换至远端 `/www/html/.chattool/bin/chattool` 并由 `supervise.sh` 重启；旧版本保留为 `chattool.previous-long-connection-20261101-0857`。本机和公网 `/chattool/api/health` 均返回 200；HTTPS `POST /chattool/api/direct/ws-ticket` 无令牌返回 `401 DIRECT_AUTH_REQUIRED` 且 CORS 正常；WSS 无效票据同样返回 401，反代路由已生效。未部署 Cocos 客户端包/热更，双账号真实长连接、发送、断线补偿和媒体消息仍待用户测试。
- 2026-11-01 双客户端问题修复：`DirectChatManager` 增加全局会话页缓存，已读回写同时清理俱乐部缓存和全局缓存，并以 `/unread` 做服务端校正；`panelMessage` 监听实时会话摘要和已读事件，收到消息后立即刷新摘要、排序和红点。`panelMessageChat` 监听 WebSocket 恢复事件，重连后按最后消息 ID 执行 `after` 补偿；失败消息重试统一复用长连接优先、HTTP 回退和同一 `clientMessageId`。连接 error 会主动 close 进入统一重连流程。客户端 TypeScript 转译与 Go 全量测试通过；Creator、双账号、断网恢复和正式包仍待实际验收。
- 2026-11-01 已读游标并发修复：服务端 `SetLastRead` 改为数据库条件更新，只允许 `(created_at,id)` 游标向前，避免旧请求晚返回导致红点恢复；fake store 与服务层回归测试同步覆盖。Linux amd64 二进制 SHA-256 `caf1f3d408b6a71f746056904e8b09756e085def38c5fa4089c3c48eae04407d` 已部署并原子替换，旧版本备份为 `chattool.previous-read-order-20261101-0915`；公网健康检查仍返回 200。客户端尚未发布正式包/热更。
- 2026-11-01 直聊提示音与数量显示：大厅 `panelMain` 监听直聊 `realtimeMessage`，复用新俱乐部申请的 `Audio/eff/申请提示.wav`，仍受 `AudioEff` 总音效开关控制；消息入口总红点和会话行未读数超过 99 统一显示 `99+`。客户端 TypeScript 转译通过，双账号声音与 99+ 实测待验。
- 2026-11-01 固定上级代理入口与备注权限：服务端按每个所属俱乐部的 `club_agent_info.upper_guuid` 生成直属上级固定会话，明确不读取平台模式的 `tbl_Account.sm_agentID`；所有有直属上级的成员（含代理/盟主）都可见，已有真实会话也标记 `isDefaultTarget=true`，并在全局列表排序中优先保证固定入口可见。固定会话服务端禁止删除，详情接口返回 `canDelete=false`，客户端按该字段隐藏删除按钮。`club_agent_info.note` 只对目标成员的俱乐部上级链返回；消息列表显示为“昵称（备注） [俱乐部名称]”，无权限时省略备注但保留方括号俱乐部名称；群主/盟主在方括号俱乐部名称后显示角色。备注回归测试、Go 全量测试、vet、TypeScript 转译通过；Linux amd64 二进制 SHA-256 `d20e5c642309f2946e7b65908a02ef419915573710c713b50444cebed30c8b99` 已部署，旧版本备份 `chattool.previous-club-superior-note-20261101-1030`，线上健康检查通过；Creator 预览已刷新，真实账号仍待验证；玩家信息下级行已补齐「对话」按钮，实测待验；API、部署和 runtime 配置文档已同步。

## 2026-10-30 牌局回顾加「翻牌」按钮（未构建、未真机）

- 回顾窗口底部新增「翻牌」：翻开本局所有已发的牌（未发牌不显示），默认 500 钻、后台可改、按钮标价；价格来自 `ConfigManager.CONSUME_FLIP` + `stone_consume_price.go`，prefab/scene 同批；已付费或本来就全开的局显示「已翻开」、不扣费。`扣费提示` 底图自带按钮文字，`V8文字` 必须保持关闭。见[交接](handoffs/2026-10-30-review-flip-cards.md)。
- `panelRecordInfo/牌局回顾` 同款「翻牌」在 `操作` 行右侧；显示条件只留「列表显示 + 有房间号」，**别再按场景名/`PanelGameView` 判断**（实机不出现）。详见表内交接。

## 2026-10-30 俱乐部玩家备注（未构建、未真机）

- 接入 `设置_俱乐部_成员_备注`（创建者/直属上级、30 字、中英文）；列表与信息显示 `名字(备注)`，备注行恢复、输入框对齐已修；转译/桩测试通过，Creator/真实回包/真机未验。见[交接](handoffs/2026-10-30-club-member-remark.md)。

## 2026-10-30 大厅底栏改「客服 俱乐部 BY 推广 我的」（未构建、未真机）

- `Down` 改为 客服/俱乐部/BY/推广/我的（原「公告」toggle 改名推广，客服仍是 Button）；`Main/公告` 分页保留但底栏不再进入。
- `club_nav_bar_v8.png` 重绘并清掉公告区，`.meta`/UUID 未动、体积未增；推广复用全屏 `推广二维码` 页，打开收起底栏、关闭回原页。
- 「我的」里的游戏推广行隐藏（按钮区 3 行、内容高 550，正好不滚）。见[交接](handoffs/2026-10-30-nav-tabs.md)。

## 2026-10-30 机器人账号首次登录激活（已部署，未提交）

- 机器人入会需要已登录建号，`kbe_accountinfos` 玩家行由首次登录生成，仍不后台预插 `tbl_Account`。迁移 040（`activated_at` 等 4 列）已执行：巡检按 `kbe_accountinfos` 补标，再给在线 Worker 排「只登录」激活会话，回查确认建号才落标记；未激活行不可投放（`409 ROBOT_NOT_ACTIVATED`）。
- 已部署：后端 `0c602dbd…`、前端 `index-BgH2Ot-G.js` / `index-BvCWh9Hq.css`；回滚 `backups/xuanmanager.20261030-0108-rollback`、`web.previous-activation-20261030`。
- **真实激活未演练**：唯一 Worker `mac-mini-2-local` 自 10-28 离线；本机 `bin/xuanagent` 已重建（含 `XUAN_LOGIN_ONLY`），待启动。
  见[交接](handoffs/2026-10-30-account-activation.md)。

## 2026-10-29 投放输赢目标支持「按周时段」（已部署，未提交）

- 输赢目标新增 `profit_mode='schedule'`：周一到周日可多段（≤28，结束早于开始算跨零点），时段内按 `window_net` 控输赢，时段外先 `drain` 打完手里一局再让出 Worker（`schedule_state='released'`）。
- 迁移 039（`profit_schedule/schedule_window/window_net/schedule_state`）已执行，后端与前端已上线，`go vet/build`、`tsc -b`、eslint、`vite build` 通过；**交互未实测，Worker 未重启**。见[交接](handoffs/2026-10-29-profit-weekly-schedule.md)。

## 2026-10-29 控制台小步调整（已部署，未提交）

- 侧边栏一级/二级配色区分；「自动化组」模块 45 隐藏，分组增删改并入**机器人管理 → 分组管理**（建组只填名称+策略；删组可搬走组内机器人）；创建/编辑机器人弹窗可内联新建分组并自动选中。
- 回滚点 `web.previous-navlevels-20261029`、`web.previous-groupmanager-20261029`。**交互待实测**。见[侧边栏](handoffs/2026-10-29-sidebar-level-contrast.md)、[分组管理](handoffs/2026-10-29-group-manager-in-robots.md)、[删组搬迁](handoffs/2026-10-29-group-delete-move.md)、[组策略](handoffs/2026-10-29-group-strategy-only.md)、[内联建组](handoffs/2026-10-29-robot-inline-group-create.md)。

## 2026-10-29 机器人密码改回密文 + 独立密钥（已部署，未提交）

- 创建/改密恢复 `SealCredential` 落库（`v1:` 密文），心跳下发不变（解密后下发）；服务器 `runtime.env` 新增独立 `XUAN_CREDENTIAL_KEY`。
- 新增 `server/cmd/xuanresea` 一次性回封工具，已装 `bin/xuanresea`；当前机器人表为空、无存量明文。
- 后端 PID 22966（`de47f71e…`），前端 `index-CcSNTgVz.js`；回滚备份 `*.previous-sealpwd-20261029`。**端到端待主人验证**；密钥只存 runtime.env，建议另存离线备份。见[交接](handoffs/2026-10-29-robot-password-sealed.md)。

## 2026-10-29 自动化：Worker 俱乐部模式 + 策略下发 + 控制台收尾（未提交，前后端已部署 v6）

- **Worker**：进房必须自己在该俱乐部内；俱乐部房不结束，倒计时到 → 全员结算 → 分回身上 → 需重新带入（人仍在留座）。**每轮结算后离房换桌**，离开的房 10 分钟内不再进；**结算时已超目标则留房继续带入来输，最多连 2 次**。见[交接](handoffs/2026-10-29-worker-club-mode.md)。
- **策略**：后台可建多套绑机器人、运行期下发。**策略 = 动作智力**（跑法/出牌节奏、安全线、牌力、收敛），**投放 = 选机器人 + 绑策略 + 底皮 + 输赢目标**（投放必选策略与输赢），草稿不下发。见[交接](handoffs/2026-10-29-automation-strategy-runtime.md)。
- **机器人/控制台**：创建弹窗删「智力/倍数/参与调度」；密码改回**密文 + 独立密钥**；侧边栏可折叠；测试数据已清空。见[交接](handoffs/2026-10-29-automation-robots-and-console.md)。
- 状态：038 已执行，后端 PID 18006、前端 `index-IE64Hwkm.js`；**未提交**。

## 2026-10-29 牌桌小修与实时战绩（未构建、未真机）

- 留座归零 fire `SelfSeatTimeout` 关「带入窗口」，`PlayerList` 后兜底收窗；俱乐部房隐藏 `RoomFrame/info/游戏时间`。见[交接](handoffs/2026-10-29-seat-timeout-close-buyin.md)、[交接](handoffs/2026-10-29-club-room-hide-clock.md)。
- 「记录」在座行加第 4 列 `countdown`，`获取_房间_已结算_玩家_命令`（每页 20）滑到底翻页；`带入记录.prefab` 改 4 列 + `V8表头countdown`。见[交接](handoffs/2026-10-29-realtime-settled-list.md)。

## 2026-10-27 及更早（阶段归档）

- 自动化控制台、我的页滚动、推广下载地址、消费全切钻石与历史 UI 状态见[归档](archive/2026-10-30/current-early-items.md)。

## 本轮实时核对：记忆整理

目录 `/Volumes/SSD/qing`，Creator 2.4.13。见[整理交接](handoffs/2026-09-05-memory-migration.md)。

## 最近报告的 UI 状态

见[全套进度](handoffs/2026-09-11-v8-all-pages.md)与[逐页归档](archive/2026-09-15/ui-status-table.md)。

## 待核实项与工作边界

1. `panelQianBao.ts` “确认充值”仍显示“暂未开通”并提前返回；本轮只修选择和美术，不代表充值业务恢复。
2. V7 只覆盖有实施记录的页面；牌桌、动画等未列入范围的设计不得因归档自动判废。
3. 待验证项不构成执行授权；动手前重新核实未提交差异。

来源：[原文归档](archive/2026-09-05/AGENTS.original.md)；目录 `/Volumes/SSD/qing`，Creator 2.4.13，`build` 与 `runtime-src.zip` 保留。
