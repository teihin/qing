# 交接：Worker 真实客户端（多逻辑客户端）—— 代码已落地，未发布

日期：2026-10-28 01:00～01:15 探查；同日续写落地
前序：[自动化控制台](2026-10-27-automation-console.md)、[Worker 通道专题](../topics/automation-worker-channel.md)
协议事实（不要在本文重复）：[真实客户端探查专题](../topics/automation-real-client.md)

## 目标与范围

用户要求：「worker 实现多逻辑客户端的功能，也就是模拟自动控制下的客户端，要实现根据分配给他的账号密码登录以及后续自动化操作。」
即把 `server/cmd/xuanagent/terminal.go` 的模拟器换成真 KBEngine 客户端：按 `mgr_automation_robot` 分配的账号真实登录
154.37.155.17 游戏服，真进房、真打牌、真上报。

## 探查结论（全部实测）

1. **真登录打通**（Node 无头跑游戏自带 SDK）：`mm000000002`/`111111` 登录成功，`onLoginSuccessfully <Account#2030>`、
   `guuid=207293`；不存在账号收到真实 `onLoginFailed [5]`。地址必须
   `wss://154-37-155-17.nip.io/ws/20013/`（裸 IP 直连/反代都不通）。
2. **密码来源**：客户端发明文、服务端 MD5 比对；机器人统一密码 `111111`
   （`player_wxpwd=96e79218965eb72c92a549dd5a330112` 三号一致）。
3. **协议面摸清**：查俱乐部房间列表、进房、坐下两段式、全套牌桌动作（详见专题 §5～§6）。
4. **PoC 固化进仓库**：`XuanManager/tools/kbe-poc/explore.js`（可跑，步骤用 `KBE_STEPS` 串）。
5. **两个假状态戳穿**：①`join_status='joined'` 游戏内没进会（申请制要管理员审批，进房被拒 0x311）；
   ②`terminal.go` 的房间号/座位/输赢全是公式编的。

## 本轮落地实现（下一步 1、2、4 的代码部分）

1. **密码落库**：迁移 `034_automation_robot_password.sql` 加 `login_password`（AES-256-GCM）与 `password_updated_at`；
   `internal/security/credential.go` 提供 `SealCredential/OpenCredential`，密钥取 `XUAN_CREDENTIAL_KEY`，
   缺省由 DB 密码加域分隔派生。建号/批量建号/改密同步写加密明文 + 游戏库 MD5；
   列表接口只回 `passwordSet/passwordUpdatedAt`，明文只在带租约的心跳指派（`agentAssignment.Password`）里下发。
2. **`XuanManager/agent-client/`**（Node，一进程一账号）：自包含加载 kbengine.js/Account.js/Item.js；
   登录、掉线/踢线重连、查房选空位、`reqEnterRoom`、预坐、坐下（带入 = 最低带入 × `buyinMultiple`）、起立、离房、
   `reqHeart`、stdin 控制（pause/resume/stop）、stdout JSON 事件行、日志行。轮到自己时按游戏同款 captureId
   跟牌（`reqRaise('-1', id)`），敲牌角色丢牌（`reqPass`），`XUAN_AUTO_ACTION=0` 可关。
3. **Go 真实模式**：`xuanagent` 新增 `client:"real"`（默认仍是 `sim`）+ `clientDir/nodePath/gameHost/gamePort/gameWss`
   （`-client/-client-dir/-node` 与环境变量 `XUAN_AGENT_*` 可覆盖）。`runRealTerminal` spawn node、逐行解析、
   stderr 转 warn 日志、退出后 30s 退避、`shutdown` 先发 stop 再 4s 强杀；事件沿用服务端允许的枚举，
   `RoomJoined/RoomLeft/PlayerSeated/TurnStarted/ActionSubmitted` 带真实 roomId/roundId。

## 验证结果

- `node --check agent-client/client.js`、`gofmt`、`go build ./...`、`go vet ./cmd/xuanagent/` 全通过；
  后台前端 `tsc/eslint/vite build` 通过（密码字段只读展示）。
- **真账号登录**：直跑 node 客户端与经 Go agent 各一次，均 `LoginSucceeded`（entityId 2030、guuid 207293、
  昵称「秦明云」、gold 6000）。
- **本地桩端到端**：Python 桩实现 register/heartbeat/commands/events，事件序列
  `TerminalStarted → LoginStarted → LoginSucceeded → Waiting → LogoutSucceeded → TerminalStopped`，
  无残留 node 进程。
- **未验**：真实进房/入座/牌局动作（无已审批会员账号，进房对外可见故未强测）、真实 worker 上 real 模式长跑。

## 发布（2026-10-28 08:52，仅后端）

- 交叉编译 `CGO_ENABLED=0 GOOS=linux GOARCH=amd64 -trimpath -ldflags="-s -w"`，9,416,888 B，
  sha256 `6a7e12ae7915e02691a865d6e37d0dfaf3d2d264d0497658f6280d752d1479e0`（本地/上传后一致）；
  `go vet ./...`、`go test ./...` 通过。
- 备份 `backups/xuanmanager.20261028-0855-rollback`（旧版 `24b08e87…`）→ `stop.sh` → `install` → `start.sh`；
  `/api/health` 200，日志 08:51:54 `XuanManager started`。
- 迁移 `034_automation_robot_password.sql` 启动时执行（`mgr_schema_migration` 记于 08:51:55），
  `login_password varchar(512) NOT NULL DEFAULT ''` 已存在；3 台存量机器人该列全为空。
- 公网 `/xuanmanager/` 200、`/api/automation/robots|workers` 401（路由已注册）。
- 回滚：`stop.sh` → `install -m 755 backups/xuanmanager.20261028-0855-rollback bin/xuanmanager` → `start.sh`；
  034 只加两列，回滚二进制不删列不影响旧版。
- 未做：前端未发布（新密码字段页面仍在本机）、`XUAN_CREDENTIAL_KEY` 未配置（走 DB 密码派生，
  轮换 DB 密码会使已存密文不可解）、存量机器人密码未回填。

## 本机 worker 实跑（08:55～08:57）

- 默认终端改为真实客户端（`main.go`/`config.go` 的缺省 `client` 由 `sim` 改 `real`），不再需要 `-client real`；
  `sim` 只用于本地 mock 联调。SDK 的 `no implement` 警告在 client.js 里静音，`Waiting` 的原因写进节点日志。
- 运行目录 `XuanManager/server/bin/`：`xuanagent` 二进制 + 同名 `xuanagent.json`（`clientDir` 指回 `XuanManager/agent-client`，不再复制副本）；
  `server/bin/` 已被 `XuanManager/.gitignore` 整个忽略。启动 `cd XuanManager/server/bin && ./xuanagent`。
- 实测：注册 `workerId=1 status=online` → 自动领到 robot 1（`mm000000001`）→ 真实登录成功 →
  客户端自动提交 `申请_加入_俱乐部`，游戏内管理员批准前进不了房；机器人 `status=idle`，无 `last_error`。
- 查文档发现 **§4.10 `直接_加入_俱乐部`**（凭邀请码免审批入会），已把 client.js 的入会命令换成它：
  5s 轮询 `club_join`，最多 3 次仍无变化则标记 `skipJoinCheck` 直接尝试进房（非成员会回 0x311，日志可见）；
  失败经 `onHallCommand` 打码与文案。**尚未实测**（worker 交由用户自行启动观察日志）。

## 仍未完成 / 缺口

1. **入会链路**：申请→审批→`set_club_join` 上报，`join_status` 改真实口径（pending/joined），后台展示「待审批」；
   审批谁来点（人工一次 / 后台管理员会话代批）未定。客户端代码里已有 `申请_加入_俱乐部` 的骨架与状态映射，未联调。
2. **牌局策略**：目前只有「跟/丢」两动作最小闭环；碰杠胡、看牌、加注等未接，`strategy` 表仍是摆设。
3. **同 IP 多开未实测**：0x306「相同IP不能加入游戏」是否拦一机多号同房未知。
4. 错误码表不全（0x311 含义为推测）；GPS 是否服务端强校验未确认。

## 验证方法（可直接复现）

```bash
cd XuanManager/tools/kbe-poc
KBE_ACCOUNT=<账号> KBE_PASSWORD=<密码> KBE_SECONDS=15 \
KBE_STEPS=joinclub,clubrooms,enterroom,presit,sit,standup \
KBE_CLUB_ID=<邀请码> KBE_ROOM_ID=<房号> node explore.js
```

真实模式单机联调：`./xuanagent -once -client real -client-dir ../../XuanManager/agent-client`（配合 `-print-config` 看生效值）。

服务器侧查机器人/密码哈希（单行 ssh，多行脚本会被掐断）：
`ssh -i ~/.ssh/id_ed25519_newserver -p 2233 -o IdentitiesOnly=yes client_update@154.37.155.17
'set -a; . /www/html/.xuanmanager/runtime.env; set +a; mysql -h127.0.0.1 -u"$XUAN_GAME_DB_USER" -p"$XUAN_GAME_DB_PASSWORD" -e "SELECT r.account,r.login_password IS NOT NULL,t.player_wxpwd FROM webcm.mgr_automation_robot r LEFT JOIN kbedm.third_marketing_info t ON t.player_wxid=r.account;"'`

## 下一步（按序）

1. 执行迁移 034 并发布后端/agent（部署需用户明确授权），worker 配置改 `client:"real"`，
   在真实 worker 跑通登录→查房→进房→坐下→跟牌全链路。
2. 入会链路真实化 + join_status 真实口径 + 后台「待审批」。
3. 牌局动作补齐（准备/看牌/加注/碰杠胡），再接策略表。
4. 同 IP 多开实测（两台客户端进同房），必要时用 `egress_ip` 分流。

## 验证边界

代码与本地验证均为 2026-10-28 当日结果；生产仍是旧二进制 + 模拟器终端，
迁移 034 未执行、agent 未发布，worker 页面上的「进房间/开局/结算」日志在发布并跑通真实客户端前依然是编的。

## 按多人代打文档对齐客户端（10-28，代码已改、未实跑）

读 `服务器文档整理/多人代打接口方案-客户端调用说明.md`（10-27 修订）后改了 `XuanManager/agent-client/client.js`：

- **回合判定**：新增 `isDecisionState()`，先去掉下划线再找「决策」，修掉 `搓牌_等待_旁家_决_策_状态` 被判成非决策态、动作被取消的问题。
- **收件人过滤**：`onServerPlay` 先算 `mine`（`player_number` 等于自己座位 **或** `player_name` 等于自己 guuid）；
  `决策_倒计时_消息`（广播）里别人在倒计时时撤掉自己还没发出去的动作。
  仍以 `is_action` 作为出牌触发，不按倒计时抢动作（游戏内 DrhPlayerLogic 也是这么判的）。
- **局号与结算**：`trackRound()` 从 `持有_手牌` / `发牌_结束` / `结算_结束` 的 `room_round` 和 PlayerList 的 `round_count` 统一收局号，
  `lastRoundId = roomId-局号` 去重后发 `GameStarted`；`settleRound()` 按局号只发一次 `GameSettled`，
  分数优先 `RoundScore`，没有再取 `结算_信息_消息.round_score` 第一段（本局分）。进房时清空这些状态。
- **配牌（可选，默认关）**：`XUAN_PAIR_CLICK` 取 1~8 / 11~18 / 98 / 99 时，每次结算后为一局发一次
  `reqGameCommand({"header":"执行检查_命令","click_count":N})`；开启后每局发牌完成拉一次
  `查询_房间_游戏_信息`，从推送的 `RoomGameInfo` 打一行「在局人数 / 下一局张数 / 我的牌」。
  `next_order` 是类 Python 字面量字符串，`parseNextOrder()` 按结构切（已用样例验证）。
- **没接**：`执行安全_命令`（`must` 独占）、`关闭检查_命令`（服务端房间级清零会误伤全房）、
  §2.4.3 的下一局手牌推算、配牌回执比对。

验证只到语法与纯函数（`node --check`；`parseNextOrder` / `isDecisionState` / 局号去重 / 配牌去重用桩跑过），
**没有进真实房间跑**；`XUAN_PAIR_CLICK` 还要账号在服务端开通配牌权限，否则 `执行检查_命令` 静默无效。
