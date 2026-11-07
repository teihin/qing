# 2026-11-07 后台代理贡献管理：暗抽比例列 + 暗抽比例调整（已部署）

- 目录：`/Volumes/SSD/qing`；分支 `codex/club-ui`；改动未提交（与其他在途改动同工作区）。
- 目标：`异步_查询_代理_展示数据` 新返回顶层 `bonus_dark_percent`，后台列表展示为「暗抽比例」，并提供逐个代理调整入口。

## 改动文件

- `XuanManager/server/internal/api/agent_contributions.go`
  - 成员节点新增 `bonusDarkPercent`（映射行级 `bonus_dark_percent`，`-1`=代理树未加载）。
  - 展示数据新增 `bonusDarkPercent`（顶层 `bonus_dark_percent`，`intPointerField`）。
  - 新增 `GET/PUT /api/game/agent-contributions/clubs/{clubId}/agents/{agentId}/bonus-dark`；底层命令 `设置_俱乐部_代理_红利暗抽`（不带比例=只读回显，带比例=写库），PUT 校验 0~100 整数 + 原因 2~200 字，写 `mgr_audit_log`。
- `XuanManager/server/internal/api/server.go`：注册上述两条路由（GET 用 `game.agent_contribution.view`，PUT 用 `game.agent_contribution.adjust`）。
- `XuanManager/server/internal/api/agent_contributions_test.go`：新增 3 个测试（透传、只读回显不带比例参数、PUT 入参校验）。
- `XuanManager/web/src/types.ts`、`pages/AgentContributionsPage.tsx`、`styles.css`：贡献组后新增「暗抽比例」列；操作列「展示调整」后新增「暗抽比例调整」按钮与弹窗（读当前值→保存/设为 0%）；表格 `min-width` 2000→2100，空行 `colSpan` 16→17。

## 游戏服命令口径（此前无文档，实测确认）

`设置_俱乐部_代理_红利暗抽`：

- 参数 `club_id`（必填）、`user_id`（目标代理，空=创建者）、`bonus_dark_percent`（也接受 `percent`；**不传即只读**）、`context`。
- 只读回包：`{"club_id","agent_id","user_id","bonus_dark_percent":"0","context"}`，不写库（已用 `club_agent_info` 前后比对确认）。
- 写库位置：`club_agent_info.bonus_dark_percent`（int，NULL/0 = 不暗抽），按 club+agent 一份。
- 校验顺序：俱乐部存在 → 代理存在 → 比例必须是整数；非整数回 `769 {"error":"红利暗抽比例必须是整数"}`。
- 未实测上限值（未用真实代理试探 100 以上），后台与前端都按 0~100 限制。`dark_percent` 参数被忽略，与房间暗抽 `设置_俱乐部_代理_暗抽`（0~20）是两条独立配置。

## 验证

- `go vet ./...`、`go test ./...` 通过；`eslint src`、`tsc -b`、`vite build` 通过。
- 线上实测：展示数据已返回 `bonus_dark_percent`；成员行也带 `bonus_dark_percent`（同俱乐部 `dark_percent` 为 `-1` 时仍给 0~100）。
- 19:07 部署：二进制 `d8f6677b…`（回滚 `backups/xuanmanager.20261107-1907-rollback`），前端 `index-Dk2KU1jc.js` + `index-D9kgAfEm.css`（回滚 `web.previous-bonus-dark-20261107-1907`）。
- 部署后：health 200；`/assets/index-Dk2KU1jc.js` 200 且含「暗抽比例调整」；新路由未登录 401、伪造路径 404；8890/8891 均在监听。

## 未完成 / 待验

- 登录态页面目视与真实保存（会写生产 `club_agent_info.bonus_dark_percent`）待主人验证。
- 游戏服该命令上限（是否允许 >100、是否支持清空为 NULL）未验证；当前用 0 表示不暗抽。
- 服务器文档 `服务器文档整理/俱乐部成员与代理展示-后台接口文档.md` 只写了查询侧 `bonus_dark_percent`，设置命令仍缺章节；本文件先记录口径。
