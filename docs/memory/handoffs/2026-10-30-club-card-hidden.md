# 2026-10-30 未加入俱乐部时隐藏「当前俱乐部」卡片

## 目标与范围

- 目录：`/Volumes/SSD/qing`；分支：`codex/club-ui`；Creator 2.4.13。
- 需求：账号没有任何俱乐部时，「我的」底部「当前俱乐部」卡片整体不显示，也不留下空档。

## 改动

- `assets/scripts/UI/ClubManagementView.ts:169` `Refresh`：按 `next.id` 切换 `Main/我的/滚动区/view/content/当前俱乐部` 的 `active`，无俱乐部时整卡（栏目/名称/邀请码/徽记/身份牌/操作按钮）一起隐藏。
- `assets/scripts/UI/ClubManagementView.ts:209` 新增 `syncProfileScroll`：有卡片时内容高 656（按钮区 419.76 + 间距 12 + 卡片 200 + 底部留白 24），无卡片时 456；内容不高于可视区时撑到 `view` 高度，并按顶部锚点重设 `content` 位置，避免出现可滚动的空白。
- `assets/scripts/UI/panelMain.ts:2244` `SyncMyPageScroll` 不再固定按 656 撑高，改为切页对齐 Widget 后交给 `syncProfileScroll` 统一计算，`Refresh` 里俱乐部状态变化时也会同步高度。

## 验证

- 静态核对：卡片路径与 Prefab 一致（`panelMain/我的/滚动区/view/content/当前俱乐部`，高 200、Widget 底部对齐）；内容高 656→456 与 Prefab 间距吻合。未运行 Creator 预览。

## 下一步

- Creator 预览：无俱乐部账号进入「我的」，确认卡片不出现、页面底部无空白可滚；加入俱乐部后立即出现且不压住按钮区；切换俱乐部/退出账号状态正常。
