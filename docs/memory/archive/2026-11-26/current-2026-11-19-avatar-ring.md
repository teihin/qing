# 2026-11-19 实时战绩头像框：环不再缩在头像里（归档于 2026-11-26）

Prefab 就绪，未导入/构建/热更/真机。

- 根因：`record_avatar_ring.png` 92×92 四周留了透明边距，环外径只占画布 0.659；节点按 64/46 绘制后可见环径仅 42/30，而头像 62/44，框被"跑进"照片里。
- 改动只有两个节点的 `_contentSize`：`观战对象.prefab` 的 `V8头像框` 64→**100**，`带入记录.prefab` 的 `ring` 46→**72**；PNG/`.meta`/UUID 未动，`tools/apply_realtime_record_v2.py` 常量同步。
- 离屏与合成图核对见 `vibe_images/2026-11-19-avatar-ring/`；Creator 导入、构建、热更、真机未做。详见[交接](../../handoffs/2026-11-19-realtime-avatar-ring-size.md)。
