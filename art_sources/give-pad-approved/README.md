# 赠送金币确认稿资源

- 用户确认稿：`design-previews/效果图V8-new/04-登录与弹窗/赠送金币-20260920.png`。
- 静态标题、标签、饰线、关闭、锁和完整金色按钮直接提取确认图；玩家头像、名字、ID及输入为独立动态节点。
- `give_pad_approved_clean_panel_source.png`：使用内置 imagegen 从确认图编辑得到无内容底板，后由资源提取工具清理边缘并缩放；未使用外部 API/CLI。
- 底板提示词：Production game UI asset extraction edit. Output ONLY the empty main rounded blue panel of the reference, tightly cropped to its external bounds, on true transparent background. Preserve EXACT original simple thin pale gold outer rim, cyan inner rim, rounded corners, subtle blue inner edge glow and smooth blue petrol gradient material. Aspect ratio of panel about 896 wide by 1024 tall. Remove ALL contents: title, all words, avatar and avatar frame, divider lines and diamonds, close circle and X, input fields, button, lock, every interior UI element. Replace them with a single seamless continuous clean blue gradient surface that matches the original panel. No ghost lettering, no stripes, no patches, no texture patterns. Remove ALL external blurred room background. This is an empty panel base for independently layered real Cocos controls, not a new layout or redesign. Keep restrained original frame style exactly, do not add ornaments or protrusions. Panel fills canvas with only tiny transparent margin.
- 实施与验证：见 `docs/memory/handoffs/2026-09-20-give-pad-approved.md`。
