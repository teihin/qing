# 后台各模块「按靓号查询」支持（2026-11-16）

## 目标

运营在后台按 ID 搜索时，手里往往只有玩家手机上显示的靓号（个人ID 6 位靓号、俱乐部邀请码 6 位靓号），
原先后台直接拿这个号码去 `sm_guuid` / `club_guuid` 精确匹配，永远查不到人/俱乐部。
本次统一在服务端入口做「靓号 → 真实 ID」反解，不改业务表、不改回包字段。

## 实现

新增 `XuanManager/server/internal/api/pretty_lookup.go`：

- `isPrettyCandidate`：只有 6 位纯数字才查号池，其它输入直接放行，避免每个搜索框多打 DB。
- `lookupPrettyNumber`：`kbedm.usr_pretty_no_info` 里 `status='used'` 的号码 → `kind` + `user_guuid`。
- `clubByInviteCode` / `clubExists` / `resolveClubInput`：俱乐部 ID 优先，其次按 `club_invite_code_info.invite_code` 反查俱乐部。
  邀请码靓号在该表里就是真实行，所以普通邀请码也顺带支持了。
- `resolvePlayerInput(s)`：个人ID 靓号 → 真实 `sm_guuid`。
- `resolveSearchInputs`：一个搜索框同时输俱乐部ID/名称/邀请码/玩家ID 时，返回识别出的俱乐部ID 与玩家ID。
- 靓号表未建 / 查询失败 → 静默退回原值，不拖挂模块（复用 `hasPrettyNumberTable` 的 30s 重试缓存）。

接入点（服务端）：

| 模块 | 参数 | 处理 |
| --- | --- | --- |
| 俱乐部管理 列表 | `keyword` / `clubId` / `ownerId` / `playerId` | `resolveClubFilters`；keyword 额外按邀请码命中的俱乐部ID 或「该玩家是本俱乐部成员」`EXISTS` 命中 |
| 俱乐部管理 详情 | 路径 `clubId` | 允许直接粘邀请码打开 |
| 玩家管理 | `playerId` | 反解为真实 ID（`keyword` 原已支持 `p.pretty_no`） |
| 交易记录 | `playerId` | 反解 |
| 用户数据 资料/明细 | `playerId` | 反解 |
| 房间战绩 列表 | `keyword`（房间或玩家）/ `club` | keyword 反解后加「该玩家在房间」精确命中；club 支持邀请码 |
| 代理管理 | `keyword` / `parentId` / 下级 `keyword` | 反解 |
| 代理红利 | `sourcePlayerId` | 反解 |
| 代理奖励 | 按ID加入 `agentId(s)` / 子账号 `subGuuid` / 候选 `keyword` | 反解 |
| 俱乐部业绩 | `player_id`（核对/开通）、候选列表 | 反解；候选额外返回 `prettyNo` 供前端搜索 |
| 玩家优化 | 核对路径 `playerId`、新增 `playerId`、列表/历史 `keyword` | 反解 |
| 封号 | 新增 `playerId`、已封列表 `keyword`、历史 `keyword` | 反解 |
| 交易黑名单 | 新增 `playerId`、修改 `newPlayerId` | 反解 |
| 奖池业绩 | 查询 `playerId`、开通路径 `playerId` | 反解 |
| 防盗号 | 列表 `keyword` | 反解 |
| 房间维护 | `keyword` | 反解（创建者ID 匹配） |
| 荣誉榜 | 活动列表 `keyword`、范围搜索 `keyword` | 邀请码反解为俱乐部ID 额外精确命中 |
| 自动化 · 俱乐部 | `keyword` | 增加 `invite_code LIKE`，并把邀请码反解出的 club_id 一起命中 |

前端只改提示文案（`ClubsPage` / `PlayersPage` / `TransactionsPage` / `UserDataPage` / `AgentsPage` / `RoomRecordsPage` /
`BansPage` / `TransactionBlacklistPage` / `PlayerOptimizationPage` / `JackpotPerformancePage` / `AntiTheftPage` /
`AgentRewardsPage` / `ClubPerfPage`），并在俱乐部业绩候选里展示/匹配 `prettyNo`。

## 验证

- `go build ./...`、`go vet ./...`、`go test ./...` 全通过。
- 新增 `pretty_lookup_test.go`：6 位判定、俱乐部 WHERE 的靓号分支与参数顺序、房间战绩关键字参数顺序。
- `tsc -b`、`npm run build` 通过。
- 部署后服务器本机只读校验（`/usr/bin/mysql` + `runtime.env`）：
  - `invite/used` 9 条，`usr_pretty_no_info.pretty_no` join `club_invite_code_info.invite_code` 命中 9 → 邀请码靓号都能反查到俱乐部；
  - `uid/used` 12 条，join `tbl_Account.sm_guuid` 命中 12 → 个人ID 靓号都能反查到真实账号。
- **未做**：登录态下的人工实操（需要主人用后台账号点一遍）。
- 已知未覆盖：`GameCallLogsPage`（纯前端日志文本过滤）、`PlayerOptimizationPage` 更新/删除路径参数（均由列表点选带入真实 ID）。

## 21:53 修复（主人实测报错：搜 555111 查出来的俱乐部不对）

**根因**：`buildClubWhere` 的关键字条件原来是一整个带括号的串 `"(c.club_guuid LIKE ? OR c.club_name LIKE ?)"`，
追加靓号分支时写成 `clause += " OR c.club_guuid = ?"`，`OR` 落在了**括号外**：

```
c.club_status NOT IN ('init','del') AND (LIKE ... OR LIKE ...) OR c.club_guuid = '555111'
```

`AND` 优先级高于 `OR`，等价于 `(status过滤 AND LIKE) OR club_guuid='555111'` →
`club_status='init'` 的空壳俱乐部被直接捞出来。运营看到的就是"一个未启用、没群主的 555111 俱乐部"。

**修法**：
1. 括号在最后统一闭合（`clause += ")"`），让追加的 `OR` 留在括号内；
2. 解析顺序改为「已绑定的邀请码（`status='used'` 且 `club_guuid` 非空）> 在用的俱乐部 ID > 任意历史码」，
   避免一个 init 俱乐部 ID 抢走"这号码其实是别的俱乐部邀请码"的解释权；
3. `clubExists` 只认 `club_status NOT IN ('init','del')`，与列表口径一致；
4. `handleGetClub` 改成「先按原 ID 查，查不到再反解」，init/del 俱乐部仍能打开详情；
5. 测试补结构断言：`") OR c.club_guuid = ?"` 不允许出现、关键字条件必须以 `)` 收尾
   （之前的测试只断言了子串存在，才让这个括号漏洞漏过去）。

**`555111` 本身的真实情况**（只读核查）：`usr_pretty_no_info` 无此号；`club_invite_code_info` 有一行但
`status='init'`、`club_guuid` 为空（码池里还没分配）；`club_guuid_info` 有一行 `club_status='init'` 的空壳。
所以修复后搜它是**空结果**，属于正确行为（没有任何俱乐部绑定它）。

**线上确实可搜的邀请码靓号（9 条）**：`111001→828389 全新`、`123321→775447 A1俱乐部`、`222111→267493 A3俱乐部`、
`444444→885399 踩踩踩`、`456789→552871 心测`、`555555→828389 全新`、`868686→885399 踩踩踩`、
`888999→775447 A1俱乐部`、`990099→775447 A1俱乐部`。

## 部署记录（2026-11-16 21:53，最终版）

- 前端 `index-B3RRtU1l.js` + `index-0JIJmIWM.css`；二进制 `383544d18365cb14d2e13c2a4ca02c5faf5ecd9a601475d3261ac89f2307a972`，新 pid 25011。
- 备份：`bin/xuanmanager.previous-prettyfix-20261116-2153`、`web.previous-prettyfix-20261116-2153`（上一版 21:38 的备份仍在：`*.previous-prettysearch-20261116-2140`）。
- 21:38 首发版本（`9f0b72da…` / `index-kEtH9GPs.js`）含括号 bug，已被本次替换。
- 校验：`/api/health` ok；`/api/game/clubs` 未登录 401；`/proc/<pid>/exe` sha 与上传包一致。无数据库迁移。

## 下一步

- 建议用上面 9 条里的号码实测：俱乐部管理关键字填 `555555` → 应只出「全新（828389）」；填 `123321` → 应只出「A1俱乐部（775447）」。
- 浏览器要**强刷**（前端 hash 变了：`index-B3RRtU1l.js`），否则还是旧包。
- 回滚：把 `*.previous-prettyfix-20261116-2153` 改回原名并 `kill` 当前子进程让 `supervise.sh` 拉起。
- 若俱乐部成员树也要显示 `真实ID(靓号)`，需在 `readClubDetail` 的成员查询里补 `usr_pretty_no_info` JOIN（未做）。
