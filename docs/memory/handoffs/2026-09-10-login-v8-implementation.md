# 登录页 V8 错误尝试与撤回交接

> 状态：2026-09-10 用户复核后明确否决本轮登录界面。本文件记录错误尝试和撤回边界，不能作为已确认实施依据。

后续已按用户要求修复重叠及上下背景接缝，最新实现和实测见[修复交接](2026-09-10-login-overlap-fix.md)。下文仅保留首轮错误及撤回经过。

## 目标与范围

- 日期：2026-09-10；目录：`/Volumes/SSD/qing`；分支：`main`。
- 用户确认 `design-previews/效果图V8-new/01-主页面/01-登录.png` 为登录页定稿，并要求字体无法稳定实现的内容使用切图、兼容长手机、清理未使用旧登录资源。
- 本轮只处理登录页视觉，保留 `assets/scripts/UI/panelLogin.ts` 的登录、输入、清除、快速注册和动态状态逻辑。

## 已否决的尝试

- 定稿图按原像素切出完整背景、账号/密码输入框、登录按钮、账号/密码占位美术字及重置/注册美术字；固定美术字和图标不再依赖系统字体。
- 正式资源写入 `assets/resources/V7/` 既有 UUID 入口，`assets/resources/UI/panelLogin.prefab` 继续使用原节点和事件；旧盾牌叠加节点已隐藏，避免完整背景重复渲染。
- 输入框保持 527 宽，账号 112 高、密码 114 高；登录按钮 527×100。Widgets 继续以 750×1334 基准固定顶部位置，长屏增加外部可见背景，不拆散输入行、按钮和固定美术字。
- 删除未被 Prefab 或业务资源引用的 `input_user.png`、`input_password.png`、`login_button.png` 及 `followup_password_login_master_long.png`（含 `.meta`）。临时 V8 中间切图已清理，避免重复占用空间。

## 验证

- `python3 tools/validate_v8_login.py` 通过：定稿存在、8 个正式资源尺寸与元数据一致、Prefab SpriteFrame 引用正确、旧盾牌叠加关闭、清除图标关闭、旧资源不存在。
- `python3 -m py_compile tools/apply_v8_login.py tools/validate_v8_login.py` 通过。
- `git diff --check` 通过；源 PNG 经过 Swift CoreGraphics 读取并写出，登录背景为 941×1672，输入/按钮/美术字切图为正式资源。
- Creator 重新导入、Prefab 可见性、浏览器长屏、真机、构建和发布尚未在本轮验证；不可把静态校验当作这些阶段已完成。
- 上述静态检查只证明文件和引用满足脚本预设，不能证明视觉正确；用户实际复核已否决本轮界面。

## Git 撤回状态

- 错误尝试曾进入本地提交 `63b9ef0`，但未推送。
- 用户要求撤回后已执行 `git reset --mixed origin/main`；当前 `HEAD = origin/main = db5b60f`，没有创建反向提交。
- 为保护提交之后已有的工作区修改，本轮登录文件、删除项和工具仍作为未暂存修改保留；是否丢弃或重做须按用户后续要求执行。
- 所有后续提交和推送均由用户明确触发，未收到“提交”或“推送”要求时不得执行。

## 工具边界

- 首轮 `tools/extract_v8_login_assets.swift`、`tools/apply_v8_login.py` 及校验预设已被否决；它们已在后续修复中重写。当前参数、单张完整背景及轮廓切图方式见[修复交接](2026-09-10-login-overlap-fix.md)，不得复用本文首轮布局结论。
- 旧 `tools/extract_v7_login_exact_assets.py`、`tools/validate_v7_login_exact.py` 依赖已删除历史效果图，只保留历史线索，不能恢复旧图或把源路径直接改成 V8-new 后套旧坐标。
