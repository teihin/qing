# 2026-11-05 牌桌客服改开消息页 + 半透明浮层

## 目录 / 分支

- 项目根：`/Volumes/SSD/qing`
- 分支：`codex/club-ui`
- 基线：`6b9120b`（工作区含其他任务未提交修改，本次只改下列文件）

## 目标

1. 牌桌菜单「联系客服」不再打开网页客服 `panelKefu`，改为打开大厅同一个消息页 `panelMessage`（含直属代理/群主的固定入口），可直接收发、回复。
2. 牌桌内打开消息列表和会话详情时背景半透明，能看到牌桌仍在进行；大厅入口外观保持不变。

## 改动文件

- `assets/scripts/UI/panelGameView.ts`
  - 「联系客服」改为 `showPanel("panelMessage", Cover, "", ["游戏内"])`。
- `assets/scripts/UI/panelMessage.ts`
  - `start()` 先执行 `ApplyEntryStyle()`：`arrayEx[0]=="游戏内"` 时隐藏实心「背景」、显示「游戏内遮罩」和「返回」，并把「标题」居中（Widget `left=(父宽-230)/2`，避开左上返回键）；大厅分页不传标记，行为不变。
  - `OpenChat()` 两个分支把 `["游戏内"]` 继续传给 `panelMessageChat`。
  - 返回键沿用已有 `onButtonClick` 的 `关闭/返回` 分支，`closePanelByName` 关闭浮层。
- `assets/scripts/UI/panelMessageChat.ts`
  - `start()` 先执行 `ApplyEntryStyle()`：同样的 `游戏内` 标记下隐藏实心「背景」、显示「游戏内遮罩」；大厅（`ClubManagementView`、`panelMessageMembers`）进入时保持原样。游戏内再调用 `HideIngameList()` 隐藏同层 `panelMessage`，只留会话一层。
  - `onDestroy()` 调用 `RestoreIngameList()` 重新显示同层列表（返回/删除/被关闭都会回到列表）。
- `assets/resources/UI/panelMessage.prefab`
  - 新增默认隐藏的 `游戏内遮罩`（全屏 750×1334，内置白图染 `(0,8,18)`、`opacity=120`，约 0.47 深色）与 `返回`（77×66，`ImagesLuck/聊天/返回箭头.png`，左上 Widget，默认隐藏）。
- `assets/resources/UI/panelMessageChat.prefab`
  - 新增同样默认隐藏的 `游戏内遮罩`；原有 `背景`、`返回` 不变。

## 关键口径

- 半透明只由遮罩提供：牌桌内隐藏大厅的实心美术背景，改用 0.47 深色遮罩，牌桌进程更清楚；列表与会话始终只显示一层。
- 模式判定沿用 `panelKefu` 的 `arrayEx[0]=="游戏内"` 约定，不新增全局状态。
- `panelMessage` 在大厅是 `panelMain/Main/消息` 常驻分页；牌桌内是 UIManager `Cover` 新实例，关闭即销毁，不影响大厅缓存页。
- 直聊长连接和大厅红点仍由 `DirectChatManager` 全局维护；牌桌内收发不依赖大厅页面存活。
- 未改服务端协议、消息接口、房间或结算逻辑。

## 验证

- 已做：两个 Prefab JSON 解析、父子/组件/`__id__` 引用、`fileId` 唯一性检查通过；用 `ChatTool/web` 的 tsc 全工程 `--noEmit`，`assets/scripts/**` 无类型错误；代码 diff 复核。
- 待验证：Creator 导入 Prefab 后在编辑器中确认新节点；网页/真机实际点击「联系客服」→ 列表半透明 → 进入会话 → 发送/回复 → 返回；不同屏幕高度下的遮罩与标题居中；`panelMessage` 在大厅的外观无回归。
