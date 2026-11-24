# 2026-11-24 用户端数据查询：支持登录ID / 昵称定位 + 代理链显示各级比例（已上测试服）

## 目录 / 分支

- 项目根：`/Volumes/SSD/qing`，分支 `codex/club-ui`。
- 只改 XuanManager（后端 + 前端 + 接口文档）；**只部署测试服 `154.37.155.17`，正式服 `8.153.70.197` 未动**。
- 未提交、未推送（工作区另有他人未提交的 `panelMain.ts` / `panelQuotaGrantRecord.ts` / `GameDef.ts` 与客服上分那批改动）。

## 目标

后台「游戏管理 → 用户端数据查询」两件事：

1. 搜索框原来只认游戏用户ID（页面文案还写着「不接受昵称代替用户ID」），现在要能按**登录ID**和**名字（昵称）**查；
2. 查出来的**代理链每一级要显示代理比例**（现在看不到）。

## 结论 / 改动

### 后端 `XuanManager/server/internal/api/user_data.go`

- 新增 `GET /api/game/user-data/lookup?keyword=`（权限沿用 `game.user_data.view`，路线注册在 `server.go` provider 段）。返回 `{items:[{playerId,name,loginName,accountName,role}], total}`，最多 20 条。
- 匹配口径：`sm_guuid`（含靓号 `usr_pretty_no_info.pretty_no`，表不存在时自动跳过）与登录ID（`sm_wxID` / `kbe_accountinfos.accountName`）**精确**；`sm_name` **模糊** `LIKE`。排序把精确命中排前，其余按 `a.id DESC`。
- `keyword` 必填、≤50 字，超限 400 `INVALID_KEYWORD`。
- 代理链的 `percent` 原本就在响应里（`club_agent_info.percent`），这次只是前端没渲染——**后端口径未改**。

### 前端 `XuanManager/web/src/pages/UserDataPage.tsx`

- 搜索框改为「先定位玩家」：提交 → `lookup`；命中 1 条直接进详情，多条先出候选表（昵称/游戏ID/登录ID/账号角色 + 「查看明细」），0 条给明确提示。
- 文案同步：标题说明、STEP 01、placeholder（`292989 / aa111333 / 测试四号选手`）、搜索框前缀 `查`。
- 代理链：每级节点 `角色 · 比例 X%`，`percent > 0` 才显示；**本人节点按「创建者 / 有 used 邀请码的代理 / percent>0」判定**，是代理就显示 `本人 · X%`（percent 为 0 也显示 `0%`，不留空白），与上方「分成比例」字段共用 `hasClubPercent()` 一个口径。
- `profile` effect 依赖加 `reloadKey`，重复搜索同一个 ID 也会重新拉取。

### 接口文档

`XuanManager/新后台管理系统接口文档.md` §4.5.5 补 `lookup` 接口、示例响应和 `chain[].percent` 口径说明。

## 验证

- `go build ./...`、`go vet ./internal/api/`、`go test ./internal/api/ -run UserData`（新增 `TestHandleUserDataLookupRejectsEmptyKeyword`）通过；`npx tsc --noEmit`、`npm run lint`、`npm run build` 通过。
- 测试服直连 SQL 复核匹配口径：`keyword=1018888`（登录ID）→ `981149 测试2号选手`；`keyword=测试四` → `327553 测试四号选手`。
- 代理链数据抽样（club `248166`）：`735443 → 981149(50%) → 975597(100%)`，符合预期。
- 部署：二进制 `0cae7ee7…`（备份旧 `1cdd9f52…`）、前端 `index-BJvnC5L-.js` / `index-BZMncE-w.css`；`/api/health` 200、公网 `/xuanmanager/` 200 且引用新 bundle、`/xuanmanager/api/game/user-data/lookup` 未登录 401（= 路由已注册，非 404）。
- 18:45 追加（用户要求「本人是代理也要显示本人比例」）：只改前端，本人比例改为 `hasClubPercent()` 判定后重新构建为 `index-DXrkHR86.js` 并替换 web 目录（后端二进制未动、未重启），公网页 200、新 bundle 200；回滚点 `web.previous-selfchain-20261124-1845/`。
- 回滚点：`/www/html/.xuanmanager/backups/xuanmanager.userdata-lookup-20261124-1839-rollback` + `web.previous-userdata-lookup-20261124-1839/`。回滚 = `stop.sh` → 还原两处 → `start.sh`。

## 未完成 / 注意

- **没有做真实登录态下的浏览器点测**（无可用后台账号）：候选列表交互、比例展示只做了构建与接口路由验证，建议运营在有权限的账号上点一遍。
- 部署脚本第一版把 `$dir/stop.sh` 写成了 `dir/stop.sh`（又被 `|| true` 吞掉），所以 stop 没执行：先替换了二进制/前端，再单独补 `stop.sh` + `start.sh`。结果恰好等于 2026-11-24 客服上分那次记下的正确顺序（**先 install 再 stop/start**，避免 `supervise.sh` 在窗口期拉起旧文件），最终 `/proc/8975/exe` 的 sha256 与本地构建一致、只有 1 个服务进程。
- 昵称模糊匹配是 `LIKE '%x%'` 全表扫，账号表大了以后（正式服）可能变慢；目前最多 20 条 + `id` 倒序，暂未加索引。
