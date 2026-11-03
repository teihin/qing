# qing 当前状态

更新时间：2026-11-03

规则见 `AGENTS.md`；版本与 UI 见 [决策](DECISIONS.md)、[专题](topics/v7-ui.md)。未发布与待验证汇总见[剩余问题清单](handoffs/2026-10-28-open-issues-backlog.md)。

## 2026-11-03 消息/直聊按联盟层级调整（服务端已部署，客户端未构建）

- 固定联系人改为「直属上级代理 + 本俱乐部老板 + 联盟大群主」，三级按 guuid 去重；固定会话服务端拒绝删除。普通玩家默认看到老板与（入盟后的）大群主，代理保留直属上级。
- 联盟大群主可查看联盟内任意俱乐部成员并与其一对一聊天，会话按对方俱乐部各一条；消息首页改为按参与者读取全部会话，跨俱乐部私聊可见。
- 聊天页上下分只给俱乐部老板；赠送给老板和代理；代理不再显示上下分。大群主入口：盟友管理行点俱乐部名 → 成员列表 → 点人聊天，盟主虚拟行可直接对话。
- 已改 `ChatTool/server/internal/directchat/*`、`DirectChatManager.ts`、`panelMessage.ts`、`panelMessageChat.ts`、`ClubManagementView.ts`、`ClubManagementApi.ts`、`panelMessageMembers.ts`。Go build/vet/test 与 TS 语法检查通过；二进制 `40fc3e4c…` 已部署（回滚 `bin/chattool.previous-union-chat-20261103-1915`），健康 200、联盟表只读可查；已随 `c77b7e5` 提交推送到 `origin/codex/club-ui`；真实账号联调、Creator/真机待验证。详见[交接](handoffs/2026-11-03-direct-chat-union-permissions.md)。

## 2026-11-03 我的页「入盟申请」审批入口（未构建、未真机）

- 联盟区域新增「入盟申请」「盟友管理」按钮：总群主判定为「已入盟且 `unionIsOwner !== false`」，缺 `is_owner` 时保留旧值并用 `查询_我的_联盟` 成功兜底；身份牌按大群主/盟主/老板显示，代理统一「代理」。已入盟以 `info.union_id` 为准，额度失败不覆盖；`union_apply` 审核中置灰加入联盟。
- 复用俱乐部申请弹窗：入盟申请逐条同意/拒绝（`同意_加入_联盟` / `拒绝_加入_联盟`），盟友管理列联盟池/俱乐部额度，支持增减；发现页、列表、卡片按权限显示。
- 推送实时刷新：审批/盟友列表收到推送即刷新；额度推送同步顶部并重拉「我的联盟」
- 卡片去掉「当前俱乐部」标题，俱乐部名/邀请码上移放大；俱乐部额度在邀请码行右侧；下方联盟区只放联盟徽记/联盟名(ID)/联盟池，与入盟申请/盟友管理同区；卡片 320 高、内容上移 60。TS/Prefab 检查通过；Creator 自动导入未刷新时需重编译/构建。详见[交接](handoffs/2026-11-03-club-union-apply-review.md)。

## 2026-11-03 我的页与俱乐部列表显示联盟归属（未构建、未真机）

- 「我的 → 当前俱乐部」标题行显示联盟徽记与 `联盟名(联盟号)`；俱乐部列表卡片对联盟俱乐部显示左上角徽记，名称改为 `俱乐部名(联盟名)`。新图 `assets/ImagesLuck/联盟/union_badge.png`。
- 名称读 `查询_俱乐部_信息.union_name`、`ClubUnionQuota`、`ClubMyUnion`；缺失时创建者补查 `查询_我的_联盟`，失败回退联盟号；盟主端名称稳定性依赖服务端补字段。
- TS 语法、Prefab 结构/贴图引用、按 Prefab 渲染预览通过；Creator 导入、真实回包、构建与真机待验证。详见[交接](handoffs/2026-11-03-club-union-display.md)。

## 2026-11-03 我的页「创建联盟 / 加入联盟」入口（未构建、未真机）

- 当前俱乐部卡片底部新增联盟分割线与两个按钮；仅俱乐部创建者且 `查询_联盟_额度` 确认未入盟时显示，已入盟/非创建者收起，卡片高度在 200/320 间切换。
- 「创建联盟」复用创建俱乐部弹窗输入联盟名，提示并扣除默认 10000 钻（`创建_联盟` 受理后再发 `玩家_消费_命令_创建联盟`）；「加入联盟」复用加入俱乐部弹窗输入 6 位联盟号，发送 `申请_加入_联盟`。
- 新金色图标与分割线由 ImageGen 生成，按钮底板复用 `agent_v8_button_base.png`；三张新图已写入 `.meta` 并被 Prefab 引用。
- XuanManager 钻石消费价格目录补「创建联盟」默认 10000，后台可配置；11:03 后端 `7289909…` 已部署，回滚 `backups/xuanmanager.20261103-1102-rollback`，价格哈希需后台保存一次。
- TS 语法、Creator 重新导入、Prefab/资源引用检查通过；真实回包、构建、真机与双账号联盟流程待验证。详见[交接](handoffs/2026-11-03-club-union-create-join-ui.md)。

## 2026-11-03 后台玩家管理：钻石余额 + 所在俱乐部（已部署）

- 玩家列表改为钻石余额/所在俱乐部，去掉现金余额、等级/角色/直属代理；加减分改加减钻石。详情页签为「基本资料/所在俱乐部/房间战绩」，俱乐部页显示角色、俱乐部金币、上级及下级。
- 新增 `GET .../clubs`、`.../subordinates`、`POST .../stone-adjustments`（校验基准与扣减上限，`异步_设置_玩家_属性` 后回读 `sm_stone`）。
- 已部署正式（后端 `6cb80fd0…`、前端 `index-DJL003ny.js`）；健康 200、新接口未登录 401；数据与交互待验收，见[交接](handoffs/2026-11-03-admin-player-diamonds-clubs.md)。

## 2026-11-02 玩家设置「赠送」改口径 + 新增「上下分」（未构建、未真机）

- 成员设置「赠送」改走 **`赠送_俱乐部_积分`**；新增「玩家设置上下分」复用 `panelClubGoldPad`，`entry=settings` 成功后弹提示、不插聊天通报；自己那行可点开，管理操作收起，行模板加透明热区扩大点击区。
- 已改 `ClubManagementView.ts`、`panelGivePad.ts`、`panelMain.ts`、`panelClubGoldPad.ts`、`panelMain.prefab`；TS/Prefab/Creator 编译通过，真实回包、构建、真机待验证。详见[交接](handoffs/2026-11-02-club-gift-updown.md)。

## 2026-11-03 后台联盟管理与「调整群主额度」（已部署）

- 新增 `/game/unions`：联盟列表/联盟池/成员数，详情跳俱乐部管理；行内「加/减额度」调整联盟池。
- 俱乐部列表加联盟列、V2 额度和「调整群主额度」：统一走 `增加_联盟_额度`（扣减传负数）；俱乐部额度仍由总群主授信。
- 09:53 部署首版（迁移 `042`），13:49 部署加/减额度，后端 `37746a0d…`、前端 `index-DY4BzOQU.js`；回滚 `backups/xuanmanager.20261103-1349-rollback` + `web.previous-union-quota-20261103-1349`；登录态/注资扣减待验收。09:59 club 模式导航隐藏「代理管理/交易记录/交易黑名单」，模块与权限保留。

## 2026-11-03 房间战绩俱乐部信息 + 房间维护只读改造（已部署）

- 房间战绩列表/详情增加俱乐部名称、俱乐部 ID、创建者和创建者邀请码；支持按俱乐部 ID/名称和创建者邀请码筛选。
- 房间维护改为按俱乐部聚合的只读页：一级俱乐部、展开二级房间，移除解散/全部解散/全局创建开关；支持按俱乐部/创建者/邀请码查询。
- 10:21 已部署正式：后端 `2865d24c…`、前端 `index-efi7NGCa.js`/`index-BJt7iv_1.css`；新接口未登录 401，已移除写接口 404；回滚 `backups/xuanmanager.20261103-1020-rollback` + `web.previous-room-clubs-20261103-1020`。未做登录态验收；KB 当前 0 个活跃房间。见[交接](handoffs/2026-11-03-admin-room-records-club-maintenance.md)。

## 2026-11-01 我的页俱乐部金币流水接口（未构建、未真机）

- `panelMain` 的「我的 → 资金明细」在有当前俱乐部时改用 `查询_俱乐部_积分流水`，带 `club_id / user_id / count / page / context`，列表接收 `ClubGoldWater`；按新接口的 `gold / type / remark / room_id / date` 解析，`gold` 按整数元显示。
- 无当前俱乐部仍保留 `查询_玩家_现金流水`；俱乐部上下文下忽略旧 `ListPlayerCashWater`，避免平台金币流水覆盖俱乐部积分流水。
- TypeScript 转译、既有金币/钱包流水回归、新 `ClubGoldWater` 请求与行显示离线检查通过；Creator 导入、真实服务器回包、构建和真机交互仍待验证。

## 2026-11-01 牌桌内俱乐部金币口径（未构建、未真机）

- 俱乐部房的带入窗口、牌桌聊天余额、房间邀请最低带入判断和牌桌兑换入口均按当前房间 `club_id` 读取 `Account.club_gold`；带入和余额不足提示不再把平台金币作为俱乐部余额，`set_club_gold` 会刷新已打开的带入窗口。
- 牌桌玩家资料在俱乐部房隐藏平台充值入口；创建当前俱乐部房时显示该俱乐部金币；大厅进入俱乐部房失败码 `0x304` 显示“俱乐部金币不足”。普通大厅/普通房保留平台金币。详见[交接](handoffs/2026-11-01-ingame-club-gold.md)。
- 8 个脚本 TypeScript 转译、俱乐部邀请桩回归和静态余额解析检查通过；Creator 导入、构建、真实服务器回包和真机交互仍待验证。

## 2026-11-01 私聊上下分入口与弹窗（未构建、未真机）

- 直聊消息页新增「上下分」入口，代理按 `查询_俱乐部_额度` 的 `is_agent/is_granted` 控制显示；新增 `panelClubGoldPad`（上分/下分/赠送），上分/下分走 `panelMsgView` 二次确认，赠送走独立 `赠送_俱乐部_积分`（扣自己积分、不动额度）。
- 成功后在聊天列表写入 `消息-系统` 系统消息（`/api/direct` 存库），服务端校验 owner/leader/agent 与固定文案；聊天页底部扩为拍照/图片/赠送/上下分四入口。
- 美术与布局、EditBox 排版/InputFlag 引擎坑、离线检查与未验证项详见[交接](handoffs/2026-11-01-chat-gold-pad.md)。

## 2026-11-01 俱乐部成员额度展示与授信（未构建、未真机）

- 成员列表对代理异步查询 `查询_俱乐部_额度`，仅在 `is_agent=1 && is_granted=1` 时在「比例」右侧显示 `quota_fen / 100`；玩家设置对直属代理显示「额度」和「开通额度/调整额度」。
- 「授信_俱乐部_额度」是额度转移接口：开通和已授信后的增加/减少都调用它，分别传正/负 `quota_fen`。成功后仍以 `GetClubQuota` 异步回包重新查询，额度 0 仍视为已授信。
- 已改 `ClubManagementApi.ts`、`ClubManagementView.ts` 和 `panelMain.prefab`；TypeScript 转译、协议桩回归、Prefab JSON/节点引用检查通过。Creator 导入、实际服务器回包、构建和真机交互仍待验证。详见[交接](handoffs/2026-11-01-club-member-quota.md)。

## 2026-11-01 俱乐部模式赠送金币路由（未构建、未真机）

- 有当前俱乐部时，赠走 **`赠送_俱乐部_积分`**（扣自己积分、校验交易密码）；上下分仍走 `添加_俱乐部_成员_积分`；赠送流水查 `查询_俱乐部_积分流水 + only_add:1`，由 `ClubGoldWater` 推送。兑换钻石读 `Account.club_gold` 并带 `gold,<club_id>`；无俱乐部时相关入口隐藏。
- 完整实现、失败回包 context 处理与交接链接见[归档](archive/2026-11-03/current-nov01-gift-routing.md)。

## 2026-11-01 后台俱乐部管理模块（已部署）

- XuanManager 新增「俱乐部管理」（`/game/clubs`，迁移 `041`）：俱乐部列表 → 成员代理树 → 群主额度，已部署；二进制 `78f3e416…`。额度以 `club_agent_info.quota`（分）为准，读库判断，`NULL`=未授信。
- 群主按 `sm_club_make`/`sm_club_make2` 反查；树按 `upper_guuid` 嵌套，异常进 `orphan`。支持俱乐部/玩家维度查询、`ownerQuotaFen` 列与俱乐部群主写操作审计。
- 真实数据验证通过；性能根因 `COALESCE(club_status,'')` 导致索引失效，修复后列表 3.8s→24ms，并给 Caddy 加 gzip。回滚点与完整细节见[交接](handoffs/2026-11-01-admin-club-management.md)。
- 未验证：Creator、客户端（`assets/` 全程未改）。

## 2026-10-31 俱乐部 1 对 1 私聊（服务端已部署）

- 服务端 `/api/direct/*` + `chat_direct_*`（迁移 `006`），直聊关系改为 `CHAT_GAME_DB_*` 只读直查游戏库，不再用俱乐部同步副本。
- 客户端 `DirectChatManager` + 消息页（`Main` 第 5 分页）；已修 Cocos `onLoad` 早于 `setPanelInfo` 导致的空会话 ID 404。
- 轮询已改为独立 WebSocket（`ws-ticket` + `ws`，`message.new`/`message.sent` 只带游标），文本/语音优先 WS、断线用同一 `clientMessageId` 回退 HTTP；已读游标改为数据库条件更新，只允许向前。
- 固定上级代理入口按 `club_agent_info.upper_guuid` 生成、`canDelete=false`；`note` 只对上级链可见，列表显示“昵称（备注） [俱乐部名称]”。
- 服务端多轮部署（CORS 预检、图片附件空 `external_media_id`、长连接、已读并发、固定入口+备注）均已完成并通过 Go 全量测试；各版本 SHA-256、备份名与逐项验证见[交接](handoffs/2026-10-31-direct-chat.md)。
- 客户端尚未正式构建/热更，双账号、断网恢复、真机图片与录音仍待实测。
- 2026-11-02 通过安卓 `192.168.3.100:9527` V8 Inspector 复现：`ws-ticket` HTTP 返回 200，但原生直聊 WebSocket 在 `OPEN` 前 `onerror → CLOSED`；同一临时票据由电脑连接公网 `ws://154.37.155.17/chattool/api/direct/ws` 可 `OPEN`。根因为服务端先用网页 Origin 白名单拒绝 Cocos 原生来源；修复为已带一次性 ticket 时跳过网页 Origin 校验，已部署到 `/www/html/.chattool`，公网健康 200，`Origin: file://` 无效 ticket 已进入 401 ticket 鉴权；真实双账号安卓回归仍待执行，见[安卓长连接交接](handoffs/2026-11-02-android-direct-chat-ws-origin.md)。
- 2026-11-02 直聊图片：安卓/iOS 原生桥已补齐「相册选图 + 拍照」，回调增加 `error` 字段（`denied`/`unsupported`），TS 侧 `PickImage(source)` 与消息页「拍照上传」「发送图片」分别走相机与相册。Java 已过 `:qing:compileDebugJavaWithJavac`、iOS 过 `clang -fsyntax-only`、TS 过语法制检；**未出包、未真机验证**，见[图片与拍照交接](handoffs/2026-11-02-direct-chat-image-camera.md)。

## 2026-10-29～10-30（阶段归档）

- 牌局回顾「翻牌」、俱乐部玩家备注、大厅底栏改版、机器人首次登录激活、投放「按周时段」、
  控制台小步调整、机器人密码密文、Worker 俱乐部模式、牌桌小修与实时战绩：
  原文与各自交接链接见[归档](archive/2026-11-01/current-oct29-30.md)。

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
