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
4. **分组是全局的**（`mgr_automation_group.club_id=''`），组上设默认智力与默认输赢目标，
   单台机器人可以覆盖；智力 0 表示跟随分组。
5. **默认带入是倍数不是金额**：`buyin_multiple`（1–10，默认 1）= 房间最低带入的几倍；
   `buyin` 保留为「当前在房带入」。
6. **输赢目标**支持「每日总输赢」与「一段时间总输赢」（`profit_mode=daily|period` + `profit_target` + 周期）。
7. **策略和输赢目标是「投放时」的设置**（2026-10-27 用户明确要求）：投放弹窗里选「机器人策略」
   （来自策略中心已配置的策略）+ 设「输赢目标周期/金额」，一批投放统一覆盖；留空 = 沿用机器人/分组原有设置。
   **机器人管理里完全不出现这两项**（列表列、详情项、编辑弹窗的输入与展示都已删掉，只保留分组/智力/倍数/IP）。
8. **投放完还要挂 Worker 才算跑起来**：`POST /deploy` 之后自动调 `assignAutomationWorkers`，
   按「在线 + 心跳 5 分钟内 + 未满容量」挑节点填空；入会成功后也会再尝试一次。
   没分到的机器人停在 `worker_id IS NULL`，界面显示「等待分配 Worker」并在详情页给出原因
   （没有在线节点 / 容量不够），可点「重新分配」重试。
9. **只进哪些底皮**（2026-10-28）：机器人可设「只进 0.1/0.3、0.2/0.5、1/3、2/5、5/10、10/20、20/40、50/100 中
   的若干档」，存放在 `mgr_automation_robot.room_pi`（`底皮5/10` 逗号分隔，空 = 不限）。
   能在三处设：投放弹窗、投放后俱乐部的「配置」弹窗、机器人管理编辑弹窗。实际落到
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
| `/automation/robots` | 机器人管理 | 批量真实开户、筛选、编辑（分组/智力/倍数/**只进底皮**/IP，**策略与输赢目标在投放时设，这里完全不展示**）、启停、删除、详情（点名称或「日志」看运行日志，运行中的机器人直接落在「运行日志」页签）、**批量操作** |
| `/automation/groups` | 自动化组 | 组列表与配置 |
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
  `035_automation_room_pi.sql`（机器人 `room_pi`，只进底皮档位，空 = 不限）。
- 后端：`XuanManager/server/internal/api/automation.go`、`automation_clubs.go`、`automation_robots.go`、`automation_ops.go`、
  `automation_deploy.go`（俱乐部维度投放）；路由在 `automation_ops.go` 的 `registerRoutes`，权限经 `authorized` / `authorizedAny`，
  写操作带 CSRF、审计与数据范围（`mgr_automation_scope`）。
- 前端：`XuanManager/web/src/pages/automation/`（12 个页面 + `AutomationDeployPage`、`AutomationRobotsPage`、`shared.tsx`、`AutomationRobotModals.tsx`）；
  路由与门控在 `App.tsx`，菜单与图标在 `Layout.tsx`。
- 投放相关接口（`automation_deploy.go`）：
  `GET /api/automation/deploy/clubs`（已投放俱乐部列表，含 `workerAssigned/workerWaiting/workersOnline`）、
  `GET /api/automation/deploy/clubs/{clubId}`（详情：club/groups/robots/strategies/history）、
  `GET /api/automation/deploy/lookup?inviteCode=`（邀请码定位俱乐部 + 剩余名额）、
  `POST /api/automation/deploy`（`{inviteCode, robotIds|groupIds, strategyId, profitMode, profitTarget, periodStart, periodEnd, roomPi}`，
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

## 3.1 邀请码是怎么"找"俱乐部的（2026-10-27 22:51 已改为游戏库真实码）

**口径（用户确认）：投放时输的是「游戏里显示的俱乐部邀请码」，不是俱乐部 ID。**

现在 `lookup` 与 `POST /deploy` 都走 `resolveDeployClub`（`automation_deploy.go`）：

1. 前端 `DeployRobotModal` 输 6 位码 → 350ms 防抖 → `GET /api/automation/deploy/lookup?inviteCode=`
2. 校验 6 位数字 → `gameClubByInviteCode`：`club_invite_code_info`（`invite_code` varchar(10) 唯一索引，90 万行码池）
   `LEFT JOIN club_guuid_info` 取 `club_name`（完整 SQL 见[交接](../handoffs/2026-10-27-automation-console.md)）
3. 判定：查不到 → 回退后台 `mgr_automation_club.invite_code`（兼容手工绑定）；`club_guuid` 为空 → 码还没被俱乐部用；
   `status != 'used'` → 码已失效；`club_status != 'used'` → 俱乐部已解散
4. 命中后 **自动 upsert** 进 `mgr_automation_club`（`ensureAutomationClub`，只刷新 `name`/`invite_code`，
   不动投放数量、每房上限、启停），再按 `club_id` 读配额算 `remaining`
5. `POST /api/automation/deploy` 用同一个 `resolveDeployClub`，所以不用先 lookup 也能投

游戏库这两张表（`kbedm`，运营后台与客服站共用同库）：

| 表 | 关键列 | 体量 / 现状（2026-10-27） |
|---|---|---|
| `club_invite_code_info` | `invite_code`(varchar10, 唯一)、`club_guuid`、`user_guuid`（码归属代理）、`status`(`init`/`used`/`disabled`)、`date` | 90 万行码池；`init` 899961、`used` 11、`disabled` 28 |
| `club_guuid_info` | `club_guuid`、`club_name`、`club_status`(`init`/`used`/`del`)、`number_count`、`account_id`… | 真实俱乐部 `used` 6 个、`del` 17 |

实测映射：`953642 → 535696 → 功能测试`（码归属代理 725838）、`996242 → 567671 → sefsef`。
一个俱乐部可以有多条码（每个代理一条），所以 `mgr_automation_club.invite_code` 记的是**最近一次投放用的那条码**，
机器人各自 `invite_code` 字段保留自己那条，便于回溯是谁的码带来的。

历史（已废弃）：改造前是纯后台库查询 `mgr_automation_club.invite_code`，与游戏码无关；
而 `mgr_automation_club` 没有任何新增接口（只有 `PUT` 改配置），演示数据清掉后表为空 → 输任何码都 404。

## 4. 参考项目：老自动化客户端（只读参考）

- 路径：`/Volumes/SSD/老自动化客户端`（**不在本仓库**，跨磁盘只读引用，勿修改、勿整体复制）。
- 关键文档：`自动化平台重构交接文档.md`（架构、数据表、状态机、Worker 协议、旧命令映射、阶段划分）、`MEMORY.md`。
- 老实现核心：`helper/assets/scripts/AutoPlayManager.ts`、`AutoPlayer.ts`、`AutoMessage.ts`、`AutoMonitor.ts`、`panelAutoTask.ts`、
  `helper/helper.py`、`helper/main.py`。老链路是「Windows 真客户端 + helper.py 轮询 + 内存命令表」。
- 复用时只取业务规则与协议语义（牌型/决策/找房进房流程/旧命令映射），**不复制其 UI 与进程依赖**。

## 5. 当前状态（细节见 CURRENT 与交接）

- 代码已完成：13 个页面与接口、真实开户、俱乐部维度投放（邀请码定位 + 自动入会 + 失败重试）、分组全局化、默认带入倍数、
  机器人批量操作（含影响面预检、>10 台转审批）、投放时选策略 + 输赢目标、自动分配 Worker + 等待可视化、
  只进底皮（`room_pi` + `XUAN_ROOM_PI`）、三处入口的单台机器人运行日志。
- 验证口径：静态检查（`go build/vet/gofmt`、`tsc/eslint/vite build`）与 mock 预览（9911 + 7458，**非真实后端**）已过；
  **真实登录后的页面、真实入会链路（`添加_俱乐部_玩家` 的 `pending→joined/failed`）、真机进房与底皮筛选均未验**。
- 发布口径：**030–034 已执行并发布**（回滚 `backups/xuanmanager.20261028-0855-rollback`）；
  **035/036/037 未执行**、这几批前后端均未发布、工作树未提交。DB 回滚点 `backups/mgr_automation.20261027-2209.sql.gz`。
  逐条剩余问题见[剩余问题清单](../handoffs/2026-10-28-open-issues-backlog.md)。
- 数据：**演示数据（`is_demo=1`）已于 2026-10-27 22:30 全部清空**（清理前备份 `backups/mgr_automation.pre-clean.20261027-2226.sql.gz`），
  页面为空属正常；造数据走「机器人管理 → 批量创建」再「投放管理 → 输邀请码」，新建数据都是 `is_demo=0`。
- 待用户确认（未清理）：游戏库 `kbedm.third_marketing_info` 里 2026-10-27 手工注册的 9 个测试账号（id 30–38）——
  后台没有删号接口，删游戏账号跨多张表，需明确授权再动。

## 6. 待办

按建议顺序的完整待办（含发布流程与真机冒烟步骤）已汇总到[剩余问题清单](../handoffs/2026-10-28-open-issues-backlog.md)；
本页只保留还没排期的两项：**房间监控接真实房间**（复用 `GET /api/admin/hall/rooms`，退掉演示快照）与
**统计报表**（局数/净分/时长按俱乐部·分组·机器人 + CSV 导出、总览 24 小时曲线）。前端发布步骤（`vite build` → 暂存目录 → `mv web web.previous-<日期>` → 原子替换 → 清 `._*` → 验 hash）见[落地交接](../handoffs/2026-10-27-automation-console.md)。

## 7. Worker 通道（`/agent/v1/*`）

后台「Worker 节点」页与 `/agent/v1/*` 六条通道（注册换租约、心跳回权威指派、拉命令、回执、事件批量、退出上报离线）。
时序、在线判定、命令状态机、事件收敛、janitor、`xuanagent` 启动参数与已验证/未验证，全部以
[Worker 通道专题](automation-worker-channel.md) 为准（本页不复制，避免两处数字打架）。
