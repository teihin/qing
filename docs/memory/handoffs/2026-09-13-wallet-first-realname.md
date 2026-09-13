# 钱包首次实名页恢复

日期：2026-09-13。目录 `/Volumes/SSD/qing`，分支 `main`。开始时工作区干净；本次改动保留未提交，未推送。

## 问题与依据

用户反馈从未实名的账号第一次打开钱包直接显示充值。实际 Edge `http://localhost:7456/` 预览日志确认缺失资料返回为 `UserHashError {"UserHashInfo":{"context":"钱包提现预留:1"}}`，没有 `key` 或 `content`。成功查询才包含键与内容。

此前提现修复新增 `TakeWithdrawInfoReply`，要求回包 `key`、唯一请求编号、当前账号全部相等。新账号缺失回包因此被丢弃，钱包停留在默认充值页。旧回归夹具给失败回包补了 `key`，未覆盖实际服务端格式；本记录修正此前“首次缺资料流程已保留”的验证范围。

## 改动

- `assets/scripts/UI/panelQianBao.ts`：仅缺失资料回包允许缺少键；用唯一请求编号定位仍待处理的资料请求，再核对请求中保存的键属于当前账号。显式错误键、无匹配编号、关闭/重开/账号变化后的旧回包仍拒绝；成功回包仍须带正确键；每条请求只消费一次。仅缺少银行卡资料触发实名，可选支付宝/USDT 资料缺失不触发。
- `tools/tests/wallet_channel_selection_regression.js`：缺失资料夹具改为服务端实际的仅 `context` 格式；增加首次打开、重复失败、关闭重开、错误键/编号、成功回包缺键及兼容带键失败的检查。未改 Prefab、资源、后台或实名提交协议。

## 验证

- 修复前先替换失败回包夹具，原实现稳定失败于 `genuinely missing bank profile still opens setup`，证实可复现。
- `node tools/tests/wallet_channel_selection_regression.js` 通过：9 个正式选中标记、16 项渠道交互、14 项金额状态、75 项动态高度、15 项支行布局、22 项实名/异步回包、40 项开关/汇率；生产 TypeScript 转译通过。
- `node tools/tests/wallet_return_origin_regression.js`：12 项返回来源/异步加载/关闭回归通过。
- 现有 Creator 2.4.13 `qing` 实例通过网页 Recompile 重新编译脚本；`temp/quick-scripts/src/assets/scripts/UI/panelQianBao.js` 已包含新匹配逻辑。
- 现有网页 iPhone X 实际未实名账号：进入钱包显示实名认证和交易密码设置页；返回大厅再次点击钱包，第二条仅 `context` 的缺失回包仍正确打开实名页。只读验证，未填写或提交实名资料、未修改密码、未充值提现。
- `git diff --check` 通过；项目记忆只读检查为 0 个错误、2 个现有文档超建议体积警告（CURRENT、v7-ui）。未 Creator 构建、真机或客户端发布；已实名账号及跨账号/乱序场景本次仅离线回归，未切换真实账号测试。

下一步按用户指定范围继续；当前预览停在实名页供用户检查。
