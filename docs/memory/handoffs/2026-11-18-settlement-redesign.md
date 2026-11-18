# 牌局结算界面按效果图重做美术（2026-11-18）

分支 `codex/club-ui`，工作目录 `/Volumes/SSD/qing`。**未构建、未热更、未真机验证**，仅完成素材替换 + Prefab 改造 + Creator 导入。

## 目标

用户给出结算界面效果图，要求「除背景图不变外，其余内容（列表项、表头、按钮、数字等）1:1 参考效果图」，顶部标题区保持不变。

## 素材（全部用 ImageGen 出图后抠黑底，再按目标宽高比重排）

覆盖（`.meta` 尺寸同步，UUID 不变）：

| 文件 | 新尺寸 | 用途 |
|---|---|---|
| `assets/V7/settlement_v8_summary.png` | 1352×128 | 房间信息条底 |
| `assets/V7/settlement_table_header_exact.png` | 1412×140 | 表头底（**去掉了原图内嵌的金色文字**，改由 Label 渲染） |
| `assets/V7/settlement_return_exact.png` | 750×184 | 返回大厅按钮底（去字） |
| `assets/V7/settlement_badge_th/dy/mvp.png` | 200×76 / 184×76 / 260×88 | 称号牌底（MVP 去字，改由 Label） |

新建：

- `assets/V7/settlement_card_row.png`（1400×168）：列表行卡片底。
  **原来 `settlement_row_exact.png` 只有 924×2，是一根分隔线，且被 4 个 prefab 共用，不能原地改**，所以另起新素材只给「战绩玩家对象」用。
- `assets/ImagesLuck/战绩详情/结算头像环.png`（248×249）：行内头像金环。
  原有 `ImagesLuck/公用/头像2.png` 被 panelGameView / panelMain / drh8.fire 共 15 处引用，不动。
- `结算排行环.png`（232×248）/ `结算MVP环.png`（340×330）：排行三环，MVP 那张带麦穗。
- `结算皇冠.png`（92×64）：第一名头像上的皇冠。
- `结算竖线.png`（8×96）：栏间分隔竖线（Python 画的渐变线，非美术元素）。
  原 prefab 里「图例1/图例2」用的 frame `a23235d1-…` **在 assets 里查不到对应资源**，是无效引用。

体积：全部 `quantize(256, FASTOCTREE)` 压过，最大 27 KB，均低于同组原图。

## Prefab 改动

`assets/resources/UI/panelRecordInfo.prefab`

- 排行：`V7荣誉框前景` 置 `active=false`，改为 土豪/MVP/大鱼 各挂一个「环」子节点；`V8称号_mvp` 新增「文字」Label（原来 MVP 三个字母画在图里）。
- 房间条 / 表头：宽 706→676、高 55→64 / 64→70，加竖线 3 条；**表头新增 4 个金色 Label**（玩家信息/带入/手数/输赢），原来这些字是画在图里的。
- `战绩列表` 底板 Sprite 置空（效果图列表区没有整块底板）；`content` Layout `spacingY` 0→14→10、`paddingTop` 5。
- 返回大厅按钮 314×72→375×92、`bottom` 120。
- 4 个条形元素的 Widget `_top` 与 `_trs` 同步（Widget 生效于运行时，`_trs` 是编辑器/离屏渲染读的值，**两边都要改**）。

`assets/resources/Prefabs/战绩玩家对象.prefab`

- 根节点 Sprite 原来是 `_enabled=false`（所以列表项一直没有卡片底），已启用并换成 `settlement_card_row`。
- 行高 100→84，`line` 子节点隐藏；头像 124×114→124×124 / scale 0.63；名字 33→28 号、ID 28→20 号；带入/手数 26→28、输赢 26→30；三列 x 改到 +20/+154/+261，与表头列对齐。
- 新增 3 条竖线、1 个「皇冠」（`active=false`）。

`assets/scripts/UI/panelRecordInfo.ts`：`setRecordItemInfo` 里加「第一名显示皇冠」（`index === 0`），名次数字节点保留但被头像覆盖（效果图没有名次数字）。

## 坑

- **渲染器验证时踩到的真坑**：父节点 Sprite 会盖住子节点文字（层级顺序写反）、`_enabled=false` 的组件仍被画出来。离屏渲染脚本必须按「父自身 → 子节点」顺序合成，并检查 `_enabled`。
- Widget 改了但 `_trs` 没改时，编辑器/离屏渲染看到的是旧位置，容易误判"改了没生效"。
- 覆盖 PNG 后 Creator 已在跑：`touch` + `osascript activate` 触发重导。新素材的 `.meta` 必须自己写（`trimType:none`），否则会被 `auto` 重裁。
- 每次重新执行安装脚本若重新生成 `.meta` uuid，Prefab 里的引用会全部失效（表现为整块不显示）。**新建素材的 uuid 只生成一次**。

## 真机验收后的返工（同日）

用户跑起来后指出三处：

1. **头像环太小、没包住头像**。根因：环图的「环内径」只占图宽的 0.78（排行环）/ 0.64（MVP 环，两侧麦穗占了宽度），而我按节点宽缩放了环，也没同步 mask。
   修法：环节点放大到 `头像直径 / 内径比`，mask/img 相应收到环内径。
   - 排行环 232×248，内径比 193/232 = 0.832 → 土豪/大鱼环节点 146×156，mask 113。
   - MVP 环 340×330，内径 219/340 = 0.644 → 环节点 225×218，mask 145。
   - 行内头像环 248×249，内径比 0.778 → mask/img 100→96。
   环心在图里不在正中（顶部有宝石），环节点 y 要补偏移（排行 +4.4、MVP +1.5）。
2. **MVP 称号是普通 Label，不是美术字**。改用图片技能出金色金属字（黑底出图→抠图→等比缩放），新建 `结算MVP字.png`，原 Label 置 `active=false`。
3. **返回大厅按钮没有文字**。之前把字从底图里去掉了却忘了补。同样出图生成 `结算返回大厅字.png`（中文，一次成功，笔画完整）。

两张美术字都在 `assets/ImagesLuck/战绩详情/`，已导入 library。

4. **表头四个词也是 Label，实机发虚**。同样出图，四张独立美术字（`结算表头字_玩家信息/带入/手数/输赢.png`，字高统一 34、2x 68），原 Label 节点置 `active=false`，新增 `字_XXX` Sprite 节点挂同一个 x。
   统一按**字高**缩放而不是宽度，否则四个词的字号会不一致（两字词会被拉大）。

## 未验证 / 下一步

- 未在 Creator 里打开 prefab 目视、未运行游戏、未构建热更、未真机验证。
- 实机 750×1624 下的纵向压叠只按 1334 做过离屏推算，长屏要再看一眼。
- 效果图里行卡片的金色边框比当前素材略粗、亮蓝色更艳；如果还要贴近，需重新出图（当前是提亮 + 插值抹掉中缝线后的结果）。
- 对比图：`design-previews/结算改版-20261118/对比.png`、`改后实现.png`。
