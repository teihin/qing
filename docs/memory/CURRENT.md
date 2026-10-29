# qing 当前状态

更新时间：2026-10-29 01:20

规则见 `AGENTS.md`；版本与 UI 见 [决策](DECISIONS.md)、[专题](topics/v7-ui.md)。未发布与待验证汇总见[剩余问题清单](handoffs/2026-10-28-open-issues-backlog.md)。客服网页已部署、真机待验：[交接](handoffs/2026-09-24-chat-keyboard-visibility.md)。

## 2026-10-29 牌桌小修：留座到期收窗 / 俱乐部房藏剩余时间（未提交）

- 留座倒计时归零（`showLiuZuoCount` 且是本人）fire `SelfSeatTimeout`，面板收到即关「带入窗口」，并在每次 `PlayerList` 后按 `isSelfSeated` 兜底收窗。
- 桌面 `RoomFrame/info/游戏时间`（"剩余时间 00:00"）在 `roomSetting` 带 `club_id` 的俱乐部房整行隐藏，不参与倒计时刷新；判断按 roomSetting 原文缓存，切房自动切回。详见[交接](handoffs/2026-10-29-seat-timeout-close-buyin.md)、[交接](handoffs/2026-10-29-club-room-hide-clock.md)。**均未构建、未真机。**

## 2026-10-29 实时战绩：倒计时列 + 已结算记录无限滚动（未提交）

- 牌桌「记录」列表：在座行加第 4 列 `countdown`（`play_countdown`，本地逐秒递减，统一 `00:00` 分:秒）；其后追加 `获取_房间_已结算_玩家_命令`（每页 20，带带入 `init_money` 与输赢 `score`）记录，滑到距底 ≤ max(360, 视口×0.75) 自动翻页。
- 行模板 `带入记录.prefab` 改 4 列；表头重排 + 新增 `V8表头countdown`（新出同风格美术字 `assets/V7/realtime_v8_countdown.png`），`drh8.fire` 与 `panelGameView.prefab` fileId 一致。
- 验证：TS 语法 0 诊断、JSON/引用完整、坐标手算无重叠；**未构建、未真机、服务端路由与 `play_countdown` 未实测**。见[交接](handoffs/2026-10-29-realtime-settled-list.md)。

## 2026-10-28 自动化：机器人当前牌局（未提交，后端已发、前端未发）

- 机器人「牌局」页签 5 秒轮询 `GET /robots/{id}/table`（在座/观战/四座手牌，无事件 20 秒补发、内容不变不落库）；**未真实开局、观战未验、未发布**。见[专题](topics/automation-strategy.md)、[交接](handoffs/2026-10-28-automation-table-snapshot.md)。

## 2026-10-28 自动化：Worker 在线状态实时化（未提交，后端已发、前端未发）

- 节点退出即离线：agent 停止前调 `POST /agent/v1/offline`，强杀靠**租约 20 秒 + 巡检 5 秒**兜底；心跳 5 秒，重新注册把 `offline` 终端放回 `idle`。后端已发，本机 `bin/xuanagent` 已重编。见[交接](handoffs/2026-10-28-worker-realtime-online.md)。

## 2026-10-28 自动化：净分区间控制 + GPS/IP + 策略移植（未提交，035–037 已执行、后端已发）

- 输赢按**时间范围累计净分**控制：目标来自投放（每日/周期/不控制，组配置兜底）；心跳净分是权威基线，`netPending` 只累计未入账差值；`|目标-净分| ≤ max(20%, 最低带入)` 常规打，超出才争赢/争输。
- 跨天/新周期由心跳懒重置（037）；出牌按老客户端移植（底皮档位、争赢/争输、加注、保牌、扯牌），开局/出牌/结算都发 `TerminalLog`。
- **GPS/IP**：036 加 `gps/public_ip/ip_seen_at`；GPS 建号时按老客户端经纬度范围生成，每 60 秒 `reqSetProperty`；IP 由心跳连接地址写入，前端详情显示两者。
- 验证：构建与 lint 全过；**未真机开局、未发布**。见[专题](topics/automation-strategy.md)、[交接](handoffs/2026-10-28-automation-strategy-gps.md)。

## 2026-10-27 自动化：机器人即账号（后端已发布，前端未发）

- 机器人=游戏账号，在「机器人管理」真实建号（随机昵称/头像），默认带入=最低带入×`buyin_multiple`；投放按俱乐部调 `添加_俱乐部_玩家`，`release` 回池。策略+目标在投放时设（留空沿用，分组带出）；投放后须挂 Worker，分不到显示「等待分配 Worker」。
- 030/031/032 已执行；批量 >10 台转审批，未真实登录冒烟。详见[专题](topics/automation-console.md)、[交接](handoffs/2026-10-27-automation-console.md)。

## 2026-10-27～28 自动化：Worker 通道（已上线，令牌可选）

- `/agent/v1/*`：注册（可选令牌→租约）、心跳回权威指派、拉命令、回执、事件批量（幂等）；命令 9 种带幂等键/过期/状态机，自动分配在三处完成。
- 033 已执行；后端三次发布（最新 `24b08e87`，回滚 `backups/xuanmanager.20261028-0045-rollback`），生产已关令牌校验。参考 agent `server/cmd/xuanagent`。见[专题](topics/automation-worker-channel.md)。

## 2026-10-28 自动化：真实客户端已接入（后端已发布，前端未发）

- 密码落库：034 加 `login_password`（AES-256-GCM），明文只在带租约心跳指派里下发；密钥未配走 DB 密码派生，**轮换 DB 密码会让密文失效**。034 已执行、后端已发布（回滚 `backups/xuanmanager.20261028-0855-rollback`）。
- `agent-client/` 一进程一账号，登录/重连/查房/进房/预坐/坐下/离房/心跳/事件/按策略出牌齐备；Go 终端默认 `client:"real"`。本机 worker 在 `server/bin/`（gitignore），入会走 `直接_加入_俱乐部` 免审批，**真实进房/开局未验**。见[交接](handoffs/2026-10-28-automation-real-client.md)。

## 2026-10-28 自动化：投放限底皮 + 机器人日志（未提交，后端已发、前端未发）

- 035 加 `room_pi`（逗号分隔 `底皮X/Y`，空=不限），投放/配置/编辑三处可改，`PUT` 全量覆盖须回传；心跳下发 `XUAN_ROOM_PI`，客户端选房前过滤，**改底皮要重新拉起终端**。
- 日志 `GET /robots/{id}/events` 5 秒轮询，终端/投放/机器人三处共用。035 已执行、后端已发；前端未发（本地 7458 连生产自测）；底皮过滤仅 mock 验证。见[交接](handoffs/2026-10-28-automation-room-pi.md)。

## 2026-10-27 「我的」页下半部分改为可滚动（短屏适配）

- `Main/我的` 新增 `滚动区 > view > content`，搬入按钮区与当前俱乐部；1334 屏不滚、矮屏才滚；已传 `5.0.31`，**真机未验**。见[交接](handoffs/2026-10-27-my-page-scroll.md)。

## 2026-10-27 游戏推广下载地址接入后台（已部署 00:12）

- 「系统配置 → 游戏推广下载地址」读写 `kbedm.usr_hash_info.下载url`，只接受完整 http(s)，写前快照/写后回读/写审计。见[交接](handoffs/2026-10-27-promotion-download-url.md)。

## 2026-10-26 消费全切钻石 / 俱乐部跨级与弹窗（后台已上线，客户端未发）

- 钻石消费价格后台可配（配置未落库）；俱乐部成员只读、踢人未放权、`panelMain` 换肤，构建/真机未验。全文见[归档](archive/2026-10-29/current-2026-10.md)。

## 2026-09 客户端 UI 与后台时间口径（阶段归档）

- 俱乐部入口、V8 换肤、热更与后台时区改动见[阶段归档](archive/2026-10-28/current-2026-09.md)；时区与拆列已部署，其余未构建发布。

## 本轮实时核对：记忆整理

- 目录 `/Volumes/SSD/qing`，Creator 2.4.13；`build` 与 `runtime-src.zip` 保留。见[整理交接](handoffs/2026-09-05-memory-migration.md)。

## 最近报告的 UI 状态

历史模块记录，构建成功不计入 V7；V7 经过见[阶段快照](archive/2026-09-11/v7-implementation-before-full-reskin.md)，逐页表格见[归档](archive/2026-09-15/ui-status-table.md)，进度以[全套进度](handoffs/2026-09-11-v8-all-pages.md)为准。高频未验证：热更与 Splash、登录/注册回包、战绩/结算/回放、排行榜领奖。

## 待核实项与工作边界

1. `panelQianBao.ts` “确认充值”仍显示“暂未开通”并提前返回；本轮只修选择和美术，不代表充值业务恢复。
2. V7 只覆盖有实施记录的页面；牌桌、动画等未列入范围的设计不得因归档自动判废。
3. 待验证项不构成执行授权；动手前重新核实未提交差异。

来源：[原文归档](archive/2026-09-05/AGENTS.original.md) 第 23–24、35、39、458、599 行。
