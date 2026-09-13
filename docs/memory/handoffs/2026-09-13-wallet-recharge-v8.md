# 钱包充值页 V8 组件化换肤

日期：2026-09-13；目录 `/Volumes/SSD/qing`；分支 `main`。本轮未提交、未推送，也未操作 Cocos Creator。

## 用户纠正与替代关系

用户对照新旧页面指出上轮仅换了背景，控件仍是 V7 旧图。上轮“已完成 V8 组件化换肤”的结论撤销；旧专项检查只验证 UUID 存在，不能证明图像来自 V8-new。以下为本次重新切图后的实现和检查，不代表 Creator 视觉验收。

## 本次实施

- `assets/resources/Prefabs/钱包.prefab` 的根背景改为复用 `assets/resources/V7/lobby_scene_long_v8.png`，按原始宽高比缩放到 750×1875.399 并顶部固定，覆盖 1334–1778 的竖屏高度。
- 新工具 `tools/apply_v8_wallet_recharge.py` 只读取 `效果图V8-new/03-钱包` 的新稿，重新切取四种渠道卡、确认按钮、透明标题/默认提示，以及共享页签各状态。金额底板、提示底板清掉示例文字，继续显示服务器真实值。共 23 张资源约 1.04 MB，未新增页面场景背景；保留既有资源 UUID，新增头部独立箭头、钱包标题、客服图标文字、共用空页签和三张未选中字图。
- 只有需要随中段高度伸缩的 `wallet_recharge_panel_exact.png` 使用九宫格：从新稿边框及无控件材质重建干净底板，压缩成 180×256，四边为 32。完整场景、标题、美术字、卡片和按钮保持普通 Sprite 比例。
- 正式 Prefab 保留新稿两行渠道的参考尺寸和间距，金额区、提示、确认及主面板均改为顶部锚定。2026-09-13 用户指出渠道少时留白过多后，取消“多余手机高度交给渠道区”的旧方案；实际行数由原生两列 Grid 按可用渠道计算，1–2 个一行、3–4 个两行，依此类推。金额/提示/确认和九宫格外框同步收紧；渠道确实超出剩余屏幕高度时才在渠道区内部滚动。首次回包、重入、渠道增减和手机高度变化均重新计算，从 Prefab 初始偏移计算避免累计漂移。Content 使用 ON_WINDOW_RESIZE 的顶部 Widget，避免逐帧 Widget 阻止滚动。
- `panelQianBao.ts` 处理上述用户要求的数据驱动高度，并保留金额状态对比色与默认/自定义提示切换；不改变通道权限、服务器金额、请求协议及充值拦截。原 Button/Toggle/ScrollView 绑定保持一致。
- 删除未被 Prefab 引用、位于 `resources` 下会进入包体的整页资源 `wallet_v8_body_exact.png(.meta)`，并从 `tools/v8_wallet_crops.json` 删除其生成项。
- 旧钱包/响应式应用工具在末尾调用新的充值应用函数，避免覆盖新稿布局；不得运行旧 V7 提取器重新覆盖资源。

## 验证

- `python3 tools/validate_v8_wallet_recharge.py`：通过。新增 V8-new 原图逐像素对比、标题透明度、素材哈希/元数据和四档控件边界检查，可识别“同 UUID 仍为旧图”的错误。
- `node tools/tests/wallet_channel_selection_regression.js`：9 个序列化通道标记、16 项交互回归、75 项动态高度检查通过。动态检查执行实际 Cocos Grid 代码，覆盖 1–9 个渠道、1334/1500/1624/1778/1860 五档高度、增减/重入/屏幕变化、金额跟随、按钮边界及溢出滚动；只是离线引擎代码测试，未操作 Creator。
- `tools/render_v8_wallet_recharge.py` 从正式 Prefab 读取布局，输出两行参考状态的 1334/1500/1624/1778 高度离线预览；动态渠道状态以上述 Node 回归为证，不把静态合成当作实际运行。证据在 `art_sources/v8-repairs/wallet-recharge/qa/`，切图来源/哈希在同级 `cuts.json`，改前备份在 `before/` 和 `before-dynamic-height/`，均不在运行时 assets 中。
- Python 编译与 `git diff --check`：通过。
- 全套 `tools/validate_v8_pages.py` 上轮被大厅列表边界差异拦截，本轮未重新运行全套检查。
- 按用户要求未操作 Cocos Creator；实际显示与交互由用户继续验收。

## 后续

钱包提现、记录和实名认证页继续按相同组件化规则处理；不得使用整张效果图作为页面背景。相似页面优先复用本轮长背景、标题栏、面板材质和按钮状态资源。
