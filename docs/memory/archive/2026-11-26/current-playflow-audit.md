# CURRENT 归档：对照真实客户端复核打牌链路（2026-11-26）

> 按文档预算归档，原文保留。

## 2026-11-26 对照真实客户端复核打牌链路（发现并修加注换算）

- 逐项对照 `panelGameView.ts` / `DrhPlayerLogic.ts`：判「轮到我」`is_action=="True"`、出牌 `reqRaise(-1/-3/-5/大X)`
  `reqPass` `reqShow`、扯牌 `{"showlist":[[type,num]]}`、`captureId` 从 100 起自增、带入报文
  `{"header":"坐下_事件","money":..,"ready":1,"type":"直接","club_id":..}`、手牌取 `持有_手牌_消息.now_pai`
  —— 六项全部一致。
- **唯一差异（已修）**：小额房（roomSetting 含 `0.1/0.3`、`0.2/0.5`）真实客户端加注要 **×10**
  （`CheckReturn2Big`），机器人原来直接发；不换算会被服务端当无效动作丢掉（表现为「出牌了但牌局没动/等到超时」）。
- 需重启 worker 生效。

