# 2026-11-09 我的 → 额度授权记录（归档自 CURRENT.md）

- 入口仅「俱乐部创建者 + 已入盟」（大盟主/盟主）；查询改 `查询_联盟_授信_记录` → `ClubUnionGrantList`，服务端按身份限定俱乐部，行字段 `quota`/`quota_after`，不再本地过滤 type。
- 只改 `panelQuotaGrantRecord.ts`，语法检查通过；Creator 构建、真机与联调待验。详见 [handoffs/2026-11-07-quota-grant-record.md](../../handoffs/2026-11-07-quota-grant-record.md)。
