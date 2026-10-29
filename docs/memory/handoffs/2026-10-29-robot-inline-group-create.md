# 机器人创建支持内联新建分组（前端已部署）

目录 `/Volumes/SSD/qing`，分支 `codex/club-ui`。**只换了前端静态目录，后端未动；git 未提交。**

## 需求

> 创建机器人界面要支持创建分组，以及可以把机器人指定到某个分组中。

现状核对：创建/编辑弹窗本来就有「机器人分组」下拉，后端 `POST /api/automation/robots/bulk` 也支持 `groupId`；
但分组列表为空时界面里没有建组入口（独立「组」页在侧边栏默认折叠里），且**自动化组页建组实际会 400**。

## 发现的 bug：组页面建组必失败

`validateAutomationGroup` 要求 `profitMode` 必须是 `none/daily/period`（`validAutomationProfitMode(..., false)`），
而 `AutomationGroupsPage` 的提交体没有这个字段 → `profitMode=""` → 400「输赢目标周期不正确」。
所以此前从界面建组走不通，这与「库里 group 表一直为空」的记录一致。

## 改动

| 文件 | 改动 |
| --- | --- |
| `web/src/pages/automation/AutomationRobotModals.tsx` | 新增 `GroupPicker`：分组下拉 + 「＋ 新建分组」内联表单（组名称、可选绑定策略、目标在座默认 4、终端上限默认 6）；创建后自动选中并回调刷新；创建/编辑弹窗都接入。内联表单回车只触发建组、不提交外层机器人表单 |
| `web/src/pages/automation/shared.tsx` | `useAutomationGroups` 改为返回 `{ groups, reload }` |
| `web/src/pages/automation/AutomationRobotsPage.tsx` | 解构新 hook；给两个弹窗传 `canCreateGroup`（`automation.group.create`）与 `onGroupCreated` |
| `web/src/pages/automation/AutomationDeployPage.tsx` | 适配 hook 返回结构 |
| `web/src/pages/automation/AutomationGroupsPage.tsx` | 提交换补 `profitMode:"none"`、`profitTarget:0`，修复建组 400 |
| `web/src/styles.css` | `.group-picker` 行布局样式 |

内联建组走现有 `POST /api/automation/groups`，`clubId` 仍由后端强制置空（组是俱乐部无关的，机器人自带 club）。

## 部署与验证（2026-10-29 21:00）

- 前端 `index-dTwa9GSD.js` + `index-OxofSX2p.css`，served JS 712789 字节与本地一致；
  产物含「＋ 新建分组」「创建并选中」「profitMode:`none`」、CSS 含 `group-picker`。
- health 200；回滚点 `web.previous-groupinline-20261029`。
- 本地 eslint + tsc + vite build 通过。

## 待验证

- **交互未实测**：需要管理员登录态，建组 → 自动选中 → 批量建机器人落入该组 → 列表「俱乐部 / 分组」列显示分组名的完整链路交给主人验证。
- 未部署后端（本次无后端改动）。
