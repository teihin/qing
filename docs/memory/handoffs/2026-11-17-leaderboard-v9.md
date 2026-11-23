# 2026-11-17 排行榜 V9 三榜统一视觉

目录 /Volumes/SSD/qing，分支 codex/club-ui。

## 目标

按用户确认的三榜概念稿实施排行榜视觉，覆盖玩家手数榜、玩家赢分榜、代理红利榜。手数榜继续保留 1皮、2皮、5皮、10皮、20皮筛选，列表继续使用无限滚动。

## 当前实现

- assets/resources/Prefabs/排行榜.prefab 和 assets/resources/Prefabs/排行榜对象.prefab 已接入 V9 表格底框、独立排行行卡片、圆形头像和当前 BF 盾牌。
- 新增 assets/V7/leaderboard_v9_row.png、leaderboard_v9_table.png、leaderboard_v9_avatar_ring.png 及对应 .meta；顶部复用正式 `leaderboard_v8_shield.png` 的 BF 标志。行卡片使用深蓝玻璃渐变、青蓝描边和顶部高光，表格底框增加内侧光，头像使用金色圆环。
- 三个榜单的正式 content 各保留 6 行编辑器示例，直接显示奖牌、头像、昵称、ID、指标和奖励；运行时 clearPage 会停用这些示例，renderPage 按序复用同一批节点。真实头像通过现有 ImageManager.BindPlayerListAvatar 按玩家 ID 查询。
- 顶部改为 BF 盾牌、开始时间、截止时间、放大的我的排名和当前奖励；编辑器示例隐藏领取按钮避免与放大后的奖励重叠，运行时仍按原大厅奖励条件显示。手数榜默认选中 1皮。
- 用户确认 V21 后，三榜 Tab 改为直接切用 `art_sources/v8-repairs/leaderboard/reference-tabs-v1.png` 中的成品字图和按钮像素，不再用系统字体重绘；顶部三枚 Tab 统一 220x64。随后用户确认图片技能生成的 1皮/2皮/5皮/10皮/20皮选中与未选中完整按钮，正式资源已替换为 `art_sources/v8-repairs/leaderboard/filter-imagegen-text-v2/` 下的 10 张 132x54 PNG，图片内含清晰中文美术字、黑白描边和蓝金光影；Prefab 中原有过滤 Label 保持隐藏，避免重复叠字。三榜内容、奖励字段和服务端协议仍保持原绑定。
- 行 Layout 增加 5 逻辑像素间距和上下留白，分页节点仍保持停用。
- tools/apply_v9_leaderboard.py 保存生成资源和正式 Prefab 的编辑器迁移逻辑。

## 已验证

- python3 -m py_compile tools/apply_v9_leaderboard.py 通过；脚本已增加图片技能生成按钮的稳定来源和尺寸断言，重跑不会回退到旧文字裁切。
- 10 张 imagegen 过滤按钮已逐一核对正式资源与稳定来源 SHA-256 一致，均为 132x54 RGBA；正式 Prefab 五档按钮尺寸均为 132x54，默认 1皮 checkmark 激活，其余四档关闭。
- V9 PNG 四角透明、meta UUID、Prefab SpriteFrame 引用和三榜表格引用检查通过。
- Prefab 中隐藏行模板与独立行 Prefab 均启用 V9 行 Sprite，三榜表格均引用 V9 表格 SpriteFrame；三榜 content 各有 6 个序列化示例行，1皮 Toggle 为选中态；三榜/皮肤 Tab 的 direct-cut SpriteFrame UUID、统一高度、嵌入式文字和默认选择检查通过。
- `tools/render_ui_prefab.py` 之前已按 1334 和 1624 高度重新渲染；本次图片资源替换后尚未重新启动 Creator 做两档实际渲染，当前已完成正式 Prefab/资源静态核对。

## 待验证

- 旧 tools/validate_v8_leaderboard.py 仍引用不存在的 assets/resources/V7 路径，不能作为本次验证结果。
- 旧 tools/tests/leaderboard_v8_regression.js 的夹具默认按大厅榜初始化，且用正向 ScrollView 最大偏移模拟滚动。当前客户端默认走俱乐部榜，生产实现使用负向偏移，因此该脚本未作为本次 V9 通过证据。
- 本次直接运行该回归脚本仍先因夹具没有提供 cc.log 中断，未作为运行通过证据。
- Creator 重新导入后的编辑器实际显示、网页实际滚动、构建和真机仍待验证。

## 2026-11-23 排行榜头像改批量查询

- 现象：`PaiHangScrollItem.Refresh` 每行都走 `ImageManager.BindPlayerListAvatar`，一行一条 `查询_用户_头像`。榜单无限滚动几百行时请求被打爆，客户端头像查询卡死。
- 改动：`ImageManager` 新增 `BindBatchListAvatar`（去抖 50ms 合并、单次 100 个分片、串行发送、5s 超时兜底、回包按 id 回填 `mapID2ImageSave`），走服务端 `查询_用户_头像_批量`（见 `服务器文档整理/用户头像查询-客户端接口文档.md`）。`PaiHangScrollItem` 改调该方法。
- 未动：`AddWaitFreshImage2Catch` 仍是原来的单查（房间座位、成员列表、战绩等入口全部不变）；`OnAccountList` 只是把写入逻辑抽成 `ApplyAvatarValue`，行为一致。
- 降级：批量连续失败 2 次判定服务端未部署该接口，本次会话退回逐条单查（等同改前行为）。
- 已验证（本地 Node 桩跑真实组件）：250 行 → 3 次请求（100/100/50）且 250 个 Sprite 全部回填；已缓存行重复绑定 0 请求；单查入口仍即时发 1 条；连续失败→退避重试→逐条单查；完全无回包时超时收尾不卡死，重新绑定可再查。
- 待验证：测试服实机（`查询_用户_头像_批量` 是否已部署生效）、Creator 内运行、网页版排行榜实际滚动、真机。
