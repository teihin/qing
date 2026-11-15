# 2026-11-15 俱乐部荣耀榜：后台开关 + 客户端切榜

## 目录 / 分支

- 项目根：`/Volumes/SSD/qing`
- 分支：`codex/club-ui`（俱乐部版；不要往 `main`/平台版合并）
- 未提交：本次改动全部留在工作区，未 commit / 未构建 / 未部署

## 目标

把大厅（全平台）排行榜改成俱乐部模式排行榜，并让后台能按**联盟或独立俱乐部**单独开榜：
总开关 + 三个榜开关（手数/赢分/红利）+ 一组共用起止时间 + 每榜每档名次奖励。

## 契约（以服务端 v2.6 为准）

`服务器文档整理/俱乐部荣耀榜-客户端接口文档.md` **v2.6（2026-11-15 17:21）**：

- 服务端**没有**新建 scope 配置表，而是在 `club_honor_rank_reward` 上加了
  `activity_on / start_date / start_time / end_date / end_time` 五列，**一行 = 一个（scope, rank_type, dipi）**，共 7 行。
- 后台读写沿用原有两条命令：
  - 查询 `异步_查询_俱乐部_活动_奖励`：回包 `list` 每项多带上述五个字段。
  - 设置 `异步_设置_俱乐部_活动_奖励`：整行覆盖，新增五个参数；`activity_on=0` 时允许保留时间。
- 榜单判定（服务端）：无行 / `activity_on != 1` → `活动没有开启`；四时间任一为空 → 同上；
  `now < start` → `活动未开始`；`now >= start` 正常出榜；`now > end` 仍出最终榜（要关榜把 `activity_on` 置 0）。
- 手数 5 个档位可各自开关与时间，后台做「一键统一」。

> 先前那份 `俱乐部荣耀榜-配置开关-服务端需求-2026-11-15.md`（提出 `club_honor_rank_config` 表 + 两条新命令）
> 与服务端最终实现不一致，已删除，避免误读。

## 改动文件

XuanManager（后台）：
- `server/internal/api/club_honor_rank.go`：GET 调查询命令 → 规整成固定 7 行 → 聚合出
  「总开关 / 三榜开关 / 共用时间」并标 `mixedOn`、`mixedSchedule`；PUT 把「总开关 + 三榜开关 + 共用时间」
  展开成 7 行，顺序调 7 次设置命令（服务端无批量命令），任一行失败即停并报告是哪一行；成功后回读，以回读值返回。
- `server/internal/api/club_honor_rank_test.go`：7 行补齐/时钟归一、聚合（部分开启、时间漂移）、
  展开写（关榜保留时间、校验规则）、查询与单行设置命令编码。
- `server/internal/api/server.go`：4 条路由 `GET|PUT /api/game/{clubs|unions}/{id}/honor-rank`。
- `server/migrations/067_club_honor_rank.sql`：权限 `game.club_honor_rank.view` / `.manage`（挂 `game.clubs`）。
- `web/src/components/HonorRankModal.tsx`：总开关 / 三榜开关 / 起止时间 / 7 组奖励 / 原因 / 确认；
  7 行不一致时顶部提示「保存后统一」。
- `web/src/pages/ClubsPage.tsx`：行内「荣耀榜」（已入盟俱乐部禁用，提示去联盟配）。
- `web/src/pages/UnionsPage.tsx`：行内「荣耀榜」（联盟维度）。
- `web/src/types.ts`：`HonorRankState` / `HonorRankRow` / `HonorRankBoardSummary`。

客户端（Cocos）：
- `assets/scripts/UI/panelPaihangbang.ts`：`CLUB_CHANNELS` / `HALL_CHANNELS` 双通道，默认俱乐部榜；
  pending key 改 `榜|list/self`（三个俱乐部榜共用 `查询_俱乐部_活动_自己排名`）；
  俱乐部模式不读 `活动文本_*`、不请求领取、隐藏领取按钮；
  GC_FAILED 带业务文案（活动没有开启 / 活动未开始 / 无权查看）时显示原文，不再一律"加载失败"；
  命令不可用（`俱乐部功能未启用`/`命令不存在`/`未注册`）时整体回落全平台榜。
- `assets/scripts/common/LeaderboardScrollView.ts`：新增 `notice(text)`（空列表位置显示服务端文案）；
  赢分带符号格式化同时认 `ClubActivityUserScore`。
- 未改 Prefab。

## 验证结果

- `cd XuanManager/server && go build ./...` 通过；`go test ./internal/api/` 全绿（荣耀榜 8 个用例）。
- `cd XuanManager/web && npx tsc --noEmit` 通过。
- 客户端两个 ts 文件 `ts.transpileModule` 语法自检 0 诊断（本机无 Cocos 完整类型环境，未做类型检查）。

## 未完成 / 下一步

1. 服务端 v2.6 未部署（脚本与建表「本地完成」）：上线后 6 条榜单命令 + 2 条后台命令才能联调。
2. 后台**已部署到位**（2026-11-15 17:50 核对）：`bin/xuanmanager` sha256 `5352ea1f…` 与本地重编译一致，
   前端 `index-BuFYhlh_.js` 一致，迁移 `067` 于 17:36:01 应用，两条权限 enabled，进程 17:36 起、健康 200。
   剩下要做的只是用有 `game.club.dark_setting` 权限的账号实测开榜/关榜/改时间/改奖励。
3. 客户端未构建、未真机；构建后抽查三个页签与「活动未开始」文案。
4. 榜标题仍按 Prefab 原样（没有新增「俱乐部名/联盟名」标题节点，文档建议但非硬需求）。
5. 后台保存一次会向游戏服发 7 次设置命令，非原子；中途失败会提示具体哪一行，重开弹窗即可看到真实状态。
