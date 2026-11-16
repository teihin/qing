# 2026-11-17 牌桌强制秀牌 / 看剩余牌美术替换

## 目录与分支

- 项目：`/Volumes/SSD/qing`
- 分支：`codex/club-ui`

## 目标

按用户附图替换牌桌「强制秀牌」与「看剩余牌」两枚圆形按钮的旧美术。

## 改动

- `assets/ImagesLuck/游戏内/e1.png`：替换为深蓝金边、牌图标、金色叶饰、浅金「强制秀牌」按钮。
- `assets/ImagesLuck/游戏内/e2.png`：替换为同风格黑桃图标、浅金「看剩余牌」按钮。
- 两个 `.meta` 的资源 UUID 与 SpriteFrame UUID 保持不变；仅自动更新透明边缘的 trim 范围。
- 未改动 `panelGameView.prefab`、`drh8.fire`、`panelGameView.ts`；原节点名、价格 Label、Button 和业务回调继续复用。

## 验证

- PNG 尺寸与 `.meta`：`e1=105×115`、`e2=105×116`，均为 RGBA，透明边缘有效。
- 静态检查确认 Prefab/Scene 均保留 `cmd6/强制秀牌/看剩余牌` 节点及原 SpriteFrame UUID。
- `python3 docs/memory/check_memory.py check --root "/Volumes/SSD/qing"`：0 个错误；已有文档超预算警告未因本次内容产生。

## 待验证

- 未执行 Creator 导入、网页预览、正式构建、真机或在线验收。
