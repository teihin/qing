# 2026-09 客户端 UI 与 XuanManager 时间口径（当前状态归档）

2026-10-28 从 [当前状态](../../CURRENT.md) 移出的历史阶段条目，保留原链接供需要时查阅。它们是阶段报告，不代表当前版本已重新验证。

## 2026-09-29 俱乐部入口与三界面

- 大厅「钱包」改「俱乐部」，新增俱乐部首页/创建/加入弹窗，按账号记住最近选择；三页离线渲染通过，点击/回包/真机未验。已推送 `ef9a0da`。见[交接](../../handoffs/2026-09-29-club-ui.md)。

## 2026-09-19～20 XuanManager 时间口径与玩家列表（正式已部署）

- 服务器与 MySQL 的 `DATETIME` 本来就是北京时间，已去掉 22 处 +8 叠加并部署；登录日期范围与注册/最近登录拆列已部署，页面点击与视觉未复核。见[时间口径](../../handoffs/2026-09-19-xuanmanager-timezone-fix.md)、[日期筛选](../../handoffs/2026-09-19-xuanmanager-player-login-range.md)、[拆列](../../handoffs/2026-09-20-xuanmanager-player-time-split.md)。

## 2026-09 客户端 UI 阶段（均未构建发布）

- 大厅「发现」两入口只改脚本；表情换 hh-poker VP9 素材（图标保留原 uuid）；热更新中断 `.tmp` 不补下；房间行改版（卡面只重绘 BY 盾牌底框）；`V7/` 移到 `assets/V7/` 减包约 60.9MB。见[表情](../../handoffs/2026-09-16-emoji-anim-replace.md)、[热更](../../handoffs/2026-09-16-hotupdate-incomplete-file.md)、[房间行](../../handoffs/2026-09-16-lobby-room-row-by.md)、[体积](../../handoffs/2026-09-15-asset-bundle-audit.md)。
- 桌内面板（牌局设置/房间邀请/赠金币）与玩家信息 V8 换肤，业务节点与协议保留，`panelMsgView` 回退原版；玩家信息已推送 `f04a05b`。见[牌桌](../../handoffs/2026-09-20-game-settings-v8.md)、[玩家信息](../../handoffs/2026-09-20-player-info-v8.md)。
- V8 全套按 `效果图V8-new` 逐页实施（56 图未做完）；登录页重叠修复未获最终验收。见[全套](../../handoffs/2026-09-11-v8-all-pages.md)、[注册](../../handoffs/2026-09-11-register-v8-exact.md)、[登录](../../handoffs/2026-09-10-login-overlap-fix.md)。
