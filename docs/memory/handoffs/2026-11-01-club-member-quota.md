# 俱乐部成员额度展示与授信

## 目标

成员列表中，代理成员在比例右侧显示当前额度；从头像打开玩家设置时，直属代理可以开通或调整额度。

## 当前实现

- `assets/scripts/UI/ClubManagementApi.ts`
  - 注册 `GetClubQuota`。
  - 新增 `getQuota(club,user)`，解析 `quota_fen`、`is_agent`、`is_granted`。
  - 新增 `grantQuota` → `授信_俱乐部_额度`，发送 `quota_fen`。
  - 已授信后的增加/减少拆成 `increaseQuota` / `decreaseQuota` 两个动作，都调用额度转移接口 `授信_俱乐部_额度`；增加发送正 `quota_fen`，减少发送负 `quota_fen`。
  - 授信成功 `GC_OK` 无 `context`，在唯一授信请求上安全兜底；查询先接收同步受理，再等待 `GetClubQuota` 异步数据。
- `assets/scripts/UI/ClubManagementView.ts`
  - 代理行查询额度；只有 `is_agent && is_granted` 才显示「额度」和值。
  - 玩家设置的额度行只对代理显示；操作者有直属代理管理权限时显示「开通额度/调整额度」。输入支持元和两位小数，换算为分，0 有效。
  - 授信成功后刷新成员列表并重新查询目标额度。
- `assets/resources/UI/panelMain.prefab`
  - 成员行和下级成员行在比例右侧新增「额度/额度值」节点。
  - 玩家设置使用与备注/比例相同的两行：代理始终显示「开通额度 / 开通（已授信时显示已开通）」；只有已授信时才显示「调整额度 / 当前值 / 增加 / 减少」，未授信时调整行隐藏。

## 验证

- `ClubManagementApi.ts`、`ClubManagementView.ts` TypeScript 转译无诊断。
- `tools/test_club_joiner_protocol.js` 通过。
- 独立桩回归覆盖无 context 的 `GC_OK` 和带 context 的 `GetClubQuota` 异步关联。
- Prefab JSON、额度节点引用和新增 `PrefabInfo.fileId` 检查通过，`git diff --check` 通过。
- 机器上未直接安装 `typescript`，验证使用已有 nexe 内 TypeScript 运行库。

## 待验证

Creator 重新导入 Prefab、真实俱乐部数据回包、网页/构建产物和 Android/iOS 真机交互尚未执行；后台权限和额度仍以服务端最终校验为准。
