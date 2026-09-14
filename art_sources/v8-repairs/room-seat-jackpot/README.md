# 2026-09-14 桌内空位与奖池

本目录的 `user-reference.png` 为本次用户提供的竞品/当前房间对照，仅作为空位图标和顶部奖池显示的最新设计依据。

## 空位素材

使用内置 imagegen 生成 `empty-seat-generated.png`，保留原始 RGBA。正式文件为 `assets/resources/V7/ingame_empty_seat_clean_v8.png`：按透明边界规范化到 192×192，Prefab 中仍为原来的 96×96 按钮。单圈、蓝灰座椅剪影，无文字、加号和铭牌。

实际生成提示词：

> Use case: ui-mockup. Generate one production-ready empty-seat icon sprite for a mobile poker game. Transparent background, square 512 by 512 composition. Single thin circular outline, flat muted desaturated blue-gray (#66858e), and a solid simplified front-view armchair silhouette exactly centered inside, same muted blue-gray. The chair should be a clean familiar rounded armchair glyph: broad rectangular back with subtly rounded corners, two arm rests, horizontal seat, two short feet; no tufting, no decoration, no upholstery details, no strokes inside the silhouette except tiny transparent gaps separating the back from armrests. Outer ring diameter 440px, stroke about 8px; chair about 220px wide and 210px high centered optically at x256 y256. Plenty of clear space between chair and ring. Quiet understated empty-seat indicator, similar to a minimal interface icon. No words, no letters, no plus sign, no gold, no decorative badge, no ornate rings, no glossy light, no perspective, no 3D, no shadows, no gradients, no background disk. Exterior and interior space must be truly transparent.

## 奖池素材

- `ingame_jackpot_frame_v8.png`：无文字薄金边蓝青底框，可九宫格。
- `ingame_jackpot_cells_v8.png/.fnt`：DIN Alternate Bold 浅金数字，每格 72×96，xadvance=72；格子底纹和字形是一体的，避免浮动数字与独立底格错位。
- 正式 Label 252×48，标准七格，不足七位补零；超过七位按完整格宽缩小，不截断服务器数值。
- `tools/apply_v8_room_seat_jackpot.py` 是本次定向写入工具；不可代替只读检查。

## 证据

- `runtime-iphone-x.png`、`runtime-iphone-6.png`：Creator 2.4.13 已导入的正式 Prefab，在独立 localhost 页面中的样例渲染；业务组件禁用，房间资料不是服务端数据。
- `runtime-comparison.png`：两档网页截图并排。
- `runtime-amounts.png`：0、补零及 7/8/9 位金额的实际网页截取。
- `runtime-amount-checks.json`：实际渲染顶点边界，8 次金额变更均未越出 Label 内框。

没有执行真实入座、奖池交易、构建或真机验证。
