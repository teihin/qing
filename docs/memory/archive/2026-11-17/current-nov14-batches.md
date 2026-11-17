# 2026-11-14 批次（从 CURRENT 归档，2026-11-17）

> 原文整体搬移，内容未改；当前状态只保留一行索引。

- **后台靓号管理**：命令代理、号池/绑定/解绑、玩家/俱乐部展示，单菜单两页签（账号ID/俱乐部邀请码，权限独立），迁移 065/066 已执行；2026-11-15「我的」ID 改读 `custom_id`（回退 guuid）。见[交接](../../handoffs/2026-11-14-pretty-numbers.md)。
- **消息页 BF 关闭规则**：普通合伙人与玩家只剩所属盟主、盟主仍见大盟主、重开恢复；群主显示改读服务端 `roleName`；退会/已删俱乐部的历史未读不再点红点。ChatTool `854d01e6…` 已部署、health 200。见[BF 交接](../../handoffs/2026-11-14-bf-chat-hide-union-owner.md)、[身份](../../handoffs/2026-11-14-chat-role-name-union-owner.md)、[红点](../../handoffs/2026-11-14-unread-visible-clubs.md)。
- **后台玩家管理**：新增「关联账号数量」（同设备 90 天 / 同 GPS 网格 7 天 / 同公网 IP 7 天，单 IP>20、单网格>50 不参与，全局上限 2000）与「IP短码」列（6 位 Base62，精确匹配 `sm_ip`，仅 `admin999` 额外可见原始 IP）；详情仍只 `admin999` 见明文 IP/GPS。二进制 `bb8bdf37…`、前端 `index-magx5XK-.js`。见[关联账号](../../handoffs/2026-11-14-admin-player-relations.md)、[IP 短码](../../handoffs/2026-11-14-admin-player-ip-shortcode.md)。
- **客户端 BOSS 玩家信息弹窗**：`ip` 上屏前转 6 位无损可逆短码并加「复制」按钮，非 IPv4 显示「—」；服务端回包仍是明文。见[交接](../../handoffs/2026-11-14-client-player-ip-shortcode.md)。
