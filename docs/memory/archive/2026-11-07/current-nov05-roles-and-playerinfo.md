# 归档：2026-11-05 角色称谓统一 / 玩家信息弹窗页签（原 CURRENT.md 节选）

## 2026-11-05 游戏内俱乐部角色称谓统一（未构建、未真机）

- 统一显示口径：联盟创始人=大盟主，已入盟俱乐部创始人=盟主，俱乐部代理=合伙人；未入盟创始人显示群主。只改文案，不改服务端命令、`role` 内部值、节点名和权限。
- 覆盖玩家信息/成员列表身份、我的俱乐部卡片、俱乐部列表、盟友行、直聊角色、兑换弹窗、房间提示、旧红利面板及静态 Prefab；未入盟俱乐部在「我的 → 当前俱乐部」不再显示额度。详见[交接](handoffs/2026-11-05-role-naming.md)与[决策 D09](DECISIONS.md)。
- 静态 Prefab JSON 与定向 TS 检查通过；Creator 导入、构建、真机和真实三角色回包待验证。

## 2026-11-05 玩家信息弹窗：页签换装 + 额度记录（未构建、未真机）

- 「成员设置/下级成员」改金色胶囊页签并新增「额度记录」（上下分/牌局流水）；搜索框改 SINGLE_LINE 支持中英文昵称；改 `ClubManagementView.ts`、`ClubManagementApi.ts`、`panelMain.prefab`，新增 `tools/apply_player_quota_records.py`。
- 额度记录口径、末列显示 `name`、盟主下级查询带 `agent_id+club_id`、身份判定创建者优先等细节见[交接](handoffs/2026-11-05-player-record-tabs.md)。
- Prefab/引用/离屏预览与定向 TS 检查通过；Creator 导入、构建、真机、真实回包待验证。
