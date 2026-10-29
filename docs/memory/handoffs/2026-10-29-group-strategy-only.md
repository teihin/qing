# 建组只留名称与策略（前端已部署）

目录 `/Volumes/SSD/qing`，分支 `codex/club-ui`。只换前端静态目录，后端未动；git 未提交。

## 需求

> 创建分组不用设置在座数、终端上限，没用；策略有用。分组里机器人默认就是分组的策略，投放时可以重新指定。

核对结论：`mgr_automation_group.target_seated / max_robots` 在服务端**只被展示类查询读取**
（总览 `automation.go:222`、俱乐部汇总 `automation_clubs.go:89`、组列表），调度器不消费；
投放本来就强制选策略并写入 `mgr_automation_robot.strategy_id`，所以组策略只需作为投放时的默认值。

## 改动（全部前端）

| 文件 | 改动 |
| --- | --- |
| `AutomationRobotModals.tsx` | 内联建组表单去掉「目标在座 / 终端上限」，只留组名称 + 绑定策略；提交 `targetSeated:0, maxRobots:0` |
| `AutomationGroupsPage.tsx` | 建组弹窗同样去掉两个输入；编辑时原样回传旧值（不清历史数据），新建送 0；列表去掉「目标 / 上限」列，统计改「已绑定策略」，删除弹窗改显示组内机器人数；文案改为「组策略 = 投放默认策略」 |
| `AutomationClubsPage.tsx` | 去掉俱乐部列表/详情的「目标在座」（组求和）和组子表的「目标 / 上限」列 |
| `AutomationOverviewPage.tsx` | 「机器人在座 / 目标」→「机器人在座 / 在线」，不再读 group 目标 |
| `AutomationDeployPage.tsx` | 投放默认策略来源从「按组选」扩到「按机器人选且所选同属一个有策略的组」；策略与输赢目标只按组选时带出，用户改过不覆盖 |

## 部署与验证（2026-10-29 21:08）

- `vite build` 产物 `index-Bposorne.js`（711396 B）+ `index-OxofSX2p.css`（未变）。
- 原子替换 web 目录；served JS 200 / 711396 B 与本地一致；「组内机器人默认用这套策略」「已绑定策略」
  「机器人在座 / 在线」「默认带出组策略」各命中 1 次；health 200。
- 回滚点 `web.previous-groupstrategy-20261029`。
- 本地 eslint + tsc + vite build 通过。

## 影响与待验证

- 历史组的 `target_seated / max_robots` 保留在库里，只是不再展示；新建组为 0。
- **交互未实测**：需要管理员登录，验证「建组只填名称+策略 → 建机器人入组 → 投放弹窗自动带出组策略 → 换成别的策略投放」。
- 若之后要恢复「目标在座」概念，应挂在俱乐部配额（`robot_quota` / `seat_ratio`）上，而不是再加回组表。
