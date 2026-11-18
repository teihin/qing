# 2026-11-18 排行榜数字：等宽等基线位图字体 + 数字列右对齐

目录 /Volumes/SSD/qing，分支 codex/club-ui。

## 目标

用户截图反馈排行榜列表里的数字「宽窄不一、不在一条线上」。要求重做数字字体并处理对齐。

## 根因

`assets/V7/leaderboard_v8_digits.fnt` 每个数字的 `xadvance` 是 33~40 的连字宽度（1=33、4/7=40），
`height` 54~56、`yoffset` 3~5，也就是**每个数字字宽不同、基线相差最多 3px**；
再叠加 Label 居中（`_N$horizontalAlign=1`）+ 五位与三位数字长度不同，右侧边缘全长不齐。

## 改动

- 新增 `tools/apply_leaderboard_tabular_digits.py`：把 17 个字形按各自墨迹裁切后统一缩放到 56px 高、
  底部对齐到同一基线（顶线 3 / 基线 59），水平居中进固定 `xadvance=43` 的格子；逗号 24、点 24、
  加号 27、负号/破折号 43、斜杠 26。只重排度量，画风、贴图尺寸 1024×128、UUID、`.meta` 都不变。
  原字形备份在 `art_sources/v8-repairs/leaderboard/digits-tabular-before/`。
- 新增 `tools/apply_leaderboard_number_align.py`：`排行榜.prefab`（19 行，含隐藏行模板）与
  `排行榜对象.prefab` 的 `played_count`、`user_reward` 两个 Label 改 `_N$horizontalAlign=2`，
  并把节点中心左移，让右边缘统一落在列分隔线/行卡片右内侧 8px：
  - `played_count` 右边缘 local 188.87（`V8列分隔1` 196.9 − 8），框宽 190.49→200
  - `user_reward` 右边缘 local 342.69（行宽 701.38/2 − 8），框宽 152.23→160
  框加宽是为了让 `−18,630`（约 190px）不被 CLAMP 裁掉；右对齐时加宽不改变视觉位置。
- `tools/render_ui_prefab.py`：位图字体的 `Digits.draw` 支持 `_N$horizontalAlign`（左/中/右）与框宽，
  之前一律按居中画，改后离屏预览能反映右对齐。

## 已验证（离屏 1334 / 1624）

- `python3 tools/apply_leaderboard_tabular_digits.py --check`：数字 advance / 顶线 / 基线 / 字高各只有一个值。
- 1334 渲染逐行取像素右边缘：手数 559/559/559/558，奖励 713/713/713/713；改前是 515/500/501/501。
- `排行榜对象.prefab`（运行时行模板，字号 44）单独渲染：两列占位「—」右边缘 560 / 717，与行内数字同列。
- 1624 全页渲染无压叠、无越界；最长串推算：`+18,630` 182.9px、`18,630` 164.3px、`−18,630` 193.9px，
  均在 200px 框内。
- 数字颜色未变（旧 #B7BDC1 / 新 #B9BFC3 同量级），未量化、未加滤镜。
- 对比图：`design-previews/待确认/2026-11-18-排行榜数字对齐/`（改前 / A 居中 / B 右对齐 + 两档全页）。

## 待验证

- **Creator 未导入**：`.fnt` 与 PNG 改了内容、`.meta` 未动，理论 UUID 不变，但需 Creator 重新导入后确认
  BitmapFont 字形表刷新（编辑器里若仍显示旧字宽，说明字体资源缓存未重建）。
- 未构建、未热更、未真机。真机需看：手数/赢分（含 `+` 号）、代理红利（五位数）三榜的右边缘是否齐、
  LabelOutline 1px 与 Shadow(1.5,-2.5) 是否压到列分隔线。
- 未跑 `leaderboard_v8_regression.js`（历史记录里该脚本夹具本身不可用）。

## 下一步

- 若用户更想要效果图那样的居中排版：把 `apply_leaderboard_number_align.py` 里的 `TARGETS` 逻辑
  改回 `_N$horizontalAlign=1` 与原始中心 98.83 / 276.57 即可（字体本身的等宽等基线保留）。
