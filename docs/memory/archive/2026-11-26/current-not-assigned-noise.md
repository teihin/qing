# CURRENT 归档：节点 not-assigned 刷屏（2026-11-26）

> 按文档预算归档，原文保留。

## 2026-11-26 修节点「terminal stop requested reason=not-assigned」刷屏

- 现象：激活（loginOnly）完成的机器人被放回池子（`worker_id` 清空）后，节点每 5 秒对它发一次
  `terminal stop requested reason=not-assigned` + `real client exited reason=stop`，日志刷屏但其实什么都没做。
- 原因：节点 `terminal.go` 的 `a.terminals` 表只加不删；心跳对账发现"不在指派清单里"就再发一次 stop，
  而 `stopTerminal` 不幂等（不检查进程是否已退出）。
- 改法：对账时**已停止且进程已退出**的终端直接 `removeTerminal` 摘掉；`stopTerminal` 对已停止的静默返回。
  本机 `server/bin/xuanagent` 已重建（2026-11-26 18:53），**各节点需重启 worker 生效**。
- 顺带确认：新建的 worker003/004/005 都已激活成功（`activated_at` 有值），当前 `worker_id` 为空、
  `join_status=unassigned`，属于"已激活待投放"，投放到俱乐部才会进房。


