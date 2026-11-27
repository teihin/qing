# CURRENT 归档：预坐不带分 + 空座推算（2026-11-26）

> 按文档预算归档，原文保留。

## 2026-11-26 预坐不带分死循环 + 空座推算（含座位数三级兜底）

原文见 [`archive/2026-11-26/current-presit-no-buyin.md`](archive/2026-11-26/current-presit-no-buyin.md)。要点：预坐成功只看 `sitSent` 就带入；空座 = 1..N 未被 `num` 占用，N 取 maxSeats→「8人」→已用+1；空表先 `reqPlayerList`。

