# 牌局结算列表按输赢正负切换行底（2026-11-18）

分支 `codex/club-ui`，工作目录 `/Volumes/SSD/qing`。**未构建、未热更、未真机验证**；Creator 已导入资源与 Prefab。

## 目标

用户给结算界面截图，指出：列表里只有「输赢为正」的人用现有金色背景条，负数（及非正数）显示普通背景条；普通底图由图片技能生成。

## 素材

- 新建 `assets/V7/settlement_card_row_normal.png`：1400×168，RGBA 未量化，59,164 B（金卡原图 18,208 B）。
- 新建独立 `.meta`（texture `1c0a8c3d-63d1-43a9-80a3-afa354870fc2`，sprite-frame `33f21cbe-9047-4dfc-8cd4-a1e0da9fc45e`），`trimType:none`、`packable:false`，与金卡 meta 同构。
- **金卡 `settlement_card_row.png` 同日二次重做**：两个 `image_gen` 金卡候选的金边四边亮度不一致（顶边发暗、内发光集中在下边），未采用。最终保留原金边与外发光，只把内部逐行中值重建为平滑渐变（内缩 16px、羽化 12px），并把内部 alpha 强制为不透明——原图内部本身有半透明条纹，是实机“褶皱”的另一来源。改后 1400×168、39,196 B，**文件名/UUID 不变（sprite-frame `105c883c…`）**，4 个共用该图的 prefab 引用不受影响。

生成与后处理（第二版，第一版实机被反馈"压缩出皱纹、不丝滑"）：

1. 第一版 `image_edit` 用金卡做形状母版 + 截图配色，黑底出图后抠图、内部高斯模糊压平；实机 700×100 下仍能看到低对比涂抹和明暗斑块，已废弃。
2. 第二版改用 `image_gen` 透明背景直接出图（8.33:1，实返 4434×532），提示词要求长条铺满画面、小圆角、纯平滑渐变、无褶皱云斑，得到干净的细描边外框。
3. 裁内容后重排到 1400×168；再**用逐行中值重建内部**：每行取中央 x 区中值颜色，9 行滑动平均后整行填充，边缘 10px 内羽化保留原描边/高光。这样内部只剩一条数学平滑的竖向渐变，不会再有涂抹纹理。
4. **不做 256 色量化**：量化后渐变出现 8 级台阶（放大 8 倍可见横带），对细长卡片太明显；改用 8-bit RGBA 直出（59 KB）。

对照图：`design-previews/结算改版-20261118/普通底条对照.png`（上金卡、下普通卡，均按实际 700×100 缩放）。

## Prefab / 脚本

`assets/resources/Prefabs/战绩玩家对象.prefab`

- 根节点 Sprite 不变（金卡）。
- 新增首个子节点「底_普通」：Sprite 指向 `33f21cbe…`，700×100、锚点 0.5、位置 (0,0)、`_active=false`；作为第 0 个子节点画在头像/文字之下，根 Sprite 关闭时由它显示普通底。
- 新增 `cc.PrefabInfo`（root=1，fileId 唯一），未改其他节点。

`assets/scripts/UI/panelRecordInfo.ts` → `setRecordItemInfo`

```ts
let bgGold = node.getComponent(cc.Sprite);
if (bgGold != null) bgGold.enabled = nScore > 0;
let bgNormal = node.getChildByName("底_普通");
if (bgNormal != null) bgNormal.active = !(nScore > 0);
```

- 正数：根 Sprite 显示金卡、普通底隐藏。
- 负数/零：根 Sprite 关闭、普通底显示。
- 行节点尺寸、Layout、Widget、文字与头像逻辑均未改；「逃跑被惩罚」行按总分判断（正分仍金底）。

## 验证

- 静态：meta sub-uuid 与 Prefab Sprite 引用一致；新节点在根 children 第 0 位、默认隐藏；fileId 无重复。
- Creator 导入：sprite-frame `33f21cbe…` 22:04 首次导入、22:13 换为第二版贴图（1400×168，59 KB）；金卡贴图 `fed6f084…` 22:20 更新为平滑版（1400×168，39 KB）；prefab `f3e3…` 22:02 重导入并含「底_普通」。
- 第二版按实际 700×100 缩放的对照图无可见横纹/云斑；金卡 1:1 放大后内部无条纹灰斑，原内部的半透明条纹已消除。
- 未做：Creator 内目视、游戏运行、1334/1624 两档离屏核对（底条与行节点同尺寸，布局未动）、构建/热更/真机。
