# CURRENT 归档

> 按预算归档，原文保留。

## 2026-11-27 投放机器人「选择俱乐部」改树形（联盟 → 俱乐部）

- 后端 `deployClubOption` 新增 `unionId/unionName`（`club_guuid_info.union_id` LEFT JOIN `union_guuid_info.union_name`），
  `club-options` 的 `limit` 上限 50 → 300。
- 前端 `AutomationDeployPage` 下拉改**可折叠树**：联盟 → 俱乐部（名称·邀请码·ID·还可投 N 台），点俱乐部回填邀请码。
- 联盟名字来源：`kbedm.union_guuid_info.union_name` 存的是 id 本身（游戏服没填），真名在 **`kbedm.club_union_info.union_name`**
  （如 196102=复仇者、291261=全新、947486=测试测试1）→ 后端改成优先取 `club_union_info`，回退 `union_guuid_info`，再回退显示「联盟 {id}」。
- **只部署测试服**（正式服未动）。数据现状：88.9 万俱乐部仅 14 个挂了 union_id，多数落在「独立俱乐部」。


