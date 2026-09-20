# XuanManager 玩家管理列表：注册时间与最近登录拆列

日期：2026-09-20
目录/分支：`/Volumes/SSD/qing`，`main`（已提交 `7865427`，未推送）
状态：**前端已部署正式 8891**；未登录页面做视觉复核

## 需求

玩家管理列表里每个玩家的注册时间和最近登录时间原先挤在同一列（`注册 / 登录（北京时间）`，
注册时间为主、最近登录作副标题），用户要求拆成两列显示。

## 改动文件

前端 `XuanManager/web/src/`：

- `pages/PlayersPage.tsx`
  - 表头 `注册 / 登录（北京时间）` → `注册时间（北京时间）` + `最近登录（北京时间）`（新增 `<th>`）。
  - 数据行拆成两个 `<td>`：`<td>{formatDate(player.registrationTime)}</td>` 与
    `<td>{formatDate(player.lastLoginAt)}</td>`，删掉原「最近：…」`cell-subtitle`。
  - 取值函数不变，仍是 `formatDate`（即 `formatBeijingDateTime` 北京时间口径，省略年份和秒）。
    注册/登录时间的时区口径未改动。
- `styles.css`：`.player-table` 的 `min-width` 1120px → 1220px，容纳新增一列。

玩家详情弹窗（`PlayerDetail` → `PlayerProfileTab`）里注册时间与最近登录本来就是两个独立
`Detail` 项，本次未动。

## 验证

- `npm run lint` 0 报错；`npm run build` 通过（tsc -b + vite build），
  产物 `dist/assets/index-DC2upvZY.js`（481,557 B）+ `index-DGtSq5jZ.css`（168,604 B）。
- 本地产物自检：含新表头「注册时间（北京时间）」「最近登录（北京时间）」，不含旧表头「注册 / 登录」。
- 部署：暂存解包 → `mv web web.previous-player-time-split-20260920` → `mv` 新目录 → `chmod 755`。
  先手工看暂存目录文件与字节数，确认无误才切换。
- 线上回读（`127.0.0.1:8891`）：`/api/health` 200；首页引用新 hash；
  `index-DC2upvZY.js` 200 且 481,557 B；JS 内新表头命中（注册时间 ×1、最近登录 ×2）、旧表头 0 命中；
  CSS 200 且含 `player-table{min-width:1220px}`。
- **未做**：登录态页面视觉复核（无管理员凭据），长屏/窄屏下的列宽表现待主人看。

## 回滚

`rm -rf /www/html/.xuanmanager/web && mv /www/html/.xuanmanager/web.previous-player-time-split-20260920 web`。
仅动前端静态目录，未重启后端、未换二进制，回滚不需要停机。

## 未完成项

- 代码已提交 `7865427`，**未推送** origin/main。
