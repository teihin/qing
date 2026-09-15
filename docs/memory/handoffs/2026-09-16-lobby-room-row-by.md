# 大厅房间行改版（BY 卡面 + 独立图标 + 剩余时间，2026-09-16）

- 目录/分支：`/Volumes/SSD/qing`，`main`；本轮改动未提交。
- 目标：大厅→发现→房间列表每行改为「筹码图标+底皮值 / 时钟+时长 / 人数图标+人数 / 剩余时间 12:12」；卡面重绘成只含 LOGO 的干净底框，图标独立成资源；游戏标识 `8L` 改 `BY`。

## 结果

- 卡面：`assets/V7/room_card_exact.png` 由生成稿直接缩放（不抠图），1426×260（= 712.77×130 的 2 倍），四角透明；UUID `ed881d3b…` 与 Prefab 引用未变。生成稿 `gen/card_by.png`（4928×896），文字 `BY`/`BL POKER`/`POKER GAME` 已放大逐字核对正确。
- 图标：`assets/V7/room_icon_chip.png`、`room_icon_clock.png`、`room_icon_player.png`（128²，白底去背 + 亮度校正，第二版重生成并放大笔画），`.meta` 用 uuid5 生成。行内节点复用模板已有的 `img` / `img copy`×2（30→36pt）：新建节点在编辑器里不渲染，已废弃该做法并清理。
- Prefab：`assets/resources/UI/panelMain.prefab` 房间行模板 `房间对象` 内新增 `筹码图标 / 时钟图标 / 人数图标` 三个 Sprite 节点（复用 `img` 节点结构克隆），四个数字 Label（`底皮 / 时间 / 人数 / 倒计时`）改为左对齐、字号 24、同排 y=-33。脚本 `tools/apply_by_room_item_layout.py`。
- 脚本：`assets/scripts/common/ScrollItem.ts` 改为 `底皮`←`jRoom[5]`（剥「底皮/局数」前缀得到 1/3）、`时间`←`jRoom[6]`、`人数`←`jRoom[3]/[4]`、`倒计时`←`"剩余时间 "+jRoom[2]`（旧版 8L 语义，见 2026-08-12 前的 `remark = jRoom[2]`）。
- 预览：`art_sources/v8-repairs/lobby-room-card-2/gen/mock_row.png`（按 Prefab 坐标合成）、`assets_preview.png`。

## 未完成/未验证

- 未在 Creator 内重新导入确认（新 PNG 尺寸与三个新 `.meta` 需切回 Creator 触发导入）。
- 未构建、未出热更包、未真机；`剩余时间` 取值按历史压缩数组下标 2，线上真实回包未联调。
- 旧静态层 `V8静态信息`（`room_static_exact`）保持关闭未删除；`img / img copy / 大图标 / 地九王` 仍为未激活的历史节点。
- 上一版「搬移烤字元素」的做法已作废，`tools/build_v8_lobby_room_card_layout.py` 仅作历史记录，不再执行。
