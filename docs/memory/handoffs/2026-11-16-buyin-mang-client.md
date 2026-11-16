# 2026-11-16 客户端接入「补芒与带入修复」（脚本已改，待 Creator 构建/联调）

- 目录/分支：`/Volumes/SSD/qing`，`codex/club-ui`（仅客户端脚本与回归测试，未提交）
- 依据：`服务器文档整理/补芒与带入修复-客户端接口文档.md`（2026-11-16，服务端已实施）

## 目标与口径

1. `玩家_补芒_查询` 的 X 改为「还差」：`max(0, 累计 - 已付)`，客户端只展示，不自行计算。
2. 带入弹窗以服务端 `buy_in_min/step/max/default` 为准：最低值、步长、上限、默认值分离；低于最低值不可选，确定按钮按余额/额度禁用。
3. 若提示的补芒数大于当前最低带入，最低分取「严格大于补芒数的下一个一簸倍数」（760→1000、1000→1500、1260→1500），默认值同步抬高；提示值比 `当前_玩家_消息` 新时优先用提示值。
3. `当前_玩家_消息` 新增 `mang_required/mang_paid/mang_need` 与 4 个 `buy_in_*`，作为主数据源；`PromptInfo2` 数组后三位作为较新时的兜底。
4. `坐下_事件` 金额仍提交服务端原值，客户端只做最低/步长/上限兜底校验；被拒后原样展示服务端文案并刷新。
5. 0.1/0.3、0.2/0.5 房的分数按 1/10 显示（与原「已带入」口径一致），提交保持原值。

## 改动文件

| 文件 | 内容 |
| --- | --- |
| `assets/scripts/common/GameDef.ts` | `DrhPlayerInfo` 新增 `mang_*`、`buy_in_*` 与本地字段 `buyin_update_time` |
| `assets/scripts/logic/DrhPlayerLogic.ts` | 解析 `当前_玩家_消息` 新增字段并记录更新时间；本人字段更新后通知牌桌面板重算带入弹窗 |
| `assets/scripts/common/BuyinDisplay.ts` | `configure(min, step, max, default, already, balance, displayScale, preserveAmount)`；可选金额按 `min + k*step ≤ max`，末档按条件追加全部余额；默认值定位；余额不足禁用确定；刷新时保留已选金额；新增 `isCurrentAmountValid()` |
| `assets/scripts/UI/panelGameView.ts` | 弹窗参数优先级（新字段 > 较新的 PromptInfo2 提示 > 房间旧配置）；`已带入` 行显示服务端 `mang_paid`（缺失时用 `begin_score`）；提示补芒数大于最低带入时抬高最低分；本人状态更新刷新弹窗并保留选择；确认带入提交前校验；成功后关窗、在座补分失败保留并刷新；新错误文案走模态并回查补芒；`PromptInfo2` 兼容数组与 `{word,context}` 两种形态 |
| `tools/tests/buyin_v8_regression.js` | 适配新 `configure` 签名、默认值/最低值用例；补 RoomClubContext 桩 |

## 2026-11-16 追加：滑条末档支持全部余额

- `BuyinDisplay` 在余额位于最后一个步长档与服务端 `buy_in_max` 之间时追加末档，末档提交当前可用余额；余额刚好整档不重复，余额超过服务端上限不越界。
- 回归用例覆盖「余额 5200、步长 500 → 末档 5200」、服务端上限拦截和整档去重；13 个功能用例通过。完整脚本仍会在历史 Prefab/场景基线对比处失败，原因是快照与当前文件已有对象 ID/根节点漂移。

## 校验

- 四个改动脚本 `typescript.transpileModule` 语法诊断 0。
- `node tools/tests/buyin_v8_regression.js`：13 个功能用例 PASS（含末档全部余额、补芒数抬高最低分、刷新保留已选金额）。
- 最后一个「prefab/场景基线对比」失败：`art_sources/v8-repairs/buyin/before` 快照早于当前 prefab（本次未改 prefab），属既有漂移，未改快照。
- `git diff --check` 通过。

## 未验证 / 风险

1. 未启动 Creator 编译/构建，未做真机与热更验证。
2. `PromptInfo2` 真实载荷形态：11-16 日志里只带 `{id, word, context}`，没有 `buy_in_*`，所以弹窗最低值实际依赖「提示文本补芒数」或随后到达的 `当前_玩家_消息`；两处都已接。若原生桥以后透传后三位，会按数组兼容。
3. 缓存键以房间号为主，房间配置不作为主键；提示值另有 10 秒新鲜度兜底，避免进房时配置晚到导致键不一致。
4. **不要复用 `带入窗口/msg`**：该节点就是 `BuyinDisplay.amount`（本次带入的大号数字）。首版曾把「累计/已付/还差」写进去，导致真机弹窗金额空白，已回退。若按文档 §5.2 显示明细，需要在 prefab 里新增独立 Label 行，再单独做布局验收。
5. 0.1/0.3、0.2/0.5 房的显示换算按既有 `CheckSmallPlay` 的 ÷10 口径，需与 1/3、2/5 等底皮各验一档。
6. 预坐首次带入失败仍按原流程清座位、关弹窗；在座补分失败保留弹窗。两条路径的提示到达顺序需联调确认。

## 下一步

- 抓一次真实 `玩家_补芒_查询` 回包，确认 `PromptInfo2` 元素个数。
- Creator 编译后按文档 §6 的 600/500、760/0、1260 三组场景联调；再验在座补分、留座回坐、已结算、小皮房各一条。
