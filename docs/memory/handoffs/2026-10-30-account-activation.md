# 2026-10-30 机器人账号首次登录激活（自动登录 + 投放门禁）

## 目标与范围

- 解决的问题：批量创建只写 `kbedm.third_marketing_info`；玩家行 `kbedm.kbe_accountinfos` 由游戏服在首次登录时创建。
  没登录过的机器人入会回「玩家不存在」，而旧的 Worker 分配要求 `join_status='joined'`，形成死锁。
- 本期不做后台直接写 `tbl_Account`（2026-10-27 的决定不变），改为「有空闲 Worker 时自动跑一次只登录的终端」。

## 改动

- 迁移 `040_automation_account_activation.sql`：`mgr_automation_robot` 加 `activated_at`、`activation_error`、
  `activation_attempts`、`activation_attempted_at`（`activated_at IS NULL` = 未激活）。
- 新增 `server/internal/api/automation_activation.go`：
  - `markActivatedGameAccounts`：巡检每 5 秒按 `kbedm.kbe_accountinfos.accountName = account` 补标
    （人工真客户端登录、外部建号、上次成功未落值都算已激活）。
  - `assignActivationRobotsToWorker`：节点 `online` 且还有空位时，给 `worker_id IS NULL AND enabled=1 AND activated_at IS NULL`
    的账号排队；`activation_attempts < 10` 且距上次尝试 ≥ 60 秒。顺序排在正常分配之后，只填空余容量。
  - `verifyAutomationActivation`：LoginSucceeded 后 6 次 × 2 秒回查 `kbe_accountinfos`，查到才写 `activated_at`、
    收回节点，并对已绑俱乐部的机器人自动重试入会；查不到记失败。
  - `failAutomationActivation`：写 `activation_error`、`attempts+1`、让出节点；冷却与上限由查询条件控制。
- 事件收敛（`automation_agent.go`）：`LoginSucceeded` / `LoginFailed` 分支先判 `activated_at IS NULL`；
  激活会话成功即置 `desired_status='stopped'`（防节点重新拉起）并异步回查，失败走激活失败分支。
  心跳在正常分配后补一次激活分配；janitor 在 `assignWaitingRobots` 之后跑 `sweepAutomationActivations`。
- 指派下发：`queryAgentAssignments` 多返回 `activated_at IS NULL AS loginOnly`；Go 结构体加 `LoginOnly`。
- 节点/客户端：`xuanagent` 把 `loginOnly` 落到终端，真实终端注入 `XUAN_LOGIN_ONLY=1`；模拟终端登录后直接 logout。
  `agent-client/client.js` 在 `loginOnly` 下登录成功后 3 秒 `shutdown`（等玩家行落库），不进房。
- 投放门禁（`automation_clubs.go`）：分组展开只取 `activated_at IS NOT NULL`；`POST /deploy` 逐个校验，
  未激活直接回 `409 ROBOT_NOT_ACTIVATED` 并列出终端号（最多 5 台）。
- 机器人接口：列表/详情返回 `activatedAt` / `activationError`；新增动作 `activate`（重置冷却与次数，不动节点）。
- 前端：投放弹窗未激活行置灰不可勾选、全选只算已激活、分组数量只算已激活；机器人管理列表与详情显示
  「未激活」徽标、原因和「激活」按钮；`.automation-row-inactive` 样式。

## 部署记录（2026-10-30 01:08 CST）

- 后端：`GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w"`，9,507,000 B，
  sha256 `0c602dbd2ffe7d49b740389f2aacaa0562fd6d506492e83a055d2448c5889666`；已 `install` 到
  `/www/html/.xuanmanager/bin/xuanmanager`，PID 15511，`/api/health` 200。
- 迁移：启动自动执行，`mgr_schema_migration` 最新为 `040_automation_account_activation.sql`；
  `mgr_automation_robot` 的 `activated_at` / `activation_error` / `activation_attempts` / `activation_attempted_at` 均已存在。
- 前端：`index-BgH2Ot-G.js` + `index-BvCWh9Hq.css`，首页回读 hash 一致，JS 200 / 724,507 B，`未激活` 文案命中。
- 回滚：`backups/xuanmanager.20261030-0108-rollback`、`web.previous-activation-20261030`。
- Worker：本机 `XuanManager/server/bin/xuanagent` 已用 `GOOS=darwin GOARCH=arm64 -trimpath -ldflags="-s -w"` 重建
  （旧件备份 `xuanagent.previous-20261030`，含 `XUAN_LOGIN_ONLY`）；**未启动**。
  库里唯一节点 `mac-mini-2-local`（darwin/arm64，max_robots=20）自 2026-10-28 14:22 起 offline。

## 验证

- 构建期：`go build ./...`、`go vet ./...`、`tsc -b`、`eslint src/pages/automation`、`vite build` 通过。
- 部署后：健康检查 200、040 已执行、前端资源可访问、日志无新错误；线上二进制含 `ROBOT_NOT_ACTIVATED`（1 处）
  与 `activation_attempts`（7 处）。
- 补标 SQL 复核（2026-10-30 01:1x）：`EXPLAIN UPDATE` 在线上 MySQL 5.7.44 被接受，语法无问题；
  当时 `mgr_automation_robot` 两条记录 `activated_at` 仍为 NULL，原因不是回填失效——
  `kbedm.kbe_accountinfos` 里根本没有 `jqr001/jqr002`（现存 44 条，最新 `m000005`），
  之前看到的 45/46 是 `kbedm.third_marketing_info` 的 id（营销表只有这两条、`player_guuid` 为空）。
  巡检按设计不动它们；节点 `mac-mini-2-local` 离线，也排不出激活会话，属预期状态。
- 另发现遗留数据：机器人 1 在 10-29 23:55 被标成 `join_status=joined`（俱乐部 567671），
  但游戏库 `club_member_score_info` 里没有它，账号也不存在——说明 `添加_俱乐部_玩家` 对不存在的账号
  也可能回 512/1280。该问题在激活门禁之前产生，现在未激活账号已不能投放，不再新增此类记录；旧记录待人工确认后清理。
- **未验证**：真实 Worker 激活登录、`kbe_accountinfos` 回查命中、玩家行落库时长、激活后自动入会、
  页面上的未激活置灰与「激活」按钮交互。

## 下一步

1. 启动 Worker（主人自行执行）：`cd XuanManager/server/bin && ./xuanagent`，确认心跳后节点转 online。
2. 用一台新建机器人验证：创建 → 有空闲 Worker 时自动登录激活 → 投放弹窗可勾选 → 投放并入会成功。
3. 观察 `logs/xuanmanager.log` 的 `assign activation robots to worker` / `robot activated by first login` /
   `fail robot activation`，以及 Worker 端终端的一次拉起、登录成功与 3 秒退出。
4. 若激活失败，检查 `activation_error` 与 Worker 日志：密码错、游戏服不可达、`kbe_accountinfos` 建行过慢都会被记下。
