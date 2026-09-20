# 桌内赠送金币弹窗确认稿实施

- 工作区 `/Volumes/SSD/qing`，分支 `main`；保留其他任务未提交修改，本任务未提交、未推送。
- 用户确认“头像/名字/ID + 横向金额/密码输入 + 底部确认”布局，并要求恢复简洁蓝青圆角风格；定稿保存为 `design-previews/效果图V8-new/04-登录与弹窗/赠送金币-20260920.png`。
- 正式 `assets/resources/UI/panelGivePad.prefab` 已组件化替换：700×805 固定比例主体、独立标题/标签/饰线/关闭/锁/圆形头像框/输入底板/完整金色按钮。12 张 PNG 与 meta 使用 `give_pad_approved_` 前缀；主底板为独立无文字素材，动态玩家及输入不烘焙。
- 原 `bk/name`、`bk/id`、`bk/头像/mask/img`、`bk/输入金额`、`bk/金额`、`bk/密码`、按钮路径与事件保留；头像/昵称仍由真实查询回包驱动，固定金额入口仍可用。
- `panelGivePad.ts` 仅增强 `UserName` 回包校验：只接收当前目标 ID，忽略无效 JSON/缺 ID，兼容空字段，原赠送协议及金额密码校验不变。
- 工具：`extract_give_pad_approved.py`、`apply_give_pad_approved.py`、`validate_give_pad_approved.py`；素材来源与联系表在 `art_sources/give-pad-approved/`。

## 验证

- 12 资源 meta、8 条业务路径与动态控件契约检查通过；10 项隔离赠送逻辑回归通过，`git diff --check` 通过。
- 真实 Cocos 2.4.13 引擎直读最终正式文件，在 375×667 / 375×812 画面检查通过；金额输入、密码圆点显示已实际点击核对。截图为 `art_sources/give-pad-approved/runtime-375x667.png`、`runtime-375x812.png`。通过独立本地 harness 禁用业务网络和提交，非真实登录交易验收。
- 已在 Creator 打开中间版本；最终 Prefab 的导入缓存仍滞后（`library/imports/5f/5f6968c5-a5f0-464c-8a0b-15d3b8f94258.json` 停留 12:46 版本），**最终编辑器重新导入待完成**。资源 UUID 存在不等于最终内容已刷新；直读 harness 未改写 library。
- 密码 EditBox 使用 PASSWORD 标志，保留原数字输入模式和长度；输入底板独立于 EditBox，固定金额模式仍显示底框。
- 未真实登录赠送、未构建、未真机、未发布；测试不发起真实交易。
