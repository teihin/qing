# 业绩核心共享：改为按联盟发放（已部署）

日期：2026-11-11　分支：`codex/club-ui`（未提交）　部署：2026-11-11 00:45 正式 8891

## 目标

用户反馈：原来「业绩核心共享」可以把所有代理/盟主加进同一张单子，应该以联盟为单位发放。
入口先列联盟，点进某个联盟后才进入发放页；添加代理、名单方案、金额、发放、账单都只能围绕当前联盟，
不能跨联盟选人。

## 改动文件

| 文件 | 说明 |
| --- | --- |
| `XuanManager/server/migrations/055_agent_reward_union_scope.sql` | 计划表加 `union_id`，唯一键改 `(reward_date, kind, union_id)`；名单方案加 `union_id`，唯一键改 `(union_id, name)`；按历史成员回填 |
| `XuanManager/server/internal/api/agent_rewards.go` | 新增联盟列表接口；概览/汇总/候选/选择/名单方案/金额/分摊/发放/排除/子账号/账单/线数据全部带 `unionId` 并校验 |
| `XuanManager/server/internal/api/server.go` | 注册 `GET /api/game/agent-rewards/unions` |
| `XuanManager/server/internal/api/agent_rewards_test.go` | 新增 `normalizeRewardUnionID` 空值/格式断言 |
| `XuanManager/web/src/pages/AgentRewardsPage.tsx` | 联盟列表入口 + 联盟内发放页；所有请求带 `unionId`，移除跨联盟筛选 |

## 关键实现

- **入口**：`#/game/agent-rewards` 显示联盟列表（联盟名、联盟码、代理数、名单人数、三类奖励当日进度），
  点击写入 `#/game/agent-rewards?unionId=...&unionName=...`；进入后用「← 联盟列表」返回。
  刷新页面仍停留在当前联盟。
- **数据隔离**：`mgr_agent_reward_member` 本身有 `union_id`，名单/排除/线数据按联盟过滤；
  计划和名单方案新增 `union_id`，不同联盟各自一份计划与模板（同名模板可跨联盟共存）。
- **跨联盟阻断**：
  - 候选池只查当前联盟；
  - 批量选择先校验每个 ID 是否属于当前联盟，跨联盟直接 400 `CROSS_UNION`；
  - 按 ID 手工加入时从游戏库重新读账号所属联盟，不属于当前联盟或未入盟直接拒绝；
  - 保存金额、排除、子账号、账单、线数据同样校验联盟归属。
- **换联盟自动移出名单**：每日同步更新 `union_id` 时，如果代理换了联盟，`selected` 置 0，
  必须在新联盟重新加入，避免自动出现在新联盟的发放单里。
- **历史数据**：迁移按计划/方案里的成员所属联盟回填；无法归属的历史行保留 `union_id=''`，
  不会出现在联盟列表，但发放账单仍可按日期 + 联盟查历史（未归属行的账单不再从联盟页进入）。

## 验证

已做：

- `go build ./...`、`go vet ./internal/api/`、`go test ./internal/api/` 全过。
- `tsc -b`、`eslint src`、`vite build` 全过。
- 已部署正式 8891：二进制 `0c558b2867651d3f370f427789a4fb1ef36aaadee038747c8be86a366080f492`（10,297,528 字节，`-trimpath -ldflags="-s -w"`）；前端 `index-BDfIIHx6.js`（872,732 字节，与本地 dist 一致），CSS 保持 `index-CFM-KCyg.css`。
- 迁移 055 启动时自动执行：`mgr_schema_migration` 已记录；计划表/名单方案 `union_id` 列与唯一键存在。回填结果：7 份计划有联盟、9 份保留空联盟；名单方案 0 份；29 个在册代理有联盟、2 个无联盟。
- health 200；`GET /api/game/agent-rewards/unions` 未登录 401（路由已生效）；正式进程 00:45:30 启动后稳定；8890/8891/8893 端口正常。
- 回滚点：二进制 `backups/xuanmanager.20261111-0045-rollback`，前端 `web.previous-agent-reward-union-20261111-0045`。

未做：

- 未登录后台做页面实操验收；未点开三个联盟核对名单、方案、计划与发放的完整交互。
- 未执行真实发放或金额保存。

## 边界

- 未改分摊/发放算法、发钱通道、排除规则和子账号拆分逻辑。
- 奖池共享的「今日奖池 50%」仍是平台级奖池，各联盟各自设置共享比例与计划总额；
  这次只改「人从哪个联盟来」，没有改奖池基数口径。
