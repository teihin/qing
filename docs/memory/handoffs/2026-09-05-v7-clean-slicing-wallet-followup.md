# V7 干净切图、钱包与后续模块修正交接

日期：2026-09-05

## 目标

修正钱包充值渠道缺少选中框、推广页缺少真实链接、钱包/金币流向/代理/排行榜列表底图残留、金币流向冗余汇总与筛选、时间断行、分页不协调，以及公告弹窗正文区横条问题。

## 已改

- `tools/extract_v7_wallet_exact_assets.py`：生成四套充值渠道选中态；列表底板改为程序生成的连续蓝色材质；钱包长背景渐隐到完整长桌面纹理。
- `tools/apply_v7_wallet_exact.py`：九个原渠道 Toggle 分别绑定普通态与选中态，强制普通底图在前、选中层在最后，停用旧叠加装饰层。
- `tools/extract_v7_followup_exact_assets.py`：推广、金币流向、代理和排行榜母版/列表改用干净素材；长背景不再由窄条镜像拼接；金币流向删除汇总及筛选展示。
- `tools/apply_v7_followup_main_exact.py`、`tools/apply_v7_followup_agent_exact.py`：Prefab 预制真实推广链接 Label；金币流向列表上移、动态列重新对齐；分页统一为赠送同系紧凑五键控件。
- `assets/scripts/UI/panelMain.ts`、`assets/scripts/UI/panelHongli.ts`：二维码生成时同步写入同一个真实推广注册链接。
- `tools/extract_v7_popup_exact_assets.py`、`tools/apply_v7_popup_exact.py`：公告弹窗正文中部改为完整连续蓝色承载区，去除横向残留。
- `tools/validate_v7_responsive_layout.py`：新增渠道选中态引用/层级、推广链接、金币流向新布局、紧凑分页和新资源尺寸断言。

## 验证

- 使用 Python 3.13 生成正式资源并直接重写正式 Prefab；未使用运行时代码换肤。
- 修改工具通过 `py_compile`；`python3.13 tools/validate_v7_responsive_layout.py` 通过；`git diff --check` 通过。
- 已直接查看钱包长背景、推广/金币流向/代理/排行榜长母版、钱包/后续列表底板以及公告弹窗资源：未见旧样例文字、横线、镜像条带或明显拼接断层。
- 已终止原 Creator 主进程并用同一 2.4.13、同一 `/Volumes/SSD/qing` 项目路径重启；预览服务恢复在 7456，资源导入完成，快速编译扫描 321 个脚本并成功结束。quick-scripts 已包含两处 `V7推广链接` 赋值，新增选中态与弹窗/金币流向资源在 `library/imports` 中有导入产物。
- 未执行 Creator 构建。登录态动态页面与真实数据仍需继续确认。

## 注意

- 本仓库有大量本轮前已存在的 V7 未提交修改，不能重置或覆盖。
- 充值渠道真实可用状态及支付协议不在本次换肤验证范围；本次只保持原 Toggle/事件并修正视觉状态。
- 推广链接为动态真实地址，预览静态图中不应烘焙虚构域名。
