# 2026-10-30 俱乐部角色标签：盟主 / 代理

## 目标与范围

- 目录：`/Volumes/SSD/qing`；分支：`codex/club-ui`；Creator 2.4.13。
- 依据：`服务器文档整理/俱乐部盟主-客户端接口文档.md`（2026-10-30）。
  - 盟主 = 创建者的**直属**代理；再往下的代理仍叫「代理」。
  - 盟主首先是代理（`is_leader=1` 必然是 `is_agent=1`），不改任何权限，只改展示。
- 改角色标签，不动服务端命令、代理树权限与分账关系。

## 基线

- 成员行：`ClubManagementApi` 只解析 `is_agent`，UI 一律显示「代理」。
- 「我的」底部身份牌、俱乐部列表卡片：只看 `is_agent`，显示「代理」。
- 玩家设置弹窗身份：只看 `isAgentPlayer`，显示「代理」。

## 改动与来源

- `assets/scripts/UI/ClubManagementApi.ts:312`：成员行新增解析 `isLeader`（`is_leader`，字符串/布尔兼容）。
- `assets/scripts/UI/ClubManagementView.ts:9,12`：`ClubContext.isLeader`、`ClubPlayer.isLeader`。
- `assets/scripts/UI/ClubManagementView.ts:169`：「我的」底部身份牌，`isLeader` 显示「盟主」。
- `assets/scripts/UI/ClubManagementView.ts:438`：成员列表/下级成员列表行，代理分「盟主 / 代理」。
- `assets/scripts/UI/ClubManagementView.ts:560`：玩家设置弹窗「玩家身份」同样显示「盟主」。
- `assets/scripts/UI/panelMain.ts:237`：俱乐部上下文增加 `isLeader`（来自 `ClubAgentInfo.is_leader`）。
- `assets/scripts/UI/panelMain.ts:3231`：俱乐部列表卡片的「身份」标签按 `is_leader` 显示「盟主」。

## 代理与邀请码文档复核（2026-10-30 版）

`服务器文档整理/俱乐部代理与邀请码-客户端接口文档.md` 本轮更新即盟主相关条目，逐项核对结论：

- `ClubAgentInfo.is_leader` / `NumberList.is_leader`：已解析并用于三处标签（上文改动）。
- 4.5 申请列表范围（创建者=全部 / 盟主=本线 / 代理=本码）与 4.8/4.8.1 审批权限：服务端判定，客户端不做逐行权限计算；列表行即可操作行，与现状一致。
- `ClubReqInfo` 统一推真实值（含 0）：`ClubManagementApi.OnBadge` 以 `req_count != null` 覆盖，0 也会生效；审批/拒绝成功后没有本地清零逻辑，符合「收到即覆盖」。
- `ClubAgentReq.agent_guuid/agent_name` 不再恒等于本人：客户端未依赖这两个字段做权限或归属判断，无需改动。
- 4.10 `直接_加入_俱乐部`：客户端仍走 4.7 申请 + 审批（`JoinClub`），4.7 带码已是异步最终回调，链路不变。
- 顺带修：申请列表 `render()` 只绑同意/拒绝，`行模板` 的姓名/玩家ID/头像一直是占位值。已在 `ClubManagementView.ts:516-520` 按玩家数据填充（与成员行同一套头像绑定）。

## 验证

- 静态核对：字段名与文档一致；`is_leader` 缺失时全部回退为「代理」，老服务端不受影响。未运行 Creator 编译或点击验证。

## 下一步

- 服务端实施 `is_leader` 后，在 Creator 预览确认：老板直属代理在成员列表、玩家设置、俱乐部列表卡片、「我的」身份牌均显示「盟主」；其下级代理仍显示「代理」。
- 若产品口径要求「盟主」与「管理员」并列展示，需要另行调整身份牌/成员行布局（当前单标签按 创建者 > 管理员 > 盟主 > 代理 > 成员 取一个）。
