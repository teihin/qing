# 2026-11-25 机器人管理三项小改（原文，2026-11-26 从 CURRENT.md 归档）

## 2026-11-25 机器人管理显示用户ID与俱乐部金币、设备码按账号固定、双击启动 Worker

- 后端 `GET /api/automation/robots`（列表与详情）新增 `playerId` 与 `clubs[{clubId,name,clubGold}]`：
  由 `kbedm.third_marketing_info.player_guuid` 找玩家行，`tbl_Account.sm_club_make/join/manage` 取所属俱乐部、
  `sm_club_gold`（JSON）取该玩家在各俱乐部的金币，名称走 `club_guuid_info`。账号没登录过就留空。
- 前端机器人列表加「用户ID」列，俱乐部列改成俱乐部标签 + 各自金币（0/未达门槛标黄）；
  机器人详情「机器人信息」页签补「用户ID」「所属俱乐部」「俱乐部金币」三行，并注明带入从俱乐部金币扣。
- 客户端设备绑定：`device_id` 改为**按账号**生成（`xuanagent-` + sha1(account) 前 32 位），换节点/换终端号都不变，
  platform 仍可 `XUAN_DEVICE_PLATFORM` 覆盖；登录数据结构与客户端 `DeviceIdentityManager.createLoginData` 一致。
- 新增根目录 `5启动机器人Worker.command` / `5停止机器人Worker.command`：**前台运行**，关窗口或 Ctrl-C 即停；
  每次启动自动分配节点编号（`mac-mini-<3位随机>`，可传参覆盖），可同时开多个互不顶号；
  停止脚本只用于一次停掉全部（`pkill -TERM -x xuanagent`）。
- 验证：库内实测 worker001 → 用户ID `627876`、俱乐部 `775447`、俱乐部金币 `{"775447":0}`；
  `go build/vet`、`tsc`、`vite build` 通过；测试服 bin `a1c524aa…`、web `index-D78KNJXy.js`（页面 200、接口未登录 401）。
  回滚点 `bin/xuanmanager.previous-profile-20261125`、`web.previous-profile-20261125`。
- 未验证：登录态下列表/详情的实际渲染；设备码绑定在游戏服的真实判定（当前两个机器人 `anti_theft_on=0`、无 device_id）。

## 2026-11-25 机器人余额不足改为「报警 + 等待补分」，日志窗口放大（测试服已部署）

- 客户端（`agent-client/client.js`）：服务端回 770「带入金币不足」后**不再每 2 秒重试**。
  预坐阶段被拒 = 服务端按账号余额判的（下发多少带入都没用）→ 直接进缺钱等待；坐下阶段被拒则先按
  候选档次加码（min / 2× / 4× / 余额一半 / 全额）再放弃。进等待后每 5 秒看一次余额，
  **只有余额比报警时更高才立刻恢复**，否则 60s→300s 退避重探（最长 5 分钟一次）；等待期间留在原房，
  不计「等座超时」也不换房。
- 新事件 `FundShortage` / `FundRestored` 进白名单；后台 `applyAgentEventToRobot` 写 `last_error`，
  并在 `mgr_automation_alert` 开/关一条 `robot_fund` 告警（同一机器人只保留一条 open，补分后自动 resolved）。
- 后台界面：运行日志列表可视高度 320/360px → `min(58vh,640px)` / `min(66vh,820px)`；
  节点详情、机器人详情、机器人日志三个弹窗从 `wide`(900) 加宽到 `xwide`(1180)。
- 验证：实测「预坐→770→一次报警→静默等待」，770 只出现 4 次（启动阶段），告警落库 `robot_fund/open`；
  `go build/vet`、`tsc`、`vite build` 通过；测试服 bin `c6690fc7…`、web `index-DcPq1v9U.js`。
  回滚点 `bin/xuanmanager.previous-fund-20261125`、`web.previous-logpanel-20261125`。
- **口径修正（22:38）**：带入扣的是**俱乐部金币**（`kbedm.club_guuid_info.club_gold`），不是账号金币。
  指派清单下发改带 `clubGold`，节点启动注入 `XUAN_CLUB_GOLD` 并热更新；客户端 `availableFunds()` 统一取
  俱乐部金币，`sendSit`/`tryBuyin`/770/观察器全部改用它，预坐前本地先挡。实测俱乐部 775447 金币 0：
  预坐请求 0 次、770 只剩 1 条、告警 open、静默等待。详见[俱乐部模式交接](handoffs/2026-10-29-worker-club-mode.md)。

## 2026-11-25 投放机器人：俱乐部支持「选择 + 输入」（测试服已部署）

- 投放弹窗原来只能填 6 位邀请码。新增 `GET /api/automation/deploy/club-options?keyword=&limit=`
  （权限同 `automation.deploy.manage`）：以游戏库 `club_invite_code_info` 里 `status='used'` 的码为入口
  倒查俱乐部（`club_guuid_info` 近 89 万行，不能整表列），关键词匹配邀请码 / 俱乐部编号 / 名称，
  按数据范围过滤、同俱乐部多码只留最新一条，返回 `clubId/name/inviteCode/status/robotQuota/robotCount/remaining`。
- 前端 `AutomationDeployPage` 弹窗新增「选择俱乐部」搜索框 + 下拉（选中自动回填邀请码），
  原邀请码输入框保留，两种方式任选；手输命中候选时下拉同步选中。从俱乐部详情进入时仍锁定不显示下拉。
- 验证：候选 SQL 在测试库 21ms 返回（A1-2 / A1俱乐部 / 踩踩踩 / w1俱乐部 等）；`go build/vet`、`tsc`、
  `vite build` 通过；测试服已部署（bin `278b6cb1…`、web `index-BirxEfcW.js`），新路由未登录 401、页面与 JS 200。
  回滚点 `bin/xuanmanager.previous-clubopt-20261125`、`web.previous-clubopt-20261125`。
- 未验证：登录态下点选投放的实际交互。
