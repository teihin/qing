# 牌桌内「牌局优化」列表加「只看当前房间」勾选

- 目录/分支：`/Volumes/SSD/qing`，`codex/club-ui`；**未提交、未构建、未热更、未真机**。
- 目标：牌局优化面板列表区加一个勾选项，勾上后列表查询把当前房间号传进 `异步_查询_胜率目标_列表`（`room_id`），默认不勾。

## 口径（按 `服务器文档整理/胜率目标控制-客户端与后台接口文档.md` §3.1 / §7.6）

- `room_id > 0` 时服务端按**查询时实时所在房间**（`account.roomID` → 服务端 `cur_room_id`）过滤，不是目标设置时的房间快照。
- `room_id > 0` 且 `state` 为空时服务端按 `active` 处理；因此勾选时客户端把状态筛选同步切到「进行中」，勾着时点「全部」只提示不改 chip。
- `history=1` 历史表没有房间列，服务端会拒绝 `room_id`；切到「历史」时自动取消勾选并提示。
- 房间号取 `GameDataManager.getAccount().roomID`，取不到（不在房/离线）拒绝勾选。

## 改动文件

- `assets/resources/UI/panelGameOptimize.prefab`：`列表区` 下新增 `筛选_当前房间`（cc.Toggle + cc.Widget，top=60 / left=12，300×32），子节点 `Background`（`room_invite_approved_checkbox_ring.png`）+ `checkmark`（`room_invite_approved_checkmark.png`，默认 `active=false`）+ `文字`（左对齐，20 号，`(169,192,214)`）；`列表` 的 Widget `_top` 60 → **100**（让出一行）。其余节点未动，`.meta`/UUID 未变。
- `assets/scripts/UI/panelGameOptimize.ts`：新增 `roomOnly / roomToggle / roomSyncing`；`onToggleClick` 覆写接 `筛选_当前房间`（Toggle 由 `UIViewBase.onButtonClickVirtual` 统一注册，不重复挂 click）；`ApplyRoomOnly`、`SetRoomToggle`、`CurrentRoomId`、`RefreshRoomLabel`；`QueryList` 里 `roomOnly && !historyMode` 时带 `param.room_id`；`SetFilter` 拦截 roomOnly 下的「全部」；`SetHistoryMode` 进历史时取消勾选；空状态文案补「本房当前没有进行中的目标」。
- `服务器文档整理/胜率目标控制-客户端与后台接口文档.md`：§7 增第 6 条 + 变更记录一行。

## 验证

- `ts.transpileModule` 0 诊断；prefab `__id__` 引用全部有效、`PrefabInfo` 95 个 fileId 唯一；`git diff` 只有新增（唯一删除行是 `列表` 的 `"_top": 60`）。
- Creator 2.4.13 已在跑，20:28 自动重导入（`library/imports/c2/c2f5a91e….json` 207KB → 217KB，含 `筛选_当前房间`）。
- 离屏渲染（`tools/render_drh8_scene_preview.PreviewRenderer`，750×1334，把根节点临时挪到画布中心）：筛选 chip 行与勾选行、勾选态（金圈 + 金勾 + `只看当前房间 · 1795609381`）均无压叠/截断，列表区让出 40px 后仍有 5 行以上可视。
- **未做**：Creator 界面点测、构建/热更、真机勾选后看服务端回包。

## 注意

- **Toggle 的 `checkMark` 必须引用 `cc.Sprite` 组件，不是节点**：引擎 `_updateCheckMark` 执行 `this.checkMark.node.active = isChecked`，指成 `cc.Node` 后一点就抛
  `Uncaught TypeError: Cannot set properties of undefined (setting 'active')`（`CCToggle.js:194`，20:32 实测报错，已修正为 `<checkmark 节点>/cc.Sprite` 的 id）。`_N$target` 才是 Node。
- `tools/apply_ingame_optimize_panel.py` 是当初生成这个 prefab 的脚本，早已落后于手工改动（后续两次提交都直接改了 prefab）；**不要再直接重跑它**，会冲掉本次勾选项和之前的改版。
- 勾选项贴图复用 V7 `room_invite_approved_*`（金圈对勾），与面板金色描边一致；没有新增 PNG。
