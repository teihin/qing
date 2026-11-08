# 2026-11-07 后台代理贡献管理：暗抽比例列 + 调整入口（已部署）

> 从 `docs/memory/CURRENT.md` 归档（2026-11-08，为控制入口文档体积）。交接见
> [2026-11-07-agent-bonus-dark-percent](../../handoffs/2026-11-07-agent-bonus-dark-percent.md)。

- 游戏服 `异步_查询_代理_展示数据` 新增顶层 `bonus_dark_percent`（该代理自己的红利暗抽，0~100，不参与 `show_percent` 缩放），成员行也带同名行级值；后台透传为 `bonusDarkPercent`。
- 列表在「贡献」组后新增「暗抽比例」列，操作列在「展示调整」后新增「暗抽比例调整」（弹窗读当前值→保存/设为 0%）；新增 `GET/PUT .../agents/{agentId}/bonus-dark`，底层命令 `设置_俱乐部_代理_红利暗抽`（不传比例=只读回显，写入 `club_agent_info.bonus_dark_percent`）。
- 19:07 部署二进制 `d8f6677b…` + 前端 `index-Dk2KU1jc.js`/`index-D9kgAfEm.css`（回滚 `backups/xuanmanager.20261107-1907-rollback`、`web.previous-bonus-dark-20261107-1907`）；health 200、新路由未登录 401。真实保存与目视待验。
