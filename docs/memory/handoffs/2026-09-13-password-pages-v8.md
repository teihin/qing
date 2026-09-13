# 2026-09-13 登录与交易密码页 V8-new 换肤、输入错位修复

目录 `/Volumes/SSD/qing`，分支 `main`。承接系统设置换肤，用户要求继续处理修改登录密码、修改交易密码，背景统一大厅，修正输入框错位。交易密码入口原本可分流初始化页，本次同步处理该实际入口，未增加短信或手机号业务。

## 改动

- 仅调整 `panelMain.prefab` 中 `修改登陆密码`、`修改交易密码`、`初始化交易密码` 三个子树。旧全图母版停用并清空引用，原节点名称保留；大厅背景、盾牌、标题、表单底板、密码行、图标、文字及确定控件独立序列化。
- 复用 `lobby_scene_long_v8.png`、设置页透明金色图标、结算蓝色面板及已存在的高清金色“确认修改”按钮；普通面板九宫格，背景/盾牌/图标/美术按钮保持比例。顶部固定，表单中段伸缩，确定入口固定在底板下部。
- 两个修改页保留三项输入，初始化页按真实业务保留新密码和确认密码两项；没有照搬参考图中不存在的手机号、验证码或眼睛开关。
- 修复输入文字与占位文字的 Cocos EditBox 左上锚点 `(0,1)` 契约，位置匹配输入区左上角，Native Widget 绑定四边并保留左右内边距；文字左对齐、垂直居中、单行 CLAMP。原密码隐藏、输入模式、长度限制及所有事件完整保留。
- 修复旧返回按钮重复计算父级顶部位移、确定按钮叠加 `ok` 父节点偏移的问题；按钮视觉与原真实点击节点重合。
- `panelMain.ts` 未修改，所有原 Button 和 EditBox 组件与本阶段开始快照一致，页面以外对象逐项不变。

## 文件

- `tools/apply_v8_password_pages.py`：三页专用应用器；不能再重跑历史全图密码页应用器。
- `tools/validate_v8_password_pages.py`：范围、控件契约、五档高度及可选 Creator 导入校验。
- `tools/tests/password_pages_v8_regression.js`：18 项生产处理函数回归，提交回包调用由内存 mock 接管。
- `tools/tests/wallet_editbox_alignment_regression.js`：增加可选页面筛选及预期数量，默认钱包 20 项行为不变；直接执行本机 2.4.13 的 EditBox 初始化和 Widget 对齐逻辑。
- `art_sources/v8-repairs/passwords/before/`：本阶段开始的 Prefab 和脚本快照；`qa/`：三页 1334/1624 离线几何预览。正式美术全部复用现有资源，未采用本轮不合格的非透明空按钮生成候选。

## 已完成检查

```sh
python3 tools/validate_v8_password_pages.py
node tools/tests/wallet_editbox_alignment_regression.js assets/resources/UI/panelMain.prefab 修改登陆密码,修改交易密码,初始化交易密码 8
node tools/tests/password_pages_v8_regression.js
node tools/tests/wallet_editbox_alignment_regression.js
```

五档高度 1334/1500/1624/1778/1860 的密码行、确定和返回均无越界/重叠。8 个输入框、16 个标签的真实引擎初始化、密码圆点、占位显隐、重入和尺寸变化对齐通过；18 项空值/不一致拦截、模拟命令、返回与清空通过；原钱包 20 项回归通过。以上均为离线检查，没有真实密码或服务端写入。

## 运行时补验与当前待验证

随后 Mac 已能访问，三页初版与设置入口移除一起完成 Creator 导入。在 iPhone X 独立引擎预览中从实际设置入口点击打开登录密码页通过，左上锚点/位置正确。

补验发现旧序列化兼容字段 `_N$string` 覆盖占位文字、`_N$overflow=2` 覆盖 `_overflow=1`。现已在三页 16 个标签同步更新实际兼容字段，并将只读测试改为优先读取这些真实字段。八个密码输入及 18 项密码处理回归通过；最新字段修正尚未被 Creator 导入，短屏/交易及初始化实际输入、返回/确定空值交互仍待继续。阶段快照 `before-runtime-labels/` 用于新的 `--baseline` 范围检查，设置子树已独立核对导入一致。

测试准确性补充：前段钱包 20 项通过是修正兼容字段读取前的结果。准确读取 `_N$overflow` 后，原钱包金额框报告既有 `2 != 1`，此前测试遗漏了真实 SHRINK 状态；本任务未改钱包 Prefab，此问题不属于设置入口移除范围。不能继续把旧通过结果视为当前完整运行状态证明。

未构建、真机、发布、提交或推送；未提交真实密码修改。此前系统设置横线修复已完成导入和短长屏网页核对，见[设置交接](2026-09-13-settings-v8.md)。
