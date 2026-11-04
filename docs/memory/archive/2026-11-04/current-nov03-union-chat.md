# 归档：2026-11-03 消息/直聊按联盟层级调整

> 原 `docs/memory/CURRENT.md` 段落归档于 2026-11-04，用于控制当前状态文件体积；结论与交接链接保留在当前状态。

- 固定联系人改为「直属上级代理 + 本俱乐部老板 + 联盟大群主」，三级按 guuid 去重；固定会话服务端拒绝删除。普通玩家默认看到老板与（入盟后的）大群主，代理保留直属上级。
- 联盟大群主可查看联盟内任意俱乐部成员并与其一对一聊天，会话按对方俱乐部各一条；消息首页改为按参与者读取全部会话，跨俱乐部私聊可见。
- 聊天页上下分只给俱乐部老板；赠送给老板和代理；代理不再显示上下分。盟友管理行不再提供成员/聊天入口（点击会误开聊天对象选择，已移除）；成员列表里的盟主虚拟行仍可直接对话。
- 已改 `ChatTool/server/internal/directchat/*`、`DirectChatManager.ts`、`panelMessage.ts`、`panelMessageChat.ts`、`ClubManagementView.ts`、`ClubManagementApi.ts`、`panelMessageMembers.ts`。Go build/vet/test 与 TS 语法检查通过；二进制 `40fc3e4c…` 已部署（回滚 `bin/chattool.previous-union-chat-20261103-1915`），健康 200、联盟表只读可查；已随 `c77b7e5` 提交推送到 `origin/codex/club-ui`；真实账号联调、Creator/真机待验证。详见 [交接](../../handoffs/2026-11-03-direct-chat-union-permissions.md)。
