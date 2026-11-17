# 2026-11-16 牌桌芒果分类单状态客户端接入

- 目录/分支：`/Volumes/SSD/qing`，`codex/club-ui`，未提交
- 依据：`服务器文档整理/芒果分类显示-客户端接口文档.md` 最新单状态版本

## 改动

- `DrhPlayerInfo` 增加 `mang_show_state`，状态 0/1/2 分别映射圈芒/休芒/揍芒。
- `DrhPlayerLogic` 按状态只更新一行名称、次数和金额；圈芒固定显示 `x1`，金额直接取服务端字段。
- 皮池独立读取 `mang_pi_hand_amount`（每手皮池 = 底注 `di_times` × 在座人数），新协议下始终显示；该字段缺失时回退 `mang_pi_times`（累计池），旧协议继续走原底分行逻辑。
- 2026-11-17 九次实施后休芒/揍芒展示金额改读 `mang_show_xiu_total_amount` / `mang_show_zou_total_amount`（= 首手圈芒基数 + 实际累计）；`mang_show_xiu_amount` / `mang_show_zou_amount` 是实际累计扣款，仅对账用、不显示。两个 total 字段缺失时回退对应 `*_amount`，兼容九次实施前的服务端。
- `mang_show_xiu_count` / `mang_show_zou_count` 语义改为**倍率等级**（圈 x1、首休/首揍 x2、后续 x3/x4），客户端仍按 `x` + 数值显示，无需换算。
- 新协议字段缺失按 0 处理；缺少 `mang_show_state` 时清空新状态并回退旧合并芒果行。
- 结合运行日志核对后，将正式 Prefab/Scene 的芒果名称默认 SpriteFrame 和脚本缓存初值改为圈芒，避免状态 0 到达前先显示旧的休芒默认图。
- 修复运行时分类名称切换：三张 `圈芒/休芒/揍芒_100x60` SpriteFrame 直接序列化到两份正式 UI 的 8 个 `DrhPlayerLogic` 组件，避免从 `assets/V7` 目录用 `loadRes` 失败后残留圈芒；结算消息不刷新公共芒果行，等下一局 `当前_玩家_消息` 再按新状态更新。
- 牌桌的芒果分类行和皮池行属于公共节点，使用“本地账号优先、未入座时第一个有效座位回退”的公共显示源，避免其他座位的 `当前_玩家_消息` 互相覆盖状态、名称或皮池金额；而皮池金额用 `mang_pi_hand_amount`。
- 保留现有 `圈芒_100x60`、`休芒_100x60`、`揍芒_100x60`、`皮池_100x60` 美术资源和现有节点结构。

## 验证边界

- 已完成源代码契约断言、资源存在性、两份 Prefab/Scene 的 8×3 SpriteFrame 引用、JSON 引用解析和代码范围 `git diff --check`。
- 按用户要求未执行客户端编译、Creator 构建、真机和真实房间联调。
