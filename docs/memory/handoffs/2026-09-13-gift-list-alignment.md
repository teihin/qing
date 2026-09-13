# 赠送页类型对齐与列表竖纹修复

日期：2026-09-13；目录 `/Volumes/SSD/qing`；分支 `main`。保留本轮进入时已有的钱包脚本、回归和 CURRENT 修改；未提交、未推送。

## 目标与改动

用户截图指出记录的“类型”偏右，以及列表背景的残留竖条。只修这两处，当前 V8-new 主视觉、输入框、头像、金额、时间、分页和赠送协议保持不变。

- `assets/resources/Prefabs/赠送记录对象.prefab`：仅根节点下 `type` 的锚点 X 从 0 改为 0.5，并把中心定位到表头列中心（源图 X=132，Prefab X=-269.39426142401703）。旧左锚点配合居中文字使显示多右移了半个节点宽度，约 43.84 逻辑像素；最终净左移约 40.65 像素。其余序列化对象逐项对比没有变化。
- `assets/resources/V7/gift_list_panel_exact.png`：原 `bandClear` 将源图 7 像素窄带拉满列表，造成细竖纹。使用内置 imagegen 编辑原底板，清除竖纹，保留蓝色材质和两侧细边；正式资源仍为 886×344，沿用原 `.meta` 和 UUID。
- `art_sources/v8-repairs/gift-list/gift_list_panel_clean_source.png`：图像编辑结果经尺寸归一后的源文件。`tools/v8_gift_crops.json` 直接读取该干净源，移除旧窄带拉伸配置；`tools/apply_v8_gift.py` 同步类型锚点和中心，避免以后生成恢复问题。本次未运行整页应用工具。

## 验证与下一步

- 16 张赠送切图的尺寸、SpriteFrame 元数据及保留像素/源图检查通过。
- 1334、1624、1778、1860 四档静态布局检查通过；列表高度分别约 275.55、565.55、719.55、801.55，均能容纳现有三行。真实记录、头像和其他列的序列化数据未改。
- Creator 2.4.13 现有 qing 实例已导入：正式 PNG 与 `library/imports/2b/2be25925-03fa-502e-b5d9-48ed1a4af6e4.png` 字节一致，导入的记录 Prefab 已含新位置。底板 SHA-256：`9221f10b867c97f159d3a378993e1011f521f46a3b912e52fb8d4bb8b48d9209`。
- 编辑前在现有 iPhone X 网页确认了同一组三条记录及两个问题。刷新后回到登录页，无法在本轮继续确认新资源的真实记录显示；不能将资源/静态检查记为网页登录态验收。下一步由用户重新登录后进入赠送页目视确认。
- 没有登录提交、真实赠送、Creator 构建、真机或发布。

## 内置图像编辑提示词

编辑目标：`assets/resources/V7/gift_list_panel_exact.png`。使用内置 imagegen，无 CLI/API 回退。生成输出归一到现有资源尺寸，原图像结果保留在工具默认输出目录。

```text
Use case: precise-object-edit. Asset type: production Cocos game UI list background texture. Edit the supplied 886 x 344 blue rectangular asset only. Remove every narrow vertical stripe, repeated band and dirty residual mark from the blue interior. Replace that interior with a perfectly clean smooth continuous subdued blue gradient, same overall navy/teal blue brightness and color family as the original, with extremely gentle broad illumination only. Preserve the original straight very thin pale blue left and right border at their exact edge locations. Keep the image fully filled and opaque, edge to edge, with square corners, no margin. No top or bottom border, no rounded corners, no new frame. No lettering, no icons, no people, no sample rows, no dividing lines, no vertical or horizontal texture stripes, no noise or grain, no decorative highlights. Output a clean flat 2D game asset at the same wide 886:344 aspect ratio, not a screenshot or mockup.
```
