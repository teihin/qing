# 代理贡献管理（后台 + 客户端）交接

日期：2026-11-05
目录：`/Volumes/SSD/qing`，分支 `codex/club-ui`
范围：本轮只改 XuanManager 后台和 Cocos 客户端；KBE 由用户侧按接口契约处理。

## 目标

- 后台新增「代理贡献管理」：联盟 → 俱乐部 → 代理/玩家逐层展开，显示真实总贡献、真实总输赢；支持按指标设置比例或固定差额、覆盖下级、恢复上级继承。
- 客户端成员列表展示 KBE 返回的展示值，并在总贡献/总输赢后加 `*`，统计栏提示“模拟展示，不代表真实账目”。

## 实现

### 后台

- 新增 `XuanManager/server/internal/api/agent_contributions.go`
  - `GET /api/game/agent-contributions/clubs/{clubId}/members`：调用 `查询_俱乐部_成员`，后台以 boss 身份获取真实值；游戏服未返回时回退到俱乐部关系树，统计留空并提示。
  - `GET/PUT/DELETE /api/game/agent-contributions/clubs/{clubId}/agents/{agentId}/rule`：查询/设置/取消展示规则。
  - 规则命令常量：`查询_代理_展示规则`、`设置_代理_展示规则`、`取消_代理_展示规则`。
  - 设置/取消写 `mgr_audit_log`，动作 `game.agent_contribution.adjust`。
- `server.go` 注册上述路由。
- `migrations/045_agent_contributions.sql`：新增模块 `game.agent_contributions`、权限 `game.agent_contribution.view/adjust`，默认授予有 `game.club.view` 的角色和超级管理员。
- 前端：
  - `AgentContributionsPage.tsx`：联盟/俱乐部左树（含「未入盟俱乐部」分组）+ 右侧代理树，逐层展开；真实贡献/输赢、展示预览、规则标签、设置弹窗、恢复继承。
  - `App.tsx`、`Layout.tsx`、`types.ts`、`styles.css` 接入路由/菜单/类型/样式。

### 客户端

- `ClubManagementApi.ts`：新增 `optionalSimFlags`，兼容多种 KBE 模拟标记字段；只识别标记，不做金额换算。
- `ClubManagementView.ts`：总贡献/总输赢值后加 `*`；列表统计栏显示“含模拟*”；首次出现时弹一次“带 * 的数据为模拟展示，不代表真实账目”。

### 文档

- `服务器文档整理/代理贡献管理-客户端与后台接口文档.md`：读取接口、规则命令、后台路由、客户端标记字段和验收用例。

## 已验证

- `go test ./internal/api` 通过；`go vet ./internal/api` 无输出。
- `npm run build`、`npm run lint`（XuanManager/web）通过。
- 客户端 `ClubManagementApi.ts`、`ClubManagementView.ts` `ts.transpileModule` 无语法诊断；全项目 tsc 仅剩既有 `require`、Widget、旧联合类型等历史错误，无本次新增错误。
- `git diff --check` 通过。
- 2026-11-05 20:37 已部署正式 8891：二进制 `72d59835…`，前端 `index-BvClN7Hq.js` / `index-B23WNhMG.css`；启动时自动执行迁移 `045_agent_contributions.sql`（20:37:45），模块/权限行已入库；健康 200、公网 `/xuanmanager/` 200、新路由未登录 401；端口 8890 游戏、8891 xuanmanager、8893 chattool。
- 回滚备份：`backups/xuanmanager.20261105-2037-rollback`、`web.previous-agent-contributions-20261105`。
- 权限目前只授予 `super_admin`（与线上 `game.club.view`/`game.union.view` 的现有授予范围一致）；其他角色需在角色管理里勾选。

## 未验证 / 待联调

1. **KBE 接口未就绪（2026-11-05 20:40 实测 8890）**：
   - 后台调用 `查询_俱乐部_成员`（club 984470 / owner 430994）仍返回 `ret_code=1280`（0x500，只推送、无 `ret_result` 数据），试过 `xuan-*`/`admin-get` context、`raw/is_admin/view/client_type/boss` 参数均无变化。
   - `查询_代理_展示规则`、`查询_代理_展示数据`、`查询_俱乐部_成员_展示` 均返回 `ret_code=769`（0x301，命令未注册/不可用）。
   - 因此后台页面目前只能回退显示俱乐部关系树，统计为 `—`；保存规则会收到游戏服失败；客户端不会变值。
   - 需要 KBE 提供：后台可读的成员真实数据（`ret_result` 或专用命令）、规则查询/设置/取消命令、客户端模拟标记字段。
2. 后台登录态页面、真实联盟/俱乐部的实际数据；没有管理员凭据，未做登录后的点击验收。
3. Cocos Creator 导入、构建、真机与真实回包未验证；客户端尚未构建/发布。

## 下一步

1. 与 KBE 对齐命令名和 `NumberList` 规则/标记字段。
2. 执行迁移并部署 XuanManager（需用户明确授权）。
3. 用真实管理员账号验证逐层展开、比例/固定差额、覆盖/恢复继承。
4. 客户端 Creator 导入、构建、真机验证 `*` 和统计栏提示。
