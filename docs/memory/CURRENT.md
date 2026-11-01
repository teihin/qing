# qing 当前状态

更新时间：2026-11-01

规则见 `AGENTS.md`；版本与 UI 见 [决策](DECISIONS.md)、[专题](topics/v7-ui.md)。未发布与待验证汇总见[剩余问题清单](handoffs/2026-10-28-open-issues-backlog.md)。

## 2026-11-01 我的页俱乐部金币流水接口（未构建、未真机）

- `panelMain` 的「我的 → 资金明细」在有当前俱乐部时改用 `查询_俱乐部_积分流水`，带 `club_id / user_id / count / page / context`，列表接收 `ClubGoldWater`；按新接口的 `gold / type / remark / room_id / date` 解析，`gold` 按整数元显示。
- 无当前俱乐部仍保留 `查询_玩家_现金流水`；俱乐部上下文下忽略旧 `ListPlayerCashWater`，避免平台金币流水覆盖俱乐部积分流水。
- TypeScript 转译、既有金币/钱包流水回归、新 `ClubGoldWater` 请求与行显示离线检查通过；Creator 导入、真实服务器回包、构建和真机交互仍待验证。

## 2026-11-01 牌桌内俱乐部金币口径（未构建、未真机）

- 俱乐部房的带入窗口、牌桌聊天余额、房间邀请最低带入判断和牌桌兑换入口均按当前房间 `club_id` 读取 `Account.club_gold`；带入和余额不足提示不再把平台金币作为俱乐部余额，`set_club_gold` 会刷新已打开的带入窗口。
- 牌桌玩家资料在俱乐部房隐藏平台充值入口；创建当前俱乐部房时显示该俱乐部金币；大厅进入俱乐部房失败码 `0x304` 显示“俱乐部金币不足”。普通大厅/普通房保留平台金币。详见[交接](handoffs/2026-11-01-ingame-club-gold.md)。
- 8 个脚本 TypeScript 转译、俱乐部邀请桩回归和静态余额解析检查通过；Creator 导入、构建、真实服务器回包和真机交互仍待验证。

## 2026-11-01 私聊上下分入口与弹窗（未构建、未真机）

- 直聊消息页新增「上下分」入口：当前会话操作者为群主/盟主时显示；代理需先通过 `查询_俱乐部_额度` 返回 `is_agent=1 && is_granted=1` 且 `quota_fen > 0` 才显示。普通成员、未授信代理和无可用额度代理隐藏，最终权限仍由大厅服务端校验。
- 新增独立 `panelClubGoldPad` Prefab/脚本（634×870，`bk` 居中、关闭按钮右上 Widget）：玩家名、金额、交易密码、100～50000 快捷金额、上分/下分。**上分/下分走 `panelMsgView` 二次确认**，确定后统一发 `添加_俱乐部_成员_积分`（下分传负数 `user_add_gold`，`修改_俱乐部_成员_积分` 服务端有问题、不再使用），成功通知 `ClubGoldGiftChanged`。
- 成功后不再弹提示框，改为在聊天列表发一条 **system 消息**（和文字/图片/语音同样走 `/api/direct`，存库、重进可见、对方也能看到）：`消息-系统` 模板 + `系统消息底.png`，居中通栏、左侧金条，区别于左右气泡；上行完整年月日时分秒，下行「玩家 X 上分 N 成功，积分 A → B」。服务端只放行 owner/leader/agent 且文案必须匹配固定正则；余额只取回包字段、拿不到就省略该段。详见交接。
- 底部入口扩成四个：拍照上传 / 发送图片 / 赠送积分 / 上下分。**代理没有可用额度时显示「赠送积分」**（与「上下分」互斥），赠送对象是玩家、管理员**和代理**（下级/同级代理；群主、盟主不显示）；点开是 `panelClubGoldPad` 的 `give` 模式（标题「赠送积分」、单按钮「确认赠送」、提示说明扣自己积分）。**赠送走独立命令 `赠送_俱乐部_积分`**（`club_id/user_id/user_add_gold/user_pwd`，扣自己积分、不动额度；上分那条 `添加_俱乐部_成员_积分` 是代理按额度发筹码，用它赠送等于白送），成功后系统消息文案为「玩家 X 赠送 N 成功」。
- 美术已整套重做（不再复用 V7 赠送弹窗资源）：`assets/ImagesLuck/上下分/` 放面板/输入框/胶囊/双按钮/美术字，入口图标 `assets/ImagesLuck/聊天/上下分.png` 复用「拍照上传」底框像素。聊天页底部三按钮改 `LEFT/CENTER/RIGHT + bottom 76` 的 Widget。
- 三个可复现工具：`tools/gen_chat_gold_pad_art.py`（画图）、`apply_chat_gold_pad_layout.py`（补 `.meta` + 重建 prefab）、`preview_chat_gold_pad.py`（离线渲染设计稿）。
- 两个必记的引擎行为：**EditBox 不排版子 Label**（必须 `Widget(45)` 铺满 + `verticalAlign` 居中）；**`InputFlag` 中 PASSWORD=0、DEFAULT=5**（写 0 会让普通输入框变 ●●●）。
- 静态检查通过（Prefab `__id__`/父子/`fileId` 完整、TS 转译 0 诊断、`inputFlag` 与 Widget 断言）；Creator 导入、实际大厅回包、构建、双账号和真机交互仍待验证。详见[交接](handoffs/2026-11-01-chat-gold-pad.md)。

## 2026-11-01 俱乐部成员额度展示与授信（未构建、未真机）

- 成员列表对代理异步查询 `查询_俱乐部_额度`，仅在 `is_agent=1 && is_granted=1` 时在「比例」右侧显示 `quota_fen / 100`；玩家设置对直属代理显示「额度」和「开通额度/调整额度」。
- 「授信_俱乐部_额度」是额度转移接口：开通和已授信后的增加/减少都调用它，分别传正/负 `quota_fen`。成功后仍以 `GetClubQuota` 异步回包重新查询，额度 0 仍视为已授信。
- 已改 `ClubManagementApi.ts`、`ClubManagementView.ts` 和 `panelMain.prefab`；TypeScript 转译、协议桩回归、Prefab JSON/节点引用检查通过。Creator 导入、实际服务器回包、构建和真机交互仍待验证。详见[交接](handoffs/2026-11-01-club-member-quota.md)。

## 2026-11-01 俱乐部模式赠送金币路由（未构建、未真机）

- “我的”页直赠在有当前俱乐部时调用 **`赠送_俱乐部_积分`**（`club_id / user_id / user_add_gold / user_pwd`，扣自己账户的积分、不动额度，双方须在同一授信代理下）；成员设置赠送、俱乐部房间内玩家头像赠送仍用 `添加_俱乐部_成员_积分`（代理按额度发筹码口径，是否同改待定）；无当前俱乐部或普通房仍保留大厅通用 `调用_方法_Exchange2`。
- 服务端更新后，三条俱乐部赠送路径均先校验交易密码并发送 `user_pwd`；成员设置/头像入口成功后通知大厅刷新记录。
- 2026-11-01 服务端失败回包会把上下文变为 `添加_俱乐部_成员_积分_club:gold:...`；`panelMain` 已截取其中真正的 `club:` 上下文，因此 `0x301` 会显示 `result.error`（如“请先设置交易密码”）。俱乐部赠送成功/关闭/再次打开会清空密码和输入内容，并忽略关闭后旧弹窗回包；遇到未设置交易密码时，确认提示会直接打开初始化交易密码界面，成员设置赠送还会先关闭赠送弹窗。
- “赠送”页有当前俱乐部时改查 `查询_俱乐部_成员_积分_添加_记录`；真实回包同步返回空 `result`，随后由 `AddMemberGoldList` 推送 `guuid / name / gold / date` 列表，客户端已兼容该事件及多层包装，普通大厅仍查 `ExchangeInfo`。
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
