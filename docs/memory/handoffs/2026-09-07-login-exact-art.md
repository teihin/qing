# 2026-09-07 登录页最终稿精确美术修正

## 范围

- 工作目录：`/Volumes/SSD/qing`，分支 `main`。
- 唯一视觉依据：`design-previews/2026-09-04-V7确认风格六页统一版/01-登录.png`。
- 仅修改登录主界面美术与空值占位显示；快速注册弹窗、登录协议和服务器逻辑不在本轮重做范围。

## 实施

- `tools/extract_v7_login_exact_assets.py` 从最终稿直接切出两行输入框、两张占位美术字、重置密码、快速注册和登录按钮，正式资源使用 `login_*_exact.png` 且关闭动态合图。
- `tools/apply_v7_login_exact.py` 直接写入 `assets/resources/UI/panelLogin.prefab`；输入框和按钮宽度按确认稿等比映射为 527，确认稿没有的清除叉号仅隐藏显示层，原 Button 行为保留。
- `assets/scripts/UI/panelLogin.ts` 只负责动态状态：空闲空值显示确认稿占位美术字，输入或已有值时隐藏；没有用代码创建、重排或替换美术节点。
- `tools/apply_v7_prefab_skin.py` 与 `tools/repair_v7_responsive_layout.py` 同步精确资源和尺寸，避免以后整批工具回退到旧生成纹路。

## 验证

- `python3.13 -m py_compile`：通过。
- `python3.13 tools/validate_v7_login_exact.py`：通过。
- `python3.13 tools/validate_v7_login_register_exact.py`：通过。
- `python3.13 tools/validate_v7_responsive_layout.py`：通过。
- `git diff --check`：通过。
- 关闭旧 Creator 后只重启一个 2.4.13 实例；网页预览 iPhone 6 和 iPhone X 均观察到登录构图固定等比、输入框和按钮无旧椭圆纹路。

## 未验证

- 未执行 Creator 构建、真机和真实登录提交。
- 动态输入、清除按钮热区与缓存账号回填保留原逻辑，但本轮没有输入真实账号做端到端验证。

## 同轮仅设计未实施

- `design-previews/2026-09-07-V7桌内统一风格重设计-v6/` 保存五张桌内新概念图；它们只供用户确认，未应用到游戏 Prefab。
