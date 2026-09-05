# 2026-09-05 赠送页主视觉与列表底板修正

## 范围

- 工作目录：`/Volumes/SSD/qing`；分支 `main`，未提交。
- 用户指出赠送页顶部两只拿牌的手不好看，且下方列表背景从样例图中扣除不净。

## 实施

- `art_sources/v7/gift/gift_hero_no_hands_v2_source.png`：内置 ImageGen 以原主视觉为编辑目标，保留冷蓝赌场环境，移除人物手部，改为居中筹码、牌面点缀和金币流光；无文字、Logo、按钮或人物。
- `assets/resources/V7/gift_hero_exact.png`：从新版源图等比覆盖到 750×300，沿用既有正式资源名和 UUID，`panelMain.prefab` 无需更换引用。
- `assets/resources/V7/gift_list_panel_exact.png`：改为程序重建的 708×280 连续冷蓝材质和克制金边，不再擦除带三条示例记录的效果图，因此无样例文字、头像、横线或残影。
- `tools/extract_v7_gift_exact_assets.py`：固定使用新版主视觉源图及真正干净的列表底板生成方式；动态记录行、头像、输入框和提交协议未改。
- `tools/validate_v7_responsive_layout.py`：新增主视觉源图存在性和列表内部扫描线连续性检查。

## 验证与边界

- 新版主视觉和干净列表底板已人工查看；Creator 2.4.13 完成资源重新导入，控制台未出现本轮资源/脚本错误。
- `py_compile`、四档竖屏响应式校验及相关 `git diff --check` 通过。
- 未用真实账号验证有数据列表、提交成功/失败回包，也未执行 Creator 构建、真机或发布。
