# 2026-11-03 消息/直聊按联盟层级调整

分支：`codex/club-ui`。状态：服务端已部署（2026-11-03 19:15）；已随 `c77b7e5` 提交并推送到 `origin/codex/club-ui`；客户端脚本已改，**未构建、未真机/双账号验证**。

## 目标

1. 普通玩家固定显示本俱乐部老板；俱乐部入盟后同时固定显示联盟大群主，且固定会话不能删除。
2. 保留原有「直属上级代理」固定会话（用户确认）。
3. 俱乐部老板可对本俱乐部成员「上下分 + 赠送积分」；代理只能「赠送」，不能上下分。
4. 联盟大群主可以和联盟内任意俱乐部的任意成员一对一聊天；同一个人按俱乐部各保留一条会话。
5. 大群主找人入口：成员列表里的盟主虚拟行可直接对话；盟友管理行不再打开成员列表（2026-11-04 移除了误开「选择聊天对象」的点击入口）。

## 服务端（ChatTool `/api/direct/*`）

- `model.go`：新增合成角色 `union_owner`（大群主）；`Club` 增加 `UnionID`；`Member` 增加 `IsUnionOwner`（不落库）；`CanHideConversation` / `CanCreateFromMemberList` 允许大群主。
- `game_directory.go`：`GetClub` 读取 `club_guuid_info.union_id`；新增 `GetUnionByClub`（连 `club_union_info` 取 `owner_guuid/club_guuid`）和 `GetAccount`（跨俱乐部补昵称头像）。
- `service.go`：
  - 固定联系人改为「直属上级代理 + 本俱乐部创建者 + 联盟总群主」，按 guuid 去重；大群主不再生成固定上级/老板入口。
  - `viewerForClub` 允许联盟总群主对联盟内任意俱乐部使用 `union_owner` 身份；`peerForClub` 允许把大群主本人当作跨俱乐部会话对方。
  - `CreateConversation` / `Messages` / `SendMessage` / `Hide` / 附件接口改用新身份校验；固定联系人禁止删除。
  - 跨俱乐部会话归属**对方所在俱乐部**（`club_id`），因此同一对方在不同俱乐部各一条。
  - `AllConversations` 改为按参与者读取全部会话，不再只遍历自己所属俱乐部；跨俱乐部私聊才能出现在消息首页。
  - 成员列表允许大群主查看联盟内任意俱乐部，`canChat=true`。
- `store.go`：新增 `ListConversationsByUser`，与 `ListConversations` 共用带可选 `club_id` 的查询。
- `fake_store_test.go` / `service_test.go`：补联盟目录、跨俱乐部会话、固定入口、删除限制、按俱乐部拆分、成员列表权限测试；原固定上级测试更新为同时存在俱乐部老板入口。

## 客户端

- `DirectChatManager.ts`：角色名改为老板 / 大群主 / 代理；删除权限加入 `union_owner`。
- `panelMessage.ts`：列表昵称后只对老板、大群主追加身份标识。
- `panelMessageChat.ts`：上下分只对 `owner` 显示；赠送对老板、代理、旧 `leader` 显示；大群主跨俱乐部会话不显示资金入口。
- `ClubManagementApi.ts`：成员行解析 `club_id`。
- `ClubManagementView.ts`：
  - 成员行「对话」按 `item.clubId || context.id` 建会话，盟主虚拟行直接找对方俱乐部。
  - ~~盟友管理行头像/名字可点，打开 `panelMessageMembers`~~（2026-11-04 已移除：点击会误开「选择聊天对象」）。
  - ~~行内提示「点名字查看成员」~~（随点击入口一并移除）。
- `panelMessageMembers.ts`：入口参数兼容旧 clubId 字符串和 `{clubId, clubName}`；`start` 二次读取，避免 `setPanelInfo` 晚于 `onLoad`；大群主可查联盟内任意俱乐部并发起会话。

## 验证

已执行：

- `gofmt`、`go build ./...`、`go vet ./...`、`go test ./...` 全绿；新增 5 个联盟直聊用例。
- 6 个改动 TS 文件用 TypeScript `transpileModule` 语法检查通过。
- `git diff --check` 通过。
- 线上游戏库只读账号已确认可查 `club_union_info`（1 条联盟）与 `club_guuid_info.union_id`（`''` 未入盟 / `916139` 已入盟 2 家）。
- 已构建 Linux amd64 静态二进制 `40fc3e4c0e1d37f6bfa173cee204a4e2656e184c13d99257c2e7b3b755892a17`，通过 `client_update@154.37.155.17:2233` 部署到 `/www/html/.chattool/bin/chattool`。
- 回滚点：`/www/html/.chattool/bin/chattool.previous-union-chat-20261103-1915`（旧版 `368f80a8…`）。
- 本机与公网 `/chattool/api/health` 均 200；未登录直聊成员接口 401；进程 `/www/html/.chattool/bin/chattool` 已指向新文件。

未验证（不得当作已通过）：

- 真实账号的跨俱乐部实时推送、未读汇总、断线补偿未联调（部署后尚未用真实会话票据验证）。
- Creator 导入、Prefab 布局、正式包、Android/iOS 真机、双账号大群主/盟主/代理/玩家全链路。
- 金币命令（`添加_俱乐部_成员_积分` / `赠送_俱乐部_积分`）的实际服务端权限与额度口径未回归；客户端只负责入口显隐。

## 下一步

1. 确认 ChatTool 的 `CHAT_GAME_DB_*` 只读账号能 `SELECT club_union_info`（原来只用到 `tbl_Account` / `club_guuid_info` / `club_agent_info`）；在测试库执行 `GetUnionByClub` 等价 SQL，确认 `owner_guuid` 与 `union_id` 数据可用。
2. 部署 ChatTool 后按「大群主、盟主、代理、普通玩家、跨俱乐部成员」五类账号联调：固定入口、不可删除、跨俱乐部收发、消息首页、未读、断线补偿。
3. Creator 重新导入脚本，真机验证成员列表盟主行直接对话与聊天页底部按钮布局（盟友行点击入口已移除）。
