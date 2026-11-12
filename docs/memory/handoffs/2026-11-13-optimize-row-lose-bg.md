# 2026-11-13 牌局优化列表按输赢区分底色

目录/分支：`/Volumes/SSD/qing`，`codex/club-ui`。

目标：牌桌内「牌局优化 → 运维优化」记录行不易区分「赢/输」目标，用背景色区分；赢保持原蓝底，输换另一种底色。

改动文件：

- `assets/V7/record_row_lose_exact.png` + `.meta`：由 `record_row_exact.png` 色相 +145° 得到深红底，尺寸 224×96、九宫格边界 20、Alpha 通道与原图一致；`packable=false`。
- `assets/resources/UI/panelGameOptimize.prefab`：行模板首个子节点新增「背景_输」（`cc.Sprite` 九宫格 + `cc.Widget` 四边 0 铺满 660×104），默认 `_active=false`，渲染在原蓝底之上、文字之下。
- `assets/scripts/UI/panelGameOptimize.ts`：`FillRow` 按 `row.targetValue < 0` 切换「背景_输」，历史行与当前行走同一路径。
- 未改其它面板（该行模板只被 `panelGameOptimize` 使用）。

验证：Prefab JSON 结构、spriteFrame UUID 指向、行模板子节点顺序已静态核对；用同图在本地合成行/列表预览确认红蓝可区分、文字可读。

未完成：未在 Creator 内确认导入，未做 1334/1624 实际渲染截图，未构建、未热更、未真机。

下一步：Creator 导入新图并打开 `panelGameOptimize.prefab` 核对「背景_输」外观 → 构建/热更后在牌桌内看赢输两类记录的实机效果。
