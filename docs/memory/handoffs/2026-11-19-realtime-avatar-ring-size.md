# 2026-11-19 实时战绩头像框缩在头像里：环节点放大（未导入/未构建/未热更/未真机）

## 现象与根因

- 用户真机截图（实时战绩）：战绩行与围观列表的头像照片是满幅圆形，金色头像框缩在照片内部，看着像"框跑进头像里"。
- `record_avatar_ring.png` 是 92×92 且在四周留了透明边距：实测强 alpha 环外径 ≈60.6 px、内径 ≈53.2 px、描边 ≈3.7 px，环只占画布 0.659。按节点实际尺寸（围观 64、战绩行 46）绘制后，可见环径只有 **42 / 30**，而头像分别是 62 / 44，所以环必然落在照片内部。
- 截图实测（836×1766）围观环径 ≈43 design px、战绩行 ≈32，与上述换算一致，排除运行时缩放/裁剪其它原因。

## 改动

- `assets/resources/Prefabs/观战对象.prefab`：`V8头像框` 节点 64×64 → **100×100**（x=-38, y=0 不变）。放大后可见环外径 ≈66，内径 ≈58，环压在 62 头像边缘上，外沿超出头像约 2px。
- `assets/resources/Prefabs/带入记录.prefab`：`ring` 节点 46×46 → **72×72**（x=-251, y=0 不变）。可见环外径 ≈47.5，对应 44 头像。
- `tools/apply_realtime_record_v2.py` 的 `build_row_prefab` / `build_watch_prefab` 同步改成 72 / 100，重跑工具不会退回旧尺寸。
- 只改节点 `_contentSize`，不动 PNG、`.meta`、spriteFrame UUID；两个 prefab 的 JSON 语义 diff 各只有 1 处 `_contentSize`。

## 验证

- 两个 Prefab JSON 结构比对：对象数不变、引用无新增/丢失；与 HEAD 全对象 diff 只有上述两处。
- `tools/render_ui_prefab.py` 离屏渲染：`vibe_images/2026-11-19-avatar-ring/观战对象-render-1334.png`、`带入记录-render-1334.png`；按围观 cell 152×80 / 行高 70 合成的 `watch_row_mock.png`、`list_mock.png` 里环都在头像外沿，三列间距与行间距无压叠。
- 环放大后透明外发光半径约 50（围观）/36（行内），环可见边仍在行/格内；围观 `name` 左缘 -5、环可见右缘 -5，文字在环之后绘制，不会被盖住。

## 未做

- Creator 未导入/刷新（只改 Prefab 尺寸，理论上重开即生效，仍需确认编辑器里已刷新）。
- 未构建、未热更、未真机复看；真机上如觉得环偏粗/偏大，可把 100/72 按 0.659 反推微调（例如 96/70 让环大致压在头像边缘）。

## 附注

- `drh8.fire` 与 `panelGameView.prefab` 的 `围观列表/view/content` 下各有一个 `观战对象` 预制体实例占位（130×130、`_active=false`、`sync:false`，子节点还是旧版 95 头像 + 无环）。运行时 `GetWatchList` 会清空 content 再按名字实例化 `resources/Prefabs/观战对象.prefab`，占位不参与渲染，本次未动它；若要在编辑器里看到一致效果，可在 Creator 里刷新该实例或删掉占位。

