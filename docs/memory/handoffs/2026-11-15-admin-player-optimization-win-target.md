# 后台「玩家优化」改接胜率目标（未部署，被游戏服 HTTP 写入通道阻塞）

- 目录/分支：`/Volumes/SSD/qing`，`codex/club-ui`；改动未提交、未部署。
- 目标：后台玩家优化与牌桌内「运维优化」统一成同一套方案——设置输赢金额（`target_value` 正=赢/负=输）+ 触发概率（`chance` 1~100），不再用「剩余次数 + 带符号概率」的 `optimize01_count/chance` 旧口径。

## 接口核查结论（2026-11-15 实测）

游戏服（`http://127.0.0.1:8890/hall/command`，本机 curl）4 条命令注册情况：

| 命令 | 实测 | 结论 |
| --- | --- | --- |
| `异步_查询_胜率目标_列表` | `ret_code=512`，3ms 返回 `{"total":0,"list":[]}`；`history=1` 返回 14 条真实记录 | 后台可直接用 |
| `异步_查询_胜率目标_日志` | `ret_code=512`，返回日志分页 | 后台可直接用 |
| `异步_设置_胜率目标` | **挂死**：12s / 45s 均无响应（HTTP 000），未产生任何写入（`usr_opt_target_history` 无 999999 记录） | 后台不可用 |
| `异步_停止_胜率目标` | **挂死**：12s 无响应 | 后台不可用 |

- 对照：未知命令 `异步_不存在的命令` 2ms 返回 `ret_code=769`；`异步_设置_玩家_属性` 对不存在玩家 10ms 返回 769 → 说明 8890 通道本身正常，是这 2 条写命令的实现依赖客户端（牌桌内 boss 长连接）上下文，HTTP 调用拿不到回包。
- 预热 `查询_俱乐部_分组列表`（club_id=110000）后再试设置，同样挂死；不是分组缓存未加载导致。
- 生产在跑：`usr_opt_target_history` 14 条、`usr_opt_target_log` 73 条，2026-11-12/13 有真实牌桌内使用记录（operator 383393）。
- 服务器 `client_update` 无 sudo、`/home/release`（游戏服脚本）不可读，无法自行修服务端。

## 已完成改动

后端 `XuanManager/server/internal/api/player_optimization.go`（重写）：

- 列表 `GET /api/game/player-optimization`：走 `异步_查询_胜率目标_列表`（先查 active 做汇总，再按 state 查），后台补登录账号、关键词过滤、内存分页；返回 `targetValue/chance/progress/remain/roundCount/peerCount/state/online/curCount/man/manName/setAt/finishAt`。
- `GET /{playerId}`：查当前 active 目标 + 玩家身份（`tbl_Account`/`kbe_accountinfos`）。
- 新增 `POST`：`异步_设置_胜率目标`（`target_value` 校验 1~100,000,000、`chance` 1~100、`reason` 可选）。
- 调整 `PUT`：同设置命令覆盖；校验 `expectedTargetValue/expectedChance`，进度从 0。
- 停止 `DELETE`：`异步_停止_胜率目标`（语义由「删除」改为「停止」）。
- 历史 `GET /history`：直读 `kbedm.usr_opt_target_history`（分页 + 关键词 + state），含牌桌内与后台两侧记录，字段含 `man/man_name/group_name/finish_reason`。
- 写命令加 8s 短超时兜底（`winTargetWriteTimeout`）：超时后回读列表确认是否实际生效；确认不到则回明确错误「该命令当前仅支持牌桌内客户端调用」。当前生产必然走到这条错误分支。
- 审计仍写 `mgr_audit_log`（action 沿用 `game.player_optimization.create/update/delete`），`before/after` 改为目标快照。

前端 `web/src/pages/PlayerOptimizationPage.tsx`（重写）、`types.ts`、`styles.css`：

- 列表列改为：玩家 / 状态 / 目标（赢红输绿）/ 概率 / 进度（含剩余）/ 局数 / 设置人 / 设置时间 / 操作。
- 新增/调整弹窗：方向（赢/输）+ 金额 + 概率 + 原因；停止弹窗。
- 历史面板改为目标历史（设置时间 / 玩家 / 目标 / 概率 / 结果 / 局数 / 状态 / 结束时间）。
- 菜单、路由、权限键（`game.player_optimization.*`）全部不变，无需迁移。

## 验证

- `go build ./...`、`go vet ./internal/api/`、`go test ./...` 通过（含重写的 `player_optimization_test.go`）。
- `npx tsc --noEmit` 0 错误；`npm run build` 通过（`index-BEzFP0bE.js` + `index-CYgoV_BN.css`，仅本地 dist）。
- **未部署**：写命令在 HTTP 通道不可用，部署会让「新增/调整/停止」全部报错，因此等游戏服先修。

## 下一步（需服务端配合）

1. 游戏服把 `异步_设置_胜率目标` / `异步_停止_胜率目标` 改成 HTTP 通道同步回包（像 `异步_设置_玩家_属性` 一样），或新增仅后台可调的 `后台_设置_胜率目标` / `后台_停止_胜率目标`（内部直接调 `opt_target_ctrl` 的同步逻辑并 `return` 结果，不回推客户端）。
2. 改完后用 `guuids=999999, target_value=1, chance=0` 探测应快速返回参数错误（当前是挂死），即视为通道就绪。
3. 服务端就绪后再部署 8891：备份 `bin/xuanmanager`、`web/`，然后登录态实操「设置→列表看进度→调整→停止→历史」。
4. 若服务端短期不能改，后台保持现状（旧 `optimize01_*` 口径），不要合并本次分支改动。
