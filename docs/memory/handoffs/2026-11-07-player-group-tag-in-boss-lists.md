# 数据统计面板：已在分组的玩家直接显示分组名

日期：2026-11-07　分支：`codex/club-ui`（未提交）

## 目标

「数据统计」（`panelBossPlayerInfo`）里「玩家信息」与「代理链」两个页签的行，
若该玩家已在本管理域的分组中，就不显示「添加到分组」按钮，改在按钮原位直接显示分组名。

## 数据来源（按文档）

- `NumberList` 成员行 2026-11-07 新增 `groups`（`[{group_id,group_name}]`），见
  `doc/俱乐部与联盟功能-客户端接口文档.md`；老字段 `group_id` / `group_name` 仍在。
- 代理链 `ClubMemberAgentChain` 的 `chain[]` 节点 2026-11-07 同样新增 `groups`，
  口径见 `doc/俱乐部成员代理链查询-客户端接口文档.md` §3.2（按节点所在俱乐部的管理域取，无分组/未加载为 `[]`）。
- 一人一组，数组最多 1 项；两处都做了 `groups` → `group_id/group_name` 的回退，老服务端也能显示。

## 改动

- `assets/scripts/UI/panelBossPlayerInfo.ts`
  - `BossChainRow` 增 `groupName`，`ParseRow` 用新 `GroupText()` 解析；
  - 新增 `GroupText()` / `ApplyGroupCell()` / `RowName()` / `RefreshRowGroup()`；
  - `FillInfoRow()`（玩家信息行）与 `AddChainRow()`（代理链行）统一走 `ApplyGroupCell()`：
    有分组 → 藏按钮、显示「分组:XXX」（前缀按用户要求用半角冒号）；未分组 → 显示按钮；
  - `OnGroupResult()`：`set_member` / `remove_member` 回执后就地刷新已渲染行的分组位，不必整表重查。
- `assets/resources/UI/panelBossPlayerInfo.prefab`
  - `行模板` 新增 `分组名` 节点（直接挂 `cc.Label`，宽 176、居中、SHRINK、浅蓝 160/220/235），
    位置 `(-246, -74)` 即原「添加到分组」按钮同一行的左端，默认 `active=false`。
  - 只追加了 3 个对象（node/PrefabInfo/Label）+ 父节点 children 一项，其余字节未变。

## 已验证

- `ts.transpileModule` 0 诊断（只查语法）。
- Creator 已于 22:01 重新导入该 prefab，`library/imports/b4/b43f860d-….json` 内含 `分组名`。

## 未验证 / 待办

- 编辑器里目视版式（176×36 是否会压到「统计口径」、长分组名 SHRINK 后的字号）未看。
- 网页/真机实际表现未测。
- 服务端 `groups` 字段标记「已上传测试服、待重启」；未重启前代理链节点只会是 `[]`，
  界面继续显示按钮，属预期。

## 注意

- 分组页签「组内成员」弹窗里同一颗按钮被复用成「移出成员」（`FillMemberRow`），那条路径没改；
  `分组名` 节点在那些行里保持隐藏。
