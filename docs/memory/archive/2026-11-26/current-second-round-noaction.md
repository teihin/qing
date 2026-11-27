# CURRENT 归档：第二圈不出牌（2026-11-26）

> 按文档预算归档，原文保留。

## 2026-11-26 第二圈（第三张牌）不再出牌：决策窗口计时用错基准 + 日志补全

- 现象：第一圈四台都出牌（19:50:39–45），19:51:03 直接进第 2 局 —— 第二圈没人动作，超时结束。
- 原因：`scheduleAction` 里的超时判断是 `Date.now() - state.lastDecisionAt > decideTimeoutMs`，
  而 `lastDecisionAt` 只在「决策_信息_消息」时更新。第二圈（摸第三张牌后）服务端不一定再发那条消息，
  窗口被判成早已过期 → **静默 return，不出牌**。
- 修一（上一轮）：轮到我时重置 `lastDecisionAt`。
- **修二（本轮真凶）**：去重原来按 `captureId`，而 `captureId` 只在「决策_信息_消息」时 +1；
  用户抓的原始报文显示**第二圈只有「一张_活牌_消息」+「当前_玩家_消息(is_action=True)」+「决策_倒计时_消息」，
  没有「决策_信息_消息」** → captureId 不变 → 去重判定「这个决策号已出过牌」→ 直接跳过。
  改成按**决策窗口**去重：`状态名 + count_times + player_number`（`state.turnKey` / `actedTurnKey`），
  窗口一变就能再出牌；`captureId` 仍按真实客户端逻辑只在决策_信息_消息时 +1。
- 日志补全（便于分析）：轮到我 → 记手牌张数/角色/跟注/底池/决策号；被同决策号去重 → debug；
  窗口过期 → warn（含距轮到我多少 ms，对比策略 `decideTimeoutMs`）。
- 需重启 worker 生效（只改 `agent-client/client.js`）。


