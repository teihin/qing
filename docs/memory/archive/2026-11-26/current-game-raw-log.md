# CURRENT 归档：原始游戏消息落盘（2026-11-26）

> 按文档预算归档，原文保留。

## 2026-11-26 每个机器人保存原始游戏消息日志

- `agent-client/client.js` 新增 `gameLog()`：把 `onEvent` 收到的**每一条服务端原始消息**（消息名 + 原始参数）
  以 JSON 行追加写入 `/tmp/xuanagent-game/<account>-<YYYY-MM-DD>.log`，按账号+日期分文件，目录可用
  `XUAN_GAME_LOG_DIR` 覆盖。写盘失败只忽略，不影响牌局。
- 排查用法：`ls -t /tmp/xuanagent-game | head` 找文件，`grep -n "牌局状态\|出牌\|玩家_搓牌" <file>` 定位；
  节点自身日志仍在 `/tmp/xuanagent-<node>.log`（含 agent 与 client 的 info/warn）。
- 需重启 worker 才开始记录。


