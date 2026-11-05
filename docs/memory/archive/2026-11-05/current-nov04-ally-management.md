# 盟友管理：盟主比例显示与调整（2026-11-04 原文）

## 2026-11-04 盟友管理：盟主比例显示与调整（未构建、未真机）

- 盟友行由 184 加高到 220，新增「盟主比例：X%」；底部改为「减少额度 / 增加额度 / 调整比例」三个并排按钮，输入 0-100 后发 `设置_联盟_盟主_比例`（`club_id`=目标俱乐部，100=不抽），自己俱乐部也可调整。
- 比例以后直接解析 `ClubMyUnion.members` 的 `union_percent`（当前回包只有 `union_quota` 额度/分）；未下发时盟友行显示「—」，自己那行缺省 100%，设置成功后先用本地值。
- 改 `ClubManagementView.ts`、`ClubManagementApi.ts`、`panelMain.prefab`；Prefab JSON/引用检查通过，Creator 导入、构建、真机与真实回包待验证。详见[交接](handoffs/2026-11-04-ally-ratio.md)。

