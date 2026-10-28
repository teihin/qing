# 真实客户端探查（KBEngine 协议，2026-10-28）

目的：让 xuanagent 的终端从模拟器换成「按分配账号真实登录游戏服 + 后续自动化」。
本文沉淀探查到的协议事实与运行方法；任务进度与缺口见[交接](../handoffs/2026-10-28-automation-real-client.md)。
PoC 代码：`XuanManager/tools/kbe-poc/explore.js`（可直接跑）。

## 1. 结论速览（全部实测通过）

- Node 22 无头跑游戏自带 SDK 完全可行，**真登录已打通**：`mm000000002`/`111111` →
  `onLoginSuccessfully <Account#2030>`，拿到 `guuid=207293`、昵称「秦明云」、`gold=6000`。
- 不存在账号 → `onLoginFailed [5]`（SERVER_ERR_NAME 用户名不正确），服务端回包真实。
- 机器人密码明文 **`111111`**：3 个机器人 `player_wxpwd` 同为 `96e79218965eb72c92a549dd5a330112` = MD5("111111")。
- 俱乐部加入是**申请审批制**，现有 `join_status='joined'` 是假状态（游戏内没进会），非成员进俱乐部房被拒（0x311=785）。
- 一机多开风险：服务端有 `0x306 规则不允许相同IP客户端加入游戏`（未实测触发条件）。

## 2. Node 加载 SDK（关键坑）

- `assets/scripts/kbe_scripts/` 下三个文件：`kbengine.js`（134KB SDK）、`Account.js`（22KB 实体）、`Item.js`。
- **`kbengine.js` 是裸脚本**（顶层 `var KBEngine`），必须 `vm.runInThisContext(source)` 直接执行；
  套 CommonJS 包装会让 `var` 变函数局部，后续 `require("kbengine")` 拿到 undefined。
- `Account.js`/`Item.js` 用极简 require 垫片加载：`require("kbengine")`→全局 KBEngine；
  `require("../GameDataManager")`→只用到 `dtLastSend/dtLastSuccess` 时间戳，空壳即可。
- 需要最小 `global.cc`（Account.js 的 `decodeEncryptedData` 分支读 `cc.sys.localStorage`，微信专用，给空壳 storage）。
- `global.window = global` 必须设（SDK 第 92 行 `window.Class = KBEngine.Class`）。Node 22 自带 WebSocket。

## 3. 登录链路

- 地址（实测三种结果）：`ws://154.37.155.17:20013` 不可达；`wss://154.37.155.17/ws/20013/` 握手失败（HTTP 200）；
  **必须 `wss://154-37-155-17.nip.io/ws/20013/`**（nip.io 域名 + WSS 反代，裸 IP 的 SNI/Host 不对）。
- KBEngineArgs：`ip=154-37-155-17.nip.io, port=20013, isWss=true,
  wssProxyBaseURL='wss://154-37-155-17.nip.io/ws/', wssProxyAllowedPorts=[20013,20015..20019], defBaseAppIP=同域名`。
- 登录：`KBEngine.Event.fire("login", 用户名, 明文密码, JSON.stringify({version:1, platform:"web", device_id, scene:"login"}))`。
  客户端发**明文**（`panelLogin.onLoginSystem` 直接取 EditBox），服务端自己 MD5 比对。
- 实体定义在登录流程内导入（`Baseapp_importClientEntityDef`），`KBEngine.Account` 必须在登录前注册好。
- 掉线重连：客户端原逻辑是重调 `loginGame(旧账号,旧密码,"重连")`，loginData 用 `scene:"reconnect"`。

## 4. 凭据事实（决定存储方案）

- 权威密码列：`kbedm.third_marketing_info.player_wxpwd` = `MD5(明文)`（password_reset.go 注释「登录校验的权威来源」）。
- 批量建号（automation_robots.go `INSERT ... MD5(?)`）只存哈希、游戏库无法反查明文；
  **已落地**：迁移 034 给 `mgr_automation_robot` 加 `login_password`（AES-256-GCM）+ `password_updated_at`，
  建号/改密时同步写加密明文，游戏库仍只存 MD5。密钥 `XUAN_CREDENTIAL_KEY`，缺省由 DB 密码加域分隔派生。
  历史机器人（统一 111111）在新版本里改一次密码才补齐明文；之后登录都用库里的加密密码。

## 5. 大厅与俱乐部协议（reqHallCommand，参数 JSON 带 header）

| 命令 | 请求 | 应答事件 |
|---|---|---|
| 查房间列表 | `{"header":"查询_俱乐部_房间_信息","club_id":id,"is_zip_result":"0","page":"0","count":"20","fillter_01":"","is_have_site":"false","fillter_02":"","is_no_running":"0"}`，context=`P@查询_俱乐部_房间_信息` | `AllRoomInfo`（`result[].room_id/room_status/play_mode/max_number/player_and_watcher_count/special_rule[]`）+ `onHallCommand 512` |
| 申请入会 | `{"header":"申请_加入_俱乐部","invite_code":"6位码"}`，context=`p@club:join` | `onHallCommand 512`（仅表示申请提交），**入会要管理员游戏内审批**，批完后推 `set_club_join` |
| 凭码直接入会 | `{"header":"直接_加入_俱乐部","invite_code":"6位码"}`（文档 §4.10，2026-10-28 新增，机器人走这条） | **免审批**立即成为成员；同步 `0x301`（码空/非数字）或异步 `0x200/0x301`；成功后服务端不回带 club_id，读自身 `club_join` |

实测：俱乐部 `567671`（名 sefsef，邀请码 996242，quota 20，max_per_room 2）有 7 个房间，
首间 `room_id=420121`（准备、8人、0 玩家）。`AllRoomInfo` 的 `result` 可能整包 zip（is_zip_result=1 时），传 0 拿明文。

## 6. 进房与坐下协议

- 进房：`reqEnterRoom("Custom", roomID, JSON.stringify({club_id}))` —— 第三参是**单层 JSON 字符串**
  （`withRoomClubId` 输出 `{"club_id":"567671"}`；`{{...}}` 是旧客户端包装，不能下发）。成功=`onEnterRoom 0x200(512)`；失败码如 `785`。
- 坐下两段式（panelGameView）：先 `reqRoomCommand({"header":"预坐_事件","site":N}, "预坐_事件")` 锁座 →
  PlayerList 回推确认本人坐上后 → `reqRoomCommand({"header":"坐下_事件","money":带入,"ready":1,"type":"直接","club_id":"..."}, "坐下_事件1")`；
  老玩家短路径直接 `{"header":"坐下_事件","site":N}`。起立 `{"header":"起立_事件"}`；另有 留座/回座/玩家_带分_事件/玩家_搓牌_事件。
- 客户端坐下前有 GPS 检查（`CheckCanSitByGps`/`IsGpsOpen`），服务端是否强校验未确认。
- 动作面（Account.js baseCall，可直接驱动）：`reqJoin/reqReady/reqStart/reqTake/reqThrow/reqPeng/reqGang/reqHu/reqPass/reqTing/reqChi/reqTao/reqRaise/reqLeaveRoom/reqHeart`。

## 7. 硬阻塞与风险

1. **俱乐部审批**：机器人须先 `申请_加入_俱乐部`，再由俱乐部管理员在游戏内「管理同意」。自动化方案二选一：
   人工批量批一次（一次性），或后台用管理员客户端会话调审批接口（`ClubManagementApi` 的 approve）。
   `join_status` 应改为真实上报：申请提交=pending、收到 `set_club_join` 推送=joined。
2. **同 IP 限制**：0x306 提示存在「相同IP不能加入游戏」的规则，一台 worker 多开同房间可能被拒；多开分房或出口代理（robot 表已有 `egress_ip` 字段）未验证。
3. 自助建房（roomID=0 无 club）实测无回包，路不通；机器人进房依赖已存在的俱乐部房间。
4. 错误码表不全：只确认 0x200 成功、0x301~0x306（panelMain）、0x311=785（疑似非俱乐部成员/无权进房）。

## 8. 架构建议（给实现者）

- KBEngine SDK 是单例（`KBEngine.app` 全局），**一个 Node 进程跑一个客户端**；Go agent 每终端 spawn 一个 node，
  stdin/stdout JSON 行双向通信：node→go 上报事件（LoginSucceeded 带 entityId/guuid、RoomEnterFailed 带码与文案…），go→node 下发启停。
- node 端以 `tools/kbe-poc/explore.js` 为底子：把加载器（runInThisContext + require 垫片 + cc/window 垫片）抽成
  `agent-client/` 自包含目录，`kbengine.js/Account.js/Item.js` 从游戏工程拷进去（注意 .meta 不用拷）。
- 事件映射参考 `terminal.go` 现有枚举：onConnectionState(false)/onDisconnected→掉线重登，onLoginFailed(code)→`KBEngine.app.serverErr(code)` 取文案进 payload。

## 9. 已落地实现（2026-10-28，代码已写、未发布）

- **目录**：`XuanManager/agent-client/`（`client.js` + `sdk/{kbengine,Account,Item}.js`，SDK 从游戏工程原样拷入）。
  Go 侧 `xuanagent` 新增模式 `client:"real"`（10-28 起默认 `real`，`sim` 只留给本地 mock），配置项 `clientDir/nodePath/gameHost/gamePort/gameWss`。
- **输入（环境变量）**：`XUAN_ROBOT_ACCOUNT/PASSWORD/ID`、`XUAN_TERMINAL_NO`、`XUAN_CLUB_ID`、`XUAN_INVITE_CODE`、
  `XUAN_JOIN_STATUS`、`XUAN_BUYIN_MULTIPLE`、`XUAN_START_PAUSED`、`XUAN_AUTO_ACTION`、`XUAN_ROOM_PI`、
  `XUAN_GAME_HOST`（默认 `154-37-155-17.nip.io`）、`XUAN_GAME_PORT`、`XUAN_GAME_WSS`、
  `XUAN_ROOM_RETRY_MS`、`XUAN_SIT_TIMEOUT_MS`。
- **stdin 控制**（每行一条 JSON）：`{"cmd":"pause"}` 离房并停轮询、`{"cmd":"resume"}` 重新找房、`{"cmd":"stop"}` 登出退出。
- **stdout**：事件行 `{"type":"event","eventType":…,"payload":…,"roomId":…,"roundId":…}` 与日志行
  `{"type":"log","level":…}`。事件名严格落在服务端白名单内：
  LoginStarted/LoginSucceeded/LoginFailed/Waiting/RoomJoined/RoomLeft/RoomClosed/PlayerSeated/GameReady/
  GameStarted/TurnStarted/ActionSubmitted/GameSettled/LogoutSucceeded/TerminalStopped。
- **自动化流程**：登录成功 1.2s 后查俱乐部房 → 选有空位且最低带入可负担的房 → `reqEnterRoom` → 轮询空座 →
  `预坐_事件` → 收到本人 PlayerList 后 `坐下_事件`（money = 最低带入 × `buyinMultiple`，ready=1，type=直接）→
  轮到自己（`状态鸡` 的 `决策` + `is_action=True`）延迟 1.2～2.5s 出 `跟`（`reqRaise('-1', captureId)`），
  敲牌角色出 `丢`（`reqPass(captureId)`）；captureId 从 100 起，遇到 `决策_信息_消息` 自增。
- **Go 侧行为**：spawn node 后逐行解析；`PlayerSeated` 更新座位、`RoomLeft/RoomClosed` 清房号；
  子进程退出 30s 退避再拉起；`shutdown()` 先发 stop，4s 未退再 kill；控制变化通过 stdin，不重建进程。
- **只进底皮（2026-10-28）**：`XUAN_ROOM_PI` 是逗号分隔的 `底皮X/Y` 列表（后台 `robot.room_pi`，空 = 不限），
  由心跳指派下发、`xuanagent` 透传给 node。`client.js` 的 `pickRoom` 在选房前用它过滤，认
  `查询_俱乐部_房间_信息` 的两种返回（`is_zip_result='1'` 的 9 元数组：第 6 位底皮；`'0'` 的字典形态：`game_pi`/`special_rule`），
  过滤后没有空房就记「没有 X 的空房，稍后重试」。**改底皮要重新拉起终端才生效**（env 只在 spawn 时读）。
- **验证边界**：登录已真测（entityId 2030），本地桩验证了完整事件链；**进房/入座/牌局动作仍未在真实房间验证**，
  底皮过滤也只在 mock 房间列表上验证过。

## 10. 与《多人代打接口方案-客户端调用说明》对齐（2026-10-28）

文档 `服务器文档整理/多人代打接口方案-客户端调用说明.md`（10-27 修订）里对客户端有约束的几处，落地情况：

| 文档要求 | 客户端处理 |
|---|---|
| `状态` 名可能把「决策」拆成「决_策」（§4.3） | `isDecisionState()` 先去掉下划线再匹配；原来 `includes('决策')` 会漏掉搓牌阶段 |
| 每条消息都按收件人裁剪，要跟自己的 guuid/座位比对（§3 开头） | `onServerPlay` 先算 `mine = player_number==座位 或 player_name==guuid`，别人的倒计时只用来撤掉我超时的动作 |
| 局号以 `结算_结束_消息.room_round` 为准（§3.5 / §4.4） | `trackRound()` 统一从 `持有_手牌` / `发牌_结束` / `结算_结束` / PlayerList 的 `round_count` 收局号，`lastRoundId = roomId-局号` 去重后发 `GameStarted` |
| `结算_信息_消息` 与 `RoundScore` 是同一局的两种汇报（§3.4） | `settleRound()` 按局号只上报一次；分数优先取 `RoundScore`，取不到就取 `结算_信息.round_score` 第一段（本局分） |
| 配牌命令是 `执行检查_命令`（`reqGameCommand`，发牌前登记，§2.1） | 可选：`XUAN_PAIR_CLICK`（1~8/11~18/98/99）在每次结算后为下一局申请一次；默认不申请 |
| `查询_房间_游戏_信息` 只回 `GC_OK {}`，数据走 `RoomGameInfo` 推送；`next_order` 是类 Python 字面量字符串（§2.2 / §2.4） | 配牌开启时每局发牌后拉一次，`parseNextOrder()` 按结构切并打一行「在局 N 人 / 下一局 32 张 / 我的牌」；未开通在 `onHallCommand` 打一次警告 |
| `BOT_` 系列不再存在 | 客户端不引用任何 `BOT_` 命令 |

**未做**：`执行安全_命令`（`must` 独占牌型）与 `关闭检查_命令`（服务端是房间级清零，会误伤全房）都没有接入；
`next_order` 只做日志，没有按 §2.4.3 推算下一局手牌，也没有做配牌回执比对（无接口，需比对预测与实际 `now_pai`）。

## 11. xuanagent：启动方式与参数（Worker 节点）

`server/cmd/xuanagent`：注册 → 心跳（顺带收敛终端）→ 每 2 秒拉命令 → 三段回执 → 事件攒批（800ms / 64 条）上报。
**退出顺序固定**：`cancel()` → `shutdown()`（停终端，先离房）→ `flush()`（把攒着的事件发完，此时租约还在）→
`offline(reason)`（正常退出「正常退出」/`run()` 报错「异常退出」）→ 进程结束。上报失败只 Warn，由服务端租约超时兜底。

**启动方式：只认配置文件，不用令牌。** 把可执行文件丢到一个目录，直接运行：

```
xuanagent            # 读同目录 xuanagent.json；没有就自动生成一份默认的再继续跑
```

默认 `xuanagent.json`（`config.go` 的 `defaultServer` 已写死正式后台地址，`code` 取主机名规范化成 3-32 位小写字母数字）：

```json
{ "server": "http://154.37.155.17/xuanmanager", "code": "mac-mini-2-local", "token": "",
  "capacity": 20, "labels": "", "heartbeatSeconds": 5, "roundIntervalMs": 1500, "roundsPerRoom": 6, "debug": false }
```

`heartbeatSeconds` 默认 5（= 后台心跳间隔）。**旧配置文件里写死 10 的要改小**：10 秒心跳配 20 秒租约只容 2 拍，
网络抖一下就会 401→重新注册（能自动恢复，但日志会多一条离线/上线）。填 0 则完全跟随后台回包。

优先级 **配置文件 < 环境变量（`XUAN_AGENT_*`） < 命令行参数**，只有显式传入的 flag 才覆盖（`parseOptions` 用 `fs.Visit`）：

```
xuanagent -server http://另一台/xuanmanager -code node-hk-01      # 临时换地址/换节点号
xuanagent -config /etc/xuanagent.json                            # 换配置文件位置
xuanagent -print-config                                          # 只打印当前生效配置（含来源与是否新建）
xuanagent -once                                                  # 单轮联调
```

其余参数：`-capacity`、`-labels`、`-heartbeat`（0 = 跟随后台）、`-round-interval`、`-rounds-per-room`、`-debug`；
注册被拒（`AGENT_ENROLL_REJECTED`）会提示去配置文件填 token 或用 `-token`。

终端默认 `client:"real"`（拉起 `agent-client` 真登录）；`sim` 终端保留做纯链路联调（入座 → 每局
GameStarted/3×TurnStarted+Action*→GameSettled，打满 `-rounds-per-room` 换桌）。接真实客户端只换 `terminal.go`
的 `joinRoom`/`playRound` 从协议回包抛事件，`main.go` 循环与 `client.go` 协议不用动。

交叉编译：`CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o xuanagent.exe ./cmd/xuanagent`
（linux/mac 同样，产物约 6 MB）。本机 mac 产物放 `XuanManager/server/bin/xuanagent`（bin 已被 gitignore），同目录 `xuanagent.json` 指 `clientDir=XuanManager/agent-client`。
