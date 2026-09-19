# 玩家管理新增「登录日期范围」筛选

日期：2026-09-19
目录/分支：`/Volumes/SSD/qing`，`main`（未提交，改动留在工作区）
状态：**已部署正式 8891（后端 + 前端一起）**

## 需求

玩家管理页面增加按最近登录日期筛选的条件，与已有的「注册开始/结束日期」并列。

## 改动文件

后端 `XuanManager/server/`：

- `internal/api/players.go`
  - `playerFilters` 新增 `LoginFrom` / `LoginTo`，从 query `loginFrom` / `loginTo` 读取。
  - 日期格式校验扩到 4 项（注册/登录各起止），报错文案带明确字段名；
    新增「登录开始日期不能晚于登录结束日期」。
  - `buildPlayerWhere` 新增两个条件（`kbe_accountinfos.lasttime` 是 Unix 秒）：

    ```sql
    k.lasttime >= UNIX_TIMESTAMP(CONCAT(?, ' 00:00:00'))
    k.lasttime <= UNIX_TIMESTAMP(CONCAT(?, ' 23:59:59'))
    ```

    会话时区为 +08，`UNIX_TIMESTAMP` 按北京时间解释日期串，所以日界就是北京时间当天，
    与工作台 `dayStart.Unix()` 口径一致。`lasttime` 为 `0`/`NULL` 的从未登录账号不落在范围内。
- `internal/api/players_test.go`
  - `TestParsePlayerFilters` 加入 `loginFrom`/`loginTo`，args 断言 10 → 12。
  - 新增 `TestBuildPlayerWhereLoginRangeUsesBeijingDayBounds`（断言两个子句与参数顺序）。
  - `TestParsePlayerFiltersRejectsInvalidDate` 补登录日期格式；新增
    `TestParsePlayerFiltersRejectsInvertedLoginRange`。

前端 `XuanManager/web/src/pages/PlayersPage.tsx`：

- `PlayerFilters` / `emptyFilters` 新增 `loginFrom` / `loginTo`（`queryString` 按 `Object.entries` 自动带上，无需改请求逻辑）。
- 更多条件面板在注册日期后新增「登录开始日期」「登录结束日期」两个 `type="date"` 输入，
  带提示「按北京时间当天 00:00 起算，从未登录过的玩家不会被筛选出来」「含当天 23:59」。
  `activeFilterCount` 会自动计入这两个条件。

接口文档 `XuanManager/新后台管理系统接口文档.md` §22：补一条登录日期范围的时区口径说明（北京时间日界、
用 `UNIX_TIMESTAMP` 换算后比 `lasttime`、不得改用 UTC 边界）。

## 验证结果

- `gofmt -l` 无输出；`go vet ./...` 通过；`go test ./...` 四个包全部 ok。
- 前端 `eslint src` 无输出、`tsc -b` 无错误、`vite build` 成功（产物 481.54 kB，hash 由 `index-Ch377lxc.js` 变 `index-DpMwsw8F.js`；CSS hash 未变）。
- 只读 SQL 语义核对（正式库）：
  - 新条件 `2026-09-19` 单日 → **8 条**；
  - 参照口径 `FROM_UNIXTIME(lasttime) BETWEEN '2026-09-19 00:00:00' AND '2026-09-19 23:59:59'` → **8 条**，与上一致；
  - 命中样本均为当天 22:27–22:56 的登录，全部早于服务器当前时间。

## 部署

- 备份：二进制 `backups/xuanmanager.20260919-2331-loginrange-rollback`（sha `b05e6344…`，即上一个已上线版本）；
  前端目录 `web.previous-login-range-20260919`。
- 上传 `incoming-login-range-20260919/`：二进制 sha `fc2092381837e107807cb96283c51b13d168d71d598fe01f0f94407f7e13e1a4`（与本地一致）；
  前端 `xm_web.tgz` 解包后与 `dist` 一致。
- 前端用「解包到暂存目录 → `mv web web.previous-*` → `mv 暂存 web`」交换，避免解包失败把线上目录打空。
- `stop.sh` → `install -m 755` → `start.sh`。
- 部署后验证：`/api/health` 200；`curl /` 返回的 index.html 指向 `index-DpMwsw8F.js`；
  该 JS `HTTP 200 size 481547`（与本地逐字节同大小）且含「登录开始日期」；日志 `23:31:36 XuanManager started`。
- 收尾：清掉 macOS tar 带出的 `._*` 元数据文件，`web/` 最终只剩 `index.html` + `assets/` 两个文件。
- 回滚：`install -m 755 backups/xuanmanager.20260919-2331-loginrange-rollback bin/xuanmanager && ./start.sh`，
  前端 `rm -rf web && mv web.previous-login-range-20260919 web`。

## 未完成项与下一步

- **未登录后台页面点击验收**（无管理员凭据）：需主人刷新「玩家管理」→「更多条件」实测两个日期输入。
- 改动**未提交**。
