# 2026-09-20 桌内牌局设置 V8

目录 `/Volumes/SSD/qing`，分支 `main`。本次仅换进游戏的 `系统设置` 美术，未提交、未推送。

## 实施范围

- 正式目标：`assets/resources/UI/panelGameView.prefab` 与 `assets/Scenes/drh8.fire` 的 `panelGameView/系统设置` 子树同步。
- 设计依据：`design-previews/效果图V8-new/06-桌内界面/10-牌局设置.png`。主框、顶饰、金色标题、五张桌面预览、三张牌背预览、金框加勾选态、关闭、开关和控制区均为独立组件；没有用整页静态图覆盖。
- 业务契约保留：`关闭上层`、`桌面1`~`桌面5`、`牌背0`~`牌背2`、`音效开关`、`语音开关`、`聚光灯开关`、两个 `ToggleContainer` 与原 `panelGameView` handler。没有更改真实牌桌或 `Tool.GetCardBackIndex()` 的实际发牌卡背资源。
- 资源与工具：本轮新增 31 张正式透明 PNG 及 `.meta` 在 `assets/V7/settings_v8_*`；来源、裁切和预览见 `art_sources/game-settings-v8/README.md`。`tools/extract_v8_game_settings_assets.py` 生成组件，`tools/apply_v8_game_settings.py` 只写设置子树并锁定子树外对象、业务组件和路径。

## 验证

- Creator 已导入本轮新增的 31 张 PNG；Prefab/Scene 与正式源码对比一致，允许导入器写入 `_name`、`asyncLoadAssets` 默认项。
- 短屏实测通过。隔离 `panelGameView` handler 的 15 个真实 Cocos 控件测试通过：五桌面、三牌背组唯一选中，三开关 on/off 和关闭；storage 与 gameLogic 为 mock，未接服务端。
- 迁移脚本重复运行通过，目标外序列化对象、Button/Toggle/ToggleContainer 与路径契约均检查；新增 PrefabInfo `fileId` 重复数为 0。`python3 -m py_compile` 与 `git diff --check` 通过。
- 静态离线渲染仅作构图证据，最终图在 `art_sources/game-settings-v8/final-preview.png`；其文字/开关覆盖差异已由真实 Cocos 实例化复核为渲染器限制，不算业务缺陷。

## 未完成项

- 未真实登录、未构建、未真机、未发布；不把 mock 交互当服务端状态或设备验收。
- `settings_v8_check.png`、`settings_v8_selection.png` 仅作为选中态合成辅助，不在桌内 Prefab/Scene 直接引用。
