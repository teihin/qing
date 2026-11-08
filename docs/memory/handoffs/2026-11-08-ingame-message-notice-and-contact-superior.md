# 牌桌「联系上级」改名 + 局内消息红点/提示音

日期：2026-11-08
目录/分支：`/Volumes/SSD/qing`，当前分支按工作区实际（未提交、未推送）

## 需求

1. 牌局内左上角菜单里的「联系客服」改为「联系上级」。
2. 局内收到任何账号发来的消息都要正常接收 + 声音提醒；左上角设置按钮与「联系上级」入口亮红点；看消息后红点自动消失。原来局内收不到提醒。

## 根因

`Tool.ts` 注释与实现都写明：大厅 `panelMain` 与牌桌 `panelGameView` 互斥，进桌走 `showPanel(CloseOther)` 会把 `panelMain` **销毁**。直聊的未读红点与提示音监听原本只挂在 `panelMain.onEnable → SetupDirectChatEntry` 里，`onDestroy` 又把它们 `Off` 掉，所以进桌后 `DirectChatManager` 的长连接还在（它是单例），但**没有任何订阅者**：没有声音、没有红点。

服务端不成问题：`ChatTool` 的 `sendMessageAndPublish` 对每条非重复消息都向接收方 guuid 推 `message.new`，客户端 `HandleRealtimeMessage` 也无发送方过滤。

## 改动

### 脚本 `assets/scripts/UI/panelGameView.ts`

- 新增 import `DirectChatManager`。
- 新增 `SetupDirectChatNotice()`：`on("unread")` → 红点；`on("realtimeMessage")` → `this.PlayAudio("eff/申请提示")`；`StartRealtime()`；进桌补一次 `LoadUnread()`（离线期间的消息也能亮）。
- 新增 `RefreshDirectChatEntryDot(total)`：`RoomFrame/ConfigBT/红点` 与 `ConfigMain/联系上级/红点` 同开同关。
- `onLoad` 末尾调用 `SetupDirectChatNotice()`；新增 `onDestroy()` 注销两个监听后 `super.onDestroy()`。
- `onButtonClick` 分支：`"联系上级" || "联系客服"`（旧名兼容，避免只更脚本时点不动）。

### Prefab / Scene

- `assets/Scenes/drh8.fire`（panelGameView 运行时用的是这份序列化副本）与 `assets/resources/UI/panelGameView.prefab` 同步改动：
  - `联系客服` 节点与 `联系客服<Sprite>` 组件改名 `联系上级`（两边 PrefabInfo.fileId 一致：`RKm8LPfb20260813J0k1L2`）。
  - 新增 `红点` 子节点 ×2：`RoomFrame/ConfigBT/红点`（(23,23)）、`ConfigMain/联系上级/红点`（(84,44)）；`cc.Label "●"`、fontSize 30、色 (246,73,72)、默认 `_active:false`、无 Button；fileId `RKm8LDot20260813CfgBT1` / `RKm8LDot20260813MsgBT1`。
  - 新对象一律追加在数组末尾（既有 `__id__` 全不变），只改两处 `_children`。

### 贴图 `assets/V7/ingame_menu_v8_service.png`（uuid 未变）

- 在原图上重建文字带底板（左右边缘逐行线性插值），只替换文字，图标/边框/底板其余像素未动。
- 字：STHeiti Medium 34（与原图 `联系客服` 的墨迹框 133×32 对齐后取 132×32，IoU 0.70 为候选字体里最高）；填充上暖白 (250,248,242)→下淡金 (250,231,180)；外扩 2px 模糊深蓝 (0,32,66) 作描边/投影。
- 校验：275×157 一致、alpha 逐像素相同、48,152B < 原 52,891B、改动仅落在 x55–220 / y93–140、`.meta` 未改；Creator 重导后 `library/imports/f8/<uuid>.png` 与源 md5 一致。

## 验证

- `ts.transpileModule` 定向语法检查：0 诊断。
- Scene/Prefab：`json.loads` 通过、无越界 `__id__`、新节点父子关系正确；Creator 已导入（`library/imports/{b1,1c}/…` mtime 与内容均含新节点）。
- 未做：Creator 构建、网页/真机实点、真实消息收发联调。

## 未完成 / 待定

- 按钮图标仍是客服耳机；若「联系上级」需要换成人物/上级图标，需另出图（AI 生成中文美术字易缺笔画，本次文字走同款字重渲染）。
- 局内红点只看直聊未读总数；若后续要区分「哪个上级发来的」需要再扩数据结构。
