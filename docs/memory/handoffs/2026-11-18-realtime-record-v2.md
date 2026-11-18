# 2026-11-18 实时战绩按新效果图重做（场景 + Prefab 同步，未导入/未构建/未真机）

## 范围与目录

- 项目根 `/Volumes/SSD/qing`，分支 `codex/club-ui`。
- 场景 `assets/Scenes/drh8.fire`（`panelGameView` 下「实时战绩」子树，节点 id 2701）。
- `assets/resources/UI/panelGameView.prefab`（同名子树，id 2696）。
- 行模板 `assets/resources/Prefabs/带入记录.prefab`，围观模板 `assets/resources/Prefabs/观战对象.prefab`。
- 脚本 `assets/scripts/UI/panelGameView.ts`。
- 改造工具 `tools/apply_realtime_record_v2.py`（幂等，可重跑覆盖结构）。
- 备份 `vibe_images/2026-11-18-realtime-record/backup/`（四份 JSON 原始 + `trim_originals/` 裁边前 PNG）。

## 结构

- 所有脚本引用的节点路径保持不变：`实时战绩/bg`、`/title2/倒计时`、`/战绩列表/view/content`、`/围观列表`、`/搓牌开关/V8状态`、`/搓牌开关/V8价格`、`/V8列表状态`、`/总带入`、`/总得分`、`/奖池`、`/V8奖池标题`、`/关闭上层`。
- 旧汇总区（`bk`、`V8战绩底板`、`V8围观底板`、`总带入/总得分`、`奖池`、`V8概况*`、`V8表头*`、旧 `title`、`V8标题线*`）整组 `_active=false` 隐藏，未删除，便于回退。
- 新元素：`战绩标题`（568×142）、`表头`（570×64）、`搓牌字`、`搓牌线`、`搓牌开关/滑块`、行模板内 `V8结算底`。

## 全高与 Widget

- `bg` 594×1334，flags 13（TOP+BOT+LEFT），左 0；750×1624 下实际拉到 1624。
- `战绩列表` flags 5，top 272 / bottom 348；`表头` TOP 190；`战绩标题` TOP 34；`关闭上层` TOP 46。
- `围观底板` BOT 120；`title2` BOT 276；`围观列表` BOT 136；`搓牌开关/搓牌字/搓牌线` 各自 BOT。
- 行高 60，列表 Layout cell 552×66；围观 content 宽 500、cell 152×80、spacingX 6。

## 美术

- 15 张 PNG + 手写 `.meta` 落在 `assets/V8/realtime_record/`；spriteFrame uuid 见 `vibe_images/2026-11-18-realtime-record/frames.json`。
- 其中 10 张按 alpha bbox 裁掉透明边（gold_line、header、row/self/dim、watch_box、toggle_track/knob、v_divider、close），同步改写 `.meta` 的 width/height/rawWidth/rawHeight，避免拉伸后可见区只占节点一部分。
- 标题、头像金环、面板底保留原边距（柔和外发光需要留白）。
- 默认头像 spriteFrame `3200ca5e-29f4-43ba-8407-fa039dbaed6e`，行模板 `head/img` 与围观模板同用。

## 脚本改动

- `UpdateRealtimeSqueezeState`：开关滑块随状态 left/right（±24）。
- `FillRealtimeAvatar`：按 `one.id` 走 `GetImageByName`，失败 `AddWaitFreshImage2Catch`；无 id 保留默认头像。
- `FillRealtimeSeatedRow` 关 `V8结算底`、`FillRealtimeSettledRow` 开 `V8结算底`。
- `MakeRealtimeHintRow` 高度 48，隐藏 `底/V8结算底/head`。
- 行模板 name 24 号、x=-158 宽 140；头像/金环 x=-251。

## 验证

- 四份 JSON 全量 `__id__` 校验 0 坏引用（4684 / 4660 / 51 / 20 objects）。
- 场景与 Prefab 的实时战绩子节点、Widget 值、15 张 SpriteFrame 引用逐项对照一致。
- `vibe_images/2026-11-18-realtime-record/mock_1334.jpg`、`mock_1624.jpg` 为按 Prefab 坐标 + 真实素材的模拟排版图，非引擎渲染。

## 未完成

- Creator 尚未导入新 PNG/`.meta`、未刷新场景与 Prefab、未构建、未热更、未真机。
- 已结算行是否带 `id` 未核实；无 id 时显示默认头像。
- 参考图无顶部汇总区，因此本版隐藏总带入/总得分/奖池；是否接受待用户确认。
- `title2` 内保留房间倒计时（参考图该位置是围观人数/标题行）。


## 第二版美术返工（2026-11-18 下午）

- 以参考图 `https://aka.doubaocdn.com/s/ExVANRQJjq` 为条件用 `image_edit` 逐件重绘，替换 `assets/V8/realtime_record/` 13 张：底板、标题、表头、普通行、本人行、结算暗行、围观框、关闭钮、开关轨道/滑块、头像金环、围观/搓牌金字。同步改写 `.meta` 的 width/height/rawWidth/rawHeight。
- 去背：`ImageDraw.floodfill` 从四角灌黑（阈值 45）只清与边缘连通的黑色，避免把胶囊内部变半透明。
- 版面修正：面板整体右移 78 使 `bg` 居中（Widget LEFT 由 l=0 改 78）；标题 466×124、关闭 x=252；围观框/列表/表头/搓牌整体 +78；搓牌开关 x=119。
- 修复 `围观` 精灵 `_enabled=false` 不显示；`set_sprite` 现在强制启用组件。
- 围观 content `_resize` 由 1 改 0，单条观战对象不再被居中。
- 开关关闭态由脚本把轨道颜色压暗（110,132,165）。
- 已重跑 `tools/apply_realtime_record_v2.py`，scene/prefab/行模板/围观模板均更新；四份 JSON `__id__` 引用 0 坏。
- 预览：`temp/panelGameView_show-render-1334.png`（临时把 2696 置 active 渲染，非正式资源）、`vibe_images/2026-11-18-realtime-record/mock_v2.jpg`。
- 待验证：Creator 导入新 PNG/meta、打开面板看真实行、构建、真机。

## 第三轮版面调整（用户反馈：上下太满、要半透、底部变形/太小）

- 面板不再顶满：`bg` Widget 改 t=36 / b=36（`oh` 1262），保持 TOP+BOT+LEFT 与 l=78 居中；面板 36..1298，上下露出牌桌。
- 背景半透：`bg` 节点 `_opacity=170`（约 67%），只在背景层，标题/表头/行/围观框仍不透明。
- 标题 TOP 68、关闭 TOP 80；表头 TOP 212；列表 TOP 292 / BOT 352（高 690）；`V8列表状态` TOP 616。
- 底部重排：围观框 h=190、BOT 150（994..1184）；围观标题行 BOT 290；围观列表 BOT 164、高 122；搓牌字 96×44 @x=-189、BOT 76；搓牌线 185 宽、BOT 94；开关 BOT 76。
- 围观/搓牌金字重做：按亮度阈值 70 紧裁后直接拉伸铺满节点（围观 96×44、搓牌 96×44），解决"太小/变形"；两字与金线左对齐（x=-189）。
- 金线长度收敛：围观线 330（x=35），搓牌线 185（x=-37），避免压到开关。
- 已重跑 `apply_realtime_record_v2.py`，场景+prefab+两个模板同步；四份 JSON `__id__` 0 坏。
- 预览：`mock_v4.jpg`（合成牌桌底）、`temp/panelGameView_show-render-1334.png`。
- 仍未验证：Creator 导入、实机、开关关闭态（脚本染色，预览不跑脚本）。

## 第四轮：字缩、金线重做、围观列表改滚动（2026-11-18 晚）

- 用户真机反馈四项：「围观」「搓牌」字太大、旁边金线不清晰、围观列表压到标题、围观列表要能往下滚。
- 金线根因：`record_gold_line.png` 原为 290×14 的「菱形渐变装饰」，真正的金色只占中间几行；节点只给 2~3px 高，拉伸后成了残影。改为 512×5 的通栏细线（alpha 70/200/255/200/70，色 206,152,61→255,236,172，首尾 10px 渐隐），文件与 UUID 不变，`.meta` 宽高同步 512×5。
- 字号：围观 96×44 → **76×35 @x=-199**；搓牌 96×42 → **76×33 @x=-199**（BOT 76 不变）；`title2` 高 40 → 35（BOT 290）。
- 金线：围观线 **322×5 @x=12**（屏幕 226~548，避开右侧倒计时 558 起）；搓牌线 **204×5 @x=-47**（226~430，避开开关 444 起）。注意 title2 局部原点在面板中心，换算要减 375，别再按画布坐标填。
- 围观列表：可视区 500×122 不变（BOT 164 → 屏幕 1082~1204，标题底 1055，留 26px）。content 改顶部对齐（`_anchorPoint.y=1`、pos y=61），Layout 由「横向 + `_resize=0`」改成 **GRID / CONTAINER(`_resize=1`) / cell 152×80 / spacing 6×6 / 左右 padding 16 / 上下 2**，view 的 `cc.Mask` 强制 `_enabled=true`、`_type=0`。三列居中（屏幕 141~609），行高 80，两行即超可视区 → 纵向可滚（`ScrollViewEx` 本就 vertical=true）。
- 围观模板 `观战对象.prefab`：`name` 由 x=26/w=88 改 **x=32/w=74**，避免压到头像（头像右缘 -6）；根下遗留的旧 92×92「V8头像框」（V7 图 `8c52c3e6…`，pos 0,17）已从 children 中摘掉（仍在文件里，active=true 但不参与渲染）。`build_watch_prefab` 现在优先复用指向 `record_avatar_ring` 的同名节点，其余同名节点置 inactive。
- 工具 `tools/apply_realtime_record_v2.py` 已同步上述常量；本轮只跑 scene/prefab/围观模板（**未跑 `build_row_prefab`**，避免覆盖别人未提交的 `带入记录.prefab`）。
- 离屏复核 `/tmp/rt_render3.png` + 合成 6 行 `/tmp/rt_list_mock3.png`：标题/金线/倒计时互不重叠，三列行从列表顶开始、第二行被 Mask 裁在 1204。
- 未做：Creator 导入（PNG 尺寸变了必须重导）、构建、热更、真机滚动实测。

## 第四轮：行间距 + 隐藏围观倒计时

- 列表 `cc.Layout` 的 `_N$cellSize` 由 552×66 改为 552×70（行高仍 60，行间 10px），9 条记录（7 在场 + 提示 + 2 结算）正好落在 690 高的列表内。
- `title2/倒计时`（围观右上角 `00:00:00`）`_active=false` 隐藏，脚本仍会写 `txtRoomTime` 但不显示；同处金线延长到 370 宽（x=65），补满原倒计时占位。
- 场景/prefab 已重跑；`mock_v6.jpg` 为新预览。未导入/构建/热更/真机。
