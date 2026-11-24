# CURRENT.md 归档：2026-11-18 客户端 UI 批次

自 `docs/memory/CURRENT.md` 移出（2026-11-24 归档，因当前状态超出预算）。原文未改动。

## 2026-11-18 实时战绩按新效果图重做（场景 + Prefab 同步，未导入/未构建/未真机）

- 场景 `drh8.fire` 与 `panelGameView.prefab` 内的「实时战绩」子树同步改写：新 `战绩标题`、`表头`、`战绩列表`、`围观底板`、`title2`、`围观列表`、`搓牌字/线/开关`；旧汇总区（`bk`、`V8战绩底板`、`V8围观底板`、总带入/总得分、奖池、V8概况/表头、旧 title）整组隐藏未删。
- 二轮美术按参考图重生成后，面板改为居中且不再顶满：`bg` 594×1262、Widget TOP+BOT+LEFT（l=78/t=36/b=36），`_opacity=170` 让牌桌透出来；标题 TOP 68、表头 TOP 212、列表 TOP 292/BOT 352、围观框 BOT 150、搓牌行 BOT 76，全部 Widget 定位。
- 第四轮按真机反馈收版：围观 76×35、搓牌 76×33（同 x=-199），金线素材改 512×5 通栏细线（围观线 322×5@x=12、搓牌线 204×5@x=-47），`title2` 高 35；围观列表 content 顶部对齐、Layout 改 GRID 152×80（`_resize=1`）、左右 padding 16、Mask 启用，三列成行、纵向可滚；围观模板 `name` 移到 x=32/w=74，根下旧 92×92 头像框不再参与渲染。
- 脚本：滑块随开关移动、战绩行补头像加载、结算行切 `V8结算底`、提示行隐藏头像与底。
- 静态核对 0 坏引用，场景/Prefab 节点与 15 个 SpriteFrame 引用一致；1334/1624 两档模拟排版图见 `vibe_images/2026-11-18-realtime-record/`。Creator 导入、构建、热更、真机均未做。详见[交接](../../handoffs/2026-11-18-realtime-record-v2.md)。

## 2026-11-18 牌局结算行底：正分金卡、非正分普通蓝底（脚本就绪，未构建/热更/真机）

- `settlement_card_row.png`（金卡）与 `settlement_card_row_normal.png`（普通，sprite-frame `33f21cbe…`）均 1400×168、RGBA 未量化；内部改为逐行中值重建的平滑渐变并强制不透明——原图内部的半透明条纹就是实机“褶皱”来源。金卡保留原金边/外发光，同名同 UUID，共用 prefab 引用不变。
- `战绩玩家对象.prefab` 新增首个子节点「底_普通」（700×100、默认隐藏）；`panelRecordInfo.setRecordItemInfo` 按 `nScore > 0` 切换根 Sprite 与普通底。
- Creator 已导入（prefab 22:02、普通图 22:13、金卡 22:20）；未构建/热更/真机。详见[交接](../../handoffs/2026-11-18-settlement-row-normal-card.md)。
