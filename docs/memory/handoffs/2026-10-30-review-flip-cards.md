# 2026-10-30 牌局回顾「翻牌」按钮（未构建、未真机）

- **目录/分支**：`/Volumes/SSD/qing`，`codex/club-ui`。**未提交**。
- **目标**：房间内右上角弹出的「牌局回顾」窗口底部加一个「翻牌」按钮，一次翻开本局所有没翻开的牌；
  只翻已发的牌（未发牌的节点本来就是关闭的），默认扣 500 钻石、后台可改，按钮上标价格。

## 改动文件

| 文件 | 改动 |
| --- | --- |
| `assets/scripts/logic/ConfigManager.ts` | 新增 `CONSUME_FLIP = "翻牌"`，兜底价 `500` |
| `assets/scripts/UI/panelGameView.ts` | 按钮价签、确认、扣费、翻牌逻辑；已购状态与翻牌/扫描改为 `static`，供结算回顾复用 |
| `assets/resources/UI/panelGameView.prefab` | `牌局回顾` 下新增 `翻牌`（104×52，右下角锚定），`扣费提示` 下新增 `确认翻牌` |
| `assets/Scenes/drh8.fire` | 同上（场景里的面板副本，fileId 与 prefab 一致） |
| `assets/resources/UI/panelRecordInfo.prefab` | 结算里的 `牌局回顾` 下新增同款 `翻牌`（104×52，`操作` 行右侧） |
| `assets/scripts/UI/panelRecordInfo.ts` | 结算回顾的价签、确认（`panelMsgView` 回调）、扣费、翻牌 |
| `XuanManager/server/internal/api/stone_consume_price.go` | catalog 新增 `翻牌`（默认 500，无金币原价） |

## 交互与口径

- 位置（房间内回顾）：`分页` 右侧底部（尾页右缘 x=248 → 按钮 263..367），`cc.Widget` 右 8 / 下 45，随屏高贴底。
- 位置（结算回顾）：`panelRecordInfo/牌局回顾` 的 `操作` 切换行右侧，中心 (315,-518)，`cc.Widget` 右 8 / 下 123；
  `分页` 在这里是 708 宽（±354）占满整行，按钮只能挪到 `操作` 行，避开了 `分页` 与底部 `关闭`。
- 价签：`价格` 子节点显示 `500钻`；后台「钻石消费价格」改了会经 `ConsumeStonePriceUpdated` → `RefreshConsumePriceLabels` 刷新；价格为 0 时显示「免费」。
- 点击 → 扣费确认 → 确认后发 `玩家_消费_命令`（`consume_type=翻牌`、`money_type=stone`），再本地翻牌。
  房间内回顾走 `reqGameCommand`；结算回顾走 `reqHallCommand`（结算期牌桌实体可能已结束，和房间内举报同一条通道）。
- 只翻当前这一局：`回顾列表/view/content` 下每个 `手牌` 里 `node.active` 且非 `(0,0)` 的牌 `ShowFace(0)`。
- 已付费的局记在 `panelGameView.reviewFlipRounds`（`static`，key=`房间号#局号`），两个回顾界面共用：
  重渲染保持全开，按钮显示「已翻开」并禁用，同一局不会被重复扣费。
- 本来就全开的局（例如这一局没有任何盖牌）不需要再点翻牌：两个界面都在刷新价签时扫一遍 `HasFaceDownCards`，
  没有背面牌就直接显示「已翻开」并禁用、不扣费；列表还没渲染出牌时按「有牌可翻」处理，点了会提示「本局没有未翻开的牌！」。
  两个界面在 `WebLoadingManager.loadBlockingRes` 的异步建行回调里也补刷一次，避免第一屏就判成「全开」。
- 文字牌谱模式下按钮隐藏；钻石不足在弹窗前就拦。
- 结算回顾的显示条件只有两条：`牌局回顾/回顾列表` 处于显示 + 面板参数里有房间号（`strRoomID`）。
  **不要再用场景名/`PanelGameView` 是否存在来判断**——按这个条件加过一版，实机上按钮一直不出现
  （2026-10-30 用户反馈「cocos 网页都重启了 还是没有」）；浏览器里直接 `cc.loader.loadRes("UI/panelRecordInfo")`
  实例化后按钮节点存在且 active，证明是这条运行时判断在隐藏它。现在大厅「查历史战绩」也会显示同一按钮。
- 排查用临时日志：`[翻牌] 找不到按钮节点…` / `[翻牌] 隐藏：列表显示=… 房间号=…`，确认后再删。
- 「翻牌」是新增收费点，服务端 `玩家_消费_命令` 不按类型白名单校验，只需 `money_type=stone` 合法。

## 验证

- `esbuild` 语法检查 `panelGameView.ts` / `panelRecordInfo.ts` / `ConfigManager.ts` 通过（本机无 Creator 类型环境，未做完整 tsc）。
- `gofmt` 无差异、`go build ./...` 通过、`go test ./internal/api -run StoneConsume` 通过。
- prefab / scene JSON 结构自检通过（引用不越界、父子对称、`__id__` 重排后索引一致、两边 fileId 相同），`.meta` 未改动；
  `panelRecordInfo.prefab` 为纯追加（+440 行）。
- 预览资源实测：在 Chrome 里 `cc.loader.loadRes("UI/panelRecordInfo")` + `cc.instantiate` 后，
  `牌局回顾/翻牌` 存在、`active=true`、104×52、坐标 (315,-518)、贴图 `ingame_review_v8_gold`，说明资源端没问题。
- Creator 在窗口失焦时不重编译：改完 `.ts` 后 `temp/quick-scripts` 不更新，必须点一下 Creator 窗口触发编译再刷新网页。
- **未做**：真机/网页实际点击验证；后台价格页未实机点过；
  结算期 `reqHallCommand` 的 `玩家_消费_命令` 是否正常扣费（服务端未在本仓，需真机确认余额变化）。

## 顺带

- `扣费提示` 的 `bk` 用的是整张成品图 `assets/V7/popup_message_dual_exact.png`：标题「温馨提示」、
  取消/确定两颗药丸和按钮文字**全部画在图上**，`V8文字` 子节点是换肤留下的空壳、必须保持关闭。
  本次一度把它们打开，实机上图上文字与 Label 叠成重影（2026-10-30 用户截图反馈），已恢复关闭；
  `确认翻牌` 的 `V8文字` 同样关掉，确认弹窗文字完全由底图提供。
