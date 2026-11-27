# CURRENT 归档：座位归属（2026-11-26）

> 按文档预算归档，原文保留。

## 2026-11-26 消息归属以 PlayerList 座位为准（对齐 DrhLogicMgr）

见 [`归档`](archive/2026-11-26/current-seat-ownership.md)。要点：`seatNo` 只由 PlayerList 写；座位表带 `room_id` 校验丢弃旧房数据；`seatViews[num]` 对应真实客户端 `arrayInfo[num]`。

