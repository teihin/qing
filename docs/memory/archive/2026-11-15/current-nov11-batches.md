# qing 当前状态归档：2026-11-11 批次

> 从 `docs/memory/CURRENT.md` 移出（2026-11-15，为控制入口体积）。内容为当时的记录，未再核实。

## 2026-11-11 牌桌「带入积分」V10（未构建、未真机）

- `panelGameView.prefab` / `drh8.fire` 重做 V10 并接入钻石扣费；Creator、构建、真机、回包待验。详见[交接](../handoffs/2026-11-11-buyin-points-v9.md)。

## 2026-11-11 我的红利：新增「业绩股」页签（2026-11-12 按 v6 联盟树改造）

- 双页签，非业绩股成员只隐藏「业绩股」（判断 `ClubPerfInfo.enabled`）；v6 渲染 `leaders`，盟主只授权不取消；服务端需部署后有 `scope`/`leaders`。详见[交接](../handoffs/2026-11-11-my-hongli-perf-tab.md)。

## 2026-11-11 后台业绩核心共享：改为按联盟发放（已部署）

- 入口先列联盟，名单/方案/金额/发放/账单按当前联盟过滤；迁移 055 加 `union_id` 并回填，跨联盟选人由后端拒绝。
- 已部署 8891；`go build/test/vet`、前端构建通过，登录态未验。详见[交接](../handoffs/2026-11-11-agent-reward-union-scope.md)。

## 2026-11-11 玩家信息卡片（未构建、未真机）

- `panelUserInfo` 统计区改为两排三列蓝卡：上排总手数/总胜率/摊牌率，下排胜利/平局/失败；沿用 `remark[3]`。
- 统计框调整、道具下移并补 Widget；TS、引用、1334/1624 预览通过，构建/真机/联调待验。详见[交接](../handoffs/2026-11-11-userinfo-stats-layout.md)。
