# 游戏设置·奖池比例支持小数 / 隐藏低底皮

- 日期：2026-11-10
- 目录/分支：`/Volumes/SSD/qing`，`codex/club-ui`
- 状态：客户端已改，未构建、未真机；服务端小数写入未验证

## 目标

1. 「修改奖池比例」弹窗支持 0.x% 小数（原来只能输整数）。
2. 奖池设置下方「底皮奖池数量」不再显示已停用的 `底皮 0.1/0.3`、`底皮 0.2/0.5`。

## 改动

- `assets/scripts/UI/panelGameSettings.ts`
  - 比例按两位小数归一化（`normalizeBili`）与展示（`formatBili`：0.50→0.5，10.00→10），合计行与「其余牌型共占」提示同步格式化。
  - 弹窗输入：原生端用 `cc.EditBox.InputMode.DECIMAL`（小数键盘）；网页/预览端 `input type=number` 会把「0.」判为非法值并吞掉小数点，改用 `InputMode.ANY` 文本框 + `inputmode=decimal`，并恢复引擎被 ANY 改掉的标签居中。`maxLength=6`，占位「0-100，可填小数」；校验 `/^\d+(\.\d{1,2})?$/`，0~100。
  - 回包 `reward_card_bili` 不再 `Math.floor`，小数原样回填；保存仍按 5 个牌型整表下发。
- `assets/scripts/UI/panelGameView.ts`
  - 牌桌奖池弹窗的比例不再向下取整，按两位小数格式化；>0 即显示该行（避免 0.5% 被当成 0 隐藏）。
- `assets/resources/UI/panelGameSettings.prefab`
  - `底皮行_0`、`底皮行_1` 置 `_active=false`（保留节点以对齐服务端 8 个底皮键）。
  - 滚动 content 高度 1604→1388（少 2×(96+12)），Layout `_layoutSize` 与 Widget `_originalHeight` 同步。
- `tools/build_game_settings_prefab.py`
  - 重新生成时保持 8 个底皮节点但前两档隐藏，content 高度 1388，避免回滚这两项改动。

## 待验证

- Creator 导入 prefab 后：滚动区只剩 6 个底皮行、无空白尾、1334/1624 两档不压叠。
- 弹窗可输入 `0.5` / `0.05` 并保存，列表与合计显示 `0.5%`（网页端、原生端各验一次）。
- **服务端前提**：`服务器文档整理/俱乐部实时房奖池-客户端与后台接口文档.md` §10.3/§10.4 仍写 `reward_card_bili` 为「整数 0~100」。若游戏服按整数截断，`0.5` 会落成 0（等于关闭该牌型），需服务端同步支持小数后本功能才完整可用。
