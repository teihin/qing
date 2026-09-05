# 钱包充值通道默认选中与美术一致性

日期：2026-09-05；工作目录 `/Volumes/SSD/qing`；分支 `main`。本任务保留了进入时其他 UI 的未提交修改，没有提交或推送。

## 目标与原因

用户反馈首次进入充值页看不到默认通道选中状态，选中和未选中图标不搭配。

- 原初始化依赖 `isChecked` 的隐式事件，并在显示容器后逐个显隐与选择通道。已有选中值未变时可能不发事件，旧 `checkmark.active` 状态也没有校准。
- 正式钱包 Prefab 的四个 `payment*Icon` 仍引用旧版图；后台图标配置只替换 `Background`，原选中层却是一张带固定图案与文字的完整卡片，所以两种状态会显示不同风格甚至不同支付类型。
- 实际 Cocos 渲染同时启用支付 1/2/3 时，还复现支付 1 被同坐标的支付 3 遮挡，支付 2/4 也使用相同坐标。必须消除布局重叠，才能保证任意可用首项真正可见。

## 本轮修改

- `assets/scripts/UI/panelQianBao.ts`：先批量确定可用通道，再统一选中首个可用项，同步 Toggle 选中标记并显式读取一次配置，然后将通道视口滚回顶部。离开充值页或切换通道后，丢弃旧通道的支付配置回包。
- `assets/resources/Prefabs/钱包.prefab`：四个动态图标字段改为对应 V7 银行卡/支付宝/微信/其他支付卡片；9 个 `checkMark` 改为共用透明金框和勾选角标。通道区新增 `通道视口`（Mask + 纵向 ScrollView），既有 `充值渠道` 作为 Grid content；根下路径改为 `通道视口/充值渠道`，两列宽 586、间隔 18/19，视口高 318、Top 118。保留通道名称、卡片尺寸、事件、Prefab UUID 和原有资源 UUID；其他区域布局不变。
- `assets/resources/V7/wallet_channel_selected_overlay.png` 及 `.meta`：1136×516 RGBA 高清透明资源，在原 284×129 节点中等比显示；图标与文字区域 alpha 全为 0。
- `art_sources/v7/wallet/channel_selected_overlay.svg`：可编辑正式源稿。内置 imagegen 曾生成金框参考，但返回 RGB 而非透明 PNG，未将该不透明参考写入运行资源；最终简单几何以 SVG 绘制并由 Sharp 导出。提示意图为“与 V7 蓝金卡片匹配的透明金框、右上金色勾选角标、内部无图标文字和底色”。
- `tools/repair_v7_wallet_channel_selection.py`：只补丁通道资源引用/显隐状态及原生滚动布局；`tools/apply_v7_wallet_exact.py`、`tools/repair_v7_responsive_layout.py` 同步调用，避免以后重新应用时退回旧图或重叠坐标。运行脚本不创建美术节点或重排换肤布局。
- `tools/validate_v7_responsive_layout.py`：核对透明选中框、V7 动态字段和 Toggle 对应 Sprite 启用状态；其余页面校验保留。
- `tools/tests/wallet_channel_selection_regression.js`：使用安装的 Creator 2.4.13 Toggle/ToggleContainer 真实源码及轻量节点宿主，覆盖 14 个初始化、点击、重入、VIP/空列表和延迟回包场景。

## 已验证

- `node tools/tests/wallet_channel_selection_regression.js`：9 通道序列化检查与 14 项交互通过，涵盖首入/重入滚回顶部；原首次回归测试运行改前 TS，因默认选中标记不可见而失败。TypeScript 转译无语法错误，初次逻辑修复类型诊断无新增（保留既有 `require` 类型诊断）。
- `python3 tools/validate_v7_responsive_layout.py`：Prefab、资源、显示状态及 1334/1500/1624/1778 四档高度通过；Python 语法和 `git diff --check` 通过。
- Creator 当前运行的是 2.4.13 qing；`library/imports/63/63b8486c-bfea-44c2-bfb8-87ca448bad73.json` 已含 9 个新选中框引用、四个 V7 动态字段和通道视口，新 SpriteFrame 已导入；`temp/quick-scripts/dst/assets/scripts/UI/panelQianBao.js` 已含 6 个新路径及滚动复位。
- 实际浏览器使用 Cocos 2.4.13、完整正式钱包 Prefab、当前编译脚本与完整生命周期，在 `/tmp/qing-wallet-qa/` 的隔离页使用假账号/配置回包（仅本地资源）。750×1334 画布已观察默认 4 通道、全部 7/9 通道无重叠且唯一默认金框完整可见；画布点击支付宝及滚动区域内的支付 7 都正确切换。
- 9 通道实际拖动后偏移到 403，关闭重入复位为 0，默认支付 1 金框完整可见；后台切换 icon 后选中图案仍为相同 V7 图标。隐藏前项的支付 4/5 组合默认选中支付 4，空列表隐藏充值根，两者通过。隔离页日志无运行错误；本轮未登录真实账号。

## 边界与下一步

“确认充值”仍有“暂未开通，后续处理”的提前返回，本轮只修复展示和选择行为，没有解除该拦截。未执行 Creator 构建、真机验证、真实充值/提现或发布。需真实账号最终验收时沿用正常登录流程。
