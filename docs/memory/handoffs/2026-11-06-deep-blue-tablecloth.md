# 深蓝桌布：去掉第 5 张绿桌布、蓝色排到第 1 并设为默认

- 日期：2026-11-06
- 目录/分支：`/Volumes/SSD/qing`，`codex/club-ui`（未提交，等确认）
- 目标：桌内「选择桌面」共 5 项，去掉原来的第 5 张（深绿），把新做的深蓝桌布排到第 1 并作为默认。

## 关键事实（以前踩不到、以后会用到）

- 游戏内「桌布」= `assets/resources/zuotype/1.png`～`5.jpg`，由 `panelGameView` 的 `BK` 节点全屏铺满，
  `UpdateTableImg()` 按 `Tool.GetConfigString("桌面","1")` 用 `Tool.LoadImg(img,"zuotype/"+N)` 动态换。
  **不是** `settings_v8_table_1..5.png`（那只是设置面板 108×178 的缩略预览，在 `assets/V7/`）。
- 缩略图挂在 `panelGameView` 的 `系统设置/设置/桌面/桌面N/Background` 与 `checkmark` 两个 Sprite 上，
  sprite `_sizeMode=0`（CUSTOM，固定 102×170），所以缩略图源尺寸各不相同也不影响排版。
- `*_selected.png` 是**通用金框+勾**（内部全透明，与桌布内容无关），各槽位只有尺寸差异。
- `panelGameView` 跑的是 `drh8.fire` 里的副本，但**两处都改了**（场景 + prefab），保持一致。

## 改动

1. `assets/resources/zuotype/` 内容重排（文件与 meta 不动，只换像素）：
   1.png=深蓝（新）、2.png=原绿1、3.png=原青2、4.jpg=原紫3（等比压到 750×1334 与原文件同尺寸）、
   5.jpg=原金4；**原 5 的深绿被覆盖丢掉**。
2. `assets/V7/settings_v8_table_N.png` / `_N_selected.png`：文件名整体后移一位
   （原 4→5、3→4、2→3、1→2，原 5 覆盖丢弃），新的第 1 张是深蓝缩略图（225×335，
   直接从原 table_1 缩略图换色相，金边/黑皮/白勾/透明区全部保留）。
   同时把 `drh8.fire` 与 `panelGameView.prefab` 里 5 个槽位的 10 个 `_spriteFrame.__uuid__` 指向新映射。
3. `assets/scripts/UI/panelGameView.ts`：`牌局设置` 打开时回填选中项的默认值 `"4"` → `"1"`，
   与 `UpdateTableImg()` 的默认 `"1"` 对齐（原来不一致，用户没选过时没有任何一项打勾）。

## 深蓝的取色

对原 1.png 做 HSV **只换色相**（169°→212°），保留原饱和度/明度/布纹/四周压暗，
所以和另外几张同一族、无风格偏差。视觉基准取自 V8 定稿 `06-桌内界面/10-牌局设置.png` 底部实拍桌布
（实测 RGB≈(39,80,124)、H≈211°）。中心色 `#042F5F`。
A/B/C 三档样张在 `design-previews/待确认/2026-11-06-深蓝桌布/`，落地的是 A（深海蓝）。

## 验证

- 已做：场景/prefab 引用全部指向 `settings_v8_table_1..5`，无悬空 uuid；`library/imports` 里
  1.png（uuid `ee069fc5…`）与新缩略图（`a51f35a5…`）md5 与源文件一致（Creator 已重导）；
  各 `.meta` 只出现「uuid + 尺寸」这类搬迁式差异，trim/type 未被改写；`zuotype` 的 5 个 meta 未变动；
  `panelGameView.ts` ts.transpileModule 0 诊断；重排结果见 `06-选择桌面重排结果.png`。
- **未做**：编辑器里点「牌局设置」目视、网页版/真机实跑、热更包重建（`project.manifest` 未动，
  要发布得跑 `1生成热更新包.command`）。

## 遗留 / 注意

- 老用户 localStorage 里 `桌面` 若已存 `"5"`，现在会看到金桌（原第 4 张），不是原来的绿。
  想彻底对齐可加一次迁移（把存量 `"5"` 改 `"1"`），本次没加。
- 若以后要另一档蓝色，只需重跑换色（B 提亮 1.24× / C 压暗 0.84×），桌布与缩略图要成对换。
