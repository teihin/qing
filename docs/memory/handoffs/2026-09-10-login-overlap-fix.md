# 2026-09-10 登录重叠与背景接缝修复

## 目标与基线

- 工作目录 `/Volumes/SSD/qing`，分支 `main`；`HEAD = origin/main = db5b60f`。错误本地提交 `63b9ef0` 已通过 mixed reset 撤回，未创建反向提交。全部后续工作保持未暂存、未提交、未推送。
- 用户要求重做混乱登录界面，随后圈出顶部窗框断接、底部重复桌沿，要求背景看起来是一张完整图片。
- 登录静态美术仍取自 [V8-new 定稿](../../../design-previews/效果图V8-new/01-主页面/01-登录.png)。最新背景修复替代首轮完整效果图直接铺底，以及随后上下补片混合的两种实现；不改变其他页面设计依据。

## 原因与修改

- 首轮把包含控件的整稿放入拉伸根 Sprite，同时叠加独立输入框/按钮；整稿与控件又使用不同长屏定位，造成重复和错位。现已禁用根 Sprite，新增独立 `V8登录背景`，与盾牌、两行输入框、链接和登录按钮共同使用 `750 / 941` 固定比例及居中 Widget。背景 941×2232，可覆盖 750×1778 校验画布。
- 上下补片与原图混合仍产生窗框断线、两条底部弧线，已按最新反馈废弃。当前 `casino_bg.png` 完全来自单张连续无控件底图，整张等比显示，无上下拼接、透明控件孔洞或拉伸。
- 盾牌按原轮廓、输入框/按钮按外轮廓保留定稿像素，外侧透明，防止矩形切图夹带旧背景。辅助链接保留金色及浅白高光；账号/密码占位图保持完整、不做阈值抠字。真实输入只覆盖其干净蓝色区域。
- 保留 `手机号`、`密码` 等直接根子节点、EditBox（含密码自定义子类）、清除热区、登录/注册/重置事件。新增背景使用独立 PrefabInfo 标识。无运行时布局或美术覆盖，业务文件 `assets/scripts/UI/panelLogin.ts` 未改。

## 文件与再生成入口

- `assets/resources/UI/panelLogin.prefab`、`assets/resources/V7/casino_bg.png` 及 `login_*_exact.png/.meta`。
- [素材说明与最终生成提示词](../../../art_sources/v8-login/README.md)记录内置 imagegen 的背景修复及无控件底图提取；正式背景源为 `continuous-background-source.png`，其他输入仅供追溯。
- `tools/extract_v8_login_assets.swift`：定稿轮廓切图与完整背景归一化，写入指定输出目录。
- `tools/apply_v8_login.py`：写正式 Prefab/资源元数据；`tools/validate_v8_login.py`：只读验证。

```sh
swift tools/extract_v8_login_assets.swift 'design-previews/效果图V8-new/01-主页面/01-登录.png' art_sources/v8-login/continuous-background-source.png assets/resources/V7
python3.13 tools/apply_v8_login.py
python3.13 tools/validate_v8_login.py
```

不得再运行依赖旧稿、旧裁切坐标或上下补片的生成器覆盖本次资源；旧登录资源删除项保持原工作区状态，不恢复已删除历史设计。

## 验证与边界

- 只读专用校验：背景全不透明且来自单张完整源图；定稿美术不透明内部像素保留；浅色链接文字完整；四档高度 1334/1500/1624/1778 无控件重叠、拉伸或越界；业务输入/按钮绑定保留。
- Creator 2.4.13 单实例已实际导入；正式背景、盾牌、输入行、按钮和链接 PNG 与 `library/imports` 内容逐一一致，未把网页 Recompile 当作导入证据。
- 网页 iPhone 6、iPhone X 最终画面已查看：窗框连续、单条底部桌沿、仅一组控件、文字完整。截图：[普通屏](../../../art_sources/v8-login/qa/login-iphone-6.png)、[长屏](../../../art_sources/v8-login/qa/login-iphone-x.png)。
- 本轮网页交互：测试账号输入后原占位图隐藏；清除后恢复占位；密码保持掩码；空账号登录显示原校验提示；注册弹窗可打开/关闭，未提交。背景再次替换后复查两档显示和清除恢复，业务逻辑未再变更。
- 未构建、未真机、未真实登录/注册，重置密码外链未点击；未提交或推送。最终视觉仍待用户验收。
- Python 语法、快速注册专用校验、`git diff --check` 均通过；项目记忆只读检查为 0 错误、2 条已有文档预算警告（CURRENT、V7 专题），未扩大到整理其他模块历史。

## 下一步

用户继续复核上述最终预览；若有具体视觉反馈只改对应部分。所有提交、推送均等待用户明确指令。
