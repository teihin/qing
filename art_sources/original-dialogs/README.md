# 原版温馨提示风格弹窗

2026-09-20 用户明确要求恢复 panelMsgView 修改前版本，并统一全部同类弹窗（含排队、房间邀请、会员数据和表情）。

- 原版 panelMsgView 精确恢复到固定基线 `23a17226cb03b506650ff09fbd9068165cc45d0c`。
- 扣费、芒果、解散、GPS、举报确认和VIP购买确认复用 `popup_message_single_exact.png` / `popup_message_dual_exact.png`，原嵌字“温馨提示”和取消/确定保留。GPS画面确定对应原返回大厅回调。
- 两处排队、邀请、会员主面板、表情、举报窗口、牌型提示复用四张独立 `original_dialog_*` PNG及SVG源（`../original-large-dialog-style/*.svg`）：深蓝低对比菱纹、双细金边、斜侧标题和蓝/金按钮。标题文字、动态数据、表情、列表、事件保持为独立业务节点。
- 工具：`tools/apply_original_message_dialog_style.py`、`tools/apply_original_large_dialog_style.py`；旧两份V8迁移器命令入口已转向本风格，避免再次覆盖原版。
- `previews/prompts.png` 为五个真实场景子树静态渲染；`previews/scene/` 为实际场景举报/牌型提示。`*-original.png` 是九宫格样式与模拟内容预览，不能当作正式节点或真实服务证据。
- 四份独立Prefab实际节点静态预览为 `previews/panel*-actual-original.png`，动态模板使用序列化默认值，十个表情实际资源保留；回调序列和内部引用静态检查通过；未登录、未构建、未真机、未提交。Creator当前新PNG尚未确认导入，不修改library缓存、不强制重启现有场景。
