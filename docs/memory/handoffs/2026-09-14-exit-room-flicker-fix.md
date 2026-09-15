# 2026-09-14 退出房间闪烁修复

- 工作目录 `/Volumes/SSD/qing`，分支 `main`；进入时工作树干净，本轮没有提交或推送，改动保留为未提交修改。
- 现象：安卓真机（192.168.3.110）退出房间后画面持续闪烁，日志刷屏。
- 诊断方式：连接生成包里 `jsb_enable_debugger("0.0.0.0", 9527)` 暴露的 V8 Inspector，用 CDP 抓 `Runtime.consoleAPICalled`、`Runtime.exceptionThrown`、运行时脚本源码与调用栈；未改游戏业务逻辑。

## 证据

- 场景销毁/切换被每帧重复执行：15 秒内 `cc.director.runSceneImmediate` 调用 910 次（约 60fps），而 `console.time("LoadScene login")` 全程只调用 1 次，即**一次** `loadScene("login")` 的完成回调被逐帧重复触发。
- `Error 5000 object already destroyed`（`CCObject._destroyImmediate`，引擎 `cocos2d/core/platform/CCObject.js:492`）约 2500 次/秒。
- 唯一业务异常：`Cannot read property 'off' of null`，栈顶 `t.onDestroy@assets/main/index.jsc:16828`；取运行时源码比对，该行即 `assets/scripts/common/BuyinDisplay.ts` 的 `onDestroy()` 中的 `this.slider.node.off('slide', this.onSlide, this)`。

## 成因

- 引擎 `Node._onPreDestroy` 先销毁子节点、再销毁本节点组件（`cocos2d/core/utils/base-node.js:1245-1257`）。`BuyinDisplay` 挂在 `panelGameView` 的 `带入窗口` 节点上，其滑杆子节点先被销毁，子节点组件在 `_destruct` 后 `slider.node` 已为 null。
- 之后才执行 `BuyinDisplay.onDestroy`，未判空即访问 `this.slider.node`，抛出 TypeError。异常中断引擎的销毁-切场景链路，旧场景处于半销毁状态，切换反复重试，表现为刷屏与画面闪烁。
- 活体验证：运行时仅给 `BuyinDisplay.prototype.onDestroy` 打判空补丁，15 秒内 `Error 5000` 由 15313 次/6 秒降到 1 次，`LoadScene` 刷屏归零，闪烁停止。

## 改动

- `assets/scripts/common/BuyinDisplay.ts`：`onLoad` / `onDestroy` 中的滑杆事件绑定与解绑增加 `this.slider != null && cc.isValid(this.slider.node)` 保护；未改业务数值与显示逻辑。
- 项目内其它 `.off(` 解绑点（`panelKefu`、`scrollview2`、`RoomInviteManager`）已有保护或使用组件自身 `node`，本次未发现同类问题，未改动。
- 未改动 `panelGameView.ts` 中两处 `Tool.GetChild(this.node,"带入窗口").getComponent(BuyinDisplay)` 调用（点击与刷新流程，非销毁路径）。

## 未完成 / 待验证

- 未构建、未生成热更新包、未上传、未发布；真机需重新构建或热更新后才能验证源码修复（当前设备上的生效补丁只是调试期运行时补丁，重启游戏即失效）。
- 未验证其它退出房间路径（排队退房、邀请退房、结算退房）是否还有独立异常。
