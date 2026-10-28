# 自动化机器人后台（XuanManager）落地与上线

- 日期：2026-10-27
- 目录：`/Volumes/SSD/qing`，分支 `codex/club-ui`（以 `git status` 实时结果为准；本次未提交、未推送）
- 目标：按既有自动化方案实现运营后台全部页面与接口，先本地验收流程，再部署正式 8891 供人工检查。

## 实现内容

数据（`XuanManager/server/migrations/030_automation.sql`，474 行）：

- 14 张 `mgr_automation_*` 表：俱乐部接入、房间快照、策略、自动化组、Worker、终端、任务、会话、会话事件、凭据、出口 IP、告警、审批、数据范围。
- 模块 id 40–52（12 页 + 1 个分组）、权限 id 4001–5302 共 35 条，全部授角色 1；与已有机迁移无 ID/编码冲突。
- 演示数据：3 俱乐部、21 房间、21 终端、18 会话、10 事件、5 任务、6 告警、3 审批、6 凭据、5 出口 IP、3 策略、3 Worker、4 自动化组；`is_demo=1` 标记。

后端（`XuanManager/server/internal/api/automation*.go`，路由挂在 `server.go`）：

- 全部接口走 `authorized(权限, 是否写, handler)`；写操作有 CSRF/Origin 校验与审计；列表/详情受俱乐部数据范围（`mgr_automation_scope`）约束。
- 高风险批量停止/排空/删除超过 10 台必须带理由并生成审批单；审批决定校验数据范围、禁止非超级管理员自审；执行改为「先全量校验范围，再逐台落库」，避免部分停止。
- 终端动作、任务取消/重试、策略灰度发布与回滚、告警处理、凭据重置（不回显密码）均按方案实现。

前端（`XuanManager/web/src/pages/automation/`，12 页 + `shared.tsx`）：

- 总览、俱乐部接入、房间监控、机器人终端、自动化组、任务与审批、策略、对局记录、Worker、凭据与设备、告警、审计；路由与权限门控在 `App.tsx`，菜单在 `Layout.tsx`。

## 本地验证（部署前）

- 本机无 MySQL：用临时 mock 服务（`/tmp`，未入库，验证后已停止）走通全部页面与主流程，未连真实库。
- 已覆盖：任务创建（含 `enter_room` 参数校验与俱乐部不匹配）、取消/重试；组 CRUD；策略新建/编辑/发布/回滚；俱乐部配置与范围保存；Worker 排空/恢复；凭据新建/编辑/重置；IP 新建/编辑；会话列表/详情时间线；告警认领/解决；审计列表；终端新建/删除；12 台批量停止 → 审批 → 通过；房间指派/召回。
- 本轮修正：`roomId` NaN 校验漏洞、`ClubSelect` 必选时状态为空、告警按钮文案、审计目标类型中文、总览在座口径、审批两阶段校验、会话结束原因/期望状态中文化、`eslint` 未使用变量与 `useMemo` 依赖。
- 构建：`go vet ./...`、`go test ./...`、`GOOS=linux` 交叉编译通过；`eslint src`、`tsc -b`、`vite build` 通过（仅 chunk >500 kB 提示）。

## 部署（2026-10-27 16:32，正式 8891）

- 同源判据：线上旧二进制为 stripped 静态包 8,655,032 B；用 HEAD（3032fe6）worktree 交叉编译 `-trimpath -ldflags="-s -w"` 得到同体积，确认线上原为 HEAD 构建。
- 后端：新包 9,072,824 B，sha256 `6ebb240f9ff0b477201504481c419e3122156fc3c06e508a3908ebbd01a47a39`，本地/上传后一致；`stop.sh` → `install` → `start.sh`，`/api/health` 200，日志 `XuanManager started`（16:31:58）。
- 迁移：启动时自动应用 `030_automation.sql`（16:31:58）；14 张表、13 个模块、35 条权限、35 条角色 1 授权、演示数据行数与种子一致。
- 前端：`index-DJZ1OjU2.js`（636,142 B）+ `index-tSoyompc.css`（190,917 B）；解包暂存后 `mv` 原子替换，`web` 下无 `._*`；公网 `http://154.37.155.17/xuanmanager/` 200，引用新 hash，JS 200 且体积一致，JS 内含「自动化总览」「任务中心」。
- 接口：`/api/automation/overview` 本机与公网均 401（路由存在、需登录）。
- 权限：`mgr_user` 中 admin999（is_super）、admin（role 1）可见；`12345678`（role 3 客服）未授予自动化权限，看不到菜单。
- 备份：二进制 `backups/xuanmanager.20261027-1629-rollback`、前端 `web.previous-automation-20261027-1629/`、RBAC 表 `backups/xm-rbac-20261027-1629.sql`（`mysqldump --no-tablespaces --single-transaction --skip-lock-tables`，因库用户无 LOCK TABLES/PROCESS）。

## 回滚

- 后端：`stop.sh` → `install -m 755 backups/xuanmanager.20261027-1629-rollback bin/xuanmanager` → `start.sh`。
- 前端：`rm -rf web && mv web.previous-automation-20261027-1629 web`。
- 迁移 030 只新增表/模块/权限并授角色 1，未改既有表结构；回滚二进制不会删除 030 数据。

## 未验证与边界

- 未做真实登录后的页面点击与视觉复核（无管理员凭据），以用户实机检查为准。
- 未接真实 Worker/客户端联调；演示数据不会自动刷新。
- 任务参数除 `enter_room` 外仅做结构校验，服务端不校验其他类型语义字段。
- 若 030 中途失败后重跑，`mgr_automation_session_event` 无唯一键，事件种子可能重复；其余种子均有 `ON DUPLICATE KEY` 保护。

## 后续重构：投放配置 + 账号与投放分离（2026-10-27，未部署）

背景：用户要求投放时不再输入账号，改为从机器人池批量选择或按组选择；账号统一在「账号管理」增删。

数据（`031_automation_deploy.sql`、`032_automation_pool.sql`）：

- 031：`mgr_automation_club` 增加 `max_per_room`、`invite_code`；`mgr_automation_robot` 增加 `invite_code`、`join_status`；自动化组增加默认智力/输赢目标等投放字段（组默认 + 单台覆盖）。
- 032：`mgr_automation_group.club_id` 改为全局（默认 `''`），演示组改全局；新增模块 54「账号管理」（`/automation/accounts`，图标 `automation-accounts`，排序 15），模块 44 更名「机器人管理」；权限 5403/5404（view/manage）授角色 1；种子池账号 31–33（`club_id=''`、`join_status='unassigned'`）。

后端：

- 新增 `POST /api/automation/clubs/{clubId}/deploy`，body `{robotIds}` 或 `{groupIds}`；校验俱乐部启用、6 位邀请码、配额、停用/在房；按组投放只取组内已启用且未投放账号。
- 机器人 `action=release` 撤回：清空 club/邀请码/join 字段并停止调度，账号回池。
- `GET /api/automation/robots` 支持 `assigned=0|1`；未限定俱乐部时数据范围为 `(club_id='' OR 范围)`。
- `server.go` 新增 `authorizedAny`（OR 权限），`authorized` 改为单元素调用；`authorized("")` 仍放行。终端 CRUD 同时接受 `automation.account.*` 与旧 `automation.robot.*`。
- 机器人更新不再接受投放归属变更（服务端保留当前 club），投放/撤回只走 deploy/release 接口。

前端：

- 新增 `AutomationAccountsPage.tsx`：筛选（关键词/分组/投放/启用）、统计、单个/批量添加、编辑、删除；池内账号显示「未投放」与投放提示。
- 投放管理新增 `DeployRobotModal`：「按机器人选择」多选池内已启用账号（支持全选当前筛选/搜索/分组），「按分组选择」显示各组可投放数；显示剩余配额并阻止超额；已投放表支持启停与撤回。
- 机器人管理改为监控视图：移除新增/编辑/删除与相关弹窗，保留启停、详情、俱乐部/分组/投放/状态筛选。
- 分组选择器改为全局；`FormActions` 增加 `disabled`；新增 `.automation-picker-list`/`.automation-inline-meta` 样式（跨两列、限高滚动）。

本地验证：

- mock（`/tmp/xuan-mock-api.mjs`，127.0.0.1:9911）+ vite（7458）走通：账号单个/批量添加、编辑、删除；投放弹窗按机器人投放 2 台、按分组投放 1 台；撤回后账号回池；机器人管理「未投放」筛选；菜单出现账号管理。
- 静态：`go build ./...`、`go vet ./...`、`gofmt -l internal/api`、`tsc -b`、`eslint src`、`vite build` 全部通过（仅 chunk >500 kB 提示）。
- 未验证：未连真实 MySQL、未真实登录 8891、未部署；迁移 031/032 未在正式库执行；真实 Worker/客户端未联调。

## 最新进展：机器人即账号，账号页合并回机器人管理（2026-10-27，未提交、未推送、未部署）

用户纠正：机器人本身就是账号，不应拆成「账号管理」和「机器人管理」两个页面；机器人管理必须能批量创建机器人（账号前缀、密码，昵称/头像随机，智力可在创建后修改）。已确认走真实游戏账号创建，不保存明文密码。

数据（`032_automation_pool.sql`，仍未执行）：

- 删除模块 54「账号管理」及权限 5403/5404 的方案，模块 44 更名「机器人管理」并设为可见。
- `mgr_automation_robot` 新增 `avatar`（头像编号 1–100）与 `buyin_multiple`（默认带入倍数，INT 默认 1）；池账号种子 31–33 带头像、`club_id=''`、`join_status='unassigned'`。
- 分组 `club_id` 改全局默认 `''`；演示机器人补头像和默认带入倍数 1。

后端：

- `automation_robots.go`：`automationRobotItem` 增加 `avatar`、`buyinMultiple`；`handleBulkCreateAutomationRobots` 重写为真实建号——事务内逐账号查重 `kbedm.third_marketing_info`、循环生成不重复随机三字昵称并查重、随机头像，先插注册表（`player_wxpwd=MD5(?)`、`anti_theft_on=0`），再插机器人表；提交后异步 `applyRegistrationAvatar` 下发游戏头像。接口响应、审计、日志均不含明文密码。
- 创建/批量/编辑请求的 `buyin` 改成 `buyinMultiple`（1–10，默认 1），错误码 `INVALID_BUYIN_MULTIPLE`；列表 `buyin` 保留为当前在房带入，编辑不再覆盖它。批量审计补记 `buyinMultiple`。
- `registrations.go`：`gameNicknameExists`/`gameLoginNameExists` 改为接受 `gameAccountQuerier`，使 `*sql.Tx` 可复用注册查重逻辑。
- 机器人路由恢复单权限：view/create/update/operate/delete 均走 `automation.robot.*`，移除 `automation.account.*`。
- 删除机器人仅删后台记录并提示游戏账号仍保留在游戏服。

前端：

- 删除 `AutomationAccountsPage.tsx`、`/automation/accounts` 路由与菜单项；投放页文案改为「机器人账号请在机器人管理中统一创建和删除」。
- `AutomationRobotsPage`：页头加「批量创建机器人」，列表加头像芯片与编辑/删除，挂载新增/编辑/删除弹窗；详情增加「默认带入 N 倍房间最低带入」与「当前带入 / 余额」。
- `RobotAddModal`：账号前缀、批量数量、起始序号、登录密码/确认、分组、智力（默认 50）、默认带入倍数（默认 1，1–10）、启用；`RobotEditModal`：账号/昵称/头像只读，分组、智力、输赢目标、默认带入倍数、出口 IP、启停可改。
- `shared.tsx` 的 `AutomationRobotItem` 增加 `avatar`、`buyinMultiple`。

本地验证（2026-10-27）：

- `gofmt -l internal/api` 无输出，`go build ./...`、`go vet ./...`、`npx tsc -b`、`npx eslint src` 通过。
- mock（`/tmp/xuan-mock-api.mjs`，127.0.0.1:9911，PID 87978）+ vite（7458，PID 74654）：机器人为账号的增删改已走通；创建弹窗已确认显示「默认带入倍数」默认 1、范围 1–10。改名前的批量创建 3 个账号、编辑智力、删除均已通过；改为倍数后正在表单冒烟，尚未提交。
- 未验证：真实 MySQL 迁移 032、真实注册建号与头像下发、投放页完整冒烟；未部署 8891。

## 补做：机器人批量操作 + 参考项目记录（2026-10-27 19:30，未提交、未推送、未部署）

背景：核对设计稿后发现后端早就有 `POST /api/automation/robots/batch`，但前端一直没有入口，属于「接口有、页面没有」的缺口。

改动（只动前端两个文件）：

- `XuanManager/web/src/pages/automation/AutomationRobotsPage.tsx`：列表增加勾选列（仅 `automation.robot.operate` 可见）、表头全选本页；选中后在表格上方显示批量条（已选 N 台 / 在房 X / 已停用 Y / 涉及 Z 个俱乐部），动作有启用、停用、排空、停止、重启；新增 `BatchConfirmModal`（影响面 + 在房警告 + 停止/排空超过 10 台时强制填原因并提示转审批）和 `BatchResultModal`（成功/失败计数 + 逐台结果，`approvalRequired` 时显示审批单号）；翻页或筛选后自动剔除非本页选中项。
- 复用 `styles.css` 中早已存在但未使用的 `.automation-batch-bar`，未新增样式。

未做：批量删除（后端 `validRobotAction` 不含 delete，需单独接口与审批口径再定）。

参考项目（用户补充，后续自动化客户端部分用）：

- `/Volumes/SSD/老自动化客户端`：`自动化平台重构交接文档.md`（架构、数据表、状态机、`/agent/v1/*` 协议、旧命令映射、阶段划分）、`MEMORY.md`；
  老代码在 `helper/assets/scripts/AutoPlay*.ts` 与 `helper/helper.py`、`main.py`。
- 该目录**不在本仓库**，只读参考，不修改、不整体复制；只取业务规则与协议语义。

验证：

- `npx tsc -b`、`npx eslint src` 通过（`eslint` 无输出），本轮未改后端，`go build`/`go vet` 沿用上一轮通过结果。
- 未做浏览器冒烟（需登录环境），未验证真实批量动作回执与审批流转。

## 投放管理改为「俱乐部维度」（2026-10-27 21:10，未提交、未推送、未部署）

用户口径：「投放管理改成列表，只显示已经投放了机器人的俱乐部；点进去看这个俱乐部投了哪些机器人、哪些组、策略是什么、
每台当前在哪个房间、什么状态、投放以来的输赢。投放机器人时用输入的邀请码定位俱乐部，投放时自动把机器人账号加到俱乐部里。」

后端（新增 `server/internal/api/automation_deploy.go`，`go vet`/`gofmt` 干净）：

- `GET /api/automation/deploy/clubs`：只返回 `robotCount>0` 的俱乐部，字段含邀请码、配额、组数、在房数、`joined/pending/failed` 计数、今日局数与净分、投放起始时间；支持 `keyword`。
- `GET /api/automation/deploy/clubs/{clubId}`：返回 `club` / `groups`（含策略名、默认智力、默认输赢目标）/ `robots`（房间、座位、运行状态、启停、加入状态、`lastError`、今日局数净分、周期净分、当前带入）/ `strategies`（按策略聚合台数）/ `history`（投放以来会话数、局数、净分、起始与最近活跃）。
- `GET /api/automation/deploy/lookup?inviteCode=`：6 位数字校验 → 定位俱乐部，返回剩余名额；错误码 `INVALID_INVITE_CODE` / `CLUB_NOT_FOUND`。
- `POST /api/automation/deploy`：`{inviteCode, robotIds[] | groupIds[]}`；校验俱乐部启用、配额、每房上限；复用共享的 `performAutomationDeploy`（`automation_clubs.go` 的旧入口 `POST /clubs/{clubId}/deploy` 已改为调用同一函数），投放后置 `join_status='pending'`、`desired_status='stopped'`，再异步入会。
- **自动入会**：`startAutomationJoins(clubID, robotIDs, inviteCode)` 起后台 goroutine，逐台调 `joinAutomationRobotToClub` → 游戏命令 `添加_俱乐部_玩家`（`{"club_id","user_id","context":"automation-join"}`），返回码 `512`/`1280` 视为成功置 `joined`，否则 `failed` + `last_error`。
- `POST /api/automation/robots/{id}/join`：手工重试入会，失败回 `JOIN_FAILED` 并带上次错误。
- 路由注册在 `automation_ops.go` 的 `registerAutomationDeployRoutes()`。

前端（重写 `AutomationDeployPage.tsx`）：

- `DeployClubList`：顶部队列卡（已投放俱乐部数、机器人/在房、今日净分合计、待加入与失败数）+ 按俱乐部 ID/名称/邀请码搜索的表格，行内显示投放数量、组数、在房、加入状态（失败 N + 邀请码提示）、今日局数与净分、投放起始。
- `DeployClubDetail`：四张指标卡（机器人/上限、启用/在房、今日局数/净分、投放以来局数/净分）+ 俱乐部配置块（只读，改配置去「俱乐部接入」）+ 机器人组与策略表 + 策略芯片 + 已投放机器人表（头像、账号/终端号、组与策略、智力、房间/座位、状态、加入状态、今日、周期净分、启用/停用 + 重试加入 + 撤回）。
- `DeployRobotModal`：先输邀请码（350ms 防抖查 `lookup`），显示命中的俱乐部与剩余名额，再切「按机器人选择」（池中 `assigned=0&enabled=1`，可搜索、可全选当前筛选）或「按分组选择」；从详情进入时锁定当前俱乐部。
- 撤回沿用 `robots/{id}/action` 的 `release`（本地 `ReleaseModal`）。

验证（2026-10-27 21:10）：

- `go build ./...`、`go vet ./...`、`gofmt -l internal/api` 无输出；`npx tsc -b`、`npx eslint src` 通过。
- 本地 mock（9911）+ vite（7458）用无头 Chrome 实跑：列表页 3 个俱乐部正确渲染 → 点「查看」进详情（9 台机器人、组/策略、房间座位、状态、失败 1 台带错误）→ 「投放机器人」输 880101 命中「星辰俱乐部 9/20，还能投 11 台」→ 勾选 1 台 → 「投放 1 台」→ toast「正在用邀请码 880101 自动加入」，数量 9→12、组数 1→3 即时刷新。
- mock 里入会直接置 `joined`，所以 `pending→joined/failed` 与真实 `0x306` 之类失败码**只能在真机验**。

## 部署到正式（2026-10-27 22:09 迁移 / 22:22 后端）

用户要求：**只更新后端接口，网站前端不更新**（他本地跑前端测接口，避免影响线上版本）。

做法与证据：

- 部署前状态：8891 health 200，线上二进制 `6ebb240f9ff0b477`（16:31 构建），`strings` 里**有** `robots/batch`、**没有** `automation/deploy/lookup`
  → 确认线上就是「030 之后、本轮投放改造之前」的那版，覆盖安全。`mgr_schema_migration` 最新为 `030_automation.sql`。
- 备份：`backups/mgr_automation.20261027-2209.sql.gz`（18 张 `mgr_automation_*` + `mgr_module`/`mgr_permission`/`mgr_role_permission`/`mgr_schema_migration`，13KB）；
  旧二进制 `backups/xuanmanager.20261027-2222-rollback`。
- 迁移**手工执行**而不是等二进制自启：`migrations.Apply` 在启动时跑，任一语句失败服务就起不来。本次把 031/032 按
  `-- +xuan Statement` 拆成 26 + 7 个单语句文件（脚本见下），逐条 `mysql < file`，全绿后手工 `INSERT INTO mgr_schema_migration`
  登记 `031_automation_deploy.sql`/`032_automation_pool.sql`（否则新版启动会重复执行 ALTER 直接失败）。
  拆分脚本：读文件 → `split("-- +xuan Statement")` → 跳过纯注释块 → 每条补 `;` 落盘。
- 数据回读（正式库）：3 个演示俱乐部分别拿到邀请码 `880101/880102/880103`，`max_per_room` 2/2/1；4 个分组 `club_id` 已清空（全局）；
  机器人按俱乐部 9/7/5 台 + 3 台池子（`join_status=unassigned`）；菜单 40 组下 `投放管理(53)/机器人管理(44)/对局记录(48)/Worker(49)/告警(51)` 可见。
- 二进制：`CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w"`（`部署说明.md` 的参数，**不加 `-s -w` 体积会从 9.2MB 涨到 12.9MB**），
  新 sha `4ea8f6511a1917b9`；上传后先在校验和一致才 `stop → install → start`，health 200，进程为新二进制，
  端口只剩 8891（8890 游戏管理、8893 chattool 未受影响）。
- 前端**没动**：`web/` 目录 mtime 仍是 16:32，`assets/index-DJZ1OjU2.js` 未变（线上老版本照旧可用，只是没有自动化新页面）。
- 接口探测（部署后）：`/api/automation/deploy/clubs`、`/deploy/lookup?inviteCode=`、`/deploy/clubs/{clubId}`、`POST /deploy`、
  `POST /robots/{id}/join`、`POST /robots/batch` 全部 **401**（= 路由已注册、只缺登录态，不是 404）；
  外网 `http://154.37.155.17/xuanmanager/api/automation/deploy/clubs` 同样 401，`/xuanmanager/api/health` 200。
- SQL 级别验证：把投放用到的 6 段查询（俱乐部列表 / 详情 / 组 / 机器人 / 历史 / 邀请码）拿正式库真实数据逐条执行，全部返回正常行，
  无列名错误、无 NULL 扫描崩溃（`since`/`joined_at`/`room_id` 都有 Null 处理）。
- 本地联调方式（给用户）：`XUAN_DEV_API_TARGET=http://154.37.155.17 XUAN_DEV_API_PREFIX=/xuanmanager npx vite --port 7458`，
  `/api/*` 会被改写成 `/xuanmanager/api/*` 打到线上；已验证 `/`, `/api/health` 200、`/api/automation/deploy/clubs` 401。

顺带发现（未处理）：线上日志有 `registration avatar apply timed out`（20:26、20:28 两条，注册号 37、38，
`error` 为 null，说明是超时不是报错）——真实建号后下发头像这一步会超时，等真机测建号时一起看。

## 清空线上演示数据（2026-10-27 22:30）

用户：「线上版本打开还有测试数据，全部清理了」。

- 清前备份：`backups/mgr_automation.pre-clean.20261027-2226.sql.gz`（14 张表全量）。
- 判定口径：这些表里**每一行都是 `is_demo=1`**（`mgr_automation_scope` 本来就是空），所以直接按 `is_demo=1` 删，没有误删风险。
- 删除顺序（无外键，纯靠业务顺序）：`session_event`（按 demo session 子查询）→ `session` → `task` → `approval` → `alert` →
  `room_snapshot` → `robot` → `group` → `club` → `credential` → `ip_pool` → `worker` → `strategy`，单事务提交。
  实际删除 111 行：session_event 10 / session 18 / task 5 / approval 3 / alert 6 / room_snapshot 21 / robot 24 /
  group 4 / club 3 / credential 6 / ip_pool 5 / worker 3 / strategy 3。
- 收尾：14 张表 `COUNT(*)` 全 0；`AUTO_INCREMENT` 重置为 1（club/group/robot/worker/strategy/task/session/alert/approval）。
- 副作用：投放管理、机器人管理、对局记录、总览等页面现在都是空态（**符合预期**）；菜单/权限行没动，`mgr_module`/`mgr_permission` 保持原样。
- 未动：游戏库 `kbedm.third_marketing_info` 里今天手工注册的 9 个测试账号（id 30–38）。后台没有删号接口，
  真要删得跨 `third_marketing_info` 之外的玩家表，风险高，**等用户确认**。

## 账号链路澄清：玩家管理要等首次登录（2026-10-27 22:33，代码无改动）

用户问「现在创建的机器人不是真实账号么，玩家管理里面没有呢」，随后自己确认「刚创建没登录游戏所以没有，登录一次就有了」。

- 事实：批量建号只写 `kbedm.third_marketing_info`（`player_wxid`=账号、`player_wxname`=昵称、`player_wxpwd`=MD5、
  `anti_theft_on=0`、`player_guuid` 留空）+ `mgr_automation_robot`。**玩家行 `kbedm.tbl_Account` 是游戏服在首次登录时建的**，
  建完把 `player_guuid` 回填营销表。后台「玩家管理」（`players.go` 读 `tbl_Account`）因此看不到没登录过的机器人。
- 由此的顺序依赖（重要）：`添加_俱乐部_玩家` 的 `user_id` 指向不存在的玩家会回「玩家不存在！」，
  所以**建号 → 机器人登录一次 → 再投放**，否则投放的自动入会会落到 `join_status=failed`。
  另外 `user_id` 目前传的是**登录账号**（不是 guuid），真机联调时要确认游戏服认哪个——若认 guuid，
  需要改成从营销表 `player_guuid` 取值。
- 决策：曾实现「建号时顺带 INSERT `tbl_Account` + 回填 guuid」，用户选择**保持现状**，代码已回滚
  （`automation_robots.go` 恢复原样，`go build`/`go vet`/`gofmt` 通过，无需重新部署）。

## 邀请码改成查游戏库真实码（2026-10-27 22:51 已部署）

用户澄清：「投放时的邀请码就是代理在游戏里看到的那个俱乐部邀请码，不是俱乐部 ID」。

- 改造（`automation_deploy.go`）：新增 `resolveDeployClub` / `gameClubByInviteCode` / `ensureAutomationClub`。
  `lookup` 与 `POST /deploy` 都先查游戏库：
  `kbedm.club_invite_code_info`（`invite_code` varchar(10) 唯一索引，90 万行码池）→ `club_guuid` →
  `kbedm.club_guuid_info.club_name`；判定 `status='used'` 且 `club_status='used'`；
  命中后 upsert 进 `mgr_automation_club`（只刷 `name`/`invite_code`，不动配额、每房上限、启停），再算剩余名额。
  游戏库查不到时回退老逻辑（后台自配的 `mgr_automation_club.invite_code`），保留手工绑定场景。
- 错误文案分三种：码还没被俱乐部用（`club_guuid` 空）、码已失效（`status` 非 used）、俱乐部已解散（`club_status` 非 used）。
- 正式库实测映射：`953642 → 535696 → 功能测试`（码归属代理 725838）、`996242 → 567671 → sefsef`；
  全库现有 11 条 `used` 码、6 个真实俱乐部，`init` 899961 条是未用码池。
- 部署：`-ldflags="-s -w"` 构建，sha `5c4a0ed74e8e875b`，22:51 切换完成，health 200，
  `lookup` 返回 401（需登录）；回滚点 `backups/xuanmanager.20261027-2250-rollback`（`4ea8f651`）。
  上线前先用真实数据验证了 guuid 查询与 upsert SQL（临时插了一条 999998 再删掉，表已恢复为空）。

## 投放后必须挂 Worker（2026-10-27 23:22 已部署）

用户指出：「俱乐部投放机器人之后需要分配给 worker，如果没有 worker 界面要提示当前状态，不是分完就完了」。

- 后端（`automation_deploy.go`）：新增 `assignAutomationWorkers`（挑在线节点填空）、
  `refreshAutomationWorkerLoad`（重算 `robot_count`）、`countOnlineWorkers`、`deployDispatchNote`（每台的一句话状态）。
  列表/详情 SQL 增加 `SUM(r.worker_id IS NOT NULL)`、`SUM(join_status='joined' AND worker_id IS NULL AND enabled=1)`、
  `(SELECT COUNT(*) FROM mgr_automation_worker WHERE status='online')`，即 `workerAssigned/workerWaiting/workersOnline`。
  自动触发两处：`POST /deploy` 之后、每台**入会成功**之后（`startAutomationJoins` 里）。
  手动补充分配：`POST /api/automation/deploy/clubs/{clubId}/dispatch`。
  投放接口的返回文案会追加「当前没有在线 Worker 节点…」或「还有 N 台等待分配 Worker（容量不足）」。
- 分配条件：`status='online'` 且心跳在 5 分钟内且 `robot_count < max_robots`，按剩余容量倒序；
  被分到的机器人置 `status='idle'`、`desired_status='running'`；撤回（`release`）会把 `worker_id` 清空并刷新节点负载。
- 前端（`AutomationDeployPage.tsx` + `shared.tsx`）：列表第 5 张统计卡「等待分配 Worker」、表格新增 `Worker` 列
  （`待分配 N` 橙色 / `已分配 N` + `在线节点 N 个`）；详情第 5 张统计卡 + 橙色告警条（文案按「没有在线节点 / 容量不够」分两种）
  + 「重新分配」按钮；机器人表格新增 `Worker` 列显示节点名或一句话状态。

## 策略与输赢目标改成「投放时设置」（2026-10-27 23:22 同时上线）

用户两次强调：「投放的时候就设置策略，或者选择配置好的策略，流程才对」「输赢目标 和赢输策略 不应该在机器人管理里面设置」。

- 后端：`automationDeployRequest` / `deployRequest` 加 `strategyId, profitMode, profitTarget, periodStart, periodEnd`；
  `performAutomationDeploy(r, clubID, robotIDs, groupIDs, strategyID, profitMode, profitTarget, periodStart, periodEnd)`。
  行为：`strategyId>0` 先查 `mgr_automation_strategy.name`（不存在回 `STRATEGY_NOT_FOUND`）；
  `profitMode` 非空才走 `validateAutomationProfit(..., allowInherit=true)`（失败回 `INVALID_PROFIT_TARGET`），
  `none` 会把目标归零；SET 子句是动态拼的，只有传了才覆盖，留空就沿用原值。投放成功的 message 会追加「策略：X」「每日/周期输赢目标 N」。
- 前端（投放弹窗）：新增「投放策略与输赢目标」区块 —— 策略下拉（`useAutomationStrategies()`，列表带草稿标注、已发布排前面）
  + `ProfitTargetFields`（周期 / 金额 / 周期日期，`shared.tsx` 里与投放共用）。**按分组投放且只勾一个组时自动带出该组的策略与目标**，
  用户手动改过就不再覆盖（`configTouched`）。提交前校验周期必须填日期。
- 前端（机器人管理）：`RobotEditModal` 删掉「输赢目标周期/目标/周期开始/结束」四个输入框，换成只读的「策略 / 输赢目标」
  （显示 `沿用分组策略 · 每日总输赢 · 赢 5,000`），PUT 时原样回传原值（周期模式缺日期时退回 `""` 免得校验不过）。
  机器人列表/详情的「输赢目标」列保留展示（是结果不是设置入口）。
  **2026-10-27 23:40 用户追加要求**：「创建机器人时不需要设置输赢目标，删除这个内容」→ 彻底移除机器人管理里的
  输赢目标展示：列表不再有「输赢目标」列、详情弹窗删掉该项、编辑弹窗那行只读也删了（策略一并去掉，只留分组/智力/倍数/IP/IP/启停）。
  `shared.tsx` 的死代码 `robotProfitTargetText` 同时删除；`profitTargetText`/`profitModeLabel` 仍给投放页的分组表用。
  PUT 仍原样回传 `profitMode/profitTarget/period*`，保证保存机器人不会把投放时设的目标洗掉。
- 部署：`8360ceee645e8bf9…`，9,244,856 B，23:22 切换完成；health 200；`POST /deploy`、`/deploy/clubs/{id}/dispatch`
  返回 401（路由已注册，只缺登录态）；回滚点 `backups/xuanmanager.20261027-2322-rollback`（= 22:51 的 `5c4a0ed7`）。
  没新增迁移，031/032 已是最终形态。
- 本地 UI 核对：mock 9911 + vite 7458，截图确认列表统计卡/Worker 列、详情告警条、投放弹窗新区块、机器人编辑弹窗；
  抓到的投放请求体 `{"inviteCode":"880101","robotIds":[22,23],"strategyId":2,"profitMode":"period","profitTarget":-12000,"periodStart":"2026-10-01","periodEnd":"2026-10-31"}`。
  顺手修掉一个 NaN 警告（mock 未返回 `workerWaiting` 时求和变 NaN，已全部 `?? 0` 兜底）。

## 下一步

- 等用户在本地前端登录后测接口；他测完再决定是否发布前端、是否提交推送。
- 真实投放要盯 `join_status`：`pending → joined/failed`，失败看 `last_error`，详情页可重试；
  同时看 `worker_id` 是否被自动填上（没有在线节点时应停在「等待分配 Worker」，属预期）。
- 投放时选的 `strategyId`/`profit_*` 是否真的落库并生效，得等真机联调时到库里核对。
- Worker/客户端联调仍未开始；协议与状态机参考 `/Volumes/SSD/老自动化客户端/自动化平台重构交接文档.md`，总览见[自动化后台专题](../topics/automation-console.md)。

## 2026-10-27 深夜：Worker 通道与参考 agent（代码完成，未迁移未发布）

**做了什么**

1. 迁移 `033_automation_worker_channel.sql`：`mgr_automation_setting`（键值，存接入令牌哈希）、
   `mgr_automation_worker` 扩 9 列（platform/arch/labels/lease_token_hash/lease_expires_at/enrolled_at/
   last_event_seq/last_event_at/notes）+ 状态索引、`mgr_automation_worker_command`、`mgr_automation_worker_event`
   （`uk_worker_event(worker_id,event_id)`）。
2. `automation_agent.go`（865 行）：`/agent/v1/*` 五条通道、`agentAuthorized`（X-Agent-Token + 90s 租约）、
   接入令牌生成/轮换、命令枚举与状态机、事件收敛、`enqueueWorkerCommand`、`RunAutomationWorkerJanitor`。
3. `automation_workers.go`（477 行）：列表/详情/动作/手动命令/令牌接口；`automation_ops.go` 换路由并删掉旧 handler。
4. `performAutomationRobotAction` 包一层：本地状态更新后再向节点入队终端命令。
5. `main.go` 起 janitor。前端 `AutomationWorkersPage.tsx` 整体重做（令牌卡/节点表/详情三页签/手动下发），
   `shared.tsx` 补 `AutomationWorkerRow` 等 6 个类型 + 命令/事件枚举，`styles.css` 加令牌卡、facts 网格、`is-*` 状态色。
6. `server/cmd/xuanagent`：参考 agent（注册→心跳→拉命令→三段回执→事件攒批），终端为模拟。

**踩到的坑**

- 新终端建好后 `ensureTerminal` 只在「已退出」分支 `go runTerminal`，新建的那条走 `default` 只改状态 →
  **goroutine 从未启动**，第一次 `-once` 跑出来 0 条事件。改成 `started` 标志 + `spawn()` 统一拉起。
- agent 原先 2 秒拉命令、10 秒才第一次心跳 → 收到 `START_TERMINAL` 时本地还没有终端，被判 `TERMINAL_NOT_FOUND`。
  改成**注册后立刻心跳一次**再起 ticker。
- `leaveRoom` 先清 `roomID` 再 emit，`RoomLeft` 事件里房间号会是 0；改成先 emit 再清。
- 前端节点表照旧用 `min-width:1180px`，8 列在 1190px 容器里被 sticky 操作列挡住两列（命令/心跳看不见）；
  压到 1080px 并去掉负载列的两根进度条后放得下。
- 详情弹窗原来沿用 `automation-detail-grid`（1.1fr/.9fr 两栏），右栏只有 280px，4 列机器人行挤成一团；
  改成 facts 5 列网格 + 下方整宽三页签列表。

**验证**

- `go build ./...`、`go vet ./...`、`gofmt -l .` 全清；`tsc -b`、`eslint`、`vite build` 通过。
- 写了临时 mock（`/agent/v1/*` 严格校验字段名，模拟 DisallowUnknownFields）跑参考 agent：
  注册成功 → 2 条命令（RECONCILE_STATE、START_TERMINAL）ACCEPTED→COMPLETED → 9 秒 358 条事件、
  `eventId` 全唯一、`errors: []`；SIGTERM 后终端先 `RoomLeft` 再退出。
- 交叉编译 windows/amd64、linux/amd64 均成功（≈6 MB）。
- 前端用本地 mock（`/private/tmp/xuan-mock-api.mjs` 已补 worker 详情/命令/令牌接口）在 1500px 视口截图：
  列表 8 列全可见、详情三页签、令牌生成后明文+示例命令+复制、手动下发弹窗；控制台只剩 `favicon.ico` 404。

**没做/待办**

- **迁移 033 未在任何库执行**；后端仍是 23:22 的 `8360ceee`，前端未发布。
- 发布顺序必须是：先跑 033（拆语句逐条执行并登记 `mgr_schema_migration`）→ 再换二进制，否则启动迁移失败/查列报错。
- 真实节点长跑、janitor 实收敛、租约续期与断网重注册、任务层（START/PAUSE/CANCEL_TASK 目前只回执不动）未验。

## 2026-10-28 00:14 执行迁移 033 / 00:15 发布后端（用户批准）

- 备份：`backups/mgr_worker_channel.20261028-0013.sql.gz`（`mgr_automation_worker` + `mgr_schema_migration`，1.6KB）；
  旧二进制 `backups/xuanmanager.20261028-0014-rollback`（9,244,856 B = 23:22 的 `8360ceee`）。
- 迁移：033 按 `-- +xuan Statement` 拆成 13 条（脚本：`split(marker)` → 去纯注释行 → 补 `;`），
  逐条 `mysql < file` 全 OK，再 `INSERT INTO mgr_schema_migration('033_automation_worker_channel.sql', NOW())`
  （登记时间 00:14:07）。核对：worker 表 24 列含 `platform/arch/labels/lease_token_hash/lease_expires_at/enrolled_at/
  last_event_seq/last_event_at/notes`；`mgr_automation_setting`、`mgr_automation_worker_command`、
  `mgr_automation_worker_event` 三表已建；上线前 worker 表 0 行（演示数据已清），本次不动既有数据。
- 二进制：`b5c399c09679d041…`，9,375,928 B（`CGO_ENABLED=0 GOOS=linux GOARCH=amd64 -trimpath -ldflags="-s -w"`）。
  上传到 `incoming-20261028-0014/`，服务器端 `sha256sum` 与本地一致后 `install -m 755`。
- **踩坑**：`pkill -f "bin/xuanmanager"` 会把执行这条 ssh 命令的 shell 自己也匹配上，直接把连接打断（后续输出全丢）；
  另外 watchdog cron 每分钟跑 `start.sh`，第一次停止后 5 秒内它就用旧二进制把服务拉起来了，`start.sh` 报
  "already running" 让人误以为新二进制已生效。**判别办法：`readlink /proc/<pid>/exe`，带 ` (deleted)` 就是旧 inode**。
  最终正确顺序：`kill $(cat run/supervisor.pid)` → 等 8891 关闭 → `./start.sh` → 用 `/proc/*/exe` 确认指向当前文件。
- 部署后：health 200；`GET /api/automation/workers`、`GET /api/automation/agent-token` 401；
  `POST /agent/v1/register`（无令牌）`AGENT_ENROLL_DISABLED`；外网 `http://154.37.155.17/xuanmanager/agent/v1/register` 同样返回，
  说明 Caddy 反代覆盖到 `/agent/` 前缀。
- mac 版 agent 已构建给用户：`~/Downloads/xuanagent/xuanagent-darwin-arm64`（5.8 MB，`-h` 正常）。
- 前端仍未发布（用户要求本地跑）：本地 7458 已指线上，`/#/automation/workers` 打开后可「重置令牌」拿明文。

## 2026-10-28 00:30 改成「配置文件启动、令牌可选」（用户要求）

用户原话：「不用搞这么麻烦 woker 读同目录的配置文件 里面配上 服务器地址 直接启动就就行了 不用令牌 也可参数传入服务器地址 启动。」

**代码**
- 新增 `server/cmd/xuanagent/config.go`：配置文件固定取**可执行文件同目录**的 `xuanagent.json`；
  不存在就写一份默认值再继续跑（`defaultServer` 已写死 `http://154.37.155.17/xuanmanager`，
  `code` 由主机名规范化成 3-32 位小写字母数字-_，`capacity` 20 / 心跳 10s / 轮次间隔 1500ms / 每房 6 局）。
- `main.go` 的 `parseFlags()` → `parseOptions()`：优先级 **配置文件 < 环境变量 `XUAN_AGENT_*` < 命令行参数**，
  用 `fs.Visit` 只收集「显式传了」的 flag 才覆盖；新增 `-config`、`-print-config`；`run()` 启动时打印生效配置；
  `enroll()` 遇到 `AGENT_ENROLL_REJECTED` 直接提示「在 <配置文件> 里填 token 或 -token 传入」。
- `automation_agent.go`：删掉「无令牌 → 503 `AGENT_ENROLL_DISABLED`」，改成 `expected != "" && !EqualTokenHash(...)` 才拒；
  开放模式打一条 `Warn`，审计带 `tokenChecked`。
- `automation_workers.go` 新增 `handleClearAutomationAgentToken`，`automation_ops.go` 注册
  `DELETE /api/automation/agent-token`（权限同轮换 `automation.worker.manage`）。
- 前端 `AutomationWorkersPage.tsx` 的令牌卡改「节点接入令牌（可选）」：新增「关闭校验」按钮、
  配置文件样例（`xuanagent.json` 片段）、常显说明；`automation-table--workers` 换 3 列宽度适配。

**发布**
- 后端：`a2dd7c008e4df32d…`，9,380,024 B；备份 `backups/xuanmanager.20261028-0028-rollback`。
  期间第一版多行 ssh 脚本连上就被断开（`Connection closed by ... port 2233`，脚本一行没执行），
  拆成「备份 / kill / mv+start / 核对」四条单行命令后全部正常。
- 前端：`XUAN_STATIC_DIR=/www/html/.xuanmanager/web`（**不是** `/www/html/mgr`，也不是 `/www/html/xuanmanager`）；
  本地 `vite build` 后 tar 上传，`web → web.prev`、`web.new → web` 两跳切换；外网 `index.html` 已引用 `index-C12AUAlM.js`。
- 生产令牌已清（`DELETE FROM mgr_automation_setting WHERE setting_key='agent_enroll_token'`），即开放注册。
- 端到端：空目录放二进制、**不写配置不带令牌**直接跑 → 自动生成配置 → `注册成功 workerId=1 status=online` →
  `mgr_automation_worker` 落 `mac-mini-2-local / darwin / arm64`；`-server`/`-code`/`-capacity` 覆盖实测生效。

## 2026-10-28 00:52 自动分配 + 节点日志写全（用户要求）

用户原话：「workder启动之后 有机器人没等待分配的 就要分配过去啊 注意worker 界面日志要写全，包括 分配账号 退出账号 登录 登录是否成功 进房间 等待。」

**后端**
- 新增 `server/internal/api/automation_assign.go`：`assignWaitingRobotsToWorker`（单节点按剩余容量领账号）、
  `assignWaitingRobots`（全局兜底）、`countWaitingRobots`（心跳前置挡板）、`refreshWorkerLoad`、`recordWorkerEvent`（系统事件）。
  触发点四处：注册成功后、每次心跳（**先分配再取指派清单**，新终端当拍进回包）、巡检每 30 秒、投放俱乐部时（原逻辑）。
  抢占用 `UPDATE ... WHERE id=? AND worker_id IS NULL` + RowsAffected；`disabled/draining/offline` 不接新账号。
- 巡检新增：离线超 10 分钟（`agentOfflineReleaseMinutes`）的节点，名下账号收回等待池（`worker_id=NULL`），
  否则节点挂了机器人永远卡在「已分配」。
- 系统事件：`WorkerOnline / WorkerOffline / RobotAssigned / RobotReleased`，`event_id = sys-<纳秒>-<robotId>`、`sequence=0`，
  前端标「系统」。投放分配、撤回投放、删节点、离线收回都会写。
- `agentEventTypes` 白名单补 7 种终端事件；**单条类型不认只跳过并 log，不再整批 400**（响应多返回 `skipped`）。
- `applyAgentEventToRobot` 补 `TerminalStarted/LoginStarted`→entering、`LoginSucceeded`→idle、`LoginFailed`→faulted+last_error、
  `Waiting`→idle（在座不动）、`LogoutSucceeded`→idle 清房。
- 详情接口：命令 20→50 条、事件 30→200 条。

**agent**
- `terminal.go` 生命周期补全：`TerminalStarted` → `LoginStarted` → `LoginSucceeded/LoginFailed` → `Waiting`（进房前/换桌后）
  → `RoomJoined/PlayerSeated/GameReady` → 逐局 → `RoomLeft/RoomClosed` → `LogoutSucceeded` → `TerminalStopped`。
- **踩坑**：eventId 原来是 `<terminalNo>-<seq>`，进程重启后 seq 从 1 重来，会被后台按 `(worker_id,event_id)` 当重复丢掉，
  日志静默缺段。改成 `<terminalNo>-<runID>-<seq>`（`newRunID()` 6 位 hex）。实测同节点连跑两次，`TerminalStarted` 落 2 条。

**前端**
- `shared.tsx`：`workerEventTypes` 补 11 种（含「后台动作」提示）、新增 `workerEventSummary`（从 payload 抽
  message/account/club/reason/roomId/delta 拼一句摘要）与 `workerEventTone`（失败红/成功绿/等待黄/进行蓝）。
- `EventRow` 显示「标签 + 系统|seq + 终端 + 房间/局 + 时间 + 摘要」；事件页签空态文案改「日志」。

**发布**
- 后端 `24b08e87…`（回滚 `backups/xuanmanager.20261028-0045-rollback`），前端 `index-C9680II9.js`。
- **又踩一次 watchdog**：`kill` 后 2 秒内 cron 用旧二进制把服务拉起来，`./start.sh` 报 "already running"。
  这次在一条命令里做完 kill→mv→start→校验 sha，发现不对就再 kill 一次重启。
- **端到端实测**：插一台 `join_status='joined' / worker_id=NULL` 的测试机器人 → 起临时节点 `zz-verify-node` →
  注册后 0.4 秒写出 `RobotAssigned`，1.2 秒终端拉起并依次回 `TerminalStarted/LoginStarted/LoginSucceeded/Waiting/RoomJoined`…，
  SIGTERM 后 `LogoutSucceeded/TerminalStopped`；`上报事件失败` 计数 0。验证数据已全清，worker 1 恢复 `online`。
- 注意：`join_status='unassigned'`（未投放）**不在**自动分配范围，必须先投放到俱乐部。
