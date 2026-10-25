# 2026-10-24 俱乐部邀请码入会（客户端接入）

## 目录/分支
- 根目录 `/Volumes/SSD/qing`，分支 `codex/club-ui`。
- 本轮改动**未提交**（工作区还带着同日俱乐部 UI 代理信息的未提交改动）。
- 文档依据：`服务器文档整理/俱乐部代理与邀请码-客户端接口文档.md` §4.7 / §4.9（该目录只读，未改）。

## 目标
按服务端已上线的口径，把「申请加入俱乐部」从**俱乐部 ID** 改为**邀请码**，并把进房的 `roomSetting.club_id` 补上。

## 改动文件
- `assets/scripts/UI/panelMain.ts`
  - 新增 `clubJoinPending`：带码入会时服务端先回 `0x500`，期间的超时兜底文案改为「已提交，请稍后查看俱乐部列表。」，不再报「操作超时」。
  - `SendClubCommand` 发送前复位 `clubJoinPending`。
  - `JoinClub()`：请求改为 `{header:"申请_加入_俱乐部", invite_code}`（不再传 `club_id`），校验失败文案改「请输入6位邀请码！」。
  - `RefreshClubIdDisplay()`：占位文案「请输入邀请码」。
  - `HandleClubHallCommand()`：`club:join` 收到 `0x500` 时保持 busy 且不弹提示，等最终 `0x200/0x301`；删掉旧的 `isDirectJoin` 分支（旧逻辑把 `0x500` 当「已直接入会」）。
  - 房间列表点击进房：`reqEnterRoom` 的 `roomSetting` 追加 `club_id`（取 `ResolveRoomClub()`，即当前房间列表所属俱乐部）。
- `assets/resources/UI/panelMain.prefab`
  - `加入俱乐部弹窗/面板/俱乐部ID输入框/俱乐部ID显示` 的默认文本改为「请输入邀请码」（仅改 `cc.Label._string`，节点名/结构/UUID 未动）。

## 验证
- `ts.transpileModule` 语法检查：0 诊断。
- 未做：Creator 重新导入、构建、真机、真实服务器联调。

## 未完成 / 待确认
1. **须向服务端确认**：老的 `查询_俱乐部_加入申请`（路由 `JoinerList`）行里是否带 `invite_code`/`agent_guuid`——决定创建者列表能否显示「哪个代理带来的」，文档未写。
2. **代理能否拒绝**：文档只给 `添加_俱乐部_玩家` 扩了权限，`删除_俱乐部_加入申请`（拒绝）没提；若服务端未扩，代理点拒绝会收到 `只有俱乐部管理员允许操作！`。
3. **其它进房入口仍未带 `club_id`**：`RoomInviteManager`、`QueueMatchManager`、`panelHongli`、`panelGameView` 的 `reqEnterRoom` 仍是 `{"special_rule":"观战"}`。按文档这类进房不会阻断，只是不参与俱乐部分成；是否补由产品定。
4. 服务器实际参数名/回调 context 未联调，`0x500` 后最终回调若不带 `club:join` context，会走 10s 超时兜底。

## 第二轮：代理按邀请码查申请 / 审批（2026-10-24）

目标：申请一律按邀请码查——代理查自己码带来的申请，有就点同意/拒绝。

改动：
- `ClubManagementView.ts`
  - `ClubRole` 加 `"agent"`；新增 `approver()`（owner/manager/agent）。`manager()` 维持 owner/manager（成员管理、解散、设管理员仍限这两个身份）。
  - `Refresh()`：`身份` 显示「代理」；`操作/管理成员` 入口与红点对 `approver()` 开放；`俱乐部申请弹窗` 的「返回成员」对非 manager 隐藏（代理点了是死按钮）。
  - `HandleButton("管理成员")`：代理直接 `open("applications")`，不进成员列表。
  - `open()` / `load()` 的权限门分开：members 要 manager，applications 要 approver。
  - `confirm()`：agree/reject 走 approver 判定，其余仍走 manager。
- `ClubManagementApi.ts`
  - 构造函数新增 `isAgent(club)` 与 `agentClubs()` 两个注入点（同文件仍兼容旧调用，默认 `()=>false` / `()=>[]`）。
  - `list()`：members 不变；applications 按 `isAgent` 分流到 **`查询_俱乐部_代理_申请`**，否则仍 `查询_俱乐部_加入申请`。
  - 注册 **`ClubAgentReqInfo`** → `OnAgentApplications`（`{number,count,result:[...]}`，无 context/club_id，复用既有串行车道 `applicationActive` 配对；兼容外层被包成 `ClubAgentReqInfo` 数组的情况）。
  - `RefreshBadges()`：创建者/管理员仍查老命令；代理额外查一次 `查询_俱乐部_代理_申请`（page0/count1）取 `count` 当红点，因为服务端没有代理视角的红点推送。
  - `act("approve")`：代理没有成员列表权限，不再用 `查询_俱乐部_成员` 复查（否则必假失败），改为受理即回 + 列表刷新兜底。
- `panelMain.ts`
  - 新增 `IsClubAgentIn(clubId)`（非创建者/管理员且 `clubAgentInfo[club].invite_code` 非空）与 `GetClubAgentIds()`，注入给 API。
  - 俱乐部上下文 `role` 增加 `"agent"`。
  - `OnClubAgentInfo` 收到码后额外触发 `clubManagement.Refresh()` + `clubManagementApi.RefreshBadges()`，代理入口/红点才会出现（登录时首轮 RefreshBadges 时代理码还没回来）。

验证：三个脚本 `ts.transpileModule` 0 诊断；`tsc` 全量类型检查里这三个文件只剩历史遗留错误（`require`/`cc.RawAsset`/`QRCode`），本次改动无新增。仍未 Creator 导入、未构建、未真机、未联调。


## 第三轮：角色判据以服务端 is_agent 为准（2026-10-24）

抓包确认 `查询_俱乐部_代理_信息` 实际回包（文档未收录 `is_agent`、且普通成员 `invite_code` 并不为空）：

```json
{"number":0,"count":1,"result":{"club_id":"222697","user_id":"718968","user_name":"abc",
 "is_creator":0,"is_agent":0,"invite_code":"435154","percent":0,
 "upper_guuid":"237737","upper_name":"天外飞仙","downline_count":0,"downline":[]}}
```

- 角色判据改为：`is_creator=1`→老板；否则 **`is_agent=1` 才算代理**（字段存在时只认它，不再看 `invite_code`）。
  没有 `is_agent` 字段时才退回「有码即代理」的老口径。`percent` 不参与判定（代理比例允许为 0）。
- `OnClubAgentInfo` 保留「`user_id` 必须是本人」的校验；排查用日志已移除。
- 影响：普通成员在俱乐部列表显示「玩家」、不展示邀请码、无审批入口与红点；代理/老板行为不变。
- 文档需更新：§2.1 补 `is_agent`、修正「普通成员 invite_code 为空串」；另需确认成员码能否用于加入俱乐部。

## 第四轮：审批最终回包口径修正（2026-10-25）

依据更新后的 `服务器文档整理/俱乐部代理与邀请码-客户端接口文档.md`：`0x500` 是服务端内部异步标记，不会下发给客户端；`添加_俱乐部_玩家` 最终通过同一 `context` 回 `0x200`，失败回 `0x301`。

- `ClubManagementApi.ts`：审批收到最终 `0x200` 后立即完成，不再追加 `查询_俱乐部_成员` 等待 `NumberList`，避免入会已成功但推送缺失时确认弹窗卡到超时；列表请求仍兼容 `0x500`。
- `panelMain.ts`：移除邀请码入会对客户端 `0x500` 的旧分支和旧超时文案，按最终 `0x200/0x301` 处理。
- 同时修复 `ClubManagementApi.ts` 中 `receive()` 参数遮蔽全局 `field()` 的问题，避免申请列表有数据时出现 `field is not a function`。
- 验证：`tools/test_club_joiner_protocol.js`、三个相关脚本 TypeScript 转译、`git diff --check` 通过；Creator 导入、构建、真实账号复测仍待执行。

## 第五轮：所有进房入口补充俱乐部上下文（2026-10-25）

依据更新后的接口文档，`reqEnterRoom` 的 `roomSetting` 需要携带俱乐部房间的 `club_id`。新增 `assets/scripts/logic/RoomClubContext.ts`，统一处理账号俱乐部、已选俱乐部、当前 `roomSetting` 和入口显式 ID；它可以读取旧双大括号输入，但下发前统一输出单层合法 JSON。

- `panelMain`：房间列表点击、手动输入房号、断线恢复均补 `club_id`；大厅俱乐部列表同时纳入 `club_join2`。
- `panelCreateRoom`、`panelGameView`、`panelHongli`：创建房间、牌桌恢复、下级玩家观战均补 `club_id`。
- `QueueMatchManager`：优先使用撮合消息中的 `club_id`，否则使用当前房间上下文；目标房请求带入该 ID。
- `RoomInviteManager`：邀请消息升级为 `ROOM_INVITE|V3` 并携带来源俱乐部，接收端保留 V2/V1/旧四段格式解析；普通 V2 邀请仍用本地已选俱乐部回退进房。

验证：全部进房调用点已扫描，相关七个 TypeScript 文件转译通过，`RoomClubContext` 的显式/已选/当前房间选择与单双大括号序列化回归通过，既有俱乐部协议回归和 `git diff --check` 通过。Creator 导入、构建、真实账号、邀请跨版本兼容和多俱乐部归属仍待验证。
