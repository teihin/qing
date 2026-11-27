# CURRENT 归档

> 按预算归档，原文保留。

## 2026-11-26 严格按时序走：请求串行 + 补芒回包驱动预坐

- 用户要求：真实客户端是「前一条消息触发下一步」，不能进房一股脑发。
- 加**请求闸门**：`pendingReq`（setPending/clearPending/pendingBusy，超时 3.5 秒放行），
  `tryTakeSeat` 与 `sendSit` 入口只要还有请求在飞就等，`onRoomCommand` 回包统一清闸。
- 补芒链路改成严格串行：`玩家_补芒_查询` → 收到 `PromptInfo2 不补芒（坐下N）` → 才发 `预坐_事件`
  （700ms 没回包才兜底；`sendPresitNow` 单独抽出来）。
- **修掉一个大坑**：`不补芒` 以前和 `已结算` 放在同一分支 → 进房第一秒就被当结算走 `afterSettle` 补带入。


