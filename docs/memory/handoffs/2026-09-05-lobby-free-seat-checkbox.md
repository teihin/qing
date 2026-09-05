# 大厅“有空位”勾选对齐修正交接

日期：2026-09-05

目录：`/Volumes/SSD/qing`

分支：`main`

## 目标与结论

- 修复大厅房间列表顶部筛选栏中，“有空位”选中状态的金色勾向右错位。
- `filter_bar_exact.png` 烘焙的空方框中心约在素材 x=587.5；筛选栏中心 x=352.5、父节点“空位条件”x=295，原子节点 x=-44 会落到素材 x=603.5，向右偏约 16px。
- 正式 Prefab 中 `Main/发现/过滤/空位条件/有空位/Background` 与 `checkmark` 均改为 x=-60、y=0，尺寸保持 32×32；Toggle 节点名、事件和筛选业务未改。

## 修改文件

- `assets/resources/UI/panelMain.prefab`
- `tools/apply_v7_lobby_exact.py`
- `tools/validate_v7_responsive_layout.py`

## 验证

- 选中态静态合成图确认勾落在方框中心。
- `python3.13 -m py_compile tools/apply_v7_lobby_exact.py tools/validate_v7_responsive_layout.py` 通过。
- `python3.13 tools/validate_v7_responsive_layout.py` 通过：Prefab 锚点、四档竖屏高度、资源引用与显示状态正常。
- 相关文件 `git diff --check` 通过；Creator 2.4.13 网页预览已触发 Recompile，重新加载后登录页可正常渲染。

## 未验证边界

- 当前预览停留在登录页，本轮未使用真实账号进入大厅点击“有空位”，未验证服务端筛选结果；也未执行 Creator 构建、真机测试或发布。
