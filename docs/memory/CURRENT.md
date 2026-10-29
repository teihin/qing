# qing 当前状态

更新时间：2026-10-29 22:40

规则见 `AGENTS.md`；版本与 UI 见 [决策](DECISIONS.md)、[专题](topics/v7-ui.md)。未发布与待验证汇总见[剩余问题清单](handoffs/2026-10-28-open-issues-backlog.md)。客服网页已部署、真机待验：[交接](handoffs/2026-09-24-chat-keyboard-visibility.md)。

## 2026-10-29 投放输赢目标支持「按周时段」（已部署，未提交）

- 输赢目标新增 `profit_mode='schedule'`：周一到周日勾选，每天可多段（≤28），结束早于开始=跨零点算开始那天。时段内按 `window_net` 控输赢（结算累加、换时段清零）；时段外先下发 `drain` 打完手里一局，离房后让出 Worker（`schedule_state='released'` 分配时跳过），到点复位。
- 迁移 039 加 `profit_schedule/schedule_window/window_net/schedule_state`；后端 `automation_schedule.go` 接巡检、投放、编辑、指派；节点 `terminal.go` 支持 drain，客户端排空前打完最后一局。前端加时段编辑器接入投放/配置。
- 验证：`go vet`/`go build`、`tsc -b`/eslint/`vite build` 通过；跨零点/星期归属用临时 Go 测试验证后删除。后端（039 已执行）与前端已上线；**交互未实测，Worker 未重启**。见[交接](handoffs/2026-10-29-profit-weekly-schedule.md)。


## 2026-10-29 侧边栏一级/二级底色区分（已部署，未提交）

- 一级菜单改青色色块表头，二级缩进压暗；`index-DzXYeO4c.css`，回滚 `web.previous-navlevels-20261029`。[交接](handoffs/2026-10-29-sidebar-level-contrast.md)。

## 2026-10-29 分组管理并入机器人管理（已部署，未提交）

- 「自动化组」模块 45 `visible=0`；分组增删改并入**机器人管理 → 分组管理**（建组只填名称 + 策略；删组可搬走组内机器人）。
- 已发布 `index--NRq6W84.js`；回滚点 `web.previous-groupmanager-20261029`。见[交接](handoffs/2026-10-29-group-manager-in-robots.md)。

## 2026-10-29 删除分组支持搬迁机器人（已部署，未提交）

- `DELETE /api/automation/groups/{id}?moveToGroupId=N`（0=不分组）：事务内先搬组内机器人再删组；不带参数且组内有机器人仍拒绝。仅超管有 `automation.group.*`；弹窗带「组内机器人移到」下拉。**真实删除待实测**。见[交接](handoffs/2026-10-29-group-delete-move.md)。

## 2026-10-29 建组只留名称与策略（已部署，未提交）

- 建组不再填「目标在座 / 终端上限」；组策略 = 组内投放默认策略，投放可改，按机器人选且同组时也会带出。**交互待实测**。见[交接](handoffs/2026-10-29-group-strategy-only.md)。

## 2026-10-29 机器人创建支持内联新建分组（已部署，未提交）

- 创建/编辑机器人弹窗的「机器人分组」旁加「＋ 新建分组」内联表单，建完自动选中并带入 `groupId`；自动化组页补 `profitMode:"none"`，修复此前从界面建组必 400 的问题。
- 仅前端 `index-dTwa9GSD.js`，后端未动；回滚点 `web.previous-groupinline-20261029`。**交互待主人用管理员登录实测**。见[交接](handoffs/2026-10-29-robot-inline-group-create.md)。

## 2026-10-29 机器人密码改回密文 + 独立密钥（已部署，未提交）

- 创建/改密恢复 `SealCredential` 落库（`v1:` 密文），心跳下发不变（解密后下发）；服务器 `runtime.env` 新增独立 `XUAN_CREDENTIAL_KEY`。
- 新增 `server/cmd/xuanresea` 一次性回封工具，已装 `bin/xuanresea`；当前机器人表为空、无存量明文。
- 后端 PID 22966（`de47f71e…`），前端 `index-CcSNTgVz.js`；回滚备份 `*.previous-sealpwd-20261029`。**端到端待主人验证**；密钥只存 runtime.env，建议另存离线备份。见[交接](handoffs/2026-10-29-robot-password-sealed.md)。

## 2026-10-29 自动化：Worker 俱乐部模式 + 策略下发 + 控制台收尾（未提交，前后端已部署 v6）

- **Worker**：进房必须自己在该俱乐部内；俱乐部房不结束，倒计时到 → 全员结算 → 分回身上 → 需重新带入（人仍在留座）。**每轮结算后离房换桌**，离开的房 10 分钟内不再进；**结算时已超目标则留房继续带入来输，最多连 2 次**。见[交接](handoffs/2026-10-29-worker-club-mode.md)。
- **策略**：后台可建多套绑机器人、运行期下发。**策略 = 动作智力**（跑法/出牌节奏、安全线、牌力、收敛），**投放 = 选机器人 + 绑策略 + 底皮 + 输赢目标**（投放必选策略与输赢），草稿不下发。见[交接](handoffs/2026-10-29-automation-strategy-runtime.md)。
- **机器人/控制台**：创建弹窗删「智力/默认带入倍数/添加后参与调度」；密码已改回**密文 + 独立密钥**（见上节）；侧边栏可折叠；测试数据已清空。见[交接](handoffs/2026-10-29-automation-robots-and-console.md)。
- 状态：038 已执行，后端 PID 18006、前端 `index-IE64Hwkm.js`；**未提交**。

## 2026-10-29 牌桌小修：留座到期收窗 / 俱乐部房藏剩余时间（未提交）

- 留座归零 fire `SelfSeatTimeout` 关「带入窗口」，`PlayerList` 后兜底收窗；俱乐部房隐藏 `RoomFrame/info/游戏时间`。**均未构建、未真机**。见[交接](handoffs/2026-10-29-seat-timeout-close-buyin.md)、[交接](handoffs/2026-10-29-club-room-hide-clock.md)。

## 2026-10-29 实时战绩：倒计时列 + 已结算记录无限滚动（未提交）

- 「记录」在座行加第 4 列 `countdown`，追加 `获取_房间_已结算_玩家_命令`（每页 20）滑到底自动翻页；`带入记录.prefab` 改 4 列 + `V8表头countdown`。**未构建、未真机**。见[交接](handoffs/2026-10-29-realtime-settled-list.md)。

## 2026-10-27～28 自动化（阶段归档）

- 机器人即账号、Worker 通道与在线状态、真实客户端接入、投放限底皮、净分区间控制 + GPS/IP、机器人牌局页签，
  原文见[归档](archive/2026-10-29/current-2026-10.md)；专题见[控制台](topics/automation-console.md)、
  [Worker 通道](topics/automation-worker-channel.md)。

## 2026-10-27 「我的」页下半部分改为可滚动（短屏适配）

- `Main/我的` 新增 `滚动区 > view > content`，搬入按钮区与当前俱乐部；已传 `5.0.31`，**真机未验**。见[交接](handoffs/2026-10-27-my-page-scroll.md)。

## 2026-10-27 游戏推广下载地址接入后台

- 「系统配置 → 游戏推广下载地址」读写 `kbedm.usr_hash_info.下载url`，写前快照/写后回读/写审计。见[交接](handoffs/2026-10-27-promotion-download-url.md)。

## 2026-10-26 及更早（阶段归档）

- 消费全切钻石、俱乐部跨级与弹窗见[归档](archive/2026-10-29/current-2026-10.md)；2026-09 客户端 UI 与后台时间口径见[归档](archive/2026-10-28/current-2026-09.md)。
- 历史 UI 记录：构建成功不计入 V7；V7 经过见[阶段快照](archive/2026-09-11/v7-implementation-before-full-reskin.md)，逐页表格见[归档](archive/2026-09-15/ui-status-table.md)，进度以[全套进度](handoffs/2026-09-11-v8-all-pages.md)为准。高频未验证：热更与 Splash、登录/注册回包、战绩/结算/回放、排行榜领奖。

## 本轮实时核对：记忆整理

目录 `/Volumes/SSD/qing`，Creator 2.4.13，`build` 与 `runtime-src.zip` 保留。见[整理交接](handoffs/2026-09-05-memory-migration.md)。

## 最近报告的 UI 状态

见上节[全套进度](handoffs/2026-09-11-v8-all-pages.md)与[逐页归档](archive/2026-09-15/ui-status-table.md)。

## 待核实项与工作边界

1. `panelQianBao.ts` “确认充值”仍显示“暂未开通”并提前返回；本轮只修选择和美术，不代表充值业务恢复。
2. V7 只覆盖有实施记录的页面；牌桌、动画等未列入范围的设计不得因归档自动判废。
3. 待验证项不构成执行授权；动手前重新核实未提交差异。

来源：[原文归档](archive/2026-09-05/AGENTS.original.md) 第 23–24、35、39、458、599 行；目录 `/Volumes/SSD/qing`，Creator 2.4.13，`build` 与 `runtime-src.zip` 保留。
