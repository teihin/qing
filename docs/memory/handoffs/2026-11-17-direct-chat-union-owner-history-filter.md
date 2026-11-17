# 2026-11-17 普通成员隐藏历史大盟主会话

状态：**ChatTool 服务端已部署；客户端源码已修复，未构建、未发布。**

## 结论

- 用户反馈与新账号自测不一致的根因是：2026-11-14 的实现只隐藏 BF 关闭后的“大盟主默认入口”，历史上已经建立的真实会话仍会被列表返回。
- 线上 ChatTool 当前二进制为 `b1ba8f54…`；`chat_direct_bf_club` 10 条记录全部关闭，旧 `chat_direct_bf_entry` 2 条也全部关闭。
- 生产只读统计显示仍有 24 条活跃的大盟主参与会话，分布在 11 个俱乐部，因此部分老账号继续看到大盟主窗口是可复现的。

## 本轮修改

- `ChatTool/server/internal/directchat/service.go`
  - 会话列表、全局消息列表、创建/恢复会话和消息详情统一调用大盟主会话可见性判断。
  - BF 关闭后，普通合伙人和玩家连历史大盟主会话也隐藏；旧会话 ID不能重新打开。
  - 俱乐部老板同时是大盟主时，仍按本俱乐部盟主会话放行。
- `ChatTool/server/internal/directchat/service_test.go`
  - 增加历史会话、全局列表、旧会话 ID和关闭/恢复切换覆盖。
- `assets/scripts/UI/panelMessage.ts`
  - 本地消息列表缓存版本 `4→5`，作废可能残留历史大盟主会话的缓存。
  - 首次进入消息页不再渲染大厅内存预取或本地缓存，等待服务端第一页后再显示，消除大盟主会话先闪现再消失。
- `ChatTool/docs/api.md`、`ChatTool/docs/qa-checklist.md`
  - 同步关闭 BF 后的历史会话规则，并修正 BF 无记录时默认关闭的说明。

## 验证与发布

- `cd ChatTool/server && go test ./...`、`go vet ./...`、`go build ./...` 通过。
- `panelMessage.ts` 用 TypeScript 5.9 `transpileModule` 语法检查通过；`git diff --check` 和 `docs/memory/check_memory.py check` 通过。
- 2026-11-17 13:08 已部署 ChatTool：新二进制 SHA-256 `a6ecd8b2e5e491b8bb5e5aeb1a05bce1f0c48e8b8bde50385b1353adb6c85729`；旧版备份 `/www/html/.chattool/backups/chattool.previous-union-history-20261117-1307`；本机与公网 health 200，未登录直聊 conversations 401。
- 客户端缓存版本 `4→5` 和首屏等待服务端的源码修改均未构建、未上传热更；服务端已拒绝旧会话 ID，因此旧客户端缓存不会重新打开受限窗口。真实账号页面/真机验收仍待做，当前工作区修改保持未提交。
- 后续验收使用：普通玩家/合伙人有历史大盟主会话、盟主账号、同账号多俱乐部且开关混合三类账号；确认关闭时列表、旧链接和实时刷新均不再显示大盟主。
