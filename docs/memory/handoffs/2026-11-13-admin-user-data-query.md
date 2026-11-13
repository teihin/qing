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

## 2026-11-13 追加：额度变化记录 + 基本信息 / 代理链（已部署 8891）

用户要求：查询对象是大盟主或盟主时，额外显示「额度变化记录」；同一页面补充玩家基本信息，包括加入了哪些俱乐部、各自角色和代理链。

- **身份口径**：沿用客户端「我的 → 额度授权记录」入口——俱乐部创建者且俱乐部已入盟才显示额度页签。联盟创建者（`club_union_info.owner_guuid` = 创建者）标「大盟主」，其余已入盟创建者标「盟主」，未入盟创建者「群主」；`club_agent_info` 有行但 `club_invite_code_info` 无 used 邀请码的仍按普通成员，不标合伙人。
- **额度数据源**：`kbedm.club_history_info`，`opt_type LIKE '额度%' AND user_quota<>0`，`user_quota` 单位分 → 元；余额取 `remark` 尾段（`旧→新` 或纯余额）。类型映射：额度占用=带入、额度回补=结算、额度联盟授信=联盟授信、额度联盟注资=平台注资、额度奖励=平台奖励。V2 新流水 `opter_name` 常为空，查询时按 `opter_guuid` 关联 `tbl_Account.sm_name` 补全。
- **基本信息**：`tbl_Account` 增补账号角色、注册时间、客户端版本、`sm_union_manage` / `sm_club_manage`（大小 BOSS 管理范围）；`clubs[]` 增补联盟、直属上级、分成比例、当前额度（大盟主看联盟池 `club_union_info.union_quota`，盟主看 `club_guuid_info.union_quota`）和 `chain[]`。
- **代理链**：按玩家所在每个俱乐部独立组装，`club_agent_info.upper_guuid` 向上回溯到创建者，再追加联盟总群主；不含本人，已取消代理不在 `status='used'` 中会自动接到上级。
- **接口**：`GET /api/game/user-data/records?kind=quota`，非大盟主/盟主返回 403 `QUOTA_VISIBLE_DENIED`；`profile` 新增 `quotaVisible`、`role`、`regTime`、`clientVersion`、`manageUnions`、`manageClubs`、`clubs[].chain` 等字段。无新迁移、无新权限。

改动文件：

- `XuanManager/server/internal/api/user_data.go`：`userDataKindQuota`、身份/俱乐部/代理链装配、`queryUserDataQuota`、`userDataQuotaTypeLabel`。
- `XuanManager/server/internal/api/user_data_test.go`：额度类型映射与代理链组装单测。
- `XuanManager/web/src/pages/UserDataPage.tsx`：条件页签「额度变化记录」、基本信息与代理链面板、额度表格。
- `XuanManager/web/src/styles.css`：基本信息/俱乐部卡/代理链/角色标签样式，页签改自适应列数。
- `XuanManager/新后台管理系统接口文档.md` §4.5.5。

验证：

- 线上只读核对（2026-11-13）：`club_history_info` 实际额度类型为 `额度占用/额度回补/额度联盟授信/额度联盟注资/额度奖励`，`user_quota` 与 `remark` 格式符合预期；`club_union_info.owner_guuid` 与 `club_guuid_info.account_id` 可反查创建者；额度查询 SQL 与操作人补全联查实测通过。
- `go build ./... && go vet ./... && go test ./...` 通过；`npm run build` 与定向 eslint 通过。
- 已部署 8891：后端 `sha256 c3b81f4f…`（`backups/xuanmanager.20261113-2244-rollback`，原始 `b6d68684…`）；前端 `index-BlT_8jCE.js` + `index-CLlbA0eV.css`（`web.previous-userdata-20261113-2244`）。health 200、未登录 records 401、线上 JS/CSS 200 且命中「额度变化记录」「基本信息与代理链」。

未验证：未登录正式后台做页面视觉与交互验收；额度页大盟主联盟池侧行与盟主俱乐部行的展示口径需用真实账号核对。

## 下一步

1. 用大盟主（如 895742）和盟主（如 529749）账号在后台查看基本信息、代理链和额度变化页签。
2. 若额度页数据为空，先确认该玩家是否已入盟且为俱乐部创建者，再核对日期范围。
3. 观察大俱乐部（代理行较多）打开玩家信息时的耗时，必要时只加载所在俱乐部的代理链。

