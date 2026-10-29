# 删除分组支持搬迁组内机器人（前后端已部署）

目录 `/Volumes/SSD/qing`，分支 `codex/club-ui`。git 未提交。

## 需求

> 现在这样创建了分组不能删除了么，需要支持删除。删除时分组里面不能有机器人，有的话需要移动到其他分组或者不分组。

核对：删除入口与接口本来就存在（自动化组页 → 删除，`DELETE /api/automation/groups/{id}`，权限
`automation.group.delete`），但组内有机器人时服务端直接 409「请先移出后再删除」，界面只给这句提示、
没有批量搬走的出口，机器人多时等于删不掉。

## 改动

| 位置 | 改动 |
| --- | --- |
| `server/internal/api/automation_robots.go` | `handleDeleteAutomationGroup` 支持 `?moveToGroupId=N`（`0` = 不分组）。带参数时同一事务内 `UPDATE mgr_automation_robot SET group_id=?` 再删组；不带且组内有机器人仍 409，错误文案改为「删除时请选择把它们移到其他分组或不分组」。校验目标组存在且不是自身 |
| `web/src/pages/automation/AutomationGroupsPage.tsx` | 删除弹窗：组内有机器人时出现「组内机器人移到」下拉（不分组 / 其他组），按钮变「移动并删除」；成功提示带搬迁台数 |

机器人搬组不改变自身 `strategy_id`（投放时写入），只影响后续按组调度与展示。

## 部署与验证（2026-10-29 21:15）

- 后端：`sha256 4b13ecf1…`，9,461,944 B；与线上旧二进制（`de47f71e…`，9,453,752 B）做字符串集合 diff，
  仅多出 `UPDATE mgr_automation_robot SET group_id = ? WHERE group_id = ?` 与字符串打包边界差异 → 同源。
  重启后 health 200，进程 `27521`。回滚备份 `backups/xuanmanager.groupdel-20261029-rollback`。
- 前端：`index-DBFRAFG3.js`（712,164 B，CSS 未变）；served 大小一致，「组内机器人移到」「移动并删除」
  「不分组」「moveToGroupId」各命中 1 次。回滚点 `web.previous-groupdel-20261029`。
- 本地 `go vet/test`、eslint + tsc + vite build 通过。

## 待验证 / 注意

- **真实删除未实测**（需要管理员登录）：组内有机器人 → 删除 → 选目标组或不分组 → 提示搬迁台数 → 组消失、机器人出现在目标组。
- 权限：`automation.group.*` 目前只授予角色 1（超级管理员）；若某账号看不到删除按钮，先查角色权限。
