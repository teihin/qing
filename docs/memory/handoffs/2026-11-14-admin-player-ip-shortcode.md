# 后台玩家管理支持 IP 短码（列表显示 + 检索）

- 日期：2026-11-14
- 目录/分支：`/Volumes/SSD/qing`，`codex/club-ui`
- 目标：后台「玩家管理」列表显示 IP 短码并支持按短码检索；玩家详情保持原样（明文 IP/GPS 仍仅 `admin999`）。

## 改动文件

| 文件 | 改动 |
| --- | --- |
| `XuanManager/server/internal/api/ipcode.go`（新增） | `EncodeIPCode` / `DecodeIPCode`：IPv4 ↔ 6 位 Base62（区分大小写，左补 0），非 IPv4 编码为空串、解码报错。 |
| `XuanManager/server/internal/api/ipcode_test.go`（新增） | 已知向量往返、非法输入/超范围拒绝。 |
| `XuanManager/server/internal/api/players.go` | 列表查询补 `COALESCE(a.sm_ip,'')`，扫描后生成 `ipCode` 返回（原始 IP 不返回）；`playerFilters.IPAddress` 解析 `ipCode` 并拼 `a.sm_ip = ?`。 |
| `XuanManager/web/src/types.ts` | `PlayerItem.ipCode`；`PlayerSensitiveInfo` 不变。 |
| `XuanManager/web/src/pages/PlayersPage.tsx` | 列表新增「IP短码」列；高级筛选新增「IP短码」；详情页未改。 |
| `XuanManager/新后台管理系统接口文档.md` | 列表参数/返回补 `ipCode`；§4.5.1 保持明文 IP 原始口径。 |

## 口径

- 列表 `ipCode` 由服务端从 `tbl_Account.sm_ip` 编码，列表接口不返回原始 IP；详情接口 `/sensitive` 仍只给 `admin999` 返回明文 IP/GPS。
- 检索按数据库最近上报 IP 精确匹配，不是在线内存实时 IP；短码区分大小写。
- 列表显示与检索对拥有 `game.player.view` 的账号开放；不再限制 `admin999`。

## 验证

- `gofmt`、`go build ./...`、`go vet ./...`、`go test ./internal/api/` 通过（含 `TestIPCodeRoundTrip` / `TestIPCodeRejectsInvalidInput`）。
- `npx eslint src/pages/PlayersPage.tsx src/types.ts`、`npm run build` 通过。
- 编码向量：`221.236.103.129` → `43Ypq1`，`127.0.0.1` → `2kce4N`，`0.0.0.0` → `000000`。
- 线上 DB 抽查 `sm_ip` 为 IPv4（含 Web 端 `127.0.0.1`）。

## 部署（2026-11-14 00:24，正式 8891，修正版）

- 二进制：`f2c4706624da6d76dcede3535785bd8c746b6712de44a749fba9c124541865dd`（10,723,512 字节，linux/amd64，stripped）。
- 前端：`index-B_pOglF-.js`（CSS 仍为 `index-D4vx8y2M.css`）。
- 备份：`/www/html/.xuanmanager/backups/xuanmanager.20261114-002434-rollback`、`web.previous-20261114-002434`。
- 验收：health 200；公网 `/xuanmanager/` 已加载 `index-B_pOglF-.js`；包内含「IP短码」列头和示例占位，「IP 短码」详情文案已不存在、「最近上报 IP」仍在；启动后日志无 ERROR；未登录列表/敏感接口 401。
- 更正：00:20 首次部署把短码加到了详情页，已由本次 00:24 版本覆盖。

## 未验证

- 未登录后台做页面实操（列表短码列、按短码筛选命中、空 IP 显示「—」）。
- 未与游戏内 BOSS 弹窗同一 IP 的短码逐字比对。
