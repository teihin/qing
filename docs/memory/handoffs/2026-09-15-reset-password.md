# 2026-09-15 重置密码弹窗设计与实施

目录 `/Volumes/SSD/qing`，分支 `main`，未提交。

## 目标

按竞品“重置密码”弹窗的内容，用 V8-new 蓝青浅金风格出效果图，并在游戏内实现登录页点“忘记密码”弹出的界面与输入。

## 设计

- 效果图：`design-previews/效果图V8-new/04-登录与弹窗/04-重置密码弹窗.png`（1600×2848，源自 `design-previews/待确认/2026-09-15-重置密码/`）。
- 用户确认后要求弹窗与行内控件比例向“新用户注册”弹窗对齐。

## 改动文件

- `tools/extract_v8_reset_password_assets.py`（新增）：把定稿图切成 12 个独立组件写入 `assets/resources/V7/`：`reset_panel_bg_exact.png`（九宫格，300×430，边界 140/70/60/60）、`reset_badge_exact.png`、`reset_title_exact.png`、`reset_subtitle_exact.png`、`reset_rule_exact.png`、`reset_close_exact.png`、`reset_safety_exact.png`、`reset_row_{account,password,confirm,trade}_exact.png`、`reset_submit_exact.png`。
- `tools/apply_v8_reset_password.py`（新增）：在 `assets/resources/UI/panelLogin.prefab` 内新增 `重置密码弹窗`（遮罩＋重置资料框＋徽章/标题/副标题/装饰线/安全提示＋四行输入＋关闭重置＋确认修改）。
- `tools/validate_v8_reset_password.py`（新增）：结构、贴图、九宫格、输入区无底字与脚本路由检查，当前 0 失败。
- `assets/scripts/UI/panelLogin.ts`：忘记密码改为打开弹窗；新增 `initResetUI/openResetPanel/closeResetPanel/onResetSubmit/requestResetPassword`。

## 2026-09-15 第二轮修正（用户反馈）

1. 弹窗遮罩透明度 198 → 225，背景压得更暗。
2. 由整张背景图改为组件化切图，便于后期单独调整。
3. 面板背景改为九宫格拉伸，资源从 752×1334 降到 300×430。
4. 输入框错位：EditBox 节点此前以行内二次偏移定位，改为相对行中心定位；并给 TEXT_LABEL / PLACEHOLDER_LABEL 加原生 Widget 固定左右内边距，聚焦和输入不再偏移。

第三轮（真机截图后）修正：

5. 标题/徽章/副标题/装饰线/安全提示/关闭美术六个节点克隆自 Prefab 中未激活的模板，漏了置为激活，导致弹窗上只剩输入行和按钮。现已全部 `set_active(True)`。
6. 弹窗底板改为**不透明整图**（371×601，圆角 22，无九宫格），与注册弹窗 `register_modal_panel_exact.png` 同一做法；九宫格版本在真机上呈现为半透明，已弃用。

待办（已知未做）：底板仍保留标题/副标题/装饰线/安全提示/按钮的烘焙内容，与叠加的独立组件像素相同、视觉一致；若后续要真正“改一处只动一张”，需要把底板这些区域也擦掉。

## 现状与未完成项

- 已实现：弹窗节点树与美术引用、四个 EditBox（账号／新密码／确认密码／交易密码）、关闭按钮、确认修改按钮、打开与关闭动画、输入校验。
- 未接入：`requestResetPassword()` 仍是占位实现，提交后只提示“重置密码接口待接入”。接口到手后替换该方法即可。
- 待验证：Creator 打开后的编辑器可见性、网页实际交互、真机与构建产物均未验证；本轮只做了静态检查与脚本自检。

## 下一步

1. 提供重置密码接口后实现 `panelLogin.ts` 的 `requestResetPassword()`。
2. 在 Creator 里打开 `panelLogin.prefab` 确认弹窗可见并刷新一次导入，再做网页交互与实际网络验证。

