# 后台靓号管理 — 实施交接（2026-11-14）

## 目录 / 分支
- 项目根：`/Volumes/SSD/qing`
- 后台：`XuanManager/`（Go + React/Vite）
- 当前分支：`codex/club-ui`（保留其他任务未提交改动）

## 目标
按 `服务器文档整理/玩家靓号绑定-后台接口文档.md`（2026-11-14）在 XuanManager 实现靓号功能：
号池列表、候选号、入池、绑定、解绑，并在玩家/俱乐部展示 `真实ID(靓号)`。

## 改动文件
### 后端
- 新增 `XuanManager/server/internal/api/pretty_numbers.go`
  - 代理 4 条游戏服命令：`异步_添加_靓号`、`异步_查询_靓号_池`、`异步_绑定_靓号`、`异步_解绑_靓号`。
  - 候选号查询：`usr_guuid_info`（个人ID）/ `club_invite_code_info`（邀请码），只接受 prefix/suffix/contains + 1–6 位数字。
  - 参数校验、错误文案透传、写操作互斥、`mgr_audit_log` 审计。
  - `hasPrettyNumberTable` 探测 `kbedm.usr_pretty_no_info`，未建表时玩家列表降级不显示靓号。
  - `loadPrettyNumbers` 批量补个人ID靓号。
- 新增 `XuanManager/server/migrations/064_pretty_numbers.sql`
  - 菜单 `game.pretty_numbers`（parent 20），权限 `game.pretty_no.view` / `game.pretty_no.manage`，按 code 授权。
- 改 `XuanManager/server/internal/api/server.go`
  - `Server` 增加靓号表探测缓存；注册 5 条路由。
- 改 `XuanManager/server/internal/api/players.go`
  - 玩家列表/搜索 LEFT JOIN `usr_pretty_no_info`，新增 `prettyNo`、`prettyNo` 精确筛选，关键字也命中靓号。
  - 保留真实 `playerId` 为所有接口键。
- 改 `XuanManager/server/internal/api/relations.go`
  - 关联账号补 `prettyNo`。
- 改 `XuanManager/server/internal/api/clubs.go`
  - 俱乐部成员树补 `prettyNo`；邀请码原本就展示 `inviteCode`，靓号自动生效。
- 测试：`pretty_numbers_test.go`，并同步 `players_test.go`、`relations_test.go` 的 `buildPlayerWhere` 参数。

### 前端
- 新增 `XuanManager/web/src/pages/PrettyNumbersPage.tsx`
  - 号池筛选/分页、候选号入池、绑定（个人ID/邀请码 + 俱乐部）、解绑确认。
- 改 `XuanManager/web/src/App.tsx`：`/game/pretty-numbers` 路由。
- 改 `XuanManager/web/src/components/Layout.tsx`：菜单图标「号」。
- 改 `XuanManager/web/src/pages/PlayersPage.tsx`：`真实ID(靓号)` 展示、按靓号筛选、关联账号展示。
- 改 `XuanManager/web/src/pages/ClubsPage.tsx`：成员树 ID 显示靓号。
- 改 `XuanManager/web/src/types.ts`、`styles.css`、`README.md`。

## 验证结果
- 本地 `go build ./...`、`go vet ./...`、`go test ./...`：通过。
- 本地 `npm run lint`、`npm run build`：通过。
- 正式部署（2026-11-14 23:37 CST）：8891 已切换，健康检查 200；`/api/game/pretty-numbers` 未登录返回 401。
- 正式二进制 sha256：`4d58b6e91a60f611c1c9f67c5f83d7b5c6f7048dbf7e3a129bbdc2bb23562c6f`，与本地一致；进程 `/proc/<pid>/exe` 同哈希。
- 正式前端资源 `assets/index-H_Fbez78.js` sha256 与本地一致。
- 迁移 `064_pretty_numbers.sql` 已执行；模块 `game.pretty_numbers` 和两个权限已落库，各授权 4 个角色。
- 游戏服 `usr_pretty_no_info` 已存在（当前 0 行）；只读调用 `异步_查询_靓号_池` 返回 `ret_code=512`、`total=0`，说明命令已部署。
- 未做：登录态页面人工验收、真实入池/绑定/解绑联调。

## 回滚点
- 旧二进制：`/www/html/.xuanmanager/backups/xuanmanager.20261114-233702-replaced`
- 旧前端：`/www/html/.xuanmanager/backups/web.20261114-233702-rollback`（完整目录备份；`web.previous-*` 未保留）
- 回滚：`stop.sh` → 恢复二进制和 web → `start.sh` → 健康检查。
- 迁移 064 已记录在 `mgr_schema_migration`，回滚二进制不会自动删除菜单/权限；如需彻底回退需另行处理。

## 未完成 / 下一步
1. 用测试号跑通：候选→入池→绑定个人ID→客户端显示→解绑；邀请码靓号需先确保目标账号是该俱乐部在职代理。
2. 当前未提供“设为代理”快捷入口；绑定弹窗已提示先在游戏内/俱乐部管理设置代理。若确认 boss 可调用 `设置_俱乐部_代理`，可再补一键操作。
3. 文档未明确个人ID靓号在客户端用哪个字段下发；后台展示不依赖该结论，客户端需另行抓包确认。

---

# 追加（2026-11-14 晚间）：靓号按类型拆成两个独立入口

## 需求
原实现把「账号ID靓号」和「俱乐部邀请码靓号」混在一个「靓号管理」页面，靠类型下拉切换，运营容易在同一个号池里串号。改为两个独立模块、各自入池：**账号ID靓号**、**俱乐部邀请码靓号**。

## 设计约束
- 游戏服 `usr_pretty_no_info` 仍是一张表、用 `kind` 区分，命令也不区分入口；**拆分只发生在后台**：路由段、权限、菜单、页面各拆两份。
- 类型只由路由段 `/api/game/pretty-numbers/{uid|invite}/...` 决定，请求体和查询串里的 `kind` 只能与路由一致，否则 400，防止在账号ID页面误绑邀请码。
- 号码跨类型唯一性不变（服务端保证），因此两个池子的号码不会重复。

## 改动文件（本轮）
### 后端
- `server/internal/api/pretty_numbers.go`
  - 新增 `prettyKindFromRequest`（从 URL 路径第二段取类型）与 `ensurePrettyBodyKind`（请求体 `kind` 必须与路由一致）。
  - 4 个 handler 不再读 body/query 的 `kind`；`parsePrettyNumberFilter` 增加 `kind` 入参，列表命令固定带上本页类型。
- `server/internal/api/server.go`
  - 靓号路由按类型注册两组（uid / invite），权限分别用 `game.pretty_no.uid.view|manage`、`game.pretty_no.invite.view|manage`。
- `migrations/065_pretty_numbers_split.sql`（新增，**未执行**）
  - 停用并隐藏 `game.pretty_numbers` 合并入口及旧权限 `game.pretty_no.view|manage`（不删，保留历史授权）。
  - 新增模块 `game.pretty_no_uid`（账号ID靓号，sort 46）、`game.pretty_no_invite`（俱乐部邀请码靓号，sort 47）及其 4 条权限。
  - 总管理员直授；原持有旧 view/manage 的角色按类型继承到两个新模块。
- `server/internal/api/pretty_numbers_test.go`：路径与入参同步；新增「请求体类型与路由不一致应 400」用例。

### 前端
- `web/src/pages/PrettyNumbersPage.tsx`：改为按 `kind` prop 渲染。去掉类型下拉与类型列；入池弹窗固定类型（不再让运营选）；邀请码页保留「归属俱乐部」列；接口路径带类型；权限按类型判断。
- `web/src/App.tsx`：`/game/pretty-numbers/uid`、`/game/pretty-numbers/invite` 两条路由（旧路由由 App 的模块白名单兜底自动跳走）。
- `web/src/components/Layout.tsx`：菜单图标 `pretty-uid`（号）、`pretty-invite`（码）。
- `README.md`：靓号说明改写为两模块口径。

## 验证（本地）
- `go build ./...`、`go vet ./...`、`go test ./... -count=1`：通过。
- `npx tsc --noEmit`、`npm run lint`、`npm run build`：通过（产物 `index-u3RHW5AK.js` / `index-BTxbi2Xv.css`）。

## 未做 / 下一步
1. **未部署**：二进制与前端未上传，迁移 065 未执行；部署后旧「靓号管理」菜单消失、出现两个新菜单。
2. 未做登录态人工验收：两页各自的入池、绑定、解绑，以及"有账号ID权限但无邀请码权限"的账号只能看到第一个菜单。
3. 已授予旧合并权限的角色会自动继承新权限；若某角色是在 064 之后单独加过 `game.player.view`，需要手工补授新模块权限。

## 部署（2026-11-15 00:04 CST，已完成）

- 方式：本地交叉编译 linux/amd64 静态二进制 → scp → `stop.sh` → 换 `bin/xuanmanager` 与整目录 `web/` → `start.sh`；迁移随启动自动执行。
- 二进制 sha256 `fd301ed18b59b93ec4c6fc727e78c7450859de5bd6a52619eafe65d3142f82e0`（与本地一致）；前端 `index-Bm-CcHP9.js` / `index-BTxbi2Xv.css`（与本地 dist 哈希一致）。
- 迁移 `065_pretty_numbers_split.sql` 已执行（00:04:58）。库内结果：模块 61 `game.pretty_numbers` visible=0/disabled，62 `game.pretty_no_uid`、63 `game.pretty_no_invite` enabled；权限 4 条新 code enabled、旧 `game.pretty_no.view|manage` disabled；两套新权限各 4 个角色已授权。
- 验证：健康检查 200；`127.0.0.1:8891` 仅本机监听；`/api/game/pretty-numbers/uid|invite`、`/uid/candidates` 未登录 401（路由存在），旧 `/api/game/pretty-numbers` 404（已下线）；公网 `http://154.37.155.17/xuanmanager/` 200 且加载新 hash；日志无 error，轮播工作器随正式实例正常启停。
- 回滚点：`/www/html/.xuanmanager/backups/xuanmanager.20261115-0006-pre-pretty-split`（旧二进制）、`backups/web.20261115-0006-pre-pretty-split`（旧整目录前端）。回滚：`stop.sh` → 覆盖回两者 → `start.sh`；迁移 065 已记入 `mgr_schema_migration`，回退二进制不会自动撤销菜单/权限变更，需另行处理。
- 未做：登录态页面人工点击验收（两个菜单是否按权限分别出现、两页各自入池/绑定/解绑）。

---

# 追加（2026-11-15 00:12）：回归单菜单，页内两个页签

## 需求
用户确认：不要两个菜单，从一个「靓号管理」进去，页内用两个页签切换「账号ID靓号 / 俱乐部邀请码靓号」。

## 改动
- 迁移 `066_pretty_numbers_single_menu.sql`：模块 61 `game.pretty_numbers` 恢复 enabled/visible，名称「靓号管理」、路由 `/game/pretty-numbers`；065 建的两个独立模块 62/63 隐藏停用；4 条按类型权限的 `module_id` 重新挂回 61（任一 view 即见菜单，页内再按类型控制页签与操作按钮）。
- 前端 `PrettyNumbersPage.tsx`：外层渲染统一头部 + `.segmented` 页签（只渲染有权限的类型；只有一个权限时不显示页签），内层 `PrettyKindPanel` 用 `key={kind}` 重挂，切页签自动重置筛选/分页/列表。
- `App.tsx`：恢复单路由 `/game/pretty-numbers`，权限判断改为 `uid.view || invite.view`。

## 验证（本地 + 线上）
- `go build/vet/test ./...`、`tsc --noEmit`、`eslint`、`vite build` 全通过。
- 部署 2026-11-15 00:12 CST：二进制 sha256 `09a2e153…ad46da`、前端 `index-DbCuYgZl.js`；健康 200，公网 `/xuanmanager/` 200 加载新 hash。
- 迁移 066 已执行：模块 61 enabled/visible、62/63 visible=0/disabled；4 条新权限 module_id=61 且 enabled，旧 `game.pretty_no.view|manage` 仍 disabled。
- 接口仍按类型分组（`/api/game/pretty-numbers/{uid|invite}/...`），未登录 401，权限码未变。
- 回滚点：`backups/xuanmanager.20261115-0012-pre-pretty-tab`、`backups/web.20261115-0012-pre-pretty-tab`。

## 未做
- 登录态人工点击验收：页签切换、各页签入池/绑定/解绑。

# 追加（2026-11-15 00:23）：绑定弹窗按类型彻底分开文案

## 需求
运营反馈：绑定弹窗里账号ID和邀请码共用一套字段（都叫“目标玩家真实ID”），容易搞混，要求分开提示。

## 改动（纯前端）
- 账号ID页签：标题「绑定账号ID靓号 888888」，提示条说明“号码会变成该玩家的账号ID，后台仍按真实用户ID走”，字段只有「用户ID」（hint 明确“这里是用户ID、不填靓号”）。
- 邀请码页签：标题「绑定邀请码靓号 666666」，提示条说明“号码会变成代理在指定俱乐部的邀请码、旧随机码作废”，字段为「代理用户ID」+「俱乐部ID」。
- 行内按钮：账号ID 页「绑定用户」，邀请码页「绑定邀请码」；表头按类型显示「绑定账号」/「绑定代理」；成功提示、校验文案、确认勾选文案、解绑提示、提交按钮文案全部按类型区分。

## 验证与部署
- `tsc --noEmit`、`eslint`、`vite build` 通过；前端 `index-D6qXug5B.js`。
- 只替换 `/www/html/.xuanmanager/web`，未重启后端；健康 200，公网 `/xuanmanager/` 200 且加载新 hash，bundle 内含「代理用户ID」文案。
- 回滚点：`backups/web.20261115-0023-pre-bind-copy`。

# 追加（2026-11-15 00:27）：关闭解绑

## 需求
用户要求关闭解绑：已绑定的号码不允许解绑，页面隐藏解绑入口。

## 改动
- 后端 `pretty_numbers.go`：新增常量 `prettyUnbindEnabled = false`，`handleUnbindPrettyNumber` 入口直接返回 400 `PRETTY_UNBIND_DISABLED`「靓号解绑已关闭：已绑定的号码不支持解绑」，不再调用游戏服；路由、审计、原逻辑保留，恢复时把常量改回 `true` 即可。
- 前端 `PrettyNumbersPage.tsx`：删除解绑按钮与 `UnbindPrettyNumberModal`（含 unbinding 状态、渲染分支）；已绑定行操作列改为灰字「已绑定不可解绑」；工具栏说明补“已绑定号码不可解绑”。
- 测试 `pretty_numbers_test.go`：原「解绑透传游戏服错误」用例改为「解绑关闭时 400 且不调用游戏服」。

## 验证与部署
- `go build/vet/test ./...`、`tsc --noEmit`、`eslint`、`vite build` 通过。
- 部署 2026-11-15 00:27 CST：二进制 sha256 `27901f9e…99844`、前端 `index-pnyhJ-2n.js`；健康 200，公网 200 加载新 hash。
- 线上证据：二进制内含 `PRETTY_UNBIND_DISABLED` 标记；前端 bundle 内 `pretty-unbind` 出现 0 次；解绑路由未登录仍 401（鉴权在前，登录后才会返回“解绑已关闭”）。
- 回滚点：`backups/xuanmanager.20261115-0027-pre-unbind-off`、`backups/web.20261115-0027-pre-unbind-off`。
- 未做：登录态点击确认（已绑定行确实不再有解绑按钮、接口返回 400 文案）。

## 影响
- 一旦绑错号码，后台无法自行纠正，只能线下改库（原文档中“号码不回收、解绑后停用”的口径现在只在服务端命令层面存在，后台不再提供）。

# 追加（2026-11-15 00:33）：邀请码绑定改为「输入用户当前邀请码」反查

## 背景
用户指出：邀请码弹窗让运营填「代理用户ID + 俱乐部ID」不符合实际操作——运营手上只有“这个用户现在的邀请码”。核对服务端文档，`异步_绑定_靓号` 的 invite 分支确实只收 `user_guuid` + `club_id`，**没有按邀请码绑的参数**，所以不是文档写错；正确做法是后台自己反查。

## 改动
- 后端新增 `GET /api/game/pretty-numbers/invite/lookup?code=482913`（权限 `game.pretty_no.invite.view`）：
  `club_invite_code_info` LEFT JOIN `tbl_Account` / `club_guuid_info`，返回 `found / inviteCode / userId / userName / clubId / clubName / status / isPretty`；码不存在返回 `found=false`；码格式非 6 位 400；顺带判断该码是否已是绑定中的靓号。
- 前端邀请码弹窗改为：主入口「用户当前的邀请码」+「查询归属」→ 查到后展示卡片（被替换的代理 / 所属俱乐部 / 原邀请码将作废）→ 确认替换；查不到时提示，并提供「手动指定代理和俱乐部」的兜底（应对还没分配邀请码的新代理）。账号ID 弹窗不变。
- 样式新增 `.pretty-lookup` / `.pretty-link`；测试补 `TestHandleLookupInviteCodeRejectsBadCode`。

## 验证与部署
- 线上 SQL 预验：`invite_code/user_guuid/sm_name/club_guuid/club_name/status` 均能取到（例：198329 → 718968 abc11 → 775447 A1俱乐部）。
- `go build/vet/test`、`tsc`、`eslint`、`vite build` 通过。
- 部署 2026-11-15 00:33 CST：二进制 `d8b2a9c9…66ec8`、前端 `index-B22CqjBY.js` / `index-YIXVHnfJ.css`；健康 200，公网 200，bundle 内含「用户当前的邀请码」「查询归属」「被替换的代理」。
- lookup 路由未登录 401（存在且需鉴权）。
- 回滚点：`backups/xuanmanager.20261115-0033-pre-invite-lookup`、`backups/web.20261115-0033-pre-invite-lookup`。
- 未做：登录态实际点一次（用真实已用码 198329 走完查询→替换），会真实改代理邀请码，需业务授权后再做。

# 追加（2026-11-15 00:41）：邀请码绑定简化为只传原始邀请码

## 需求
用户明确：俱乐部绑定靓号只需输入原始邀请码，参数 `invite_code`。

## 改动
- 后端 `handleBindPrettyNumber`：invite 分支不再接受 userId/clubId；改为读 `inviteCode`（同时兼容 `invite_code`），先 `lookupInviteOwner` 反查出代理与俱乐部，再按服务端要求调 `异步_绑定_靓号`。新增错误：`INVALID_INVITE_CODE`（非 6 位 / 与原号相同）、`INVITE_CODE_NOT_FOUND`、`INVITE_CODE_INCOMPLETE`（码无归属代理/俱乐部）。审计里补 `inviteCode`。
- 抽出 `lookupInviteOwner`，`GET /invite/lookup` 复用它（该接口保留，前端不再调用）。
- 前端邀请码弹窗只剩一个「原始邀请码」输入框 + 备注 + 确认；删掉“查询归属/归属卡片/手动指定代理”整套交互与对应样式（`.pretty-lookup`、`.pretty-link` 已移除）。
- 测试：`TestHandleBindPrettyNumberRequiresInviteCode`（不传码 400）替换原“缺 clubId”用例；`TestHandleBindPrettyNumberReturnsOldInviteCode` 改为 `SendsUserId`（账号ID路径）。

## 验证与部署
- `go build/vet/test ./...`、`tsc`、`eslint`、`vite build` 通过。
- 部署 2026-11-15 00:41 CST：二进制 `1b11aecb…51020`、前端 `index-B6jh32uk.js`；健康 200，公网 200。
- 线上前端核对：「原始邀请码」出现 5 次，「查询归属 / 被替换的代理 / 手动指定代理」均为 0；bind 路由未登录 401。
- 回滚点：`backups/xuanmanager.20261115-0041-pre-invite-code-only`、`backups/web.20261115-0041-pre-invite-code-only`。
- 未做：登录态真实换码（会改代理邀请码，需业务授权）。

## 副作用
- 用法上绑定目标完全由原邀请码决定：代理如果还没有邀请码（新设代理未发码 / 码已作废），后台无法用它定位，需先在游戏内处理。

# 追加（2026-11-15 00:48）：纠正——服务端已支持直传 invite_code

## 情况
上一轮后台自己查 `club_invite_code_info` 反查代理与俱乐部是多余的：用户明确服务端 `异步_绑定_靓号` 已支持直接接收 `invite_code`，由服务端自己解析。

## 改动
- 后端 `handleBindPrettyNumber`：invite 分支只往命令里放 `invite_code`，不再放 `user_guuid` / `club_id`；uid 分支不变。
- 删除后台反查：`inviteLookupResponse`、`lookupInviteOwner`、`handleLookupInviteCode`、`GET /invite/lookup` 路由及对应用例；`database/sql` 的 import 一并去掉。
- 新增用例 `TestHandleBindPrettyNumberSendsInviteCode`：断言命令参数含 `invite_code`、不含 `user_guuid`/`club_id`。
- 前端不变（仍是只填「原始邀请码」，发 `inviteCode`）。
- 服务端接口文档 `服务器文档整理/玩家靓号绑定-后台接口文档.md` 补 `invite_code` 字段与变更记录。

## 验证与部署
- `go build/vet/test ./...` 通过；只发后端二进制 `a6e35ecb…34d00`，前端未动（`index-B6jh32uk.js` 保持）。
- 健康 200；线上 `/invite/lookup` 已 404（下线），`/invite/{prettyNo}/bind` 未登录 401。
- 回滚点：`backups/xuanmanager.20261115-0048-pre-invite-passthrough`。
- 未做：登录态真实换码（会改代理邀请码，需业务授权）；服务端对 `invite_code` 的实际接受度以首次真实绑定为准。
