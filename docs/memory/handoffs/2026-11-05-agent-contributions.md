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
- 2026-11-05 21:49 读侧改造重新部署：后台新增批量 `POST .../display-data`，表格展示值优先取游戏服。二进制 `5becd5f6…`，前端 `index-v9lhT86m.js`，健康 200、公网 200、新路由未登录 401。
- 2026-11-05 21:56 按最新接口改用统一异步命名：`异步_查询_俱乐部_成员`、`异步_查询_代理_展示数据`（实测均 `ret_code=512`，成员行带真实贡献和 `*_contrib_display_fen`，展示数据带 `self/team`）；旧 `查询_俱乐部_成员` 已不在二进制中（grep 0）。二进制 `05e1145a…`，健康 200。
- 2026-11-05 22:15 前端 `api.ts` 增加接口错误控制台日志：网络异常、非 JSON、HTTP/业务错误统一输出 `[XuanManager API]`，包含方法/路径/状态码/错误码/脱敏请求体/回包；部署 `index-CdsfPdNJ.js`，备份 `web.previous-api-error-console-20261105`，健康/公网 200。
- 2026-11-05 22:25 增加启动日志 `[XuanManager API] 接口错误日志已启用 build=2026-11-05.3`，便于确认浏览器是否加载新包；部署 `index-Cg7BfrxD.js`，备份 `web.previous-api-log-build-20261105`，健康/公网 200。
- 2026-11-05 22:40 修复页面红色「代理不存在」：展示数据批量接口只对代理/群主调用（玩家行不传），避免玩家被当成代理返回软提示；展示数据/成员数据的软提示和失败项也输出 `[XuanManager API]` 到控制台。部署 `index-8TItF57P.js`，备份 `web.previous-player-display-filter-20261105`，健康/公网 200。
- 2026-11-05 22:55 全量日志：前端 `api.ts` 对每个 XuanManager 请求/返回输出 `[XuanManager API] 请求/返回`（请求体脱敏，`localStorage.xuan.api.logAll=0` 可关闭）；后端 `callGameCommand` 对每个 `/hall/command` 输出 `game command request/response`（header、param、ret_code、ret_result 截断 8000、密码类字段脱敏，`XUAN_LOG_GAME_COMMANDS=0` 可关闭）。二进制 `d2ce172f…`、前端 `index-s3UYL9A0.js`，备份 `backups/xuanmanager.20261105-2255-rollback`、`web.previous-all-request-logging-20261105`，健康/公网 200。
- 2026-11-05 23:10 按 KBE 指引修复盟主虚拟行「代理不存在」：成员行补 `club_id`、`is_leader`；`/display-data` 改为 `{items:[{agentId,clubId}]}`，每个展示查询和规则设置都用该行自己的俱乐部（盟主虚拟行用盟主自己的俱乐部），不再统一用父俱乐部。前端 build 标记 `2026-11-05.5`，部署 `index-BeqDGF-K.js`，备份 `web.previous-row-club-display-20261105`；后端二进制 `9dc52d9a…`，备份 `backups/xuanmanager.20261105-2310-rollback`；健康/公网 200。
- 2026-11-05 23:45 按新文档 `俱乐部成员与代理展示-后台接口文档.md` 接入 `show_type`：联盟级用 `union`、俱乐部级用 `member`、展开统一 `member`；左侧联盟和俱乐部都可点击；成员查询 `count` 上限 500；表格补齐客户端成员列表字段（今日/昨日/总输赢、今日/昨日/总贡献、团队人数、积分、比例、额度、在线、备注、真实/展示）。二进制 `73df0ff8…`、前端 `index-CtmCFCo9.js` / `index-DBtFaJRb.css`（build .6），备份 `backups/xuanmanager.20261105-2345-rollback`、`web.previous-scope-note-20261105`，健康/公网 200。规则弹窗已标注 KBE 当前仅支持全局展示规则。
- 2026-11-05 23:55 懒加载：俱乐部级初始只查根节点（`selfOnly=1` → 游戏服 `user_id=<根ID>`），默认折叠；展开时才用 `agent_id + user_id=ALL` 查下一级。联盟级首屏只查盟主虚拟行，同样折叠。二进制 `960a3221…`、前端 `index-Bp-MO-Mr.js`（build .7），备份 `backups/xuanmanager.20261105-2355-rollback`、`web.previous-lazy-expand-20261105`，健康/公网 200。
- 2026-11-06 00:05 输赢数值按客户端配色（正数 `#ff5c50` 红、负数 `#97d339` 绿）；「输赢」「贡献」两组增加分组竖线、组头和淡底色，数字列居中。前端 `index-5KmxDTRk.js` / `index-Cswil8MS.css`（build .8），备份 `web.previous-score-colors-20261105`，健康/公网 200。
- 2026-11-06 00:20 查询结果增加俱乐部名：成员行带 `club_id`/`club_name`；后台按每行 `club_id` 批量查 `kbedm.club_guuid_info` 补名称（fallback 用俱乐部详情名）；表格新增「所属俱乐部」列（名称 + 俱乐部 ID），分组列索引顺延。二进制 `81e57393…`、前端 `index-DwW-LejO.js` / `index-BydiZbCO.css`（build .9），备份 `backups/xuanmanager.20261106-0020-rollback`、`web.previous-club-name-20261105`，健康/公网 200。
- 2026-11-06 00:35 修复规则保存 400：前端 PUT `/rule` 漏了 `?metric=`，后台只从 query 读 metric，导致 `INVALID_METRIC`；已补 query 并部署 `index-DcuJD9nI.js`（build .10），备份 `web.previous-rule-put-metric-20261106`。KBE 未提供代理级写命令，保存仍会返回 `0x301`。
- 2026-11-06 00:50 日志可读化：后端输出 `[游戏服调用] GET /hall/command | 命令 | 参数` 和 `[游戏服返回] ... | HTTP | ret_code | ret_result | 耗时`，非 512 用 Warn；错误文案改为「游戏服命令 X 返回 769 (0x301)，接口未注册或暂未开放」。前端改为单行 `[XuanManager API] 请求/返回/失败 METHOD PATH HTTP ...` 再带展开对象。二进制 `50ec029f…`、前端 `index-DdM1uTrz.js`（build .11），备份 `backups/xuanmanager.20261106-0050-rollback`、`web.previous-readable-logs-20261106`，健康/公网 200。
- 2026-11-06 01:05 左侧「未入盟俱乐部」改为「普通俱乐部」，不再显示 `_none_`，图标改为「普」；点击仍展示其下俱乐部。前端 `index-I30GFwGz.js`（build .12），备份 `web.previous-normal-club-label-20261106`，健康/公网 200。
- 2026-11-06 01:20 左侧新增联盟/俱乐部搜索：输入名称后 300ms 防抖，同时查 `/api/game/unions?keyword=` 和 `/api/game/clubs?keyword=`，分别列出匹配联盟和俱乐部；点击结果直接切换联盟/俱乐部范围。切换联盟时不再清掉搜索选中的俱乐部。前端 `index-ChhIvpVw.js` / `index-BZ1sXNBB.css`（build .13），备份 `web.previous-union-club-search-20261106`，健康/公网 200。
- 2026-11-06 01:40 表格第一列「代理 / 玩家」和最后一列「操作」改成横向滚动固定列，使用 `position: sticky` + 左右分隔阴影，表头同步固定。前端 `index-DoyDXsX2.js` / `index-y0i9NyFX.css`（build .14），备份 `web.previous-sticky-columns-20261106`，健康/公网 200。
- 2026-11-06 01:30 按最新详细方案收敛为**每个代理一份 `show_percent`**：只支持 percent 0~100，只影响贡献类字段，输赢不缩放；去掉固定差额、输赢规则、继承/恢复继承；恢复真实改为设置 100。后台从 `club_agent_info.show_percent` 批量补每行 `showPercent`；弹窗改为单个比例；表格规则列显示每行比例 + 输赢不缩放。二进制 `317e8858…`、前端 `index-Bi1uZfej.js` / `index-BwP4zcnd.css`（build .15），备份 `backups/xuanmanager.20261106-0130-rollback`、`web.previous-per-agent-percent-20261106`，健康/公网 200。
- 2026-11-06 00:50 按最新文档（00:46）改为**成员列表输赢也缩放**：成员行新增 `today/yesterday/total_score_display`，后台按行映射 `*_score_display`；`异步_查询_代理_展示数据` 的 `team_display` 输赢同样已缩放，前端团队行优先取 `team_display`。表格「输赢」列改为真实/展示两行（正数红、负数绿），表头「输赢（真实 / 展示）」，规则标签贡献与输赢都显示比例；弹窗预览同时显示贡献与输赢。后端 `agentContributionNode` 增加 3 个 score display 字段，测试同步。二进制 `f6264a3e…`、前端 `index-vYAvuawm.js` / `index-BwP4zcnd.css`（build .16），备份 `backups/xuanmanager.20261106-0050-rollback`、`web.previous-score-display-20261106-0050`；健康/公网 200、端口 8890/8891/8893 正常。
- 2026-11-06 01:00 按最新文档补继承口径并部署：`查询_代理_展示规则` 同时解析自身 `agent_income_show_percent` 与 `effective_show_percent`；弹窗打开时回读自身值（输入框）和生效值（摘要），保存成功后关闭弹窗；设置命令补 `metric`；玩家行不显示「设置规则」按钮（仅群主/盟主/代理/合伙人可设）。前端 `index-CrLCEEWT.js` / `index-D7eUTZUl.css`（build .19），后端 `3516d9a1…`（含 `effective_show_percent`），备份 `backups/xuanmanager.20261106-0100-rollback`、`web.previous-rule-inherit-20261106-0100`；健康/公网 200、端口正常。
- 2026-11-06 01:07 规则列区分来源：后台用成员行 `show_percent`（生效值）对比 `club_agent_info.show_percent`（自己的值），新增 `ownShowPercent` / `showPercentSource`（self/inherit/default）；表格显示「贡献 · 自设 80% / 继承 80% / 未设置 100%」，保存后该行立即变「自设」；新增 `TestShowPercentSource`。前端 `index-Clo215qL.js`（build .20）、后端 `b8dad60e…`，备份 `backups/xuanmanager.20261106-0107-rollback`、`web.previous-percent-source-20261106-0107`；健康/公网 200。
- 2026-11-06 01:11 规则列样式区分：自己设置过的显示黄色「贡献 80%（设置）」，继承/未设置显示灰色「贡献 80%」（输赢同理）；前端 `index-vIOviZTr.js` / `index-Dq24wEA0.css`（build .21），备份 `web.previous-rule-style-20261106-0111`；健康/公网 200。
- 最新详细方案已废弃“全局一份”；`代理收益客户端展示折扣方案.md`（00:08）按代理一份，另两份旧文档仍写全局，需后续同步。
- 回滚备份：`backups/xuanmanager.20261105-2037-rollback`、`web.previous-agent-contributions-20261105`、`backups/xuanmanager.20261105-2148-rollback`、`web.previous-agent-contributions-read-20261105`、`backups/xuanmanager.20261105-2205-rollback`。
- 权限目前只授予 `super_admin`（与线上 `game.club.view`/`game.union.view` 的现有授予范围一致）；其他角色需在角色管理里勾选。

## 未验证 / 待联调

1. **最新方案支持自身设置 + 上级继承**：`设置_代理_展示规则` 实测仅 percent，`mode=fixed` 返回 `769：mode 仅支持 percent`，`percent=101` 返回范围错误；没有“整线一键覆盖/取消继承（恢复继承）”和固定差额；贡献与输赢都按生效 `show_percent` 缩放，积分、人数、比例不缩放。后台已按这个口径收敛。
2. **客户端模拟标记仍缺字段**：最新方案没有下发“模拟/折扣”标记，客户端无法判断展示值；`NumberList` 成员行也不带 `show_percent`，后台已改为读 `club_agent_info.show_percent` 补。
3. 后台登录态页面、真实联盟/俱乐部的实际数据；没有管理员凭据，未做登录后的点击验收。
4. Cocos Creator 导入、构建、真机与真实回包未验证。

## 下一步

1. 用真实管理员账号设置一个测试代理的 percent（如 80），核对后台比例、贡献展示值和客户端贡献；固定差额/输赢/整线继承已不再支持。
2. 与服务端确认是否还要补：整线继承/取消、固定差额、输赢缩放、客户端模拟标记；不补则维持当前按代理 percent 口径。
3. 同步更新仍写“全局一份”的两份旧文档。
4. 客户端 Creator 导入、构建、真机验证。
