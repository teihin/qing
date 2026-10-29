# 分组管理并入机器人管理（已部署，未提交）

目录 `/Volumes/SSD/qing`，分支 `codex/club-ui`。**只改前端，后端未动；前端已发布，git 未提交。**

## 背景

主人看不到「自动化组」页：`mgr_module` id 45 的 `visible=0`，侧边栏只渲染启用的可见模块，
当前自动化下实际只有投放管理 / 机器人管理 / 策略中心 / 对局记录 / Worker 节点 / 告警中心。
因此分组的增删改不能放在旧组页，按主人选择并入**机器人管理**。

## 改动

| 文件 | 改动 |
| --- | --- |
| `web/src/pages/automation/AutomationGroupModals.tsx` | 新增 `GroupManagerModal`：分组列表（名称、默认策略、机器人/在座、状态）+ 内联新建/编辑表单（只有组名称与策略）+ 删除面板（组内有机器人时选「不分组 / 其他分组」，按钮变「移动并删除」） |
| `web/src/pages/automation/AutomationRobotsPage.tsx` | 页头加「分组管理」按钮（`automation.group.view`）；弹窗保存/删除后 `reloadGroups()` 并静默刷新机器人列表；分组被删后自动清掉指向它的分组筛选 |
| `web/src/styles.css` | `.group-manager*` 布局样式 |

要点：

- 新建走 `POST /api/automation/groups`，编辑走 `PUT /api/automation/groups/{id}`，删除走
  `DELETE /api/automation/groups/{id}?moveToGroupId=0|组ID`（该接口与搬迁事务上一轮已部署）。
- 编辑只展示名称与策略，但请求体会**原样带回**在座目标、上限、房间偏好、带入比例、默认智力、
  输赢目标与周期、状态、备注，避免把后台已有配置清掉；`profitMode` 仍固定落在 `none/daily/period`
  之一以满足后端校验。
- 独立「自动化组」页代码保留但菜单隐藏，未删除。

## 验证

- `eslint src`、`tsc -b`、`vite build` 全部通过；产物 `index--NRq6W84.js`（718,353 B）+
  `index-Du8eCa0b.css`（199,767 B），产物内已含「分组管理」「移动并删除」「组内机器人移到」。

## 部署（2026-10-29 21:33）

- 上传 → 解包到 `web.staging-groupmanager-20261029` → 本地/暂存/线上 sha256 三方一致
  （JS `dbd692d0…`、CSS `41591111…`）→ `mv web web.previous-groupmanager-20261029` → `mv` 暂存为 `web` → 清 `._*`。
- 线上 `index.html` 指向 `index--NRq6W84.js` + `index-Du8eCa0b.css`；实际下载 200，字节数与本地一致；
  `api/health` 200；served JS 含「分组管理」、CSS 含 `group-manager__bar`。
- 回滚点：`/www/html/.xuanmanager/web.previous-groupmanager-20261029`（上一版 `index-DBFRAFG3.js`）。
- **交互仍未实测**：需要管理员登录后走一遍建组/改名/删组链路。

## 下一步

1. 实测：新建分组 → 机器人在批量创建/编辑里选中该组 → 改策略 → 删除该组时选「不分组」确认机器人被搬走。
