# 2026-09-20 带入积分余额不足子弹窗

目录 `/Volumes/SSD/qing`，分支 `main`，起始HEAD `5773c1f`。未提交、未推送。

按用户要求，`panelGameView.prefab` 与 `drh8.fire` 的 `带入窗口/余额不足提示` 改为原版温馨提示风格：复用 original_dialog 的深蓝金边框、标题、蓝/金按钮，标题为温馨提示，取消左/充值右，保留右上关闭。无新增贴图。

`txt` 原动态路径保留；`panelGameView.ts` 继续按最小带入金额拼接“金币余额不足…，请先充值！”，没有固化50。两个同名关闭节点按实际坐标区分，原Button及自定义组件完整保持，主带入窗口及其他子树未变。

复现：`python3 tools/apply_original_insufficient_dialog_style.py`。

验证：Prefab/Scene目标视觉签名一致；与HEAD比对全部非目标对象未变、原Button/自定义组件未变；py_compile与diff检查通过。实际序列化静态叠层预览见[预览](../../../art_sources/original-dialogs/previews/insufficient/03_带入窗口_余额不足.png)。复用的主框/标题/金按钮源像素与Creator library一致；本次Prefab/Scene重新导入与真实点击尚未验收。未充值、未构建、未真机。
