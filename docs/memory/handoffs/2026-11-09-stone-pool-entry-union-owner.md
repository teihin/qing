# 2026-11-09 钻石池消耗入口：大盟主不可见修复

- 分支：`codex/club-ui`（工作区含其他任务未提交修改）
- 状态：代码已改、静态语法检查通过；**未 Creator 构建、未真机、未联调**

## 现象

「我的」页「钻石池消耗」按钮对大盟主（联盟总群主）消失；原意是只给大盟主看、其他人不可见。

## 根因

`panelMain.CanViewStonePoolCost` 原本写成「`status.known` 为真但对创建者不放行」：

- 大盟主的 `查询_联盟_额度` 推送可能不带 `is_owner`，此时 `clubUnionStatus` 已是
  `known=true / hasUnion=true / isOwner=undefined`，按钮被当成非总群主隐藏。
- `查询_我的_联盟` 成功后会落 `isOwner=true / ownerConfirmed=true`，但 `OnClubMyUnion` 末尾
  只刷新了俱乐部卡片/发现页，没有重算「我的」按钮区，于是入口被藏后不会自己回来。
- 首次进「我的」时未入盟群主状态未知，对创建者临时放行；确认非总群主后也没有立即刷新
  （`club:union:name` 失败分支只改了状态）。

## 改动（只改 `assets/scripts/UI/panelMain.ts`）

- `CanViewStonePoolCost`：仍先判 `IsUnionOwnerAccount()`（账号级 `isOwner === true`）；
  否则要求 `IsClubOwner`，且只在 **`status.known && status.isOwner === false`** 时收起。
  即「联盟状态已知但 owner 未回包」不再误伤大盟主。
- 新增 `RefreshClubFinanceMenuVisibility()` 调用点：
  - `switchTabSel("我的")`：按当前俱乐部先重算一次；
  - `OnClubMyUnion`：确认总群主后立即出现；
  - `OnClubUnionCreate` 推送：创建者成为大盟主后立即出现；
  - `club:union:name` 失败且确认非总群主：立即收起；
  - `club:union:status` 失败（含「你还没有联盟」）：立即重算。
- `OnClubUnionQuota` 原有的 `isOwner` 变化刷新保留。

## 结果口径

- 大盟主：`isOwner=true` 或账号级任一联盟 `isOwner=true` → 显示。
- 盟主 / 群主：确认 `isOwner=false` 或已确认无联盟 → 隐藏；状态未回包时对创建者短暂放行。
- 管理员 / 合伙人 / 普通成员：不是创建者，始终隐藏；点击分支同样拦截。

## 未验证

1. Creator 未导入/构建，真机未跑。
2. 大盟主首次进「我的」的实际时序（额度推送是否带 `is_owner`）需联调确认；本次已用多处刷新兜底。
3. 「上下分记录」沿用同一套账号级判定，未本次回归。
