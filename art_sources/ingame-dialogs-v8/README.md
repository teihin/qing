# V8 桌内弹窗组件化换肤

设计依据：`design-previews/效果图V8-new/04-登录与弹窗/03-普通弹窗-取消和确定.png`，配合现存桌内蓝金风格。

正式资源只新增两张：`ingame_dialog_v8_header.png`（144×58，九宫格边距25）、`ingame_dialog_v8_gold_button.png`（96×66，边距16）。纹理包含透明抗锯齿边缘，文字由独立Label提供；其余底板、次按钮、关闭及开关复用现有V8资源。外框不使用整张页面截图。

- `tools/extract_v8_ingame_dialog_assets.py`：金按钮从定稿提取；标题从 `header-redesigned.png` 读取，避免恢复旧截图杂边。
- `tools/migrate_v8_ingame_dialogs.py`：正式桌内Prefab与Scene同步迁移。
- `tools/migrate_v8_standalone_dialogs.py`：排队、通用提示、邀请、VIP、聊天正式Prefab迁移。
- `edge-validation.json`：Alpha连通性检查，内部透明孔洞0；不能替代实际显示验收。
- `previews/`：从实际序列化节点渲染的静态预览，动态内容由运行时赋值时，空模板并不代表业务内容消失。

用户要求 `panelGameView/提示` 保留原半透明样式：正式Prefab、Scene完整子树恢复到本轮开始时HEAD，迁移工具跳过它。

预览证据按静态、离线引擎、Creator导入分别记录；不代表登录态业务、购买、扣费、构建或真机验收。

## 2026-09-20 标题底板重绘（已被后续原版风格替代）

用户要求重新设计并替换杂边标题。使用内置 imagegen 生成蓝色渐变、细香槟金边、无文字圆角底板，再裁去多余透明留白并缩至原144×58；保留生成Alpha、原meta/UUID和25像素九宫格。`header-redesigned.png` 是可复现源，正式资源为 `assets/V7/ingame_dialog_v8_header.png`。

最终生成提示词：Refine this game UI sprite to absolutely pristine production-quality edges. Remove ALL stray colored flecks, noisy yellow/green/red pixels, scratches, glow and halos around the outside outline. Keep a perfectly clean single smooth gold rim with anti-aliased transparent edge. Simplify to a flat clean vector-like rendering with a subtle blue gradient interior and delicate muted gold outline. No decorative corner bulges. Actual transparent alpha background. Tight framing: sprite bounds should occupy 98 percent canvas width AND height, not huge transparent padding. Canvas and sprite aspect ratio 2.5 to 1, such as 1000x400. Single blank plate, no text. Same blue/gold family but less saturated blue, understated champagne gold.

验证：RGBA透明像素442，三种尺寸九宫格静态检查见 `header-redesigned-preview.png`；Creator聚焦后自动导入，library贴图与正式PNG像素一致。未检查真实登录弹窗、构建或真机。旧 `edge-validation.json`/`shared-chrome.png` 为重绘前证据。

用户随后明确要求 panelMsgView 退回修改前原版，并将排队、邀请、会员、表情及同批提示弹窗统一成原版风格。以上重绘header不再是当前弹窗设计依据，后续见 `../original-dialogs/README.md`。
