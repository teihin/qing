# 牌局设置 V8 组件来源

设计依据为 `design-previews/效果图V8-new/06-桌内界面/10-牌局设置.png`。保留的来源图为 `frame-source.png`（无控件主框）与 `components-atlas-source.png`（五桌面、三牌背、顶饰、关闭、开关、图标和勾选组件）；最终离线构图为 `final-preview.png`。

`tools/extract_v8_game_settings_assets.py` 以透明 alpha 裁切图集，保留抗锯齿边缘，提取金色标题，并创建稳定 UUID 的 Cocos 2.4 `.meta` 到 `assets/V7/settings_v8_*`。选中态由金色外框和右下勾选徽章合成；不会触及真实牌桌或实际发牌牌背。

`tools/apply_v8_game_settings.py` 只更新 `panelGameView/系统设置` 的正式 Prefab/Scene 子树，保留所有原 Toggle、ToggleContainer、Button、节点路径和 `panelGameView` handler。脚本在保存前检查子树外对象、业务组件和路径不变；新增视觉节点的 PrefabInfo `fileId` 保持唯一。

`tools/render_drh8_panel_previews.py --only settings --simulate-creator-size-mode` 生成离线静态图。该渲染器不等同 Creator/Cocos 实例化，文字与开关最终以 Creator 导入及隔离控件测试为准。
