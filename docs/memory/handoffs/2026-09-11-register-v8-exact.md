# V8 新用户注册实施交接

日期：2026-09-11。目录 `/Volumes/SSD/qing`，分支 `main`。

## 范围与实现

- 以 V8-new 的快速注册大字版为唯一依据；固定弹窗保留原稿位置、间距和比例，四档手机高度只增加外侧留白。
- `assets/resources/UI/panelLogin.prefab` 与 `assets/resources/V7/register_*_exact.png`：原图直切静态美术，原生五项输入、真头像、防盗号和状态覆盖层保留。关闭旧内部 Widget，防止长屏位移；遮罩拦截背景点击。动态状态清底不压住确认按钮。
- 工具：`tools/extract_v8_register_assets.swift`、`tools/apply_v8_register.py`、`tools/validate_v8_register.py`。最后一项为只读。
- 未改 `assets/scripts/UI/panelLogin.ts` 注册协议。执行期间检测到用户调整登录输入热区、将输入底图移为同级节点，已保留；旧登录校验的子路径假设待同步，不可为使校验通过覆盖用户调整。

## 验证

- 原图不透明像素、资源 UUID/尺寸/裁切、事件、密码模式、层序以及 1334/1500/1624/1778 高度检查通过。
- 13 张正式 PNG 与 Creator 导入库一致，导入 Prefab 中动态状态字号为 20。
- 网页 iPhone 6/X：五项输入与隐藏密码、空邀请码本地拦截、头像左右选择和选择器换一批、防盗号状态、关闭重入已测试。
- 证据：[资源说明](../../../art_sources/v8-register/README.md)，截图在同目录 `qa/`。
- 未真实注册、未 Creator 构建、未真机。视觉实施完成不等于服务端注册回包验证完成。

## Git 与接续

- 代理没有执行暂存、提交或推送。任务进行中观察到用户创建 `16275a8 登录界面换皮完毕`，随后 `2f614ba 注册界面换皮完成`；这是当前已观察的历史，不再沿用旧“HEAD=db5b60f、全部未提交”的状态。
- 用户已将本次目标扩展为按 V8-new 顺序完成全套，继续大厅；进度见[全套任务](2026-09-11-v8-all-pages.md)。
