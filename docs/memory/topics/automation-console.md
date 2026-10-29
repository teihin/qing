# 自动化后台（XuanManager「自动化」分组）专题

更新时间：2026-10-27。本文只记录**当前口径、代码位置、验证状态与待办**；细节过程见
[自动化后台交接](../handoffs/2026-10-27-automation-console.md)。

## 1. 当前业务口径（用户最终确认，优先级最高）

1. **机器人 = 游戏账号**。不存在「账号管理」和「机器人管理」两个页面，统一在「机器人管理」里
   真实开户、改配置、停用、删除。创建必须走游戏库真实注册（`kbedm.third_marketing_info`），
   密码只写 MD5，后台不回显、不进日志与审计。
   **建号只写营销表（占号）**：玩家行 `kbedm.tbl_Account` 由游戏服在**首次登录**时创建，并把
   `player_guuid` 回填到营销表。所以「玩家管理」（读 `tbl_Account`）要等机器人**登录过一次**才看得到它。
   由此有个顺序依赖：**投放时 `添加_俱乐部_玩家` 对没登录过的账号会回「玩家不存在」**，
   正确顺序是「建号 → 机器人登录一次 → 再投放」。2026-10-27 用户明确选择保持这个链路，
   不做后台预插 `tbl_Account`（加过一版预建代码，已按此决定回滚）。
2. **投放与账号分离**。投放管理只做「把池里的机器人放进某个俱乐部」，可以单个/多选，也可以按分组批量；
   投放时不输入账号。撤回（`release`）后账号回池，配置和历史保留。
3. **俱乐部维度配置**：投放数量（`robot_quota`）、每房最多机器人（`max_per_room`）、
   6 位数字邀请码（`invite_code`）、占座比例、启停。
   **投放 = 凭邀请码定位俱乐部 + 服务端真调游戏命令入会**：`join_status` 走
   `pending → joined | failed`，失败写 `last_error`，详情页可「重试加入」。入会命令是
   `添加_俱乐部_玩家`（`club_id` + `user_id` + `context=automation-join`），成功码 `512`/`1280`。
4. **分组是全局的**（`club_id=''`）；建组只填名称 + 策略（在座/上限两字段无调度用途、已不展示）。
   组策略 = 投放默认策略，投放可改；智力 0 = 跟随分组。增删改在机器人管理页头「分组管理」弹窗。
   删组时组内有机器人须带 `?moveToGroupId=0|组ID`，事务内先搬机器人再删（0 = 不分组）。
5. **默认带入是倍数不是金额**：`buyin_multiple`（1–10，默认 1）= 房间最低带入的几倍；
   `buyin` 保留为「当前在房带入」。
6. **输赢目标**支持「每日总输赢」「一段时间总输赢」「按周时段」（`profit_mode=daily|period|schedule`
   + `profit_target`；`schedule` 另带 `profit_schedule`，口径见第 8 节）。
7. **策略和输赢目标是「投放时」的设置**：投放弹窗里选「机器人策略」
   （来自策略中心已配置的策略）+ 设「输赢目标周期/金额」，一批投放统一覆盖；选中一个分组时默认带出组策略。
   **机器人管理里完全不出现这两项**（列表、详情、编辑弹窗都不展示，只保留分组/智力/倍数/IP）。
8. **投放完还要挂 Worker 才算跑起来**：`POST /deploy` 之后自动调 `assignAutomationWorkers`，
   按「在线 + 心跳 5 分钟内 + 未满容量」挑节点填空；入会成功后也会再尝试一次。
   没分到的机器人停在 `worker_id IS NULL`，界面显示「等待分配 Worker」并在详情页给出原因
   （没有在线节点 / 容量不够），可点「重新分配」重试。
9. **只进哪些底皮**（2026-10-28）：机器人可设「只进 0.1/0.3、0.2/0.5、1/3、2/5、5/10、10/20、20/40、50/100 中
   的若干档」，存放在 `mgr_automation_robot.room_pi`（`底皮5/10` 逗号分隔，空 = 不限）。
   三处可设：投放、俱乐部「配置」、机器人编辑。实际落到
   **每台机器人的 `room_pi`**，不是俱乐部级配置。改完要**重新拉起终端**才生效（env 只在进程启动时读）。
10. **机器人日志**：节点详情、投放管理、机器人管理三处都能点开某台机器人的运行日志
   （同一个接口 `GET /api/automation/robots/{id}/events`，前端 5 秒轮询）。

## 2. 页面与权限

菜单分组 40「自动化」，模块 id 40–54，权限 `automation.*`，默认授角色 1（超级管理员）。

| 路由 | 页面 | 主要能力 |
|---|---|---|
| `/automation/overview` | 自动化总览 | 指标卡、俱乐部卡片、告警流、待审批、Worker 负载 |
| `/automation/deploy` | 投放管理 | **以俱乐部为单位**：列表只列「已投放机器人的俱乐部」→ 点「查看」进俱乐部详情（机器人组/策略/每台的房间座位·状态·加入状态·Worker·今日与投放以来输赢·**只进底皮**，每台可点「日志」「配置」）→ 「投放机器人」先输邀请码定位俱乐部，选机器人或分组，**同一弹窗里选策略 + 设输赢目标 + 选只进的底皮**，提交后自动入会并尝试分配 Worker |
| `/automation/clubs` | 俱乐部接入 | 俱乐部列表与接入配置 |
| `/automation/rooms` | 房间监控 | 房间池筛选、座位图抽屉、指派/召回 |
| `/automation/robots` | 机器人管理 | 批量真实开户、筛选、编辑（分组/智力/倍数/**只进底皮**/IP，**策略与输赢目标在投放时设，这里完全不展示**）、启停、删除、详情（点名称或「日志」看运行日志，运行中的机器人直接落在「运行日志」页签）、**批量操作**、页头**「分组管理」**（分组增删改，删组时可把机器人移到其他组或不分组） |
| `/automation/groups` | 自动化组（菜单隐藏） | 旧组页，功能已并入机器人管理 |
| `/automation/tasks` | 任务中心 | 任务创建/取消/重试 + 审批单 |
| `/automation/strategies` | 策略中心 | 策略版本、发布、回滚 |
| `/automation/sessions` | 对局记录 | 会话列表与事件时间线 |
| `/automation/workers` | Worker 节点 | 节点负载、排空/恢复；节点详情三页签（终端/命令/事件），**点某台终端进「机器人日志」** |
| `/automation/credentials` | 凭据与设备 | 游戏账号凭据、出口 IP 池 |
| `/automation/alerts` | 告警中心 | 认领/解决 |
| `/automation/audit` | 自动化审计 | 操作记录（父记录 + 逐项结果） |

## 3. 数据与代码位置

- 迁移：`XuanManager/server/migrations/030_automation.sql`（14 张 `mgr_automation_*` 表 + 模块/权限 + 演示数据）、
  `031_automation_deploy.sql`（投放字段）、`032_automation_pool.sql`（头像、`buyin_multiple`、分组改全局、模块 44 更名）、
  `033_automation_worker_channel.sql`（Worker 通道）、`034_automation_robot_password.sql`（加密登录密码）、
  `035_automation_room_pi.sql`（只进底皮 `room_pi`）、`036`/`037`/`038`（身份、净分周期、策略下发）、
  `039_automation_profit_schedule.sql`（周计划：`profit_schedule/schedule_window/window_net/schedule_state`）。
- 后端：`XuanManager/server/internal/api/automation.go`、`automation_clubs.go`、`automation_robots.go`、`automation_ops.go`、
  `automation_deploy.go`（俱乐部维度投放）；路由在 `automation_ops.go` 的 `registerRoutes`，权限经 `authorized` / `authorizedAny`，
  写操作带 CSRF、审计与数据范围（`mgr_automation_scope`）。
- 前端：`XuanManager/web/src/pages/automation/`（12 个页面 + `AutomationDeployPage`、`AutomationRobotsPage`、`shared.tsx`、`AutomationRobotModals.tsx`）；
  路由与门控在 `App.tsx`，菜单与图标在 `Layout.tsx`。
- 投放相关接口（`automation_deploy.go`）：
  `GET /api/automation/deploy/clubs`（已投放俱乐部列表，含 `workerAssigned/workerWaiting/workersOnline`）、
  `GET /api/automation/deploy/clubs/{clubId}`（详情：club/groups/robots/strategies/history）、
  `GET /api/automation/deploy/lookup?inviteCode=`（邀请码定位俱乐部 + 剩余名额）、
  `POST /api/automation/deploy`（`{inviteCode, robotIds|groupIds, strategyId, profitMode, profitTarget, periodStart, periodEnd, profitSchedule, roomPi}`，
  投放 → 自动入会 → 自动分配 Worker，返回 `clubId`/`joinPending`/`workerWaiting`/`workersOnline`）、
  `POST /api/automation/deploy/clubs/{clubId}/dispatch`（重新分配 Worker，返回 `assigned`/`waiting`/`workersOnline`）、
  `POST /api/automation/robots/{id}/join`（重试入会）。
- Worker 分配规则（`assignAutomationWorkers`）：`status='online'` + 心跳 5 分钟内 + `robot_count < max_robots`，
  按剩余容量倒序挑节点；填充 `club_id=? AND worker_id IS NULL AND enabled=1 AND join_status='joined'`，
  同时把节点上的机器人置 `status='idle'`、`desired_status='running'`。
- 其他关键接口：`POST /api/automation/robots/bulk`（真实开户）、`POST /api/automation/clubs/{clubId}/deploy`（旧入口，复用同一段投放逻辑）、
  `PUT /api/automation/robots/{id}`（**全量覆盖 `ROOM_PI`**：`roomPi` 不传等于清空，所有调用方必须回传原值）、
  `GET /api/automation/robots/{id}/events?limit=`（单台机器人运行日志，新的在前，`authorizedAny` robot.view/worker.view）、
  `POST /api/automation/robots/{id}/action`（`release`/`enable`/`disable`/`start`/`pause`/`drain`/`stop`/`restart`）、
  `POST /api/automation/robots/batch`（批量，>10 台停止/排空转审批）、`POST /api/automation/rooms/{roomId}/assign|recall`。

## 3.1 邀请码是怎么"找"俱乐部的（2026-10-27 已改为游戏库真实码）

**口径：投放时输的是「游戏里显示的俱乐部邀请码」，不是俱乐部 ID。** `lookup` 与 `POST /deploy`
都走 `resolveDeployClub`：6 位码 → `gameClubByInviteCode` 查 `club_invite_code_info`（码状态
`init/used/disabled`）+ `club_guuid_info`（`club_status`）→ 查不到回退后台
`mgr_automation_club.invite_code` → 命中后 `ensureAutomationClub` upsert 俱乐部并读配额算 `remaining`。
一个俱乐部可有多条码（每代理一条），`mgr_automation_club.invite_code` 记最近一次投放用的码，
机器人各自 `invite_code` 保留自己那条。完整 SQL 与实测映射见
[自动化后台交接](../handoffs/2026-10-27-automation-console.md)。

## 4. 参考项目：老自动化客户端（只读参考）

- 路径 `/Volumes/SSD/老自动化客户端`（不在本仓库，勿改、勿整体复制）；关键文档 `自动化平台重构交接文档.md`、`MEMORY.md`。
- 只取业务规则与协议语义（牌型/决策/找房进房/旧命令映射），**不复制其 UI 与进程依赖**（老链路是 Windows 真客户端 + helper.py 轮询）。

## 5. 当前状态（细节见 CURRENT 与交接）

- 代码已完成：13 个页面与接口、真实开户、俱乐部维度投放（邀请码定位 + 自动入会 + 失败重试）、分组全局化、
  机器人批量操作（影响面预检、>10 台转审批）、自动分配 Worker + 等待可视化、只进底皮（`room_pi` + `XUAN_ROOM_PI`）、
  三处入口的单台运行日志、策略管理与运行期下发。
- 验证口径：静态检查（`go build/vet/gofmt`、`tsc/eslint/vite build`）与 mock 预览（9911 + 7458，**非真实后端**）已过；
  **真实登录后的页面、真实入会链路（`pending→joined/failed`）、真机进房、策略端到端均未验**。
- 发布口径：**030–038 已执行，039 未执行**；2026-10-29 前后端多轮已部署，**工作树未提交**。
  回滚点为服务器 `web.previous-*` / `bin/xuanmanager.previous-*` 与 `backups/*.sql.gz`；剩余问题见[清单](../handoffs/2026-10-28-open-issues-backlog.md)。
- 数据：演示数据（`is_demo=1`）2026-10-27 清空，2026-10-29 又清了一次自动化测试数据；页面为空属正常，
  造数据走「机器人管理 → 批量创建」再「投放管理 → 输邀请码」，新建都是 `is_demo=0`。
- 待确认（未清理）：游戏库 `kbedm.third_marketing_info` 里 9 个手工测试账号（id 30–38）——后台无删号接口，需授权再动。

## 6. 待办

按建议顺序的完整待办（含发布流程与真机冒烟步骤）已汇总到[剩余问题清单](../handoffs/2026-10-28-open-issues-backlog.md)；
本页只保留还没排期的两项：**房间监控接真实房间**（复用 `GET /api/admin/hall/rooms`，退掉演示快照）与
**统计报表**（按俱乐部·分组·机器人的局数/净分/时长 + CSV、24 小时曲线）。前端发布步骤见[落地交接](../handoffs/2026-10-27-automation-console.md)。

## 7. Worker 通道（`/agent/v1/*`）

后台「Worker 节点」页与 `/agent/v1/*` 六条通道（注册换租约、心跳回权威指派、拉命令、回执、事件批量、退出上报离线）。
时序、在线判定、命令状态机、事件收敛、janitor、`xuanagent` 启动参数与已验证/未验证，全部以
[Worker 通道专题](automation-worker-channel.md) 为准（本页不复制）。

## 8. 周计划（按周时段，2026-10-29 未验证）

- **口径（用户确认）**：周一到周日分别勾选，**每天可多段**；**允许跨零点**（22:00–02:00 算在开始那天）；
  **每个时段单独累计净分**；**时段外让出机器人、不占 Worker，但手里最后一局要打完**。
- 落库：`profit_mode='schedule'` + `profit_schedule`（`[{"weekday":1,"start":"12:00","end":"18:00"}]`，
  weekday 1=周一…7=周日，最多 28 段）；`schedule_window` 是当前时段键，`window_net` 是本时段净分，
  `schedule_state='released'` 表示已让出 Worker。
- 引擎：`automation_schedule.go`。`SweepAutomationSchedules` 每 5 秒跟着 janitor **先于分配**跑：
  时段内换键清零 `window_net` 并解除挂牌；时段外先置 `desired_status='draining'`，离房后
  `worker_id=NULL` + `released`；三处分配/等待统计均排除 `released`。所有时间按 `automationPeriodLocation`（东八区）。
- 下发：指派 SQL 对 `schedule` 模式把 `window_net` 当 `todayNet` 发给客户端；`GameSettled` 同时累加
  `window_net`。节点 `terminal.go` 把 `draining` 映射为 stdin `drain`；`client.js` 收到后打完当前局再
  `shutdown`（没在局里立即退出）。
- 界面：投放「输赢目标周期」新增「按周时段（周一到周日）」，周一~周日勾选 + 每段 `time` 输入，
  跨零点标「次日」；机器人配置弹窗同样可改并显示本时段净分/让出状态；投放列表机器人行显示时段摘要。
- 验证：`go vet`/`go build`、`tsc -b`/eslint/`vite build` 通过；跨零点与星期归属用临时 Go 测试验证后删除。
  **后端（迁移 039 已执行）与前端已上线；页面交互、Worker 排空链路未实测**。见[交接](../handoffs/2026-10-29-profit-weekly-schedule.md)。

## 策略与机器人收尾（2026-10-29，已部署 v6）

**策略**只描述怎么跑、怎么打；**投放**负责选机器人、绑策略、底皮、输赢目标（投放必选策略与输赢）。
优先级：已发布（`gray`/`enabled`）> 机器人列 > 分组默认，**草稿不下发**；链路：策略 JSON → 心跳
`assignments.strategyConfig` → `XUAN_STRATEGY` / stdin `config.strategy` → `applyStrategyOverrides` + `mergeTuning`。

**机器人**：创建弹窗删掉「智力」「默认带入倍数」「添加后参与调度」；分组下拉旁可**内联新建自动化组**
（建完自动选中）；登录密码存 **AES-256-GCM 密文**（`v1:` 前缀），心跳时后端解密下发，游戏库仍只存 MD5。
密钥 `XUAN_CREDENTIAL_KEY`（缺省回落 DB 密码 = 没加密）；丢失即全部不可解，换钥用 `bin/xuanresea` 重封。详见[密码密文交接](../handoffs/2026-10-29-robot-password-sealed.md)。

**控制台**：侧边栏一级菜单可折叠（状态存 `localStorage["xuan.nav.collapsed.v2"]`，默认折叠）。
细节、部署表与 git 状态见[策略交接](../handoffs/2026-10-29-automation-strategy-runtime.md)与
[收尾交接](../handoffs/2026-10-29-automation-robots-and-console.md)。
- 部署与 git 状态（分支 `codex/club-ui`，**全部未提交**）见
  [收尾交接](../handoffs/2026-10-29-automation-robots-and-console.md)。
