# 2026-11-17 我的页 10 个操作按钮统一美术

## 目录与范围

- 项目：`/Volumes/SSD/qing`
- 分支：`codex/club-ui`
- 用户已确认生成的新版效果并授权替换到游戏。
- 本轮只替换「我的」页中间 5×2 操作按钮的正式 PNG，不改业务脚本、节点名、事件、权限显隐或布局。

## 修改

覆盖 `assets/V7/` 下 10 个正式资源：

- `mine_updown_exact.png`
- `mine_stone_pool_cost_exact.png`
- `mine_gift_exact.png`
- `mine_money_exact.png`
- `mine_exchange_exact.png`
- `mine_stone_water_exact.png`
- `mine_record_exact.png`
- `mine_settings_exact.png`
- `mine_quota_grant_exact.png`
- `mine_chengfa_exact.png`

新图统一深蓝玻璃按钮底、金色边框、立体金色图标、米白金边字、阴影与文字中线。每张图按原资源尺寸导出，原 `.meta` 和 UUID 未改，因此 `panelMain.prefab` 的 SpriteFrame 引用保持不变。

## 验证

- 10 个按钮节点逐一核对，Prefab SpriteFrame UUID 仍分别对应上述 10 个资源。
- 10 张 PNG 的尺寸与原 `.meta` 一致，四角透明，适合现有圆角按钮显示。
- `panelMain.prefab` 当前仍保留原按钮节点、Button 组件和动态权限逻辑。
- `git diff --check` 的全量输出被既有未提交的服务器文档尾随空格占用；本轮资源与记忆文件没有新增该类问题。
- `tools/validate_v7_responsive_layout.py` 已运行，但被既有 `assets/resources/UI/panelLogin.prefab:登录LOGO alignFlags=18，预期17` 阻断；该失败点不涉及本轮 10 张按钮资源。

## 未验证与下一步

- 未执行 Creator 导入/保存、网页实际预览、Creator 构建、正式构建、真机和真实账号操作。
- 下一步先让 Creator 重新导入 10 张 PNG，再核对短屏/长屏下的按钮间距和第 5 行入口；确认显示后再决定是否生成新 APK/IPA。
