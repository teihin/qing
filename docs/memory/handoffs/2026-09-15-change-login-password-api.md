# 2026-09-15 登录前修改密码接口

文档依据：`登录前修改密码Web接口方案.md`（用户提供）。目录 `/Volumes/SSD/qing`，分支 `main`，未提交。

## 服务端（XuanManager，Go）

- 新增 `server/internal/api/password_reset.go`：`POST /api/game/change-login-password`（另有 OPTIONS 供跨域）。
- 校验顺序按文档：参数（E1005）→ 注册表联查（E1001）→ 交易密码未设置（E1002）→ MD5 比对（E1001）→ 单条 UPDATE。
- 只写 `kbedm.third_marketing_info.player_wxpwd`（MD5(?)），不写 `tbl_Account.sm_userPWD`。
- 限频：账号 5 次/小时锁 30 分钟，IP 20 次/小时；审计用 slog，只记账号/IP/结果，不记明文或 MD5。
- `server/internal/api/server.go`：注册路由并初始化两个限频器。
- `server/internal/api/password_reset_test.go`：账号格式、MD5 大小写不敏感、限频锁定与解锁。

## 客户端（游戏）

- `assets/scripts/logic/ConfigManager.ts`：新增 `changeLoginPasswordUrl`，指向 `http://154.37.155.17/xuanmanager/api/game/change-login-password`。
- `assets/scripts/UI/panelLogin.ts`：`requestResetPassword` 改为真实 POST，按 code 映射提示文案；成功后关闭弹窗并提示用新密码登录；关闭弹窗会 abort 请求。

## 验证

- `go build ./...`、`go test ./internal/api/` 通过（含既有用例）。
- 客户端未做编辑器/网页/真机验证；服务端未连真实库跑 P01–P14 验收用例。

## 2026-09-15 第二轮（用户要求统一接口 + 可查记录 + 上服务器核实）

- 返回体改为与后台一致的 `ok/data` 信封：成功 `{"ok":true,"data":{"message":"ok"}}`，失败 `{"ok":false,"error":{"code","message"}}`；错误码改为字符串（ACCOUNT_OR_PAY_PASSWORD_WRONG / PAY_PASSWORD_NOT_SET / NEW_PASSWORD_REQUIRED / RATE_LIMITED / INVALID_PARAMETERS）。客户端同步改为读 `ok` 与 `error.message`。
- 修改记录写入现有 `mgr_audit_log`：action=`game.player.change_login_password`，operator_name=`玩家自助`，target_type=`game_player`，target_id=玩家 guuid；只记账号，不记明文密码和 MD5。可直接在后台“审计”页按操作人或 action 检索。

## 服务器实测（154.37.155.17，SSH 端口 2233）

- 后端进程 `/www/html/.xuanmanager/bin/xuanmanager`，由同账号 supervise.sh 拉起。
- `webcm_user` 授权：`SELECT ON kbedm.*` 加 `INSERT/UPDATE/DELETE ON kbedm.third_marketing_info`，本接口用的 UPDATE 与 JOIN 查询都在既有授权内，**不需要新增授权**（文档第 7 节的授权申请本部署已满足）。
- 表结构：`third_marketing_info.player_wxpwd varchar(50) NOT NULL`、`tbl_Account.sm_userPWD2 varchar(255) NOT NULL`；`mgr_audit_log` 列与本次 INSERT 一致。
- 数据现状：注册表 25 条，全部能 JOIN 到 Account，其中 19 条交易密码为空（会返回 PAY_PASSWORD_NOT_SET）。

## 仍未做

- 未连真实库跑 P01–P14 验收用例；未部署、未重启线上后端。
- 客户端未做编辑器/网页/真机验证。

## 已部署（2026-09-15，用户确认后执行）

- 现象：网页报 CORS 预检失败。排查发现线上后端是 9-13 的旧二进制，新路由返回 404。
- 处理：本地交叉编译 linux/amd64，上传到 `/www/html/.xuanmanager/xuanmanager.change-login-password.upload`，用 `deploy-change-login-password-20260915.sh` 按既有部署模式停服→备份旧二进制为 `bin/xuanmanager.previous-change-login-password-20260915`→替换→启动→健康检查→预检验证，失败自动回滚。
- 新二进制 sha256 `2c36629ebd2618fe7e004a7fcd61e9cc170408a57b79432cff2337e87ef90bb6`。

## 线上实测结果

- 预检 `OPTIONS /xuanmanager/api/game/change-login-password` 返回 204，含 `Access-Control-Allow-Origin: *`。
- 未知账号 → ACCOUNT_OR_PAY_PASSWORD_WRONG；账号格式非法 → INVALID_PARAMETERS；新密码为空 → NEW_PASSWORD_REQUIRED；真实账号无交易密码 → PAY_PASSWORD_NOT_SET（密码未被改动）。
- 审计表已落记录（mgr_audit_log，operator_name=玩家自助）。
- 未跑：改密成功路径（需要真实账号，避免锁死玩家）、限频 E1004/RATE_LIMITED。

## 2026-09-15 修复线上 500（幂等改密）

- 现象：改密后再次提交同一新密码，接口 500；日志 `change-login-password unexpected row count rows=0`。
- 原因：MySQL 的 affected_rows 统计的是**真正发生变化**的行，新旧密码相同时返回 0（已用临时表实测：first_change=1、same_value=0）。原实现 `affected != 1` 判错，把文档 P10 要求的幂等成功当成异常。
- 修复：只在 `affected > 1` 时报错，0 行按幂等成功处理。
- 已重新编译部署（sha256 `59a766ba…bbc5e`），备份为 `bin/xuanmanager.previous-change-login-password-r2-20260915`。

## 2026-09-15 审计记录带上玩家名字

- 需求：后台审计里改密记录只有玩家 ID，要带名字。
- 后端：审计列表查询 `queryAudits` 增加 `LEFT JOIN kbedm.tbl_Account` + `kbedm.kbe_accountinfos`，返回 `targetName`（优先 `sm_name`，回退 `accountName`）。
- 前端：`AuditPage` 目标列显示为 `game_player #<guid> <昵称>`，`types.ts` 的 `AuditItem` 增加 `targetName`。
- 已部署后端与网页（sha256 `311526687e…f614e`，新前端包 `index-Ch377lxc.js`），旧版本分别备份为 `bin/xuanmanager.previous-audit-target-name-20260915` 与 `web.previous-audit-target-name-20260915`。
- 实测：id 273/272/268/267 的 `target_id=237737` 解析出 `target_name=天外飞仙`。
