# 2026-10-26 我的俱乐部列表当前俱乐部置顶

## 范围

- 目录：`/Volumes/SSD/qing`；分支：`codex/club-ui`；Cocos Creator 2.4.13。
- 保留工作区其他未提交修改；未提交、未推送。

## 改动

- `assets/scripts/UI/panelMain.ts` 的 `RefreshClubList()`：先用 `ResolveRoomClub()` 取当前俱乐部，再把当前 ID 排到 `GetMyClubIds()` 结果首位，其余俱乐部保持原有关系顺序（创建/加入/管理）。
- 每次点开俱乐部页签都会走 `onToggleClick` 的「俱乐部」分支重新渲染列表，因此切换当前俱乐部后回到该页即可看到置顶生效。

## 验证

- `panelMain.ts`、`ClubManagementApi.ts` 经 TypeScript 转译 0 诊断。
- 未做：Creator 场景预览、构建、真机、真实服务器回包联调。
