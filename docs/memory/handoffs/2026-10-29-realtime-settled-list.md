# 实时战绩：倒计时列 + 已结算记录无限滚动

目录 `/Volumes/SSD/qing`，分支 `codex/club-ui`（俱乐部版，勿并入 main）。未提交。

## 目标

牌桌左下角「记录」打开的实时战绩列表，按 `服务器文档整理/俱乐部实时结算-客户端接口文档.md`：

1. 原有 `GamePlayerListInfo`（`获取_游戏内玩家_信息_命令`）在座玩家列表**增加一列「倒计时」**，取 `play_countdown`，客户端本地逐秒递减。
2. 同一列表**后面追加 `SettledPlayerListInfo`（`获取_房间_已结算_玩家_命令`）**的已结算记录；该接口分页，列表需**往下滑自动加载下一页**。

在用户已调整过的页面基础上改（`drh8.fire` 里实时战绩底板加高、旧 V7 节点置灰那批改动原样保留）。

## 改动

### `assets/resources/Prefabs/带入记录.prefab`

行模板从 3 列扩到 4 列（行宽 552 不变，列坐标 content 局部）：

| 列 | 节点 | x | 宽 | 对齐 |
| --- | --- | --- | --- | --- |
| 昵称 | `name` | -192 | 126 | 左 |
| 带入 | `in` | -71 | 112 | 右 |
| 积分 | `score` | 57 | 128 | 右 |
| 倒计时 | `countdown`（新增） | 193 | 120 | 右 |

新增节点复用 `name` 的字体（PingFF）、字号 28、`LabelShadow`，颜色 250/240/214。

### `assets/Scenes/drh8.fire` + `assets/resources/UI/panelGameView.prefab`

两处同步改（panelGameView 运行走场景副本，但 fileId 必须两边一致）：

- 表头横向重排：`V8表头nickname` -300、`V8表头buyin` -112.5、`V8表头score` 21.3（均为表头节点相对「实时战绩」的 x）。
- 新增表头 `V8表头countdown`（x=141.2、显示 77.64×32.96，Sprite = `assets/V7/realtime_v8_countdown.png` 的 spriteFrame `70fdb33d-…`），fileId `9cQb1wReZK8pWm3dTgHy0v` 两边一致。
  「倒计时」表头文字是 AI 生成的同风格美术字（浅奶金字面 + 深藏蓝细描边，106×45 画布、字形高 33、上 4 下 8 留白，与 `realtime_v8_nickname.png` 同一规格），7.1 KB 小于同组原图 7.4 KB。

### `assets/scripts/UI/panelGameView.ts`

- `GetReadRecordInfo()`：并行发接口一与接口二第 0 页；1.5 秒收不到已结算回包就按「无已结算数据」渲染（fixed 模式 / 老服务端不转圈）；同时启动倒计时 tick。
- `onGamePlayerListInfo()` 不再直接画列表，只存数据 + 刷汇总（总带入/总得分/奖池），交给 `TryRenderRealtimeList()`。
- 新增 `onSettledPlayerListInfo()`：`number>0` 走追加，`number===0` 或首屏未画时整体重绘；`realtimeSettledDone` 由「本页条数 < 20」或「(page+1)×20 ≥ count」判定。
- `TryRenderRealtimeList()`：在座行 → 「以下为已结算记录」分隔行 → 已结算行 → 尾部提示行（上滑加载更多 / 正在加载… / 没有更多记录）。
- 滚动加载：监听 ScrollView `scrolling`，`getMaxScrollOffset().y - getScrollOffset().y ≤ max(360, view 高×0.75)` 时请求下一页；请求 3 秒无回包自动解锁可重试；首屏/追加后 `scheduleOnce` 补一次检查，防止内容不足一屏时卡住。
- 倒计时：`realtimeCountdowns` 存 `{label, endAt}`，每秒重算 `ceil(endAt-now)`，统一「分:秒」两位数（`00:23` / `02:00`），到 0 显示 `00:00`。关闭抽屉 `CloseAllShow()` 里 `unschedule`。
- 已结算行：昵称/带入/输赢都按接口二的新字段填（`init_money` 带入、`score` 输赢，口径与在座行相同：`CheckSmallPlay` + 千分位）；倒计时列留横杠 `—`；昵称、带入、倒计时刻灰（133/158/179），**输赢保留红绿**（255/112/117 / 189/216/76）。
  `init_money` 是结算那一刻的快照，服务端已把玩家对象清零，只能从这里读；老服务端不带该字段时该列回落成 `—`。`played_count`（本周期局数）文档有，但界面没有对应列，暂未使用。
- 「以下为已结算记录」分隔行**不灰化**：浅金 250/240/214、字号 24、文字 `—— 以下为已结算记录 ——`，靠字号和前后破折号跟数据行拉开；尾部「上滑加载更多」那行仍用灰色 22 号。
- 在座行：`V8本人底` 整行底色高亮自己，`V8本人` 那个「我」字小图标统一关掉（2026-10-29 用户要求，只留高亮）。
- 迟到回包：`IsRealtimeListCurrent()` 比对请求时的 `roomID`，切房/换号后旧响应直接丢弃。

## 验证结果

- `ts.transpileModule` 语法检查 0 诊断。
- 三个资源文件 JSON 合法、`__id__` 引用全部在范围内；新增表头节点 `_id` 已换新值（模板 deepcopy 会带重复 id）。
- 列坐标手算无重叠，表头与各列右边缘差 ≤ 5px。
- **未做**：Creator 内实际打开/构建、真机与网页运行、真实服务端回包。以下均为待验证：
  - 服务端 `SettledPlayerListInfo` 是否按 `P@获取_房间_已结算_玩家_命令` 路由（文档写 `scripts/base/Account.py` 注册，按接口一惯例用 P 前缀）。
  - `play_countdown` 是否真的随 `GamePlayerListInfo` 下发（文档 2026-10-28 新增；客户端未接 `PlayerList` 里的同名字段，玩家重新带入后倒计时靠本地递减，需重开抽屉才校准）。
  - fixed 模式下列表只显示在座玩家、无「已结算」分隔行。

## 下一步

1. Creator 导入后构建 `web-mobile`，实机点「记录」看四列是否对齐、倒计时是否逐秒走。
2. 若已结算行「带入」列留空显得空，可改成显示该次结算前的带入或直接隐藏该列。
3. 想让倒计时在面板打开期间也随服务端校准，需要把 `PlayerList` 的 `play_countdown` 接到 `GameDef.PlayerInfo` + 触发本列表局部刷新（本次未做，属额外范围）。
