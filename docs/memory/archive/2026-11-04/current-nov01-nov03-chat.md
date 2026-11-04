# CURRENT 条目原文（2026-11-04 归档）

## 2026-11-03 玩家设置：盟主行收起管理操作（未构建、未真机）

- 大群主在成员列表点盟主虚拟行（`role=盟主`）打开玩家设置时，收起「开通代理」开关行、「代理比例」行和「赠送」，上下分保留；改为显示独立「盟主比例」行（额度行位置），「调整」输入 0-100 后发 `设置_联盟_盟主_比例`（`club_id`=盟主俱乐部）。切页签后保持收放，按钮回调按身份拦截。
- 「下级成员」页签不再用 `is_agent=0` 跳过盟主；NumberList 每行都带自己的 `club_id`，查询统一用目标玩家自己的 `club_id` + `agent_id`。盟主行缺 `club_id` 时用 `查询_我的_联盟`（owner→club 缓存）兜底，仍取不到则报错、不回退大群主俱乐部；代理/成员缺才回退当前俱乐部。改动 `ClubManagementView.ts`、`ClubManagementApi.ts`、`panelMain.prefab`，TS/Prefab 结构通过，真实回包/Creator/构建/真机待验证。详见[交接](handoffs/2026-11-03-club-union-apply-review.md)。

## 2026-11-01 资金明细 / 牌桌金币 / 私聊上下分（未构建、未真机）

- 有俱乐部时资金明细走 `查询_俱乐部_积分流水`；牌桌带入/余额/邀请/兑换按房间 `club_id` 读 `Account.club_gold`；私聊四入口用 `panelClubGoldPad`。详见[牌桌金币](handoffs/2026-11-01-ingame-club-gold.md)、[私聊上下分](handoffs/2026-11-01-chat-gold-pad.md)。
