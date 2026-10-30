# qing 当前状态

更新时间：2026-10-30

规则见 `AGENTS.md`；版本与 UI 见 [决策](DECISIONS.md)、[专题](topics/v7-ui.md)。未发布与待验证汇总见[剩余问题清单](handoffs/2026-10-28-open-issues-backlog.md)。

## 2026-10-30 牌局回顾加「翻牌」按钮（未构建、未真机）

- 回顾窗口底部新增「翻牌」：翻开本局所有已发的牌（未发牌不显示），默认 500 钻、后台可改、按钮标价；价格来自 `ConfigManager.CONSUME_FLIP` + `stone_consume_price.go`，prefab/scene 同批；已付费或本来就全开的局显示「已翻开」、不扣费。`扣费提示` 底图自带按钮文字，`V8文字` 必须保持关闭。见[交接](handoffs/2026-10-30-review-flip-cards.md)。
- 结算界面的 `panelRecordInfo/牌局回顾` 加了同款「翻牌」（`操作` 行右侧）：已购/扫描/翻牌改用 `panelGameView` 的 `static`；结算走 `reqHallCommand` 扣费。显示条件只留「列表显示 + 有房间号」，**别再加场景名/`PanelGameView` 判断**（实机一直不出现），大厅战绩也显示；`[翻牌]` 日志待删。

## 2026-10-30 俱乐部玩家备注（未构建、未真机）

- 接入 `设置_俱乐部_成员_备注`（创建者/直属上级、30 字、中英文）；列表与信息显示 `名字(备注)`，备注行恢复、输入框对齐已修；转译/桩测试通过，Creator/真实回包/真机未验。见[交接](handoffs/2026-10-30-club-member-remark.md)。

## 2026-10-30 大厅底栏改「客服 俱乐部 BY 推广 我的」（未构建、未真机）

- `Down` 改为 客服/俱乐部/BY/推广/我的（原「公告」toggle 改名推广，客服仍是 Button）；`Main/公告` 分页保留但底栏不再进入。
- `club_nav_bar_v8.png` 重绘并清掉公告区，`.meta`/UUID 未动、体积未增；推广复用全屏 `推广二维码` 页，打开收起底栏、关闭回原页。
- 「我的」里的游戏推广行隐藏（按钮区 3 行、内容高 550，正好不滚）。见[交接](handoffs/2026-10-30-nav-tabs.md)。

## 2026-10-30 机器人账号首次登录激活（已部署，未提交）

- 问题：新建机器人只写营销表，游戏库 `kbe_accountinfos` 玩家行由首次登录生成；没登录过的账号入会回「玩家不存在」，
  而分配 Worker 又要求已入会，形成死锁。仍不后台预插 `tbl_Account`。
- 迁移 040 已执行：加 `activated_at / activation_error / activation_attempts / activation_attempted_at`。
  巡检先按 `kbe_accountinfos` 补标（人工真客户端登录也算），再给有空位的在线 Worker 排「只登录」激活会话；
  登录成功后回查游戏库确认建号才落 `activated_at`、收回节点并自动补入会。失败记原因、让出节点，60 秒冷却、最多 10 次。
- 投放：未激活行不可勾选，直接提交回 `409 ROBOT_NOT_ACTIVATED`；分组投放只取已激活账号。机器人管理显示未激活与原因，
  并加「激活」动作（重置冷却）。
- 已部署：后端 `0c602dbd…`、前端 `index-BgH2Ot-G.js` / `index-BvCWh9Hq.css`；回滚 `backups/xuanmanager.20261030-0108-rollback`、`web.previous-activation-20261030`。
- **真实激活未演练**：唯一 Worker `mac-mini-2-local` 自 10-28 离线；本机 `bin/xuanagent` 已重建（含 `XUAN_LOGIN_ONLY`），待启动。
  见[交接](handoffs/2026-10-30-account-activation.md)。

## 2026-10-29 投放输赢目标支持「按周时段」（已部署，未提交）

- 输赢目标新增 `profit_mode='schedule'`：周一到周日可多段（≤28，结束早于开始算跨零点），时段内按 `window_net` 控输赢，时段外先 `drain` 打完手里一局再让出 Worker（`schedule_state='released'`）。
- 迁移 039（`profit_schedule/schedule_window/window_net/schedule_state`）已执行，后端与前端已上线，`go vet/build`、`tsc -b`、eslint、`vite build` 通过；**交互未实测，Worker 未重启**。见[交接](handoffs/2026-10-29-profit-weekly-schedule.md)。

## 2026-10-29 控制台小步调整（已部署，未提交）

- 侧边栏一级/二级配色区分；「自动化组」模块 45 隐藏，分组增删改并入**机器人管理 → 分组管理**（建组只填名称+策略；删组可搬走组内机器人）；创建/编辑机器人弹窗可内联新建分组并自动选中。
- 回滚点 `web.previous-navlevels-20261029`、`web.previous-groupmanager-20261029`。**交互待实测**。见[侧边栏](handoffs/2026-10-29-sidebar-level-contrast.md)、[分组管理](handoffs/2026-10-29-group-manager-in-robots.md)、[删组搬迁](handoffs/2026-10-29-group-delete-move.md)、[组策略](handoffs/2026-10-29-group-strategy-only.md)、[内联建组](handoffs/2026-10-29-robot-inline-group-create.md)。

## 2026-10-29 机器人密码改回密文 + 独立密钥（已部署，未提交）

- 创建/改密恢复 `SealCredential` 落库（`v1:` 密文），心跳下发不变（解密后下发）；服务器 `runtime.env` 新增独立 `XUAN_CREDENTIAL_KEY`。
- 新增 `server/cmd/xuanresea` 一次性回封工具，已装 `bin/xuanresea`；当前机器人表为空、无存量明文。
- 后端 PID 22966（`de47f71e…`），前端 `index-CcSNTgVz.js`；回滚备份 `*.previous-sealpwd-20261029`。**端到端待主人验证**；密钥只存 runtime.env，建议另存离线备份。见[交接](handoffs/2026-10-29-robot-password-sealed.md)。

## 2026-10-29 自动化：Worker 俱乐部模式 + 策略下发 + 控制台收尾（未提交，前后端已部署 v6）

- **Worker**：进房必须自己在该俱乐部内；俱乐部房不结束，倒计时到 → 全员结算 → 分回身上 → 需重新带入（人仍在留座）。**每轮结算后离房换桌**，离开的房 10 分钟内不再进；**结算时已超目标则留房继续带入来输，最多连 2 次**。见[交接](handoffs/2026-10-29-worker-club-mode.md)。
- **策略**：后台可建多套绑机器人、运行期下发。**策略 = 动作智力**（跑法/出牌节奏、安全线、牌力、收敛），**投放 = 选机器人 + 绑策略 + 底皮 + 输赢目标**（投放必选策略与输赢），草稿不下发。见[交接](handoffs/2026-10-29-automation-strategy-runtime.md)。
- **机器人/控制台**：创建弹窗删「智力/倍数/参与调度」；密码改回**密文 + 独立密钥**；侧边栏可折叠；测试数据已清空。见[交接](handoffs/2026-10-29-automation-robots-and-console.md)。
- 状态：038 已执行，后端 PID 18006、前端 `index-IE64Hwkm.js`；**未提交**。

## 2026-10-29 牌桌小修与实时战绩（未构建、未真机）

- 留座归零 fire `SelfSeatTimeout` 关「带入窗口」，`PlayerList` 后兜底收窗；俱乐部房隐藏 `RoomFrame/info/游戏时间`。见[交接](handoffs/2026-10-29-seat-timeout-close-buyin.md)、[交接](handoffs/2026-10-29-club-room-hide-clock.md)。
- 「记录」在座行加第 4 列 `countdown`，`获取_房间_已结算_玩家_命令`（每页 20）滑到底翻页；`带入记录.prefab` 改 4 列 + `V8表头countdown`。见[交接](handoffs/2026-10-29-realtime-settled-list.md)。

## 2026-10-27 及更早（阶段归档）

- 自动化控制台、我的页滚动、推广下载地址、消费全切钻石与历史 UI 状态见[归档](archive/2026-10-30/current-early-items.md)。

## 本轮实时核对：记忆整理

目录 `/Volumes/SSD/qing`，Creator 2.4.13。见[整理交接](handoffs/2026-09-05-memory-migration.md)。

## 最近报告的 UI 状态

见[全套进度](handoffs/2026-09-11-v8-all-pages.md)与[逐页归档](archive/2026-09-15/ui-status-table.md)。

## 待核实项与工作边界

1. `panelQianBao.ts` “确认充值”仍显示“暂未开通”并提前返回；本轮只修选择和美术，不代表充值业务恢复。
2. V7 只覆盖有实施记录的页面；牌桌、动画等未列入范围的设计不得因归档自动判废。
3. 待验证项不构成执行授权；动手前重新核实未提交差异。

来源：[原文归档](archive/2026-09-05/AGENTS.original.md)；目录 `/Volumes/SSD/qing`，Creator 2.4.13，`build` 与 `runtime-src.zip` 保留。
