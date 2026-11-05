# 消息列表：手滑滚动、下拉刷新与分页（2026-11-04 原文）

## 2026-11-04 消息列表：手滑滚动、下拉刷新与分页（未构建、未真机）

- 消息首页改为按页加载（每页 30），滚动接近底部自动追加下一页，内容不足一屏自动补页；首屏不再一次拉全部会话。
- 顶部下拉沿用房间列表机制：`content` 至少比 `view` 高 1px，短列表也能由 ScrollView 原生回弹，`bounce-top` 触发刷新、负向 offset 显示提示。实时 `allConversations` 只合并第一页，行数不变时复用节点更新红点/摘要，不再整表重建或强制回到顶部。
- 聊天详情页视口高度变化时同步平移 `content.y`，修正长屏下列表整体偏移导致的滚动异常。
- 进入慢：服务端列表接口实测 10–30ms，8.3s 在客户端首次请求；已在大厅预取首页并预载页面，消息页优先用管理器缓存。服务端已部署，客户端待重编译验证。
- 改 `panelMessage.ts`、`panelMessageChat.ts`、`panelMessage.prefab`、`directchat`；TS/Prefab/Go 检查通过，Creator/真机/分页/实时待验证。详见[交接](handoffs/2026-11-04-message-list-scroll-paging.md)。

