# 2026-11-10 发牌优化改用游戏服 `异步_设置_玩家_属性`

## 范围

- 目录：`/Volumes/SSD/qing`，分支以实际检出为准（本次为 `codex/club-ui`）。
- 目标：按服务端文档把后台发牌优化写入从“直连游戏库事务”改为“8890 游戏服命令 + 回读校验”，并去掉“必须唯一 BOSS”的限制。

## 服务端口径（用户提供的服务器文档）

- `GET http://127.0.0.1:8890/hall/command`
  - `header=异步_获取_玩家_属性` / `header=异步_设置_玩家_属性`
  - `param={"guuid":"718968","name":"optimize01_chance","value":50,"context":"..."}`
- `name`：`optimize01_chance` / `optimize01_count` / `optimize01_man`
- `chance`：`1~100` 正优化（让玩家拿好牌），负数为负优化（让玩家拿最差牌）；`count`：生效次数，命中一次扣 1。
- `optimize01_man`：设置人标记，**不参与判定，可不设**。
- `ret_code=512` 只代表接口调用成功，是否真正写入要看数据库/审计。

## 改动文件

- `XuanManager/server/internal/api/player_optimization.go`
  - 删除 `readSingleBoss()` 与直写 `writePlayerOptimizationTransaction()`。
  - 新增 `writePlayerOptimizationViaGameCommand()`：新增/调整先写 `optimize01_chance` 再写 `optimize01_count`；删除先写 `count=0` 再写 `chance=0`。
  - 新增 `setPlayerOptimizationValue()` 调用 `异步_设置_玩家_属性`，`ret_code!=512` 时区分“命令未注册/业务拒绝”。
  - 新增 `waitForPlayerOptimization()`：16×300ms 回读 `tbl_Account`，次数和概率都一致才算成功。
  - 新增 `rollbackPlayerOptimization()` / `restorePlayerOptimization()`：部分写入或回读失败时恢复操作前值；恢复失败单独报错，提示人工核对。
  - 审计 `writeMode` 改为 `game-command`，并记录命令 `context`。
  - 概率校验放开到 `-100~-1` 与 `1~100`，`0` 不允许；调整/删除的页面基准概率、列表概率范围同步放开。
  - 请求超时 10s → 25s（两次命令 + 最长约 4.8s 回读）。
- `XuanManager/server/internal/api/player_optimization_test.go`
  - 状态匹配只比较次数/概率，不再比较 `optimize01_man`。
  - 新增负概率通过、`0`/`±101` 拒绝、负数范围筛选用例。
- `XuanManager/web/src/pages/PlayerOptimizationPage.tsx`
  - 新增/调整弹窗概率输入 `-100~100`、`0` 不可用，提示区分正/负优化。
  - 列表概率范围筛选放开负数。
  - 弹窗说明从“数据库事务”改为“游戏服接口 + 回读校验”。
- 文档：`XuanManager/README.md`、`XuanManager/新后台管理系统接口文档.md`（15.1/15.2）、`docs/memory/topics/xuanmanager.md`、`docs/memory/CURRENT.md`。

## 验证

- `XuanManager/server`：`gofmt` 无输出、`go vet ./...` 通过、`go test ./...` 通过。
- `XuanManager/web`：`npm run lint`、`npm run build` 通过。
- 发布构建用独立 worktree 重建了与线上一致的基线（二进制体积 `10129592` 字节、业务 SQL 串零差异），只叠加本次改动后交叉编译；堆内旧 BOSS 报错串计数为 0。
- 部署：正式 8891 二进制 `347a37e04469…`，health 200；前端 `index-BU2OmBcu.js`（843,690 字节），CSS 保持线上 `index-DCd0vLpS.css`；8890 只读查询玩家 718968 返回 `optimize01_chance=0`、`optimize01_count=0`。
- 未验证：未在页面实操新增/调整/删除，未对真实玩家写入，未确认离线玩家写入后的持久化时延；负优化的业务使用范围未确认。

## 部署记录（2026-11-10 00:26）

- 二进制回滚：`/www/html/.xuanmanager/backups/xuanmanager.20261110-0026-rollback`
- 前端回滚：`/www/html/.xuanmanager/web.previous-player-optimization-20261110-0026`
- 线上端口：8890 游戏管理、8891 XuanManager、8893 ChatTool。
- 注意：线上前端基线包含未提交的「钻石发放」PlayersPage 改动；本次发布沿用该基线，只替换 JS 和 index.html 的 JS 引用，CSS 未动。

## 下一步

1. 游戏服已确认可用：`异步_获取_玩家_属性` 对 `optimize01_chance/count` 返回 512。
2. 在后台页面用一个测试玩家执行新增 → 调整 → 删除，核对 `tbl_Account` 回读、`mgr_audit_log` 的 `writeMode=game-command` 与 `context`，并观察是否出现“未回读到目标参数”的恢复提示。
3. 若游戏服对 `optimize01_man` 有非空要求，再决定是否写入玩家 ID 或固定 BOSS ID。
4. 负优化（`chance<0`）是否作为常规运营能力开放给所有角色，仍需业务确认。
