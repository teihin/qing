# 后台俱乐部列表新增「俱乐部总积分」

日期：2026-11-06
分支：`codex/club-ui`
目录：`/Volumes/SSD/qing`（XuanManager 服务端 + 前端）

## 目标

后台「俱乐部管理」列表在「钻石池」列后面增加「俱乐部总积分」，问「现在能拿到么」。

## 数据结论

- 游戏服 `查询_俱乐部_成员_总分`（参数 `club_id`、`context`）实测走 `/hall/command` 同步返回
  `{"ret_code": 512, "ret_result": {}}`，数据只推给玩家客户端的 `AllPlayerGold` 路由 —— **后台拿不到**。
- 落库数据可用：`kbedm.tbl_Account.sm_club_gold` / `sm_club_gold2`，形态 `{"俱乐部ID": 积分}`，单位元，
  `-99` 是「无该俱乐部数据」哨兵。线上实测有 6 个俱乐部有值：
  267493=55808、885399=25462、260673=17960、984470=11413、876300=1061、775447=640，其余为 0。
- 当前库里 `tbl_Account` 只有 61 个账号（`club_guuid_info` 88 万条里绝大多数是 `init` 占位行），
  聚合成本可忽略；将来账号量大时这条 `LIKE '%"clubID"%'` 是全表扫，需要重新评估。

## 改动

- `XuanManager/server/internal/api/clubs.go`
  - `clubListItem` 新增 `TotalClubGold *int64`（json `totalClubGold`，单位元，`null` = 读取失败，≠0）。
  - 新增 `clubTotalGolds()`：一次查询按当前页 clubID 拼 `(sm_club_gold LIKE ? OR sm_club_gold2 LIKE ?) OR ...`，
    Go 侧 `parseClubGoldMap()` 解析累加；茶楼/带分模式（`club_mode` 2/3）优先取 `*_2` 列，与 `readClubMembers` 同口径。
  - 列表 `handleListClubs` 与详情 `readClubDetail` 都填该字段。
- `XuanManager/web/src/types.ts`：`ClubListItem` 加 `totalClubGold`。
- `XuanManager/web/src/pages/ClubsPage.tsx`：表头「钻石池」后插「俱乐部总积分」，显示 `N 元`；null 显示「未确认」。
- `XuanManager/新后台管理系统接口文档.md`：补充字段与口径说明。
- `XuanManager/server/internal/api/clubs_test.go`：新增 `TestParseClubGoldMapKeepsNumbersAndDropsSentinels`。

## 验证

- `go build ./...` / `go vet ./internal/api/` / `go test ./...` 全过；`npm run build` 通过。
- 部署 19:14（`client_update@154.37.155.17:2233`）：
  - 二进制 `e9fd5d744b90c4407703b1c3101fd7fa3d3c09c0a768429469d69c582096424b`（13,643,130 字节）
  - 前端 `index-6HAkVMKQ.js`，CSS 仍为 `index-Dq24wEA0.css`（未变）
  - 回滚点：`bin/xuanmanager.previous-clubtotalgold-20261106`（旧 13,633,169 字节）、
    `web.previous-clubtotalgold-20261106`、包归档 `xuan-web-20261106.tar.gz`、脚本 `deploy-clubtotalgold-20261106.sh`
  - `/api/health` 200；公网 `http://154.37.155.17/xuanmanager/` 200 且指向新 js；未登录 `/api/game/clubs` 401；
    js 内含「俱乐部总积分」「totalClubGold」；二进制含 `totalClubGold` 符号。
- **未验证**：真实后台登录态下打开俱乐部管理页看列与数值；未做页面截图。

## 踩坑（下次部署必看）

`supervise.sh` 里 `if wait "$child_pid"; then exit 0` —— 子进程**正常退出（exit 0）时守护进程直接退出、不再重拉**。
用 `kill <子进程>` 换二进制会触发优雅退出（日志 `XuanManager stopped`），守护随之消失，服务一直挂着，
直到 crontab 的每分钟 watchdog 调 `start.sh` 才恢复（本次中断 19:13:11 → 19:14:00，约 50 秒）。

安全做法：换完二进制后直接跑 `bash /www/html/.xuanmanager/start.sh`（它会发现 supervisor 已死并重启），
或者不要单独 kill 子进程，改为 kill supervisor.pid 后再 start.sh。
部署后务必确认 `ps -eo pid,lstart,args | grep bin/xuanmanager` 的启动时间是新时间。

## 下一步

- 登录后台目视核对列位置与 6 个俱乐部数值。
- 若后续要和服务端「总积分」严格对齐，需要服务端给出该命令的同步实现或专用后台查询命令。
