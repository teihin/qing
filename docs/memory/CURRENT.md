# qing 当前状态

更新时间：2026-11-03

规则见 `AGENTS.md`；版本与 UI 见 [决策](DECISIONS.md)、[专题](topics/v7-ui.md)。未发布与待验证汇总见[剩余问题清单](handoffs/2026-10-28-open-issues-backlog.md)。

## 2026-11-03 后台玩家管理：钻石余额 + 所在俱乐部（已部署）

- 玩家列表改为钻石余额/所在俱乐部，去掉现金余额、等级/角色/直属代理；加减分改加减钻石。详情页签改为「基本资料/所在俱乐部/房间战绩」，俱乐部页显示角色、俱乐部金币、上级及下级。
- 新增 `GET .../clubs`、`.../subordinates`、`POST .../stone-adjustments`；加减钻石校验基准与扣减上限，调用 `异步_设置_玩家_属性` 并回读 `sm_stone`。
- 2026-11-03 已部署正式（后端 `6cb80fd0…`、前端 `index-DJL003ny.js`）；健康 200，三个新接口未登录均 401。真实数据与页面交互待验收，见[交接](handoffs/2026-11-03-admin-player-diamonds-clubs.md)。

## 2026-11-02 玩家设置「赠送」改口径 + 新增「上下分」（未构建、未真机）

- 成员设置「赠送」改走 **`赠送_俱乐部_积分`**；新增「玩家设置上下分」复用 `panelClubGoldPad`，`entry=settings` 成功后弹提示、不插聊天通报；自己那行可点开，管理操作收起，行模板加透明热区扩大点击区。
- 已改 `ClubManagementView.ts`、`panelGivePad.ts`、`panelMain.ts`、`panelClubGoldPad.ts`、`panelMain.prefab`；TS/Prefab/Creator 编译通过，真实回包、构建、真机待验证。详见[交接](handoffs/2026-11-02-club-gift-updown.md)。

## 2026-11-03 后台联盟管理与「调整群主额度」（已部署）

- 新增 `/game/unions`（`game.union.view`）：联盟列表/联盟池/成员数，「详情」跳 `/game/clubs?unionId=...` 过滤下辖俱乐部。
- 俱乐部列表新增联盟列、V2 额度（`club_guuid_info.union_quota`）和「调整群主额度」：平台只调用 `增加_联盟_额度` 给联盟池注资，俱乐部额度仍由总群主授信。
- 09:53 已部署：后端 `8a3f2627…`、前端 `index-Dvwrp3Q8.js`，迁移 `042` 已执行；回滚 `backups/xuanmanager.20261103-0952-rollback` + `web.previous-union-management-20261103-0952`。未做登录态/注资验收。见[交接](handoffs/2026-11-03-admin-union-management.md)。
- 09:59 按 club 模式在导航隐藏「代理管理/交易记录/交易黑名单」（模块与权限保留，standard 模式恢复）；见[交接](handoffs/2026-11-03-admin-club-mode-hidden-modules.md)。

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

- “我的”页直赠在有当前俱乐部时调用 **`赠送_俱乐部_积分`**（`club_id / user_id / user_add_gold / user_pwd`，扣自己账户的积分、不动额度，双方须在同一授信代理下）；成员设置赠送、俱乐部房间内玩家头像赠送仍用 `添加_俱乐部_成员_积分`（代理按额度发筹码口径，是否同改待定）；无当前俱乐部或普通房仍保留大厅通用 `调用_方法_Exchange2`。
- 服务端更新后，三条俱乐部赠送路径均先校验交易密码并发送 `user_pwd`；成员设置/头像入口成功后通知大厅刷新记录。
- 2026-11-01 服务端失败回包会把上下文变为 `添加_俱乐部_成员_积分_club:gold:...`；`panelMain` 已截取其中真正的 `club:` 上下文，因此 `0x301` 会显示 `result.error`（如“请先设置交易密码”）。俱乐部赠送成功/关闭/再次打开会清空密码和输入内容，并忽略关闭后旧弹窗回包；遇到未设置交易密码时，确认提示会直接打开初始化交易密码界面，成员设置赠送还会先关闭赠送弹窗。
- “赠送”页有当前俱乐部时查 **`查询_俱乐部_积分流水`**（`club_id` + `user_id` 留空=查自己 + **`only_add:1`** 只看「添加积分/积分赠送」+ `count/page`），同步回包只有空壳，列表由 **`ClubGoldWater`** 推送；该推送与「资金明细」页共用，客户端按最近一次请求的 context（`club:gold:add-record:` / `club:gold:water:`）分派到赠送列表或资金明细列表。流水没有对方 ID，记录行按 `opter_name` 显示操作人、`type` 缩成两字（添加/赠送/收到）；旧的 `AddMemberGoldList` 解析保留兼容。普通大厅仍查 `ExchangeInfo`。
- 已改 `panelMain.ts`、`panelGivePad.ts`、`panelUserInfo.ts`；TypeScript 转译、赠送/密码/金币流水回归、请求字段静态断言、既有俱乐部协议桩回归和脚本/Prefab `git diff --check` 通过。Creator/真实服务器回包/构建/真机仍待验证。
- 兑换钻石弹窗 `panelExchangeStone.ts` 在有当前俱乐部时读取 `Account.club_gold`，发送 `reqExChange2(..., "gold,<club_id>")`，余额校验/提示改为俱乐部金币，并监听 `set_club_gold`；无俱乐部时关闭入口/弹窗，顶部金币显示 0，不再回退到平台金币。
- 无俱乐部时大厅“赠送/兑换钻石”入口、牌桌设置里的“兑换钻石”和牌桌玩家资料里的“赠送”均隐藏；无俱乐部金币余额统一显示 0。

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
