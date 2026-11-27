# CURRENT 归档：策略「是否进等待中的房间」开关（2026-11-26）

> 按文档预算归档，原文保留。

## 2026-11-26 策略新增「是否进等待中的房间」，默认不进

- 策略 → 跑法 新增开关 `allowWaitingRoom`（默认 **false**）：关闭时 `pickRoom` 直接跳过状态含
  「等待」「准备」的房间，只进**已经开局/进行中**的房间；开启恢复原来的「等待房优先」。
- 客户端 `agent-client/client.js`：`cfg.allowWaitingRoom`（也可用 `XUAN_ALLOW_WAITING_ROOM=1`），
  `applyStrategyOverrides` 认这个字段，`pickRoom` 里过滤。**改的是 node 脚本，节点需重启 worker 才加载新代码**。
- 后台策略表单（`AutomationStrategiesPage`）加勾选项，`shared.tsx` 的类型与默认配置同步；老策略没这个字段按"否"处理。
- 部署：前端 `index-DNBUL-Kc.js`（回滚 `web.previous-waitroom-20261126`）。正式服未动。
- 注意：俱乐部里所有房都在准备中时，机器人会一直空等（15 秒重查），这是按需求预期的行为。


