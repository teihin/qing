# 2026-10-26 俱乐部与钻石消费（当前状态归档）

2026-10-29 从 [当前状态](../../CURRENT.md) 移出的前一批条目，原文保留；CURRENT 只留状态摘要。链接相对本文件改写。

## 2026-10-26 消费全切钻石 + 价格后台可配（后台已上线，VIP 已下线）

- 客户端 6 处 `玩家_消费_命令` 改 `money_type=stone`，价格由后台「钻石消费价格」下发；**配置尚未落库、客户端未发版**；VIP 三档停用，延时档位定死。
- 待服务端重启：牌桌通道与 `延长时间_命令` 钻石档位；服务端仍不按配置校验价格。见[交接](../../handoffs/2026-10-26-stone-consume-price.md)。

## 2026-10-26 俱乐部：跨级只读、弹窗重设计、直属口径、分页

- 成员列表只返回直属下级，更深一层起只读；踢人已重编译，服务端未放开权限。见[只读](../../handoffs/2026-10-26-club-downline-readonly.md)、[踢人](../../handoffs/2026-10-26-club-agent-kick.md)、[代理](../../handoffs/2026-10-26-club-agent-direct-manage.md)。
- `panelMain.prefab` 按深蓝金稿换肤（节点/事件/`.meta` 保留）；弹窗 710×1240；构建/真机/回包未验。见[换肤](../../handoffs/2026-10-26-club-player-settings-reskin.md)、[按钮](../../handoffs/2026-10-26-club-input-dialog-buttons.md)、[分页](../../handoffs/2026-10-26-club-downline-paging.md)、[直属](../../handoffs/2026-10-26-club-member-direct-scope.md)。
