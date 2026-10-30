# 2026-10-30 俱乐部暂不允许退出/踢人（按钮隐藏）

## 目标与范围

- 目录：`/Volumes/SSD/qing`；分支：`codex/club-ui`；Creator 2.4.13。
- 用户要求：俱乐部玩家设置弹窗里的「玩家设置踢出俱乐部」、以及「我的 → 当前俱乐部」底部「退出俱乐部」按钮都隐藏；目前不允许玩家退出俱乐部。
- 只改客户端显示与入口；服务端 `申请_退出_俱乐部` / `删除_俱乐部_玩家` 未动。

## 基线

- 两个按钮在 Prefab 中本来就是 `_active: false`，运行时由脚本重新点亮：
  - `操作/管理退出`（Label「退出俱乐部」）：非老板可见。
  - `玩家设置踢出俱乐部`：`canKick`（老板/管理员/代理直属）可见。
- 退出唯一入口是「管理退出」→ `confirm("leave")`，没有其他脚本直接发退出命令。

## 改动与来源

- `assets/scripts/UI/ClubManagementView.ts:183`：「操作/管理退出」固定 `active=false`。
- `assets/scripts/UI/ClubManagementView.ts:578`：「玩家设置踢出俱乐部」固定 `active=false`，按钮同时 `interactable=false`；删除随之不再使用的 `canKick`。
- Prefab 节点保留（`panelMain.prefab` 中 `管理退出`、`玩家设置踢出俱乐部`），点的处理与 `leave`/`remove` 分支也保留，后续恢复只需改回激活条件。
- 同时对齐了「成员设置底」与「下级成员底」尺寸/坐标（640×700、0,-150），切换页签不再露边。

## 验证

- 静态核对：脚本改动与 Prefab 节点状态、调用点一致；未运行 Creator 编译或点击验证。

## 下一步

- Creator 重新编译 `ClubManagementView.ts` 并核对 `temp/quick-scripts` 产物，预览「我的」页与玩家设置弹窗确认两个按钮都不出现。
- 若以后放开退出，需同时恢复按钮激活条件，并确认服务端审核口径。
