# 延时改为「每手牌 3 次」+ 价格后台可配

日期：2026-11-08
分支：`codex/club-ui`（改动未提交，工作区）
状态：客户端与后台代码已改；**后台已部署 8891（00:22、00:32 两次）；客户端未构建、未发版**

## 目标（用户 2026-11-08 原话）

1. 延时次数：由整场累计 3 次 → **每手牌 3 次**。
2. 第 1 次延时**不扣费**，第 2、3 次提示收费并扣费。
3. **扣费走客户端统一扣费接口**，流水类型写「延时」。
4. 每次扣多少钻石**后台可配**。

## 改动文件

**客户端**

- `assets/scripts/logic/ConfigManager.ts`
  - 新增 `CONSUME_DELAY_2`/`CONSUME_DELAY_3`（`延时第2次`/`延时第3次`）、`CONSUME_DELAY_TYPE = "延时"`、`DELAY_MAX_TIMES = 3`；
  - 内置默认价 200 / 400（**第 1 次固定免费，没有配置项**）；
  - `GetDelayStone(nTimes)`：`nTimes<=1` 直接返回 0（不读配置）；
  - `BuildDelayConsumeParam(nTimes)`：取价按档位键，`consume_type` 固定写「延时」。
- `assets/scripts/UI/panelGameView.ts`
  - `GetDelayTier()` 重写：不再用服务端 `count_times` 反推档位（价格可配后那套判法必炸），
    改为「本手牌已用次数 + 后台配置价」；第 4 次客户端直接拦。
  - 新增 `delayUsedCount` / `delayRoundKey` / `pendingDelayTimes` 与 `SyncDelayRoundCounter()`：
    局号（`gameLogic.round_count`）变动或收到 `SelfRoundDealt` 即清零。
  - `SendDelayCommand(nTimes, nCost)`：先发 `延长时间_命令`；**`nCost > 0` 才发** `玩家_消费_命令`
    （`consume_type=延时`、`money_type=stone`）。第 1 次不扣、不发。
  - 文案「本局加时次数已用完」→「本手牌加时次数已用完」。
- `assets/scripts/logic/DrhPlayerLogic.ts`
  - `开始_发牌_事件` 分支里（仅自己座位）`KBEngine.Event.fire("SelfRoundDealt")`，
    给加时计数一个准确的「新手牌」信号。

**后台（XuanManager）**

- `server/internal/api/stone_consume_price.go`：catalog 新增两档
  `延时第2次`（默认 200）/`延时第3次`（默认 400）；旧的单值 `延时` 与一度加过的 `延时第1次`
  都留在 `stoneConsumePriceRetired`（首次免费没有可配空间，用户明确要撤）。
  前端页面按接口 items 渲染，**无需改前端**。
- 文档：`XuanManager/新后台管理系统接口文档.md` §13.3.2（catalog 12 项）；
  `服务器文档整理/俱乐部金币与钻石-客户端接口文档.md` §3.7 / §3.9 / 变更记录 v1.6。

## 验证

- 两个 TS 文件 `ts.transpileModule` 0 诊断。
- `gofmt -l` 无输出、`go vet ./internal/api/` 无输出、`go test ./internal/api/ -run StoneConsume` 通过。
- 线上实测未做（无客户端包）。

## 部署（仅后端二进制，前端不用重建）

| 时间 | 二进制 sha256 | 回滚件 |
| --- | --- | --- |
| 00:22（三档版，已被下一版取代） | `dc77befd…ea5a96f` | `backups/xuanmanager.20261108-0021-delaytier-rollback`（旧版 `859202c4…`） |
| **00:32（最终版，去掉第 1 次）** | `0f924b4d…6136cf4` | `backups/xuanmanager.20261108-0031-delay2tier-rollback`（= 00:22 的三档版 `dc77befd…`） |

- 流程：`stop.sh` → `mv` 替换 `bin/xuanmanager` → `start.sh`；当前 pid 23560，
  `/proc/23560/exe` 哈希 = `0f924b4d…`。
- 验证：本机 `/api/health` 200、`/api/configuration/stone-consume` 401；
  二进制内 `对局加时 · 第 1 次` 命中 0、`第 2 次`/`第 3 次` 各 1。

## 未完成 / 风险

1. **双扣风险（最高）**：截至 2026-11-08 00:05 的 `usr_cash_water` 仍是服务端
   `延长时间_命令` 在扣（`remark4='延长时间'`、-200/-400）。客户端现在也会扣，
   **服务端若不去掉加时内的扣费，一次延时扣两次**。需服务端确认。
2. 后台配置未落库：线上 `消费钻石价格` 里还没有 `延时第2/3次` 两个键，
   需运营在页面点一次保存（页面会显示两行，缺项按默认值 200/400 展示）。
   未保存期间客户端走内置默认价，数值相同，不影响功能。
3. 客户端未构建、未发版（`build/web-mobile`、`build/jsb-link` 仍是 11-07 01:0x 的产物），
   线上仍走旧逻辑：服务端扣费、流水类型 `延长时间`。
4. 加时秒数（20/15/10）仍写死在客户端，本次只做了价格可配。
5. 本地计数靠「局号变化 / 发牌事件」清零，重连或异常补发时可能与服务端计数短暂不一致；
   服务端 `0x301` 仍是最终兜底。
