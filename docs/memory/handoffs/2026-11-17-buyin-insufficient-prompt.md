# 2026-11-17 带入弹窗：在座补分积分不足要弹提示（脚本已改，待 Creator 构建/联调）

- 目录/分支：`/Volumes/SSD/qing`，`codex/club-ui`（仅客户端脚本与回归测试，未提交）
- 用户反馈：没在座位上直接坐下时，俱乐部积分不足会弹提示；**已经在座位上再次带入时没有任何提示，点「确定」像没反应，带入窗口一直挂着**。

## 根因

1. `BuyinDisplay.configure` 在 `余额 < 最低带入` 时把「确认带入」置灰（`confirm.interactable=false`），点击不触发任何事件 → 玩家看到的就是「点了没反应」。
2. `panelGameView.onRoomCommand` 里 `坐下_事件1` 失败、且不是预坐提交态（即已在座位补分）时只调 `RefreshBuyinBalance()`，**不弹任何提示**（2026-11-16 那次刻意「保留弹窗并刷新」，没有兜底文案）。

## 2026-11-17 追加：提示弹出后带入窗口要一起收掉

- 第一版只弹提示不关窗，真机联调反馈「提示弹了但带入窗口一直在，挡着牌桌」。
- `ShowSitFailureFallback(strMsg, onFallback?)` 增加可选回调，只在**兜底文案真正弹出**时执行；在座补分失败传入 `CloseBuyinWindowWithoutSeat()`。
- 服务端另发 PromptInfo 时不关窗：`俱乐部金币不足/额度不足` 分支本身 `ClearPreSitState(true)` 已关窗，`至少需要 X 分` 分支要 `OpenBuyinWindowFromPrompt()` 重开让玩家改金额，互相不打架。

## 改动

| 文件 | 内容 |
| --- | --- |
| `assets/scripts/common/BuyinDisplay.ts` | 余额不足不再禁用「确定」（恒 `interactable=true`）；新增 `hasEnoughBalance()`、`minimumAmount()` 供面板判断与拼文案 |
| `assets/scripts/UI/panelGameView.ts` | 抽出 `GetBuyinShortageText(min,scale)`，面板红字与弹窗共用一套文案；「确认带入」的金额/区间/余额不足三类拦截改走 `ShowModalPrompt`（模态），余额不足直接弹「俱乐部金币不足，请联系合伙人上分！」且不发无效请求；`坐下_事件1` 在座补分失败时刷新金额 + `ShowSitFailureFallback` 中性兜底（服务端若推 PromptInfo 专用文案则让位），兜底弹出时同步关掉带入窗口；「正在确认俱乐部信息」「占座已失效」也改模态 |
| `tools/tests/buyin_v8_regression.js` | 断言改为 `hasEnoughBalance()`；新增「余额不足说明原因且不发请求」「在座补分失败也弹提示」两条用例 |

## 校验

- `node tools/tests/buyin_v8_regression.js`：14 个功能用例 PASS（含两条新增）。
- 最后一个 `prefab/场景基线对比` 仍失败：`art_sources/v8-repairs/buyin/before` 快照早于当前 prefab。**stash 掉本次改动后同样失败**，属既有漂移，本次未改 prefab。

## 未验证 / 风险

1. 未启动 Creator 编译/构建，未做真机与热更验证；热更 manifest 版本仍是 6.0.13，未重建。
2. 「在座补分」仍按原逻辑发 `type="申请"`（未改协议）；若服务端在余额不足时静默创建审批而不回失败码，本轮的本地余额拦截会先生效，不再出现「点了没反应」。
3. 余额不足时本地直接拦截不发请求，依赖 `club_gold` / `gold` 缓存；服务端余额比客户端新的场景下可能少一次重试机会，玩家重开弹窗即按最新值重算。
