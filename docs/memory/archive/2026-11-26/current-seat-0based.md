# CURRENT 归档

> 按预算归档，原文保留。

## 2026-11-26 按真实报文对齐坐下链路（座位 0 基）

- 实录：`玩家_补芒_查询{context:"坐下0"}` → `预坐_事件{site:0}` → `坐下_事件{money:100,ready:1,type:"直接",club_id:"775447"}`；
  **座位号 0 基**，带入用 `buy_in_default`，club_id 用房间自带的。
- 已改：`freeSeats` 0 基、`seatNo>=0` 判归属、预坐前补芒查询、带入取 default + 房间 club_id。

