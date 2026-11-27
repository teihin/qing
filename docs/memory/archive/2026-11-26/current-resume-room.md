# CURRENT 归档：切换节点后回原房继续打（2026-11-26）

> 按文档预算归档，原文保留。

## 2026-11-26 切换/重启节点后回原房继续打（不再重新预坐）

- 需求：Worker 关闭或切换节点后，只要原房还留着座位，就**回座继续**，不要重新找房、重新预坐。
- 链路：后台把 `room_id` 随指派下发（`agentAssignment.RoomID`）→ 节点用 `t.roomID`（进程内事件里更新，
  重启后由后台值补齐）注入 `XUAN_RESUME_ROOM` → 客户端 `afterLogin` 优先 `enterRoom(原房)`，
  失败才回大厅找房。
- 回到原房后：`PlayerList` 里自己已在座（`seated`）且桌面没带入分（`state.money <= 0`）→
  直接标记 `presitOk` 并补一次带入（`回到原座位（N 号），直接补带入继续打`），**不走预坐**。
- 部署：后端 `dba99cf4…`、本机 `bin/xuanagent` 已重建；client.js 同步。需重启 worker 生效。
- **踩坑**：给指派查询加 `room_id` 时只加了 Scan 目标、没加 SELECT 列 → 每次心跳报
  `sql: expected 28 destination arguments in Scan, not 29`，节点拿不到任何指派、一台都不拉起。
  **改 `queryAgentAssignments` 的列时，SELECT 与 Scan 必须成对改**（这条同 `AllowWaitingRoom` 的坑）。
  修复后 4 台已分配并在 623085 开打。


