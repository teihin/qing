# 钱包提现状态与后台开关

日期：2026-09-13。目录 `/Volumes/SSD/qing`，分支 `main`。保留工作区原有美术及用户手动布局修改；本阶段未改 Prefab、未提交或推送。

## 请求与完成范围

用户要求修复提现页偶发误弹实名认证，替换已停用的 `hasUSDT` 网站查询，并让银行卡、支付宝、USDT 可由后台分别启停。用户随后明确同意增加后台 USDT 汇率设置，含义为 1 USDT 对应的人民币金额。本阶段不延续历史关机操作，不操作 Creator，视觉与真机由用户验证。

## 客户端修复

文件：`assets/scripts/UI/panelQianBao.ts`、`tools/tests/wallet_channel_selection_regression.js`。

- 原代码银行卡/支付宝共用预留信息请求上下文，可选支付宝记录缺失也会打开实名页；Toggle 取消选中仍触发读取，旧请求回包还可能覆盖当前方式。用修改前文件复现了“支付宝记录缺失误弹实名”的失败用例。
- 新预留查询按账号、提现方式、唯一请求上下文匹配并消费一次，关闭/重入及账号变化后的旧回包无效。仅银行卡身份不完整或缺失触发实名；支付宝和 USDT 可选记录缺失不会触发，且不能覆盖银行身份字段。
- 忽略取消选中的 Toggle 事件；程序选择兼容 Cocos 是否发送脚本事件的两种设置。银行卡资料完整时关闭误弹实名并清理密码初始化标记，过期密码检查不再修改状态；保留首次真实缺资料的实名与密码初始化流程。
- 从哈希读取 `银行卡提现`、`支付宝提现`、`USDT提现`、`USDT汇率`、旧 `提现类型`，本次五项成功/缺失回包全部返回后应用。离开提现页会使旧配置回包失效。各方式独立显示，全部关闭时隐藏表单，重新进入读取最新配置。
- 银行卡/支付宝仅缺少新键时兼容旧 `提现类型` 的 1/2/3；显式 `关` 优先。USDT 缺少开关或汇率无效时关闭。汇率必须有限、大于 0、不超过 1000000；移除旧 HTTP 查询和隐式汇率 1。
- 原金额、交易密码及提现请求格式保留；新增不可用方式的请求拦截，不替代原游戏服务器金额和交易校验。

## 后台配置

文件：`XuanManager/server/internal/api/payment_configuration.go`、`payment_withdrawal_test.go`；`XuanManager/web/src/pages/PaymentConfigurationPage.tsx`、`web/src/types.ts`。使用原支付配置 GET/PUT 与权限，不新增接口或表。

- 支付通道配置 → 全局支付与提现设置新增三个开关和汇率输入。
- 三个哈希值保存为明文 `开`/`关`，汇率为十进制字符串。USDT 开启必须填写有效汇率；关闭允许汇率为空。
- 三开关的 PUT 字段必须显式提供，旧版页面遗漏会被拒绝。保存同时同步旧 `提现类型` 0～3；新字段纳入修订冲突检查、快照恢复、写后回读及审计。
- 部署并保存后，新客户端重新进入提现页读取新设置；旧客户端仍需升级才能停用旧 USDT 网站查询。

## 验证

- `node tools/tests/wallet_channel_selection_regression.js`：9 个序列化选中标记、16 项交互、75 项渠道高度、15 项支行布局、16 项实名/异步回包及 40 项开关/汇率检查通过；离线使用实际 Cocos Toggle/ToggleContainer/Grid，TypeScript 转译通过。
- `node tools/tests/v8_money_record_regression.js`：10 项流水显示检查通过。
- `env GOCACHE=/tmp/qing-go-cache go test ./...`、`go vet ./...`（目录 `XuanManager/server`）通过，覆盖八种开关组合、兼容缺省、非法汇率、写入映射/回读/审计/修订和必填字段。
- `npm run lint`、`npm run build`（目录 `XuanManager/web`）通过。依照锁文件安装本地依赖，未改包清单/锁文件，生成的 node_modules/dist 为忽略文件。
- 实现阶段未运行 Creator、未实际提现、未读写生产数据库或部署。随后用户明确要求更新服务器，后台已部署且登录态只读验收通过，详见[部署交接](2026-09-13-xuanmanager-withdrawal-deploy.md)；真实提现和正式后台配置保存仍未执行，客户端未发布。

下步以用户指定任务为准。配置契约已补入 `XuanManager/新后台管理系统接口文档.md` 的 13.3.1；当前状态和后台专题仅保留摘要链接。
