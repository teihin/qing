# 2026-11-13 批次（已部署 8891 / 8893）

自 `CURRENT.md` 归档，细节见各自交接。

- **BF 聊天开关移交后台**：ChatTool 迁移 014 建 `chat_direct_bf_club` 并拒绝客户端写入，XuanManager 迁移 063 建 `game.club.bf_chat` 与 `PUT /api/game/clubs/{clubId}/bf-chat`；客户端未构建。见[交接](../../handoffs/2026-11-13-club-bf-chat-admin.md)。
- **业绩核心共享发放改三阶段**：总额注入大盟主联盟池 → 下划各盟主俱乐部 → 给成员发积分；迁移 `062` 加 `stage/club_id/…` 与账单分组；有流水后总额/分摊锁定、重试幂等；**未做真实发放**。见[交接](../../handoffs/2026-11-13-agent-reward-club-payout.md)。
- **额度授权记录加类型显示**：行模板新增 `typelabel`（授信/收回/注资/注资扣减/额度奖励）；未构建/真机。见[交接](../../handoffs/2026-11-13-client-quota-grant-type.md)。
- **后台用户端数据查询** `/game/user-data`（迁移 `061`）：玩家信息/俱乐部/代理链 + 五类明细，大盟主与盟主额外看额度变化；默认 7 天、单次 ≤31 天。见[交接](../../handoffs/2026-11-13-admin-user-data-query.md)。
