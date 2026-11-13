# 2026-11-13 后台「用户端数据查询」

## 目录 / 分支

- 项目根：`/Volumes/SSD/qing`
- 分支：`codex/club-ui`
- 工作区另有 `assets/resources/project.manifest`、`version.manifest` 及一份改动整理文档未提交；本次未触碰。

## 目标

后台「游戏管理」新增「用户端数据查询」：输入游戏用户ID，在同一页查询客户端「我的」里能看到的全部明细：

1. 上下分记录
2. 赠送金币
3. 金币流向
4. 钻石流向
5. 我的收益红利详情

## 接口口径（依据 `服务器文档整理` 客户端接口文档）

| 页签 | 客户端命令 / 文档 | 后台数据源 |
| --- | --- | --- |
| 上下分记录 | `查询_俱乐部_成员_积分_添加_记录` / 积分流水 §11.1 | `kbedm.club_history_info`，`opt_type='添加积分'`，`user_gold` 整数元，正=上分、负=下分；`remark`=变动后余额 |
| 赠送金币 | `查询_俱乐部_积分流水` + `only_add=1` | `club_history_info`，`opt_type IN ('积分赠送','积分受赠')` |
| 金币流向 | `查询_玩家_现金流水`（§3.8） | `usr_cash_water`，`money_type='gold' AND add_money<>0`，变化=`new_money-old_money` |
| 钻石流向 | `查询_玩家_钻石流水`（§3.9） | `usr_cash_water`，`money_type='stone' AND add_money<>0` |
| 收益红利 | `查询_俱乐部_红利_明细` → `ClubBonusList`（V2 §9.2） | `usr_income_info`，`remark1`=收益归属账号；`contrib=tax_number/100`、`bonus=(tax_number-bonus_tax_number)/100`；排除 `clubtotal` 对账基线 |

- 金币/钻石流水后台不套客户端「最近 8 天 + 类型白名单」，运营用日期和关键字自行收窄。
- 红利明细保留 `unionroot`（联盟上缴）和 `darkroot`（创建者暗抽），便于运营核对全部入账；客户端代理红利页会排除 `unionroot`。
- `club_history_info` 的时间列布局做了自适应：`date` 是 DATETIME 直接用；若 `date` 是 DATE 且存在独立 `time` 列，则拼接后输出（首次查询探测 information_schema 并缓存）。
- 俱乐部名称按页面行的 `club_guuid` 批量补全；红利的 `proxy_guuid='club-<id>'` 拆出俱乐部号。

## 改动文件

新增：

- `XuanManager/server/migrations/061_user_data_query.sql`
  - 模块 `game.user_data`（游戏管理下，sort 15）、权限 `game.user_data.view`；按拥有 `game.player.view` 的角色批量授权，并授权超级管理员角色。
- `XuanManager/server/internal/api/user_data.go`
  - `handleUserDataProfile` / `handleUserDataRecords`；五类查询、汇总、分页、关键字、日期校验（默认 7 天、最多 31 天）。
- `XuanManager/web/src/pages/UserDataPage.tsx`
  - 玩家搜索、账号概览、五页签、日期/关键字筛选、汇总卡、分页、各页签表格。
- `docs/memory/handoffs/2026-11-13-admin-user-data-query.md`（本文件）。

修改：

- `XuanManager/server/internal/api/server.go`
  - 注册 `GET /api/game/user-data/profile|records`，权限 `game.user_data.view`。
  - `Server` 增加 `club_history_info` 时间列探测缓存字段。
- `XuanManager/web/src/App.tsx`：注册 `/game/user-data` 路由。
- `XuanManager/web/src/components/Layout.tsx`：菜单图标 `user-data` → 「查」。
- `XuanManager/web/src/styles.css`：新增用户端数据查询样式（搜索区、页签、筛选、表格、响应式）。
- `XuanManager/新后台管理系统接口文档.md`：新增 §4.5.5。
- `docs/memory/CURRENT.md`：新增 2026-11-13 条目。

## 验证

- `cd XuanManager/server && gofmt && go build ./... && go vet ./... && go test ./...`：通过。
- `cd XuanManager/web && npm run build`：通过（tsc + vite）。
- `npx eslint src/pages/UserDataPage.tsx src/App.tsx src/components/Layout.tsx`：通过。

## 未验证 / 风险

1. **未部署 8891、未跑迁移 061**；未登录正式后台做页面实操。
2. **未连正式库核对字段/索引**：`club_history_info.user_gold`、`date/time` 布局、`user_guuid` 索引，`usr_income_info.remark1` 的收益归属语义均来自文档与历史直连记录；时间列已做自适应，其余字段若线上布局不同需按实际调整。
3. `club_history_info` 按 `user_guuid + date` 查询的性能未实测；若表很大且缺索引，需要加日期约束或改按俱乐部索引查询。
4. 金币流水后台展示全部 `money_type='gold'` 行，和客户端「最近 8 天 + 服务端类型白名单」不完全一致；如需严格对齐客户端，需要补类型白名单。
5. 收益红利今日/昨日统计按 `usr_income_info.date` 与 `remark1` 汇总，排除 `clubtotal`；与客户端按俱乐部范围的统计可能因跨俱乐部/联盟上缴行而不同。
6. 前端未在浏览器中登录验收；仅构建与静态检查通过。

## 下一步

1. 在候选/正式环境执行迁移 061，确认新菜单和权限出现在对应角色下。
2. 用真实玩家 ID 逐页核对五类明细与客户端显示是否一致（尤其上下分 `user_gold` 符号、赠送双行、红利层级）。
3. 观察 `club_history_info` 查询耗时，必要时补日期/用户索引或改为按俱乐部维度查询。
4. 验收通过后再按授权决定是否部署 8891。
