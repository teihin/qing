# 2026-11-03 我的俱乐部卡片显示群主钻石池

- 分支：`codex/club-ui`
- 状态：代码、Prefab、布局示意已落盘；**未构建、未 Creator 导入、未连真实服务器验证**。
- 目标：在「我的 → 当前俱乐部」卡片右侧、额度下面显示俱乐部钻石池数量，群主可见并尽量实时更新。

## 数据口径

- 客户端没有直接返回 `club_agent_info.stone` 的字段；用 **`查询_俱乐部_钻石流水`**（§11.5，群主/boss 权限）的推送 **`ClubStoneWater`** 取最新一条的 `remark`「前→后」的**后值**作为当前池子。
- 查询参数：`club_id`、`count:100`、`page:0`、`context`；服务端总条数封顶 100，直接一次取完。
- 推送不带 `club_id`，按最近一次查询的俱乐部配对；没有待配对查询时只接受当前俱乐部群主（`guuid` 校验）的推送。
- 刷新时机：进入「我的」、收到 `ClubAgentInfo(is_creator=1)`、兑换结果回到大厅、`ClubStoneWater` 推送；停留在「我的」页时每 30 秒补查一次。查询按俱乐部 15 秒节流（强制刷新除外）；无数据时显示 `--`。
- 群主池为 0 或流水为空时显示 0；非群主不显示该行。

## 改动

- `assets/scripts/UI/panelMain.ts`
  - 新增 `clubStonePools` / `clubStonePoolAsked` / `clubStonePoolRequestClubId`，`ClubStoneWater` 监听，`RequestClubStonePool()` / `OnClubStoneWater()` / `IsClubOwner()` / `ClubOwnerId()`。
  - `onHallCommand` 新增 `club:stone:pool:` 同步回包分支；`HandleClubHallCommand` 兼容 `result` 空壳。
  - 进入「我的」、`OnClubAgentInfo`（创建者）、兑换结果（`onExChange` 兑换忽略窗口）触发查询；换俱乐部/入退会时清空缓存。
  - 会读取 `查询_俱乐部_钻石流水` 最新一条的 `remark` 后值；只对群主发请求。
- `assets/scripts/UI/ClubManagementView.ts`
  - `ClubContext` 新增 `stonePool`；卡片新增「钻石池」文字，只有 `role=owner` 显示，额度下方；不再带前置钻石图标。
- `assets/resources/UI/panelMain.prefab`
  - 「当前俱乐部」新增 `钻石池` 文字（180×24，x=239、y=-7，字号/行高 21/24 与「俱乐部额度」一致），默认隐藏，由代码按群主身份显隐；文字左边缘 149，使「钻石池：」与「额度：」的冒号都落在 x=212。
  - 原 18px `钻石池图标` 节点及其 Sprite 已删除，`ClubManagementView` 不再控制该节点。

## 布局预览

- `design-previews/待确认/2026-11-03-俱乐部钻石池/card_pool_mock_1x.png`
- `design-previews/待确认/2026-11-03-俱乐部钻石池/card_pool_detail_2x.png`
- 两张预览仍是「带钻石图标、字号 19」的旧版；2026-11-03 改为无图标、字号 21 并与「额度：」冒号对齐，尚未重出预览图。

## 验证

- `node --experimental-strip-types --check`：`panelMain.ts`、`ClubManagementView.ts` 通过。
- Prefab JSON 引用、节点/组件反向引用、新增节点父子关系检查通过；删除图标后无悬空 `__id__`，`钻石池图标` 无残留引用。
- 对齐按 Prefab 数值核算：额度左边缘 170 + 2 字宽 = 212，钻石池左边缘 149 + 3 字宽 = 212；本地字体渲染核对冒号与数值同列。
- 未验证：真实 `ClubStoneWater` 推送与 `remark` 格式、流水为空/超过 100 条、兑换后池子刷新、非群主权限、Creator 导入/构建/真机。

## 下一步

1. Creator 打开项目，确认卡片右侧「钻石池」与额度、按钮不重叠。
2. 群主账号进入「我的」核对数值与后台 `club_agent_info.stone` 一致；兑换一次确认实时下降。
3. 非群主账号确认该行隐藏；真机长屏/短屏验收后考虑提交。
