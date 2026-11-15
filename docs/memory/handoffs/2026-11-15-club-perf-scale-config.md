# 2026-11-15 后台「业绩股」全局折算百分比配置（代码就绪，未部署）

- 目录/分支：`/Volumes/SSD/qing`，`codex/club-ui`（改动仅在 `XuanManager/`，不涉及客户端）
- 目标：服务端要求「后台做一个 50% 的配置项」，写 `usr_hash_info` 的 `俱乐部业绩全局百分比`

## 改动文件

| 文件 | 内容 |
| --- | --- |
| `XuanManager/server/internal/api/club_perf_scale.go` | **新增**。GET/PUT 配置读写：明文整数 0~100、默认 50、无行 INSERT / 有行统一 UPDATE（不删行）、回读校验、失败按原 `id` 恢复、审计 `configuration.club_perf_scale.update`；`scaledClubPerfCount` 折算保留两位小数 |
| `XuanManager/server/internal/api/server.go` | 挂 `GET /api/game/club-perf/scale`（`game.club_perf.view`）、`PUT /api/game/club-perf/scale`（`game.club_perf.config`） |
| `XuanManager/server/migrations/070_club_perf_scale.sql` | **新增**。权限 `game.club_perf.config`，授予 role 1 |
| `XuanManager/server/internal/api/club_perf.go` | `My/Granted/Left` 由 `int64` 改 `float64`（原 `int64(anyFloat())` 会把 50% 的 .5 截断）；联盟根 `root.My` 改为折算值（原为原始总次数）；overview 增加 `scalePercent`；报表解析支持 `scale_percent`，缺失返回 -1 → 调用方回落 100 |
| `XuanManager/server/internal/api/club_perf_test.go` | 适配新签名；新增 50% 折算、两位小数、`parseClubPerfScale` 用例 |
| `XuanManager/web/src/pages/ClubPerfPage.tsx` | 页头「全局折算设置」按钮 + `ScaleSettingModal`（0~100、示例换算、`confirm-check` 二次确认）；统计条新增「全局折算」卡；表头改「我(折算)/下放(折算)」；`num()` 支持两位小数；底部说明标注合计约 X% |
| `XuanManager/web/src/styles.css` | `.club-perf-stats` 由 4 列固定改 `auto-fit minmax(168px,1fr)`（卡片由 4 个变 5 个） |
| `XuanManager/新后台管理系统接口文档.md` | 新增 §13.3.3（接口、权限、值格式、范围、生效、影响） |
| `服务器文档整理/俱乐部业绩-客户端与后台接口文档.md` | 状态行去掉"未实施"的自相矛盾表述；新增 §7.5.1；变更记录 v10 |

## 校验

- `go build ./...` 通过；`go vet ./internal/api/` 无告警；`go test ./internal/api/` 全通过（含新增 4 个用例）。
- 请求体的 `percent` 用 `*int`：缺字段直接 400，避免 `{}` + `confirm` 被当成 0% 静默写库。
- `tsc -b` 通过；`eslint src/pages/ClubPerfPage.tsx` 无告警。

## 部署（2026-11-16 00:03，8891）

| 项 | 值 |
| --- | --- |
| 二进制 | sha256 `77dbde3cffda3efee6bf571c462fc57abed926bd07757187a7bf3eaafd825722`，11,124,920 字节 |
| 回滚 | `backups/xuanmanager.20261116-0003-rollback`（旧版 11,104,440 / `22f1f187…`） |
| 迁移 | `070_club_perf_scale.sql` 已随启动执行；`mgr_permission` 新增 `game.club_perf.config`，已授 role 1 |
| 前端 | `index-Bg6BsbJD.js`（1,013,620 字节 / sha256 `cada15ee…`）+ `index-CCEXCQ45.css`（266,046）；回滚目录 `web.previous-clubperfscale-20261116-0003` |
| 自检 | health 200；`GET /api/game/club-perf/scale` 未登录 401（路由存在）；8890/8891/8893 均 LISTEN |
| 同源反证 | 用 HEAD(2868d1c8) 单独构建基线，体积与线上旧版**逐字节相同**（11,104,440），确认覆盖的是 HEAD |

## 待办 / 风险

1. ~~写值格式待确认~~ **已确认**：线上 `kbedm.usr_hash_info` 已有该行（id 175，`hash_content = '50'`，明文，LEN=2），与实现一致；服务端自己插的默认值，后台直接 Update 即可。
2. 服务端是否已上线折算：未返回 `scale_percent` 时后台按 100 处理（不折算），避免联盟根被算成 0；上线后自然切到真实值。
3. 归一化分配（`left_count / Σ left_count`）在全员同乘时比例不变，**打款金额不会自动减半**，需财务确认是否改用 `left_percent` 或同步减预算。
4. 迁移只给 role 1 授了 `game.club_perf.config`；role 4 有 view/grant 但没有 config，如需给运营角色开放要单独授权。
5. 登录态页面实操（点开弹窗、存 50、看统计条与两位小数）**待主人验收**。

