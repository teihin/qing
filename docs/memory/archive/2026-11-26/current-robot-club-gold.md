# CURRENT 归档：机器人批量上分/下分（2026-11-26）

> 按文档预算归档，原文保留。

## 2026-11-26 机器人管理：批量上分 / 下分（走俱乐部积分，测试服已部署，正式服未动）

- 入口：① 机器人行右侧操作区「上分 / 下分」（单台，不用先勾选）；② 勾选 ≥1 台 → 批量栏「上分 / 下分」。
  两者共用同一个弹窗：选**俱乐部** + 每台金额 + 原因；单台时标题不带「批量」。
- 规则（用户确认）：**没加入俱乐部的机器人不能上分**（逐台跳过并说明）；一个机器人属于多个俱乐部时
  必须选一个俱乐部（下拉由 `GET /api/automation/robots/club-options?ids=` 按所选机器人实时算）。
- 后端 `POST /api/automation/robots/club-gold`（权限 `automation.robot.operate`）：
  - 上分走游戏服 `异步_发放_玩家_奖励`（club_id + user_ids + gold>0，单批 ≤50，逐人 success/failed）；
  - 下分走 `添加_俱乐部_成员_积分`（user_add_gold 负数，单人循环）。这条是「无即时响应」命令，
    实测返回 **1280**（已受理）而非 512，**必须回读 `sm_club_gold` 校验**，不能凭返回码报成功。
  - 改的是该玩家在该俱乐部的积分（带入扣的那份），牌桌筹码不变；每笔写审计。
- 实测（测试服 8890）：worker001(627876/club 775447) 上 1 → 512 + success；再下 1 → 1280，
  回读 `sm_club_gold` 正确回到 0。库内：robot3 属 775447，robot4 无俱乐部（会被跳过）。
- 部署：后端 `cde83135…`、前端 `index-BSpKZ6UE.js`；回滚 `bin/xuanmanager.previous-robotgold-20261126`、
  `web.previous-robotgold-20261126`（前一轮）、`web.previous-rowgold-20261126`。**正式服未动**。
- 未验证：登录态下点按钮的完整链路（无后台密码）；在房间内的实际到账时机（文档称已即时）。

### 同批修正：列表状态不再把「缺钱卡住」显示成空闲

- 原因：状态列是**终端进程**状态，不是分配关系。机器人缺俱乐部金币时终端卡在等钱，后台只写了 `last_error`
  没动 status，于是列表显示「空闲」，看着像没事。
- 改法：`FundShortage` 事件把 status 置 `faulted`（在 `seated/playing` 时不动，避免误标进行中的对局）；
  `FundRestored` 时 `faulted → idle` 并清 `last_error`。列表状态列补一行「节点 xxx · 期望运行中/已停止」，
  能区分「没分配」和「分配了但终端没跑」。存量数据已用一条 UPDATE 修正（worker001 现在显示故障）。
- 部署：后端 `0e5904b1…`、前端 `index-BLCFYl8Z.js`；回滚 `web.previous-statefix-20261126`。


