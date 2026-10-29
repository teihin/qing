# 后台策略管理：机器人的「动作与智力」

目录 `/Volumes/SSD/qing`，分支 `codex/club-ui`。**已部署正式 20:22（v6），未提交。**
同一天的机器人侧收尾（表单精简、密码明文）与控制台折叠见
[2026-10-29-automation-robots-and-console.md](2026-10-29-automation-robots-and-console.md)。

## 需求演进

> 这些最好在后台里面可以配置成策略，绑定到机器人上……跑的时候下发下去执行。

> 策略里面只保留真实用到的可变参数，没用的删除了。还有一些写死的变量也要写到策略里面啊，打牌过程中的。

> 策略编码不要，没用；只进底皮用选择的方法不要填；进房身份不用配，默认观战；配牌不是配置，是打牌过程自己调整的；
> 自动出牌不用配置，分配了就是自动出牌；输赢模式、目标金额、周期这些都不是策略，是投放的时候选的。
> **策略里面配置的相当于机器人的动作智力，输赢和进哪些房间都是在投放的时候配置。**
> 投放的时候选投放的机器人，以及每个机器人绑定什么策略。

## 职责划分（最终口径）

| 归属 | 内容 |
| --- | --- |
| **策略** | 跑法节奏（带入倍数、原房连输次数、找房/坐下/带入节流、换房避让）、出牌节奏（延迟区间、决策超时）、三档安全线、牌力阈值、输赢收敛方式（连赢降级、死区比例、加注概率） |
| **投放** | 选哪些机器人、每台绑哪个策略、只进哪些底皮、输赢模式/目标/周期 |
| **机器人自身** | 智力、登录密码、出口 IP、启用状态 |

投放页原本就有「机器人策略 / 输赢目标 / 只进底皮档位」三块（`AutomationDeployPage.tsx` 617–647 行），
v3 只把策略里的重复项删掉；v5 起**策略与输赢目标改为投放必选**（不再提供「沿用原有策略/设置」）。

## 现在策略里有什么（全部有消费方）

| 分组 | 字段 | 消费位置 |
| --- | --- | --- |
| 跑法节奏 | `buyinMultiple / stayBuyinTimes / roomAvoidMs / sitTimeoutMs / reinstateDelayMs / roomRetryMs` | client.js `cfg` |
| 出牌节奏 | `actionDelayMinMs / actionDelayMaxMs / decideTimeoutMs` | client.js `scheduleAction`（原写死 1200–2500ms / 6 秒） |
| 三档安全线 | `tiers["1"/"2"/"5"].minG / safeGen / noAddGenMin` | strategy.js `thresholdsOf`（原 `THRESHOLDS` 常量） |
| 牌力 | `bigPairFen / weakLowFen / protectPairFen / protectBothFen` | strategy.js `handIsBig / chooseSplit / protectBigHand`（原 9 / 7 / 10 / 8） |
| 输赢收敛 | `winStreakPause / deadbandRatio / addMoreChance` | strategy.js `planRound / profitIntent / shouldAddMore`（原 3 / 0.2 / 0.34） |

所有字段 0 = 不覆盖机器人自身配置。

## 删掉的

- 无消费方的历史字段：`followCap / raiseRule / cheEnabled / maxLossPerRound / maxDrawdown /
  lossStreakPause / maxRoundsPerDay / restSeconds / tiers(档位勾选) / intelligence`。
- 属于投放的：`roomPi / profitMode / profitTarget / periodStart / periodEnd`。
- 属于打牌过程或固定的：`pairClick`（配牌过程中自己调）、`enterRule`（固定观战）、`autoAction`（分配即自动打）。
- UI 上的「策略编码」输入：编码改由后端自动生成 `s<yyyyMMddHHmmss><毫秒3位>`，只作内部唯一键。
- 「出牌风格」下拉：固定写 `balanced` 入库，不再让运营选。

## 投放必选（v5）

- 前端：策略下拉去掉「沿用原有策略」，未手动选时自动取第一个（已发布排前面）；输赢目标 `allowInherit={false}`，
  默认「每日」；没有策略时提交按钮禁用并提示先去策略中心创建；提交前校验两项非空。
- 后端 `performAutomationDeploy`：`strategyID <= 0` → `STRATEGY_REQUIRED`；策略不存在 → `STRATEGY_NOT_FOUND`；
  `status == disabled` → `STRATEGY_DISABLED`；`profitMode` 为空 → `PROFIT_MODE_REQUIRED`，非 daily/period/none 拒绝。
  `validateAutomationProfit(..., false)` 不再允许空模式。
- 只进底皮仍然可以不选（表示不限档位）。

## 链路

```
策略 config_json（草稿不下发，gray/enabled 才下发）
  → 心跳 assignments.strategyConfig（applyStrategyConfig 只覆盖 buyinMultiple）
  → 节点 terminal.strategy（原文）
  → 启动注入 XUAN_STRATEGY=<整份 JSON>；运行中 stdin config.strategy 热更新
  → client.js applyStrategyOverrides：覆盖 cfg 跑法字段，原文存 cfg.strategy
  → strategy.mergeTuning(cfg.strategy)：打牌阈值逐项兜默认值
```

## 改动文件

- `server/internal/api/automation_ops.go`：结构体只剩动作/智力字段；校验重写；`code` 自动生成；`playStyle` 固定。
- `server/internal/api/automation_agent.go`：`applyStrategyConfig` 只覆盖 `buyinMultiple`，其余原样下发。
- `server/cmd/xuanagent/terminal.go`：`XUAN_STRATEGY` 整份注入 + `config.strategy` 热更新。
- `agent-client/client.js`：`applyStrategyOverrides` 去掉 roomPi/enterRule/pairClick/autoAction 分支。
- `agent-client/strategy.js`：`DEFAULT_TUNING / mergeTuning / thresholdsOf`，硬编码阈值全部参数化。
- `web/.../shared.tsx`、`AutomationStrategiesPage.tsx`：类型与表单同步（只剩名称 + 五组参数）。
- `server/internal/api/automation_strategy_test.go`：改为断言「策略只覆盖带入倍数，不碰底皮与输赢」。

## 验证

- `go build ./...`、`go vet ./internal/api ./cmd/xuanagent`、`go test ./internal/api`（ok 2.3s，含 2 条策略用例）通过。
- 前端 `tsc -b`、`eslint src`、`vite build` 通过。
- `node --check client.js/strategy.js` 通过。
- 三轮部署（v1 19:07、v2 19:18、v3 19:47）；后续 v4/v5/v6 见
  [收尾篇](2026-10-29-automation-robots-and-console.md)的部署表，当前后端 PID 18006，health OK，前端 `index-IE64Hwkm.js`。
- `bin/xuanagent` 已重编。

## 未验证 / 下一步

1. **策略从建到发到真机的完整链路没跑过**：线上策略表仍 0 条，只验证了编译、单测、接口 401、前端构建。
2. 自动生成的编码在「同一毫秒创建两条」时会撞唯一索引，实际运营手速不可能，先不处理。
3. 老策略数据（如果以后出现）里多出的字段会被后端忽略、前端 `normalizeConfig` 补默认值。
4. 热更新时序：`buyinMultiple` 下次带入生效，打牌阈值下一次决策即生效。
