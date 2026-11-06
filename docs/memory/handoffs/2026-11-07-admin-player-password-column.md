# 2026-11-07 后台玩家管理「用户密码」列：改存明文副本并展示（已部署）

## 范围

- 目录：`/Volumes/SSD/qing/XuanManager`（Go 后端 `server/` + React/Vite 前端 `web/`）。
- 分支：`codex/club-ui`（代码改动在工作区，未提交、未推送）。
- 目标：玩家管理列表的「用户密码」列要显示**玩家登录密码明文**，只有管理员（`super_admin` 角色，含 `admin999` 与普通管理员 `admin`）能看到。

## 关键事实：MD5 不能解密

- 游戏端没有明文密码：`kbedm.third_marketing_info.player_wxpwd`（注册写入、登录校验权威来源）、`kbedm.tbl_Account.sm_userPWD`、`kbe_accountinfos.password` 全是 **MD5**（线上 `kbe_accountinfos.password` 与 `player_wxpwd` 同值，`usr_account_info` 0 行）。所以不存在「解密」，只能自己另存明文。
- 后台能拿到明文的地方只有三处：客户端注册 `POST /api/game/registrations`、后台重置 `POST /api/game/players/{id}/password`、玩家自助改密 `POST /api/game/change-login-password`。

## 方案（已上线）

1. 新表 `mgr_player_login_password(player_wxid PK, sealed_password, source, updated_at)`（migration `046_player_login_password.sql`，启动自动执行）。
2. `server/internal/api/player_login_password.go`：`savePlayerLoginPassword`（`security.SealCredential`，AES-256-GCM，密钥 `XUAN_CREDENTIAL_KEY`，与自动化机器人凭据同一把）、`loadPlayerLoginPasswords`、`attachPlayerLoginPasswords`。
3. 三个写入口各挂一次：注册成功、后台重置成功后、自助改密成功后。写入失败只记日志，**不影响注册/改密本身的成功判定**。
4. 玩家列表：管理员才查该表并解密，`loginPassword` 有值则回 `passwordRecorded=true`；没有记录时字段为空、`passwordRecorded=false`，前端显示「未收录」（不回退显示 MD5）。
5. 存量回填：用「常见密码 + 登录账号派生 + 六位纯数字」字典对上 MD5，把命中项加密写入，`source='recovered'`。线上 63 个账号命中 62 个（未命中 `37022268`），即绝大多数玩家现在就能看到明文。回填工具是一次性的，跑完已删除，不进仓库。

## 改了哪些文件

- `server/migrations/046_player_login_password.sql`（新增）
- `server/internal/api/player_login_password.go`（新增）
- `server/internal/api/players.go`：`playerItem` 增 `LoginPassword`/`PasswordRecorded`，列表不再读游戏库 MD5；管理员时调 `attachPlayerLoginPasswords`
- `server/internal/api/registrations.go`、`player_security.go`、`password_reset.go`：各加一次明文收录
- `server/internal/api/players_test.go`：身份判定、字段序列化、空输入不写库、登录账号规范化
- `web/src/types.ts`、`pages/PlayersPage.tsx`、`styles.css`：列显示明文或「未收录」
- `新后台管理系统接口文档.md` 4.1：补 `loginPassword`/`passwordRecorded` 与明文来源

## 部署（2026-11-07 00:40，正式 8891）

- 二进制 `285c62b3cea15b546f3ac9d3050d30be35f300fb49385b865f3f8374445427ab`；前端 `index-DoJnkJZt.js` + `index-D1sxNJE2.css`。
- migration `046_player_login_password.sql` 00:40:50 已执行，表已建。
- 回填后 `mgr_player_login_password` 62 行（`source='recovered'`），密文均 `v1:` 前缀。
- 回滚点：`bin/xuanmanager.previous-pwdplain-20261107`（上一版，MD5 列）、`web.previous-pwdplain-20261107`；更早的 `*previous-playerpwd-20261107` 是最初原件。

## 验证

- `go build` / `go vet` / `go test ./internal/api/ -run 'Player|Password|LoginName'`、`npm run lint` / `build` 全过。
- 线上：health 200、未登录 `/api/game/players` 401、公网页面 200 且指向新 js、js 含 `passwordRecorded`、二进制含 `mgr_player_login_password`、日志 `XuanManager started`（00:40:49）。
- **密钥一致性已验证**：运行进程 `/proc/<pid>/environ` 里的 `XUAN_CREDENTIAL_KEY` 与 `runtime.env` 的 sha256 完全相同（`cd5c916f…`），因此本地加密的密文服务端可解。
- **未验证**：真实登录态下打开玩家管理页看列与明文（没有 admin/kefu 密码，未做登录截图）。

## 风险与后续

- 明文副本是**新增的敏感数据**：库被拖走时可解出玩家密码（AES-GCM 密钥在 `runtime.env`，与机器人凭据同一把）。已限定只有管理员接口能取、不进审计与日志；如需更强隔离，应换独立密钥或独立实例。
- 回填是字典命中，`source='recovered'` 可区分；玩家之后在后台重置或自助改密会覆盖为 `admin_reset`/`self_service`。
- 游戏客户端内部改密不经过 XuanManager 时，明文副本会过期——此时显示的是「当时那次」的密码，不会自动同步。需要严格一致就只能让客户端改密也走后端接口。
- 玩家量大后列表每页多一次按 `player_wxid` 的批量查询（一页一次，不是每个玩家一次）。
