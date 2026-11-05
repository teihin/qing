# 消息列表：手势滚动、下拉刷新与分页加载

日期：2026-11-04。目录 `/Volumes/SSD/qing`，分支 `codex/club-ui`（HEAD `7e27148`，改动未提交）。
范围：只改消息首页，不动服务端、协议与客服链路。

## 目标

- 消息会话列表可正常手滑滚动；实时消息到达时不再把用户滚动位置顶回顶部。
- 消息列表顶部下拉刷新；滚动接近底部自动加载下一页，避免一次拉取全部会话造成卡顿。
- 聊天详情页在长屏/旋转导致视口高度变化时保持列表与视口顶部对齐。

## 改动

- `assets/scripts/UI/panelMessage.ts`
  - 分页状态：`page/pageSize/hasMore/loadingFirst/loadingMore/refreshing`，首屏只请求 `LoadAllConversations(1)`，滚动接近底部（260px）或内容不足一屏时请求下一页并只追加新增行。
  - 下拉刷新改为与大厅房间列表同一套：`content.height` 至少为 `view.height + 1`（房间列表的 1px 滚动余量），短列表也能进入 ScrollView 原生弹性拖动/回弹；脚本不再自己平移 content，也不再监听触摸。`scrolling` 时按负向 offset 显示「下拉刷新 / 松开刷新」，拉过顶部松手触发 `bounce-top` 后刷新第一页（负向回弹 ≥40px 才算，避免误触）。
  - 之前两版失败原因留档：① ScrollView 拖动超过 7px 会给行补发 `simulate=true` 的 `TOUCH_CANCEL`，捕获监听若当成抬手会让下拉第一次移动就被取消；② 自行平移 content 后 `getScrollOffset()` 被自己的位移污染，第二次移动就被误判成“已离开顶部”；③ 内容不足一屏时 ScrollView 会把位移钳成 0，必须靠 1px 余量解决，而不是脚本自己挪 content。
  - 实时更新：`allConversations` 第 1 页只与已加载的后续页合并；行数不变时复用节点重排+重绑（含红点/摘要），不整表销毁，也不重置滚动；新增会话插到顶部时按行高补偿滚动偏移。
  - 滚动布局：重绘时只在顶部重新对齐 `content.y`；内容高度按行数维护；`RestoreScrollOffset` 延后一帧定位。
  - 切页回来/已读回刷改为 0.2s 合并的静默第一页刷新；离开该页时不再处理实时事件。
  - 底部提示复用新增 Prefab 节点：加载中 / 没有更多了（后者仅在接近底部时显示）。
- `assets/resources/UI/panelMessage.prefab`
  - 新增两个 Label 节点：`下拉提示`（TOP+CENTER，top 126）、`底部提示`（BOTTOM+CENTER，bottom 108），默认隐藏；其余节点、UUID、模板未动。
- `assets/scripts/UI/panelMessageChat.ts`
  - `PrepareScrollLayout` 记录视口高度；高度变化时按 `(1 - view.anchorY)` 平移 `content.y`，保持滚动偏移不变，修正 onLoad 早于 Widget 对齐时的内容整体偏移。
- `ChatTool/server/internal/directchat/request_cache.go`（新增）
  - 单请求内的俱乐部/成员/联盟/代理关系缓存，见下节。

## 进入速度（2026-11-04 追加）

- 实测客户端不是瓶颈：Creator 预览里 `UI/panelMessage` 加载约 44ms，`RenderFull` 1/30/100 行分别约 5.7/9.6/20.9ms。慢在网络返回。
- 服务端根因：`AllConversations` 逐会话调用 `GetClub` + `viewerForClub` + `peerForClub` + `isFixedTarget` + `peerView`；其中 `GetMember` 每次都会重新执行 `agentRelations`（整表读取该俱乐部的 `club_agent_info`），一次列表请求可放大到上百次 SELECT。
- 服务端优化：新增 `request_cache.go`，在 `authorized` 里按请求注入缓存，`GetClub/GetUnionByClub/GetAccount/GetMember/agentRelations` 在本请求内复用结果；不跨请求保存，因此不会引入权限/成员关系的陈旧窗口。`go build/go vet/go test ./...` 通过。**已部署**：Linux amd64 静态二进制 SHA-256 `2fe27bf0…`，备份 `bin/chattool.previous-entry-cache-20261104-230047`（旧版 `40fc3e4c…`），8893 监听 PID 19928，公网 `/chattool/api/health` 200、未授权直聊接口 401；重启时现有 WebSocket 会短暂断线并自动重连。
- 客户端优化：按账号把第一页会话摘要缓存到 `localStorage`（`direct_chat_list_v1_<guuid>`，最多 30 条），进页面先用缓存立即渲染，再静默合并服务端第一页；切走时落盘。新增 `消息列表第一页耗时 Nms` 日志便于后续核对。
- 2026-11-04 复测「第一页 8317ms」：Caddy 访问日志里 `/conversations` 服务端耗时只有 **10–33ms**，数据库也很小（会话 29、参与者 58、消息 191、`tbl_Account` 59 行），慢不在查询。首次慢、后续 178ms 指向客户端首次请求的连接/鉴权或回调等待。
- 对应处理：`panelMain.SetupDirectChatEntry` 进大厅时预取 `LoadAllConversations(1)` 并预加载 `UI/panelMessage`；消息页优先用 `DirectChatManager.CachedAllConversations()`（大厅预取结果）渲染，其次 localStorage。`Request`/`EnsureSession` 增加慢请求拆段日志（总耗时、鉴权、HTTP），下次可区分是登录还是网络。

## 验证

- 两个脚本用项目内 TypeScript 5.9.3 `transpileModule`：0 诊断。
- 在 Creator 预览页按房间列表机制实测（手动把 `content.height` 设为 `view.height + 1`）：一条会话时向下拖动，content.y 从 551.75 依次变为 511.75、481.75（offset -70），松手后 `bounce-top` 触发并回弹，说明短列表已能拉、能刷新。注意预览的 `temp/quick-scripts` 在外部改写源码后可能不自动重编，需在 Creator 调试页点 Recompile 后再测。
- Prefab JSON 全部 `__id__` 引用有效、节点名唯一、新增节点父子/组件互指一致。
- `git diff --check` 通过。

## 未验证（不得当作已通过）

- Creator 是否已重新导入 `panelMessage.prefab`、编辑器内两个提示节点的位置与字号。
- 真机/浏览器登录后的实际手滑、下拉手势与惯性滚动；长列表分页边界（30/60/90 条）与不同屏高补页。
- 双账号实时消息下的滚动保持、红点合并与「新会话插入顶部」补偿。
- 未构建、未出热更包、未提交。

## 下一步

1. Creator 打开消息页确认两个提示节点显示与位置；真机验证下拉刷新和滚到底自动翻页。
2. 用 >30 个会话的账号验证第 2/3 页追加、没有更多提示与滚动位置。
3. 双账号连发消息，确认列表不再跳回顶部、当前浏览位置不变。

## 2026-11-05 补：底栏「消息」点击刷新

- 大厅底栏「客服」按钮就是消息入口；每次点击都调用 `panelMessage.RefreshFromTop()`，与下拉松手同一入口，重取第一页并回到顶部。
- 首次实例化时如果 `onLoad` 还没完成，`RefreshFromTop` 的 `manager == null` 保护会直接返回，由 `start()` 原有刷新兜底；页面已存在时点击也会强制刷新（不依赖 `onEnable`）。
- 改 `assets/scripts/UI/panelMessage.ts`（`RefreshFromTop` 改 public 并加初始化保护）、`assets/scripts/UI/panelMain.ts`（`OpenDirectChatPage` 三条分支后统一触发，新增 `RefreshDirectChatPage`）。
- 未做：Creator 导入/构建/真机；未验证连续点击时请求合并与滚动回顶的实际表现。
