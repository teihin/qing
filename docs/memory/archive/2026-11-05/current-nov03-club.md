# 2026-11-03 俱乐部管理 / 我的页 / 直聊（原文归档）

来源：`docs/memory/CURRENT.md` 2026-11-05 体积超限时整体迁出；交接链接保持原样。

## 2026-11-03 玩家设置：盟主行收起管理操作（已归档）

- 原文与交接链接见[归档](../2026-11-04/current-nov01-nov03-chat.md)。

## 2026-11-03 俱乐部管理与菜单顺序（已部署）

- 移除俱乐部管理「调整群主额度」按钮与弹窗；「群主额度」改只读，由大群主在游戏内调整。
- 联盟管理「加/减额度」及 `POST /api/game/unions/{unionId}/quota-adjustments` 保留，只调联盟池。
- 菜单顺序改为玩家 → 联盟 → 俱乐部；前端 `index-B77sPvpw.js`、后端 `5751cd60…` 已部署，未登录态验收。详见[交接](../../handoffs/2026-11-03-admin-union-management.md)。

## 2026-11-03 后台俱乐部钻石池（已部署，扣减待实测）

- 俱乐部列表/详情新增「钻石池」：读 `club_agent_info.stone`（创建者行）；新增 `POST /api/game/clubs/{clubId}/stone-pool-adjustments`，权限 `game.club.stone_pool_adjust`、迁移 `043`，加/减都走 `增加_俱乐部_钻石`（扣减传负数）并回读审计。
- Go 测试/vet、前端 lint/build 通过。已部署正式 8891：二进制 `18351c52…`、前端 `index-DzEoybUS.js`，迁移 043 已执行，健康 200、新路由未登录 401；游戏服负数支持与登录态交互未验证。详见[交接](../../handoffs/2026-11-03-admin-club-stone-pool.md)。

## 2026-11-03 我的页「钻石池消耗」（未构建、未真机）

- 「我的」第4行右侧新增「钻石池消耗」（有俱乐部显示，第二列版式）；独立 `panelStonePoolCost` 弹窗复用金币流向，标题/表头为时间/玩家/消耗积分/获得钻石，行模板带钻石图标。
- 接口 `查询_俱乐部_钻石兑换_记录` / `ClubStoneExchangeList`；`panelMain` 加入口。TS/Prefab/UUID/贴图检查通过；Creator/构建/真实回包待验证。详见[交接](../../handoffs/2026-11-03-my-stone-pool-cost.md)。

## 2026-11-03 俱乐部卡片钻石池（未构建、未真机）

- 群主卡片额度下方新增「钻石池」数量（仅群主显示）；值取 `查询_俱乐部_钻石流水`/`ClubStoneWater` 最新 `remark` 后值，进入我的/兑换/推送时刷新；`panelMain` 查询节流+推送，prefab 加文字。TS/Prefab 通过，Creator/构建/真机待验证。详见[交接](../../handoffs/2026-11-03-club-card-stone-pool.md)。

## 2026-11-03 我的页「上下分记录」（未构建、未真机）

- 「我的」新增「上下分记录」（有俱乐部显示），弹窗复用金币流向；接口 `查询_俱乐部_成员_积分_添加_记录`（整本俱乐部，无 user_id）/ `AddMemberGoldList`，按 `type=添加积分` 过滤；表头时间/玩家/金额/余额，行显示玩家+操作人两行。
- 新增 `panelUpDownRecord` 与两行行模板；TS/Prefab/UUID/贴图检查通过；Creator/构建/真实回包待验证。详见[交接](../../handoffs/2026-11-03-my-updown-record.md)。

## 2026-11-03 消息/直聊按联盟层级调整（已部署，详见交接）

- 固定联系人、跨俱乐部私聊、上下分/赠送权限按联盟层级收敛；服务端已部署，客户端未构建。详见[交接](../../handoffs/2026-11-03-direct-chat-union-permissions.md)，细节见[归档](../2026-11-04/current-nov03-union-chat.md)。

## 2026-11-03 我的页「入盟申请」审批入口（未构建、未真机）

- 联盟区新增「入盟申请」「盟友管理」，复用申请弹窗逐条审批；卡片去掉旧标题、名称上移放大，联盟区只留徽记/联盟名/联盟池。原文见[归档](./current-nov03-union-apply.md)，细节见[交接](../../handoffs/2026-11-03-club-union-apply-review.md)。

## 2026-11-03 我的页与俱乐部列表显示联盟归属（未构建、未真机）

- 「我的 → 当前俱乐部」标题行显示联盟徽记与 `联盟名(联盟号)`；俱乐部列表卡片对联盟俱乐部显示左上角徽记，名称改为 `俱乐部名(联盟名)`。新图 `assets/ImagesLuck/联盟/union_badge.png`。
- 名称读 `查询_俱乐部_信息.union_name`、`ClubUnionQuota`、`ClubMyUnion`；缺失时创建者补查 `查询_我的_联盟`，失败回退联盟号；盟主端名称稳定性依赖服务端补字段。
- TS 语法、Prefab 结构/贴图引用、按 Prefab 渲染预览通过；Creator 导入、真实回包、构建与真机待验证。详见[交接](../../handoffs/2026-11-03-club-union-display.md)。

## 2026-11-03 我的页「创建联盟 / 加入联盟」入口（未构建、未真机）

- 卡片底部两个入口、10000 钻扣费、图标与 Prefab 细节见[交接](../../handoffs/2026-11-03-club-union-create-join-ui.md)。
