# 牌桌带入积分 V10 视觉修订交接

日期：2026-11-11
目录：`/Volumes/SSD/qing`
分支：`codex/club-ui`
状态：已写入客户端 Prefab/Scene 与脚本，未构建、未真机、未做真实服务端回包验收

## 目标

按用户最新效果图统一牌桌带入积分弹窗的视觉和间距：深蓝渐变、亮蓝发光边框、干净的顶部标题抠图、放大居中的当前带入数字、实时扣钻行、`带入积分 / 背包积分` 两行、钻石余额行和参考图按钮光影。

## 改动

- `assets/V7/buyin_v9_panel.png`、`buyin_v9_title.png`、`buyin_v9_stone_cost.png`、`buyin_v9_cancel.png`、`buyin_v9_confirm.png` 及 `.meta`：按本轮效果图制作面板、标题、扣钻胶囊和按钮素材；标题使用透明轮廓，消除矩形底。
- `assets/V7/buyin_v10_minimum.png`、`buyin_v10_maximum.png`、`buyin_v10_carry_label.png`、`buyin_v10_bag_label.png` 及 `.meta`：从参考图提取透明美术字，替换底板内的平面标签。
- `assets/resources/UI/panelGameView.prefab` 与 `assets/Scenes/drh8.fire`：同步写入同一套带入窗口节点、坐标、资源引用、动态标签、实时扣钻行和钻石余额图标；移除编辑图标，最高金额列左移留出大位数边界，按钮仍保留原 Button 事件，节点均保留/补有 Widget。
- `assets/scripts/common/BuyinDisplay.ts`：新增扣钻行引用和积分→钻石比例，滑杆变化时实时更新 `落座钻石`；关闭「入座扣钻」时同时隐藏扣钻行和余额行。
- `assets/scripts/UI/panelGameView.ts`：读取 `ConfigManager.GetClubSeatStoneRatio()` 传入显示组件；带入协议、余额、滑杆和确认逻辑未改。

## 验证

- `BuyinDisplay.ts`、`panelGameView.ts` TypeScript `transpileModule` 无诊断。
- 自定义 BuyinDisplay 回归通过：500 积分按 0.1 比例显示 50 钻，滑到 8000 显示 800，关闭开关后两行均隐藏。
- Prefab/Scene 动态组件引用、资源引用和新增节点 Widget 静态检查通过。
- `tools/render_ui_prefab.py` 离屏预览已核对 750×1334、750×1624 两档，标题无矩形底，编辑图标已移除，最高金额大位数在框内，最低/最高值固定列对齐，四处标签使用美术字，按钮和扣钻行对齐。
- 仓库原 `tools/tests/buyin_v8_regression.js` 直接执行会先遇到既有测试桩缺少 `cc.isValid`；补齐测试桩后业务断言通过，但其旧 before 快照与当前工作区已有的 panelGameView 序列化基线不一致，不能作为本轮资源完整回归证据。

## 待验证

- 用 Cocos Creator 2.4.13 导入 Prefab 和 `drh8` 场景，确认外部资源导入、场景实例显示和 Widget 在编辑器中可见。
- Creator 构建、真实账号开关关闭/开启、不同积分比例、滑杆实时扣钻数量、确认带入、取消预坐和真实服务端回包。
- 1334/1624 真机截图与新 APK/IPA 验收。
