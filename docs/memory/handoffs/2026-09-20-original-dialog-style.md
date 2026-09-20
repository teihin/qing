# 2026-09-20 原版温馨提示弹窗统一

目录 `/Volumes/SSD/qing`，分支 `main`，本轮基线 `23a17226cb03b506650ff09fbd9068165cc45d0c`。未提交、未推送。

用户先要求重绘header，随后明确改为恢复修改前panelMsgView，并将全部同类弹窗统一为原版风格。最终范围与资源证据见[资源说明](../../../art_sources/original-dialogs/README.md)。

修改：panelGameView.prefab/drh8.fire 的五个提示、排队、举报、牌型提示；panelQueueMatch、panelRoomInvite、panelVipInfo、panelTalk；panelMsgView完全恢复基线。新增四张独立矢量风格PNG/meta、四份SVG源和两个应用工具；两个旧迁移命令入口保护新决定。

按钮事件序列与内部引用检查通过。已检查实际场景提示/举报/牌型预览，以及四份独立Prefab实际节点静态渲染；无未解析SpriteFrame，其他预览层级详见资源说明。未登录、未购买/扣费、未构建/真机。Creator新资源尚未确认导入，未强制重启或修改library缓存。
