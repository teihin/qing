# 钱包实名清晰度与大厅弹窗统一交接

日期：2026-09-06
目录：`/Volumes/SSD/qing`
范围：钱包首次实名认证页、钱包银行选择弹窗及大厅内遗留覆盖弹窗。

## 已完成

- 根据用户实机截图放大实名认证主副标题、五行标题/输入文字和底部四条重要提示；隐藏银行行残留的旧“银行名称”，避免文字重叠。
- 顶部 8L 改为专用双倍分辨率、禁止动态图集的 `wallet_realname_shield_exact.png`；关键文字图、输入行及提示卡同样关闭动态打包，减少缩放锯齿与模糊。
- 银行选择框改为 V7 蓝金面板，扩大标题和滚动列表；`银行对象.prefab` 使用干净动态行，银行名称仍由原配置填充，点击后仍走 `panelQianBao.ts` 的既有回填逻辑。
- 审计大厅可触发的对话型覆盖层：普通/公告提示和初始化交易密码原已是 V7；本轮补齐“确定修改个人信息”“确定随机头像提示面板”“加入房间”、序列化的旧“选择银行”，以及独立 `panelLoginErrorEx.prefab` 的登录异常/切换账号弹窗。确认弹窗复用当前双按钮风格，加入房间保留原数字键与自动进房逻辑；切换账号保留原按钮节点和回调。
- 全部视觉通过正式 PNG + `.meta` 和 Prefab 引用实现；未在运行时创建或重排美术节点，`panelMain.ts`、`panelQianBao.ts` 未修改。

## 工具与验证

- 资源生成：`tools/extract_v7_wallet_realname_exact_assets.py`、`tools/extract_v7_popup_exact_assets.py`。
- Prefab 应用：`tools/apply_v7_wallet_realname_exact.py`、`tools/apply_v7_lobby_popups_exact.py`、`tools/apply_v7_popup_exact.py`。
- 响应式修复/检查同步到 `tools/repair_v7_responsive_layout.py`、`tools/validate_v7_responsive_layout.py`。
- 750×1334、750×1778 实名页合成已核对；四档响应式、资源引用、银行动态行及大厅对话弹窗旧皮检查通过。Creator 2.4.13 已按要求重启并完成快速编译，预览刷新后回到登录页。

## 待验证

- 重新登录后核对实名认证实际输入、银行滚动选择/回填、提交回包，以及头像确认、加入房间、登录异常等弹窗的真实点击路径。
- 本轮按要求未执行 Creator 构建、真机、交易或发布验证。
