# 2026-11-17 搓牌开关：标价 + 每次搓牌扣钻（后台可配）

## 目录 / 分支

- 项目根：`/Volumes/SSD/qing`
- 分支：`codex/club-ui`
- 工作区含其他任务未提交修改（排行榜 V9、带入弹窗等），本次只改下列文件。

## 目标

1. 牌桌「记录」抽屉（`实时战绩`）里的搓牌开关要明确标出单次扣费，形如 `20 钻/次`。
2. 打开开关后，每搓一次牌扣 20 钻。
3. 单价走后台「钻石消费价格」页，运营改价不用发客户端。

## 改动文件

- `assets/resources/UI/panelGameView.prefab`、`assets/Scenes/drh8.fire`
  - `实时战绩/搓牌开关` 新增子节点 `V8价格`（130×20，字号 18，金色 `255,214,120` + LabelShadow，`(105,-14)`），默认文案 `20 钻/次`；`V8状态` 上移到 `y=9`，与价签形成开关右侧上下两行。
  - 选择右侧两行的原因：开关行离面板底边只有 15px、离上方「围观」底板只有 13px，开关下面放不下第三行。
  - 两份文件的新节点共用 `fileId=d3CuoPricePerRound0001`，`_prefab` 指向新增 `cc.PrefabInfo`，与既有 `V8状态` 结构一致。
- `assets/scripts/logic/ConfigManager.ts`
  - 新增 `CONSUME_CUO_CARD = "搓牌"`，兜底价 `20`（`CONSUME_STONE_DEFAULT`）。
- `assets/scripts/UI/panelGameView.ts`
  - `GetCuoSqueezePrice()` / `RefreshCuoSqueezePriceLabel()`：价签文案取后台价，0 显示「免费」；挂到 `RefreshConsumePriceLabels()`（进桌 + `ConsumeStonePriceUpdated`）和 `UpdateRealtimeSqueezeState()`。
  - `ConsumeCuoSqueeze()`：搓牌窗口松手揭开（`DelayShowCuoInfo` 开头）发一次 `玩家_消费_命令`（`consume_type=搓牌`、`money_type=stone`）；按 `round_count` 去重，同一手牌只扣一次，局号拿不到时按 10 秒兜底；余额不足只提示不扣。
  - `onToggleClick` 的 `搓牌开关` 分支：开启时校验余额，不足则提示「钻石不足X，无法开启搓牌！」并把开关复位（不下发 `player_setting=True`）。
- `XuanManager/server/internal/api/stone_consume_price.go`
  - catalog 新增 `{Code:"搓牌", Default:20, Scene:"牌桌 · 实时战绩 · 搓牌开关"}`，后台页按 catalog 动态渲染，前端无需改。
- `tools/apply_v8_realtime_record.py`
  - 同步生成逻辑（`V8状态 y=9` + 新增 `V8价格`），避免下次重跑抽屉脚本把价签冲掉。
- 文档：`服务器文档整理/俱乐部金币与钻石-客户端接口文档.md`（新增 §3.7.1、§3.9 `remark4` 补「搓牌」、变更表 v1.7）、`XuanManager/新后台管理系统接口文档.md`（catalog 12→13 项）。

## 关键口径

- 扣费点 = 搓牌窗口**松手揭开**那一刻，不在开窗时扣；直接点「看牌」揭开（不走搓牌窗口）不扣费。
- 同一手牌只扣一次：`round_count` 变一次才允许再扣，窗口重开/服务端补推全量都不会重复扣。
- 开关是付费开关：余额 < 单价时开不起来（和延时/强制秀牌的拦截口径一致）。
- 后台价配成 0 = 免费：价签显示「免费」，客户端不发扣费命令。

## 验证

- 已做：`panelGameView.ts` / `ConfigManager.ts` 语法检查 0 诊断；`go test ./internal/api -run StoneConsumePrice` 通过；`gofmt` 无差异；两份序列化文件 JSON 引用完整（`__id__` 全部命中）、价签节点挂在 `搓牌开关` 下、`grep` 确认无转义污染；`tools/render_drh8_panel_previews.py --only realtime_record` 离屏渲染确认 `已关闭`/`20 钻/次` 两行不遮挡、不压底边。
- **后台已部署（2026-11-17 22:10）**：`go vet ./...` + `go test ./...` 全绿；`GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w"` → 11,149,496 B / sha `91c44480…`；备份 `backups/xuanmanager.20261117-2210-rollback` 后停/换/启，`/api/health` 200、`8891` 单进程；二进制内 `grep 搓牌（每搓一次）`=1。同批带上 HEAD 的「玩家优化→玩家控制」更名（迁移 071 已生效，见其交接）；前端包与 HEAD 构建同名同大小，未重发。
- 待验证：Creator 导入 Prefab 与场景；真机/网页实际操作（开关打开 → 搓一次 → 钻石减 20、流水 `remark4=搓牌`）；后台保存 `搓牌` 价后续生效（<10 秒缓存）；服务端 `玩家_消费_命令` 若对 `consume_type` 有白名单需放行「搓牌」。

## 下一步

1. 后台「钻石消费价格」页确认出现「搓牌（每搓一次）」行并**保存一次**（保存才写进 `usr_hash_info` 的 `消费钻石价格`，之后客户端才能读到；未保存时客户端按内置默认 20）。
2. 客户端构建/热更后按上面待验证清单跑一遍真机。
3. 若服务端有 `consume_type` 白名单，补一条放行。
