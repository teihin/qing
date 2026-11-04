# 2026-11-04 盟友管理：盟主比例显示与调整

- 目录/分支：`/Volumes/SSD/qing`，`codex/club-ui`
- 目标：在「俱乐部 → 盟友管理」列表中显示每个俱乐部（含总群主自己那家）的盟主比例，并提供调整入口。

## 改动

- `assets/scripts/UI/ClubManagementView.ts`
  - 盟友行行距 200→236、行高 184→220；姓名/ID/额度/比例四行，底部按钮行改为「减少额度 / 增加额度 / 调整比例」三个并排按钮（160/160/160 宽，调整比例在最右）。
  - 所有行（含总群主自己俱乐部）都显示「调整比例」；总群主自己那家缺省按 100% 展示。
  - 新增 `openUnionPercentInput` / `applyUnionPercent`：输入 0-100 整数，复用 `玩家设置输入弹窗`，发送 `设置_联盟_盟主_比例`，成功后重拉盟友列表。
  - `unionQuotaMode` 增加 `"percent"`，与增加/减少额度共用输入弹窗与确认按钮。
  - 比例直接读 `ClubMyUnion.members`；设置成功后用 `allyPercentOverrides` 暂存新值，避免回包暂未带比例时界面回退。
- `assets/scripts/UI/ClubManagementApi.ts`
  - `ClubMyUnion.members` 解析可选的 `union_percent` / `percent` / `unionPercent` 字段。
- `assets/resources/UI/panelMain.prefab`
  - 行模板新增默认隐藏的「盟友比例」文本（386×24）和「调整比例」按钮（160×54，复用减少额度蓝色底板，文字 25 号，位于最右）。
  - 只追加/调整这两个新节点；行底板是九宫格，运行时拉高到 220 不变形。

## 接口口径

- `union_quota` 是额度，单位分（顶级是联盟池 1100 = 11 元，成员级是该俱乐部额度）；**不是比例**。
- 比例由服务端后续在 `ClubMyUnion` 的 `members[].union_percent` 返回，客户端不再单独查询成员列表补比例；未返回前盟友行显示「—」，自己那行按 100%。
- `设置_联盟_盟主_比例`：`{"header":"设置_联盟_盟主_比例","club_id":"目标俱乐部","percent":90}`，100=不抽，流水 `联盟比例`。服务端会校验目标俱乐部是否在本联盟；自己俱乐部也在联盟内，允许调整。

## 验证状态

- 已做：脚本改动静态核对；Prefab JSON 解析、对象引用范围、行模板子节点结构检查通过（相对上一次工作副本只改这两个新节点）。
- 未做：未打开 Creator 导入/编译、未构建、未真机、未用真实总群主账号验证比例补查与设置回包。
- 下一步：Creator 导入后检查三按钮行宽和比例行间距；服务端在 `ClubMyUnion.members` 下发 `union_percent` 后，验证盟友比例显示、调整后立即更新、自己俱乐部也能调整、非总群主不出现调整按钮。
