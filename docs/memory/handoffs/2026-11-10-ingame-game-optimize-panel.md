# 牌桌内「牌局优化」面板（运维优化页）

- 目录/分支：`/Volumes/SSD/qing`，`codex/club-ui`；未提交、未构建、未真机。
- 目标：电量连点 3 下（BOSS）打开全屏牌局优化；首个页签「运维优化」＝上方设置个人/分组优化，下面列表看已配置记录与达成情况。

## 改动文件

- 新增 `assets/scripts/UI/panelGameOptimize.ts` + `.ts.meta`（uuid `8e4c1f2a-7b6d-4c58-9a31-6f0d2e5b8c74`）。
- 新增 `assets/resources/UI/panelGameOptimize.prefab` + `.prefab.meta`（uuid `c2f5a91e-3d47-4b82-8e60-1a9c7b4d2f35`），由 `tools/apply_ingame_optimize_panel.py` 生成；贴图全部复用 V8 正式资源。
- 新增通用选择弹窗 `assets/scripts/UI/panelPlayerPicker.ts` + `.ts.meta`（uuid `a7d3e5c9-2b48-4f16-9c7a-5e1d8b3a6f02`）与 `assets/resources/UI/panelPlayerPicker.prefab` + `.meta`（uuid `d9b4f6a2-8c31-4e75-b0d2-7a6c1e9f4b58`），由 `tools/apply_player_picker_prefab.py` 生成；`panelGameOptimize` 已不再内嵌弹窗。
- `assets/scripts/UI/panelGameView.ts`：`BK/电量` 连点计数（800ms 内 3 次）＋ `GameDataManager.IsBossAccount()` 门禁，`showPanel("panelGameOptimize", Cover)`。

## 接口（按 `服务器文档整理/胜率目标控制-客户端与后台接口文档.md`）

- 设置：`异步_设置_胜率目标`，个人传 `guuids`，分组传 `club_id + group_id`；`target_value` 正=赢/负=输，`chance` 1~100，remark 固定「牌桌内运维优化」。
- 列表：`异步_查询_胜率目标_列表`，不传 guuids/scope（看全部），`state` 由筛选决定（空=全部 / active / done / stopped）；每 10 秒轮询，无推送。
- 历史页签：**默认就是历史列表**，第一次及轮询查询都带 `history=1` + `count=20` + `page`（0 起）；点「历史」切回当前目标（当前目标查询不带 history）。`id` 作为列表行 key；`state` 仍按单个状态筛选，服务端不支持多值；`state=''` 会包含历史表里仍未结束的 `active`，只看已结束就点「已达成」/「已停止」。
- **不重试设置/停止**：客户端只在超时后提示刷新，不会自动重发；同一 context 重复设置会被服务端重复执行（会产生覆盖/历史多一条）。
- 停止：`异步_停止_胜率目标`，行内按钮传单个 `guuids`。
- 分组下拉：`查询_俱乐部_分组列表` → 推送 `ClubPlayerGroupList`；club_id 取房间 club_id，缺失时取本人俱乐部。
- 鉴权：服务端只认 `d_users.config["account"]["boss"]` 且 `game_mode='club'`；客户端用现有 `IsBossAccount()` 决定入口，服务端仍会拒绝非名单账号。

## 行为与口径

- 个人支持「本房在座玩家」列表 + **手动输入数字玩家 ID**（`/^\d{1,20}$/`，不校验玩家是否存在，以服务端/牌局生效为准）；分组用于跨房/离线成员批量生成。
- 通用弹窗调用：`panelPlayerPicker.Open({title:"选择玩家", mode:"player", presetId, onPick})` 或 `{mode:"group", clubId, onPick}`；选择后先关闭弹窗再回调，调用方面板不受影响。
- 输入框占位文字统一调暗：颜色 `(78,98,118)`、节点 opacity 145、字号 18；实际输入仍是 `(231,240,246)` / 22，避免用户把占位符当成已输入内容。
- 行状态：active=进行中（在线且 `cur_count>0` 显示已生效）、done=已达成、stopped=未达成；进度文字带 `remain`、局数、完成原因与完成时间。
- 历史模式下状态筛选仍可用（单状态查询）；「历史」再点一次回到当前目标；历史列表底部有上一页/下一页和总数，当前目标列表不显示分页。
- 列表筛选切到历史后，设置成功会自动回到「全部」，避免新目标看不见。
- 长屏：设置区贴顶固定，列表区 top+bottom 拉伸；筛选条与滚动区自带 Widget；列表 content 在渲染时按 view 高度把顶边贴回顶部。

## 验证

- `ts.transpileModule`：新面板、`panelGameView` 均 0 诊断；临时 `tsc` 类型检查新文件 0 错误（仓库其它模块有大量既有 Vec2/Vec3 报错，未处理）。
- prefab 静态校验：两个 prefab 的节点引用全部有效、脚本压缩 uuid 与 `.ts.meta` 一致，脚本用到的节点路径全部存在。
- 离屏渲染 750×1334 / 750×1624 + 选择弹窗两种模式：设置区/筛选条/列表/手动 ID 行/行内文字不压叠；长屏列表顶边由运行时代码纠正。
- **未做**：Creator 导入、构建/热更、真机点击电量、BOSS 账号实操设置/停止/分组、服务端真实回包验收（文档标注服务端“未上传测试服/未建表”，用户称已支持，需实测确认）。

## 下一步

1. Creator 首次导入新 prefab（确认脚本组件与贴图都能识别），构建后真机用 boss 名单账号连点电量 3 次。
2. 实测个人设置、分组设置（先打开分组下拉触发缓存加载）、停止、10 秒轮询、无权限/俱乐部模式关闭时的错误提示。
3. 如需支持“手动输入离线玩家 ID”，把个人选择弹窗增加 ID 输入即可；当前按文档限制在本房在座玩家。

## 2026-11-10 修正：电量位置被隐形「完成」热区占据

- 现象：连点电池实际发送 `关闭检查_命令`，面板不弹。
- 根因：`panelGameView.prefab` 的 `RoomFrame/完成` 是无贴图隐形 Button，`left=140 / top=15`、尺寸 100×72，正好覆盖 `BK/电量`（屏幕约 131~187）；`RoomFrame` 在 `BK` 之后渲染，触摸被它吃掉。原逻辑点它发送 `关闭检查_命令`。
- 修正：`onButtonClick` 顶部拦下 `完成`，改为 `OnBossBatteryTap()`：
  - BOSS：800ms 内 3 次 → 打开 `panelGameOptimize`，不发关闭检查；单/双击 → 延迟 900ms 补发一次 `关闭检查_命令`，避免三连击时先打出去两条。
  - 非 BOSS：保持原来的即时 `关闭检查_命令`。
  - 电量节点自身的触摸监听保留为兜底（若以后移走/隐藏该隐形按钮）。
- 已加日志：`电量三连击打开牌局优化 level=… role=…` / `电量三连击：非BOSS账号 level=… role=…`，便于确认账号是否通过客户端 BOSS 口径。
- 仍需 Creator 重新导入/构建；若日志已打印但窗口没出现，查 `UI/panelGameOptimize` 资源加载报错。
