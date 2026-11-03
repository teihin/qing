# 2026-11-01 后台俱乐部管理模块（阶段归档）

来源：`docs/memory/CURRENT.md`，2026-11-04 因当前状态超出预算移入；原文未改。完整细节见 [交接](../../handoffs/2026-11-01-admin-club-management.md)。

## 2026-11-01 后台俱乐部管理模块（已部署）

- XuanManager 新增「俱乐部管理」（`/game/clubs`，迁移 `041`）：俱乐部列表 → 成员代理树 → 群主额度，已部署；二进制 `78f3e416…`。额度以 `club_agent_info.quota`（分）为准，读库判断，`NULL`=未授信。
- 群主按 `sm_club_make`/`sm_club_make2` 反查；树按 `upper_guuid` 嵌套，异常进 `orphan`。支持俱乐部/玩家维度查询、`ownerQuotaFen` 列与俱乐部群主写操作审计。
- 真实数据验证通过；性能根因 `COALESCE(club_status,'')` 导致索引失效，修复后列表 3.8s→24ms，并给 Caddy 加 gzip。回滚点与完整细节见[交接](../../handoffs/2026-11-01-admin-club-management.md)。
- 未验证：Creator、客户端（`assets/` 全程未改）。
