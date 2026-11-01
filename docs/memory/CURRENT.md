# qing 当前状态

更新时间：2026-11-01

规则见 `AGENTS.md`；版本与 UI 见 [决策](DECISIONS.md)、[专题](topics/v7-ui.md)。未发布与待验证汇总见[剩余问题清单](handoffs/2026-10-28-open-issues-backlog.md)。

## 2026-11-01 俱乐部成员额度展示与授信（未构建、未真机）

- 成员列表对代理异步查询 `查询_俱乐部_额度`，仅在 `is_agent=1 && is_granted=1` 时在「比例」右侧显示 `quota_fen / 100`；玩家设置对直属代理显示「额度」和「开通额度/调整额度」。
- 「授信_俱乐部_额度」是额度转移接口：开通和已授信后的增加/减少都调用它，分别传正/负 `quota_fen`。成功后仍以 `GetClubQuota` 异步回包重新查询，额度 0 仍视为已授信。
- 已改 `ClubManagementApi.ts`、`ClubManagementView.ts` 和 `panelMain.prefab`；TypeScript 转译、协议桩回归、Prefab JSON/节点引用检查通过。Creator 导入、实际服务器回包、构建和真机交互仍待验证。详见[交接](handoffs/2026-11-01-club-member-quota.md)。

## 2026-11-01 后台俱乐部管理模块（已部署）

- XuanManager 新增「俱乐部管理」（`/game/clubs`，迁移 `041`）：列出全部俱乐部 → 成员代理树 → 给群主调额度。已部署正式环境，二进制 `78f3e416…`。
- 群主按 `sm_club_make`/`sm_club_make2` 用 `FIND_IN_SET` 反查（`club_guuid_info` 无 owner 列）。树按 `club_agent_info.upper_guuid` 嵌套，上级缺失/指错/成环进 `orphan` 并提示，不硬挂；`club_gold` 兼容数字与 `{"俱乐部ID":积分}`，`-99` 显示「暂无数据」。
- **额度以 `club_agent_info.quota`（分）为准**：游戏服 `查询_俱乐部_额度` 只推异步 `GetClubQuota`，收不到同步回包，原实现会永远 `verified=false`；已改为读库，`NULL`=未授信而非 0。
- 写操作只限俱乐部群主，输入元/换算分，扣减不得为负，回读校验失败标 `verified=false`，全程串行并写审计。
- 真实数据验证通过：4 个俱乐部群主全部正确；`567671` 三层代理树 9 人、0 orphan；群主额度 900000 分、a2 100000 分；+1 元→900100 后已扣回还原 900000。非群主/超额/无 CSRF/未登录均按预期拦截。
- 公网 index/js/css 三个资源哈希与本地构建逐字节一致；回滚点为 `bin/xuanmanager.previous-club-management-20261101`（`0c602dbd…`）+ 同名 `web.previous-…`。
- 列表新增「群主额度」列（`ownerQuotaFen`，分→元），读 `club_agent_info.quota`，元组 `IN` 批量查不逐行；无记录/`NULL` 显示「未授信」而非 0。
- 查询支持**俱乐部维度**（ID/名称/群主/状态/模式/抽成/成员数）与**玩家维度**（玩家 ID/名字反查其所在俱乐部，用 EXISTS，不重复出行），已部署。
- **性能**：线上列表原 3.8s，根因是 `COALESCE(club_status,'')` 让索引失效（扫 89 万行 + filesort），改成直接比较后 3.7s→24ms；另给 Caddy 加 `encode gzip`，JS 741KB→200KB。现列表接口 7–13ms、页面查询 57ms。
- 未验证：Creator、客户端（`assets/` 全程未改）。见[交接](handoffs/2026-11-01-admin-club-management.md)。

## 2026-10-31 俱乐部 1 对 1 私聊（服务端已部署）

- 服务端 `/api/direct/*` + `chat_direct_*`（迁移 `006`），直聊关系改为 `CHAT_GAME_DB_*` 只读直查游戏库，不再用俱乐部同步副本。
- 客户端 `DirectChatManager` + 消息页（`Main` 第 5 分页）；已修 Cocos `onLoad` 早于 `setPanelInfo` 导致的空会话 ID 404。
- 轮询已改为独立 WebSocket（`ws-ticket` + `ws`，`message.new`/`message.sent` 只带游标），文本/语音优先 WS、断线用同一 `clientMessageId` 回退 HTTP；已读游标改为数据库条件更新，只允许向前。
- 固定上级代理入口按 `club_agent_info.upper_guuid` 生成、`canDelete=false`；`note` 只对上级链可见，列表显示“昵称（备注） [俱乐部名称]”。
- 服务端多轮部署（CORS 预检、图片附件空 `external_media_id`、长连接、已读并发、固定入口+备注）均已完成并通过 Go 全量测试；各版本 SHA-256、备份名与逐项验证见[交接](handoffs/2026-10-31-direct-chat.md)。
- 客户端尚未正式构建/热更，双账号、断网恢复、真机图片与录音仍待实测。

## 2026-10-30 牌局回顾加「翻牌」按钮（未构建、未真机）

- 回顾窗口底部新增「翻牌」：翻开本局所有已发的牌（未发牌不显示），默认 500 钻、后台可改、按钮标价；价格来自 `ConfigManager.CONSUME_FLIP` + `stone_consume_price.go`，prefab/scene 同批；已付费或本来就全开的局显示「已翻开」、不扣费。`扣费提示` 底图自带按钮文字，`V8文字` 必须保持关闭。见[交接](handoffs/2026-10-30-review-flip-cards.md)。
- `panelRecordInfo/牌局回顾` 同款「翻牌」在 `操作` 行右侧；显示条件只留「列表显示 + 有房间号」，**别再按场景名/`PanelGameView` 判断**（实机不出现）。详见表内交接。

## 2026-10-30 俱乐部玩家备注（未构建、未真机）

- 接入 `设置_俱乐部_成员_备注`（创建者/直属上级、30 字、中英文）；列表与信息显示 `名字(备注)`，备注行恢复、输入框对齐已修；转译/桩测试通过，Creator/真实回包/真机未验。见[交接](handoffs/2026-10-30-club-member-remark.md)。

## 2026-10-30 大厅底栏改「客服 俱乐部 BY 推广 我的」（未构建、未真机）

- `Down` 改为 客服/俱乐部/BY/推广/我的（原「公告」toggle 改名推广，客服仍是 Button）；`Main/公告` 分页保留但底栏不再进入。
- `club_nav_bar_v8.png` 重绘并清掉公告区，`.meta`/UUID 未动、体积未增；推广复用全屏 `推广二维码` 页，打开收起底栏、关闭回原页。
- 「我的」里的游戏推广行隐藏（按钮区 3 行、内容高 550，正好不滚）。见[交接](handoffs/2026-10-30-nav-tabs.md)。

## 2026-10-30 机器人账号首次登录激活（已部署，未提交）

- 机器人入会需要已登录建号，`kbe_accountinfos` 玩家行由首次登录生成，仍不后台预插 `tbl_Account`。迁移 040（`activated_at` 等 4 列）已执行：巡检按 `kbe_accountinfos` 补标，再给在线 Worker 排「只登录」激活会话，回查确认建号才落标记；未激活行不可投放（`409 ROBOT_NOT_ACTIVATED`）。
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
