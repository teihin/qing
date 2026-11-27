# qing 当前状态

更新时间：2026-11-26

规则见 `AGENTS.md`；版本与 UI 见 [决策](DECISIONS.md)、[专题](topics/v7-ui.md)。未发布与待验证汇总见[剩余问题清单](handoffs/2026-10-28-open-issues-backlog.md)。

## 2026-11-27 投放树改懒加载（联盟→盟主→代理→俱乐部）

- 新接口 `GET /api/automation/deploy/club-tree`：`level=unions|leaders|agents|clubs`，按需逐级查；
  数据源 `mgr_agent_reward_member`(role/upper_id) + 俱乐部/联盟/邀请码表。
- 前端 `DeployClubTree`：默认展开到盟主（只拉一级），点代理才查下级，点俱乐部回填邀请码。只部署测试服。

## 2026-11-27 取消「每俱乐部可投放 N 台」限制

前端去掉「还可投 N 台」与超配额拦截，后端 `ensureAutomationRobotQuota` 直接放行。见 [`归档`](archive/2026-11-27/current-no-quota.md)。

## 2026-11-27 投放「选择俱乐部」改树形（联盟 → 俱乐部）

`deployClubOption` 加 `unionId/unionName`（优先 `kbedm.club_union_info.union_name`），前端改可折叠树。详见 [`归档`](archive/2026-11-27/current-club-tree.md)。

## 2026-11-26 额度不足：直接报警停手（用户确认）

- 用户确认「就是额度不够才坐不下」。改：`坐下_事件` 回 **769 / 301** → 直接 `markFundShortage()`
  （后台 FundShortage 告警 + 停止一切坐下动作 + 60s~300s 退避重探），**不再换座/加码重试**；
  `sendSit` 增加 `fundShortage` 守卫（缺额期间不发任何坐下）；告警文案改为「俱乐部额度/积分不足」。
- 另：预坐回包走 `onGameCommand`，已按 200/0x200/512 判成功并设 `presitOk`。
- 状态展示：机器人状态新增 **`shortage`（额度不足）**。后端 `FundShortage` 事件 → 不在座时 `status='shortage'`，
  `FundRestored` → 回 `idle` 并清 last_error；前端 `shared.tsx` 加 `shortage: "额度不足"`、机器人筛选也加该项；
  客户端事件的 60 秒节流改为 10 秒（否则重启后可能一次都不上报）。后端与 `web/` 已部署到测试服。
  **补丁**：`RoomLeft/RoomClosed` 会把 status 刷回 `idle`，导致列表看不出额度不足 → 改为 `IF(status='shortage','shortage','idle')`；
  已把现存的 3 台回填成 `shortage`。前端需强刷（Ctrl+Shift+R）才能看到新的状态标签。

## 2026-11-26 只有 0 号位坐得上（769 对照）

0 号位 `{money:100,type:"直接"}` → 512；1/2/3 号位同一报文 → 769，状态一致 → 不是字段问题。已加自愈：769 用「最低带入 + 申请」回退一次；预坐回包走 `onGameCommand` 也已解闸。详见 [`归档`](archive/2026-11-26/current-769-compare.md)。

## 2026-11-26 严格按时序走：请求串行 + 补芒回包驱动预坐

`pendingReq` 闸门（tryTakeSeat/sendSit 有请求在飞就等，onRoomCommand 回包清闸）；补芒查询 → `不补芒（坐下N）` → 才发预坐；`不补芒` 不再并入「已结算」分支（曾导致进房即补带入）。详见 [`归档`](archive/2026-11-26/current-serial-flow.md)。

## 2026-11-26 本地日志加「C->S / S->C」线路日志

- 用户要求日志要像真实客户端那样能看到收发报文。做法：
  - `wrapAccountWire(account)`：登录成功后给实体的所有 `req*` 方法套一层，打印 `C->S:reqXxx <参数>`；
  - `onEvent` 入口对关键下行（`onMessage/PlayerList/onRoomCommand/onGameCommand/onHallCommand/onEnterRoom/PromptInfo*`）
    打印 `S->C:名字 <原文前 400 字>`；
  - 只写本地 `log()`（`/tmp/xuanagent-<节点>.log`），不推后台事件，避免刷爆后台；
  - 完整原始报文仍逐条落 `/tmp/xuanagent-game/<账号>-<日期>.log`。
- 需重启 worker 生效。


## 2026-11-26 按真实报文对齐坐下链路（座位 0 基）

见 [`归档`](archive/2026-11-26/current-seat-0based.md)。

## 2026-11-26 对齐客户端坐站流程（含带入区间）

- 首次坐下 = `预坐_事件{site}` → `坐下_事件{money,ready:1,type:"直接",club_id}`；已坐过（留座/回座）=
  `坐下_事件{site}`（不带 money），桌面没钱再发 `{money,type:"申请"}`。
- 带入金额必须落在服务端下发的 `buy_in_min ~ buy_in_max`（结算态常见 0~17），超了回 769；已按区间夹取并对齐步长。

## 2026-11-26 看牌卡死：动画中间态占掉正式窗口

见 [`归档`](archive/2026-11-26/current-kanpai-midstate.md)。

## 2026-11-26 消息归属以 PlayerList 座位为准

见 [`归档`](archive/2026-11-26/current-seat-ownership.md)。

## 2026-11-26 日志记录实际发出的请求

见 [`归档`](archive/2026-11-26/current-sent-log.md)。

## 2026-11-26 看牌与扯牌（分牌）区分

见 [`归档`](archive/2026-11-26/current-split-phase.md)。

## 2026-11-26 策略「芒果下注」规则

见 [`归档`](archive/2026-11-26/current-mang.md)。

## 2026-11-26 轮到我 3 秒未出牌就兜底过牌

见 [`归档`](archive/2026-11-26/current-pending-timeout.md)。

## 2026-11-26 「轮到我但角色不可用（等待）」改为回退下单

见 [`归档`](archive/2026-11-26/current-role-wait-skip.md)。

## 2026-11-26 看牌阶段整桌卡住：确认看牌后直接下注

见 [`归档`](archive/2026-11-26/current-kanpai-stall2.md)。要点：搓牌事件只作确认，400ms 后直接按策略下注；1.5 秒未推进补过牌。

## 2026-11-26 切换/重启节点后回原房继续打

见 [`归档`](archive/2026-11-26/current-resume-room.md)。要点：`roomId` 随指派下发 → `XUAN_RESUME_ROOM` → 登录后先进原房，留座在则直接补带入，不预坐。

## 2026-11-26 按真实客户端「每人一个对象」整理消息归属

见 [`归档`](archive/2026-11-26/current-seatviews.md)。

## 2026-11-26 「轮到我却不出牌」主因：别人的消息取消了我的出牌

见 [`归档`](archive/2026-11-26/current-action-canceled.md)。要点：`!isDecisionState` 时曾无条件 `cancelAction()`；别人的倒计时也取消；`!seated` 还丢消息。现在只处理 `mine`。

## 2026-11-26 预坐不带分死循环 + 空座推算

见 [`归档`](archive/2026-11-26/current-presit-no-buyin.md)。

## 2026-11-26 每个机器人保存原始游戏消息日志

原文见 [`archive/2026-11-26/current-game-raw-log.md`](archive/2026-11-26/current-game-raw-log.md)。要点：`/tmp/xuanagent-game/<账号>-<日期>.log`，JSON 行存每条 `onEvent` 原始报文。

## 2026-11-26 修「已入座仍挂金币不足」+ 后台重启误释放

原文见 [`archive/2026-11-26/current-stale-error-and-release.md`](archive/2026-11-26/current-stale-error-and-release.md)。要点：入座事件清 `last_error`；WS 断开不再判离线/释放，离线满 1 分钟才收回机器人。

## 2026-11-26 看牌窗口处理

见 [`归档`](archive/2026-11-26/current-kanpai-window.md)。

## 2026-11-26 按余额选房（钱不够去低底皮）

见 [`归档`](archive/2026-11-26/current-pickroom-by-funds.md)。

## 2026-11-26 第二圈（第三张牌）不出牌：去重改用决策窗口

原文见 [`archive/2026-11-26/current-second-round-noaction.md`](archive/2026-11-26/current-second-round-noaction.md)。要点：第二圈不发「决策_信息_消息」→ captureId 不变 → 按 capture 去重会静默跳过；改为 `状态名+count_times+座位` 判窗口。

## 2026-11-26 对照真实客户端复核打牌链路（修小额房加注 ×10）

原文见 [`archive/2026-11-26/current-playflow-audit.md`](archive/2026-11-26/current-playflow-audit.md)。要点：判窗口/出牌命令/扯牌报文/capture/带入报文/手牌来源六项一致；小额房（0.1/0.3、0.2/0.5）加注需 ×10。

## 2026-11-26 「坐不上 / 不出牌」修复：座位表未到不判无座 + 带入时序

原文见 [`archive/2026-11-26/current-sit-buyin-fix.md`](archive/2026-11-26/current-sit-buyin-fix.md)。

## 2026-11-26 抢座改为「逐个试空座，没空座就换房」

见 [`归档`](archive/2026-11-26/current-seat-retry.md)。

## 2026-11-26 「有分却报故障」修复：770 不再一律当缺钱

原文见 [`archive/2026-11-26/current-770-misjudge.md`](archive/2026-11-26/current-770-misjudge.md)。要点：座位被占也回 770，改为看最近 3 秒 PromptInfo 文案判定缺钱；误标的 4 台已清回 idle。

## 2026-11-26 策略保存即生效（取消草稿门槛）

见 [`归档`](archive/2026-11-26/current-strategy-no-draft.md)。

## 2026-11-26 投放配置「改了不生效」修复

原文见 [`archive/2026-11-26/current-live-apply-fix.md`](archive/2026-11-26/current-live-apply-fix.md)。要点：策略参数默认展开、保存自动判差异写 override；`allowWaitingRoom` 变禁止且当前房未开局时立即离房重找。

## 2026-11-26 策略「是否进等待中的房间」默认不进

原文见 [`archive/2026-11-26/current-waiting-room-flag.md`](archive/2026-11-26/current-waiting-room-flag.md)。要点：`allowWaitingRoom` 默认 false，`pickRoom` 跳过等待/准备房；用户 2026-11-26 明确不要兜底，严格按策略执行。

## 2026-11-26 修节点「terminal stop requested reason=not-assigned」刷屏

见 [`归档`](archive/2026-11-26/current-not-assigned-noise.md)。

## 2026-11-26 机器人批量上分 / 下分（走俱乐部积分，测试服已部署）

原文见 [`archive/2026-11-26/current-robot-club-gold.md`](archive/2026-11-26/current-robot-club-gold.md)。要点：`POST /api/automation/robots/club-gold`，上分走 `异步_发放_玩家_奖励`、下分走 `添加_俱乐部_成员_积分`（回 1280 需回读余额校验）；未加入俱乐部的跳过，多俱乐部必须选一个。

## 2026-11-26 自动输赢平衡：名单回包多一层数组 + 候选状态列（两台已部署）

- 根因：游戏服 4 条异步名单命令回包被包成数组（实测 `异步_查询_伙牌名单` →
  `{"ret_code":512,"ret_result":[{"teams":[],"members":[]}]}`），后台 `decodeGameObject` 只认对象 → 空 map → 伙牌名单永远空白、导入回来全 0。
- 后端 `auto_balance.go` 新增 `decodeAutoBalancePayload`（字符串外壳 → 数组取首元素 → `result` 包装，最多 6 层），
  4 条异步命令共用；候选结构补 `existingTargetValue/Man/Time`。
- 前端状态列按文档 §4.3 显示 `已有目标（补偿 +800 · 手工）`/`（压制 -1,200 · 自动）`，值 0 或来源空 → `方向未知`；
  动作下拉按 §4.4 加「未命中」。
- 测试服二进制 `8877b0fa…`；正式服 `5ceb18b1…`（干净 HEAD + 上次 6 个文件 + 本次改动；先验证基线构建 sha 与线上 `b5cc11ee…` 逐字节一致）。
  前端两台 `index-DmOggmZr.js` / `index-D0Wf5v9H.css`，health 200、单实例。**正式服游戏服侧已可用**（名单有 8 个团队真实数据）。
  回滚点 `bin/xuanmanager.20261126-1643-rollback`、`web.previous-ab-balance-20261126/`，详见[交接](handoffs/2026-11-25-auto-balance-admin.md)。

## 2026-11-25 机器人设备绑定 + Worker 离线即时转移（测试服已部署）

原文见 [`archive/2026-11-25/current-device-and-offline.md`](archive/2026-11-25/current-device-and-offline.md)。要点：机器人账号统一绑 `xuanagent-worker-fleet-v1`（`anti_theft_on=1`），只有 worker 能登录，冒名设备回 2563；节点离线（正常退出/断链 6 秒/巡检）立即把机器人收回并重新分配，Worker 列表默认只显示在线。

## 2026-11-25 自动化通道改实时（WS + SSE）

详见 [`handoffs/2026-11-25-automation-realtime-channel.md`](handoffs/2026-11-25-automation-realtime-channel.md) 与 [`归档`](archive/2026-11-25/current-realtime-channel.md)。
## 2026-11-25 牌桌内「牌局优化」加「只看当前房间」（未构建/未真机）

原文见 [`archive/2026-11-25/current-ingame-optimize.md`](archive/2026-11-25/current-ingame-optimize.md)。

## 2026-11-25 客户端「额度授权记录」按身份区分 club_id（未构建热更、未真机，详见[交接](handoffs/2026-11-25-quota-grant-record-union-owner.md)）

- 口径：`查询_联盟_授信_记录` 大盟主（当前俱乐部所在联盟的总群主）看全联盟 → **只带 `union_id`、不传 `club_id`**；盟主只看自己名下俱乐部 → `club_id` + `union_id` 都带。
- 实现：`panelMain` 打开面板时透传 `is_union_owner = IsUnionOwnerOfClub(clubId)`（只认服务端结论、不落盘）；`panelQuotaGrantRecord.ReadEntry/GetRecords` 按该标记决定发不发 `club_id`，**大盟主但 `union_id` 为空时仍退回带 `club_id`** 兜底。
- 仅语法自检 0 诊断；待 Creator 编译后实机抓报文确认。

## 2026-11-26 客服站：admin999 专用「服务端调用日志」（测试服 + 正式服均已上）

- 数据源是后台游戏命令日志：XuanManager 新增服务通道 `GET /api/service/game-call-logs`（Bearer + 仅本机，按 `contextPrefix` 过滤）；ChatTool 同名客服接口代理它，只留 `cs-hosted-gold-` 的调用/回包/异常行。
- 同批次：客服上分「同步增加盟主额度」只走 `后台_授信_盟主_额度`（`club_id`/`quota_fen`/`context`，写 `额度联盟授信`；`异步_` 是错名，游戏服返回空 769），**不回退老命令**。**额度是「分」，金额是「元」，换算 ×100**（少乘导致 11 元只加 0.11 元，已修）；下分同一命令传负 `quota_fen`（测试服实测 512 生效，正式服待验）。回包超过全局 6 秒 → 单独用 12 秒客户端，超时后回读额度自证到账，避免重复提交。
- 同批次：客服消息区「贴底才跟随」，轮询不再把上翻查记录的客服拉回底部；托管面板同一套逻辑。
- 日志页倒序（最新在最上），参数/返回完整显示，只留 时间/类型/命令/参数/返回/ret_code 六列。上下分结果改走绿色浮层（带告警是橙色，4 秒自动消失），红条只留真失败。
- 仅 `username=admin999` 可见（前端按钮 + 后端 403）。两台均已发布：测试服 xuan `f32e56d2…`；正式服 xuan `b5cc11ee…`（干净 HEAD + 本次改动编译，避开他人未提交的 automation 改动）+ chat `ee7e409a…` + 前端 `index-D6GZXvNu.js`。

## 2026-11-25 自动输赢平衡：后台完整版（已上正式服；游戏服命令未部署，功能暂不可用，详见[交接](handoffs/2026-11-25-auto-balance-admin.md)）

- 新增独立模块「自动输赢平衡」`/game/auto-balance`（`parent_id=20`、`sort_order=72`、icon `balance`），配置 / 候选 / 名单三个 Tab；迁移 `075_auto_balance.sql`（模块 id 66、权限 5841-5844 授权 role 1）。
- 后端 `auto_balance.go` 9 条路由，全走 8890 `/hall/command`；4 权限 `view/config/execute/team`；`mode=auto` 强制 `confirm:true`；写操作串行锁 + 审计；分组下拉只读 `club_player_group_info`。
- 两台已部署（15:36/15:43），二进制 `77f44df7…`、health 200、新路由 401；回滚点见交接。测试服仅 role 1 有玩家控制权限，故只授权 role 1。
- 16:46–17:01 前端调整：隐藏「生效玩法」；排除玩家标签输入 + 后台核对玩家存在（新接口 `GET /auto-balance/player`）；底皮只能下拉选 9 档；文案全中文化。二进制 `e0744d9b…`。
- **阻塞**：正式服游戏服没这套实现 —— 无 `auto_balance.py`、`Hall.py` 无 8 条命令、两张表都不存在，`查询_自动平衡_配置` 实测 769。页面打开显示「接口未注册」，需游戏服部署 + reload。代码已提交推送（`codex/club-ui`）。

## 2026-11-19 实时战绩头像框：环不再缩在头像里（Prefab 就绪，未导入/构建/热更/真机）

原文见 [`archive/2026-11-26/current-2026-11-19-avatar-ring.md`](archive/2026-11-26/current-2026-11-19-avatar-ring.md)。要点：只改 `观战对象.prefab` 的 `V8头像框` 与 `带入记录.prefab` 的 `ring` 两处 `_contentSize`（64→100、46→72），PNG/`.meta`/UUID 未动。

## 更早批次

见 [`handoffs/`](handoffs/)：11-23~11-25 的自动化通道、客服站、自动输赢平衡等历史交接。
## 本轮实时核对：记忆整理

## 最近报告的 UI 状态

## 待核实项与工作边界

- 2026-09 原文见[归档](archive/2026-11-06/current-sep-consolidation.md)；待验证项不构成执行授权，动手前重新核实未提交差异。
