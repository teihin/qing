# 游戏设置入口：联盟状态三态判断 + 总群主身份只认 is_owner

- 目录/分支：`/Volumes/SSD/qing`，`codex/club-ui`（未提交）
- 日期：2026-11-18

## 现象

A3（俱乐部创建者、联盟里的**盟主**）大厅仍显示「游戏设置」。截图同时有「额度：948」但没有「联盟池」，是「已入盟 + 被误判成总群主」的组合。

## 根因（两层）

1. 当天 `85b1c493` 已修：服务端对无权限 hall 查询回 `200 + result:{}`，`club:union:name` 把空壳当总群主证据，`ownerConfirmed` 又压过 `is_owner=0`。该修复在 `build/web-mobile`（22:30 构建）里已生效。

2. 残留两道口子（本次修）：

- `RefreshGameSettingsEntry` 把「联盟状态未知」当「未入盟」：`hasUnion` 没有 `known` 校验，大厅也不补查状态，已入盟盟主会按「未入盟创建者」亮入口。
- `OnClubMyUnion` 在该俱乐部还没有 `is_owner` 结论时，仍把「查询_我的_联盟」成功写成 `isOwner=true, ownerConfirmed=true` 并记进 `ownedUnionIds`；服务端对开过联盟读权限的账号会放行这条命令，误判会重现。

## 改动（`assets/scripts/UI/panelMain.ts`）

1. `RefreshGameSettingsEntry`：`hasUnion` / `unionKnown` 都要求 `union.known` 或俱乐部信息 `union_id`；可见条件 = `isUnionOwner || (unionKnown && !hasUnion && IsClubCreator)`；未知时隐藏并按 30 秒节流补发 `查询_联盟_额度`。
2. `OnClubMyUnion`：只补 `union_id` / `union_name` / 成员归属，不再写 `isOwner` / `ownerConfirmed`，也不再 `RememberOwnedUnion(true)`；`quotaFen` 仅在 `status.isOwner===true`（总群主）时写入。总群主身份唯一来源 = `ClubUnionQuota` 的 `is_owner` + `创建_联盟`。

## 验证

- `ts.createSourceFile` 解析 0 诊断，`transpileModule` 通过。
- 入口用例（vm + 真实 `panelMain` 原型）：盟主已入盟=false、总群主=true、已入盟但状态未知=false 且补查 1 次、未入盟创建者=true、`known=false`=false 且补查 1 次、非创建者=false。
- `OnClubMyUnion` 用例：盟主回包后 `isOwner` 仍 false、`ownedUnionIds` 空；无结论时只落 `known/hasUnion/unionId/unionName`，不写 `isOwner`。

## 未做

- 未构建、未热更、未真机；`build/web-mobile` 仍是 22:30 的旧包（含 `85b1c493`，不含本次两处）。
- 真机需确认：盟主首次登录入口全程不亮；未入盟创建者回包后（几百毫秒内）出现；总群主入口等 `is_owner=1` 回包后出现。

## 第二轮（同日，用户实测复现后）

现象：A3 首次进大厅入口正确隐藏；点进「我的」再回房间列表，入口出现，之后一直在。

根因：上面第 1 条只加了 `known` 校验，`isUnionOwner` 仍是**账号级**扫描——`clubUnionStatus` 里任意一家俱乐部 `isOwner===true` 就算数。A3 名下另一家俱乐部是联盟创始人（`is_owner=1`），与当前选中的盟主俱乐部无关。`start()` 的 `this.schedule(..., 1)` 是每秒轮询，所以「我的」页补查回包后 1 秒内入口就翻上去，看起来像「点了我的之后才出现」。

修正（`RefreshGameSettingsEntry`）：改用 `IsUnionOwnerOfClub(clubId)`（只认当前俱乐部所属联盟是不是我当总群主的，和多俱乐部场景已在用的「上下分记录/钻石池消耗」同口径）。

- 可见 = `unionKnown && (IsUnionOwnerOfClub(clubId) || (!hasUnion && IsClubCreator(clubId)))`
- `unionKnown` = `status.known` 或已知联盟号；`hasUnion` = 已知联盟号或 `status.hasUnion`；未知一律藏 + 30 秒节流补查。

验证：`transpileModule` 0 诊断；把 `RefreshGameSettingsEntry` / `IsUnionOwnerOfClub` / `ResolveClubUnionId` / `OwnedUnionIds` / `IsClubOwner` 源码切片后用假上下文跑 6 例——盟主店+另一家 is_owner=1 → 藏、盟主店只知联盟号 → 藏、盟主店状态未知 → 藏且补查 1 次、大盟主店 → 显示、未入盟创建者 → 显示、非创建者 → 藏。

仍未构建/热更/真机。
