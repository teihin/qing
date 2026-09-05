# 2026-09-05 游戏推广冷蓝广告页及长屏布局修正交接

## 范围与确认

- 工作目录：`/Volumes/SSD/qing`；分支按当前检出，未提交。
- 用户确认 `design-previews/2026-09-05-V7游戏推广冷蓝广告页效果图-v5/` 的冷蓝方向，并要求顶部改成与其他 V7 页面一致的样式。
- 否定方向仍有效：不用偏暖黄、传统赌场海报感或大面积金色框；香槟金只留给盾牌、标题栏和少量细线。
- 后续实机截图确认四个新问题：原母版图标与正式节点叠加错位、二维码/信息/按钮区域过挤且整体偏上、长屏下方空白过大、游戏下载地址太小且错位；同时要求 ID 和地址都能单独复制。

## 实施文件

- `assets/resources/UI/panelMain.prefab`：推广根节点仍为 `推广二维码`；750×1800 母版固定顶部，统一标题栏和盾牌保持独立。新增独立主标题、二维码框、信息卡、两枚复制按钮及分享/保存按钮，说明、二维码和操作区改用屏幕垂直中线定位；正式根节点仍默认关闭。
- `assets/resources/V7/followup_promo_master_long.png`：改为纯冷深蓝舞台和连续桌面纹理，不含标题、盾牌、二维码、信息卡、按钮、示例 ID 或链接，解决烘焙元素与正式节点重叠错位。
- `assets/resources/V7/followup_promo_headline_exact.png`、`followup_promo_qr_frame_exact.png`、`followup_promo_info_panel_exact.png`、`followup_promo_copy_button_exact.png`、`followup_promo_share_button_exact.png`、`followup_promo_save_button_exact.png`：独立正式资源，图标和文字在资源内对齐，外部节点不再叠放第二套图标。
- `assets/resources/V7/followup_promo_header_exact.png`：来自已确认 V7 页的金色返回标题栏，覆盖效果图原白色顶部。
- `art_sources/v7/promotion/promo_background_clean_v2_source.png`：使用内置 ImageGen 对原长母版做精确对象移除后的无字冷蓝背景源图；生成方向为冷深蓝、冰蓝光效、克制香槟金点缀，不含业务内容。
- `tools/extract_v7_followup_exact_assets.py`、`tools/apply_v7_followup_main_exact.py`、`tools/validate_v7_responsive_layout.py`：同步正式资源生成、Prefab 应用和四档高度校验规则。

## 业务与适配

- 二维码仍由 `panelMain.ts` 按真实注册地址绘制到 `推广二维码/二维码/img`；`V7推广ID` 和 `V7推广链接` 仍写入运行时真实值。`复制推广ID` 去掉展示前缀后复制真实 ID，`复制推广地址` 复制完整真实注册地址，并沿用 `MobileManager.CopyToPhone` 结果提示。
- 没有新增或臆造原生分享流程；`分享二维码` 与 `保存二维码` 均复用既有 `CaptureScreen()` 保存到相册契约。
- 750×1334 保证全部关键信息可见；1334、1500、1624、1778 四档竖屏中，顶部与主视觉固定，说明、二维码、信息卡及按钮组相对屏幕中心整体下移，二维码到信息卡和信息卡到按钮均保留至少 45px 间距，避免长屏下方形成大段空白。

## 验证与边界

- `python3.13 tools/validate_v7_responsive_layout.py`：通过，包含 Prefab 锚点、四档高度、资源引用和显示状态。
- 四个相关 Python 工具通过 `py_compile`；相关文件通过 `git diff --check`。
- `python3.13 tools/validate_v7_responsive_layout.py` 再次通过，确认四档屏幕中的段间距、正式资源引用、四个按钮组件、ID/地址字号及复制脚本入口；Prefab 根节点已复核为默认隐藏。现有 Creator 2.4.13 已导入新的背景、标题、二维码框、信息卡和按钮资源。
- 用户随后报告进入大厅即弹出分享页：文件中根节点虽为关闭，但已加载的预览实例可能保留临时显隐。已在 `panelMain.ts` 的 `onLoad` 和 `onEnable` 主动关闭推广页，并同步让应用/修复工具固定写回关闭状态；校验器新增默认显隐及双生命周期保护断言。Creator 重新导入后未出现本次 TypeScript 编译错误。
- 尚未以真实登录账号验证动态二维码/ID/链接、两项复制返回和相册保存，也未执行 Creator 构建、真机或发布；推广页整页仍需登录态最终视觉复核。
