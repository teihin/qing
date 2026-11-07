# 2026-11-07 修改交易密码改为用登录密码核验

目录 `/Volumes/SSD/qing`，分支 `codex/club-ui`（工作区另有代理奖励等未提交改动，未触碰）。
部署：正式 8891 **已上线**。客户端**已改代码、未构建**。

## 为什么不能只改客户端

游戏服 `修改_玩家_交易密码` 的 `old_pwd` 只比对交易密码（`tbl_Account.sm_userPWD2`），
登录密码是另一个字段（`third_marketing_info.player_wxpwd`，游戏登录校验的权威摘要）。
用户选择「后台加接口校验」，因此新增玩家侧 HTTP 接口，由后台做登录密码比对、再由游戏服写交易密码。

## 改动

### 后台（XuanManager，Go）

| 文件 | 说明 |
| --- | --- |
| `server/internal/api/change_pay_password.go` | 新接口实现（校验 + 调游戏服 + 回读 + 审计） |
| `server/internal/api/server.go` | 新增 `OPTIONS/POST /api/game/change-pay-password` 两条路由 |
| `server/internal/api/change_pay_password_test.go` | guuid 格式、入参校验单测 |

接口：`POST /api/game/change-pay-password`

```json
{"player_id":"954431","login_pwd":"******","new_pay_pwd":"******"}
```

- 入参：`player_id` 纯数字；`login_pwd` 非空；`new_pay_pwd` 非空、≤32 字、无空白。
- 校验：`third_marketing_info.player_wxpwd` 与 `MD5(login_pwd)` 大小写不敏感比对。
- 写入：服务器本机 8890 `异步_设置_玩家_属性`（`name=userPWD2`，接受 `ret_code` 512/1280），
  再由游戏服落 `tbl_Account.sm_userPWD2`；随后回读 `LOWER(sm_userPWD2)=MD5(新密码)` 最多 16 次 × 250ms。
  **后台 DB 账号（webcm_user）对 `tbl_Account` 只有 SELECT，不能直写，所以必须走 8890。**
- 限频：复用 `passwordAccountLimiter`（5 次/小时锁 30 分钟）与 `passwordIPLimiter`（20 次/小时），
  key 加 `pay-` / `pay-ip-` 前缀，与改登录密码互不干扰。
- 审计：`mgr_audit_log.action=game.player.change_pay_password`，`operator_name=玩家自助`，不记明文与摘要。

### 客户端（Cocos）

| 文件 | 说明 |
| --- | --- |
| `assets/scripts/logic/ConfigManager.ts` | 新增 `changePayPasswordUrl` |
| `assets/scripts/UI/panelMain.ts` | 「确定修改交易密码」改调 HTTP，新增 `SubmitPayPasswordChange`；旧游戏服协议只保留给「初始化交易密码」 |
| `assets/resources/UI/panelMain.prefab` | 仅 3 处文案：`原交易密码`→`登录密码`、占位 `请输入原密码`→`请输入登录密码`、说明改「请先验证登录密码，再设置新的交易密码」（`_string` 与 `_N$string` 同步改） |

节点路径 `修改交易密码/列表/原有密码/txt` 保持不变，`ClearTransactionPasswordInputs` 未受影响；
「修改登陆密码」面板的 `请输入原密码` 未动。「初始化交易密码」分流（`bNeedInitJYPwd`）与旧协议未变。

## 验证

- `go build ./...`、`go vet`、`go test ./internal/api/` 通过。
- 客户端 `panelMain.ts`、`ConfigManager.ts` ts.transpileModule 0 诊断。
- `panelMain.prefab` JSON 可解析，diff 仅 6 行。
- 线上部署：二进制 `859202c4a3350433ec3ca2210ff1998be43ce37dc8d94da528ea7d4db812b218`，
  回滚备份 `bin/xuanmanager.previous-paypw-20261107`，部署脚本 `deploy-paypw-20261107.sh`，health 200。
- 线上实测（测试账号 `954431` 00008888 测试一下，登录密码 123456）：
  - `OPTIONS` → 204，带 `Access-Control-Allow-Origin: *`；
  - 错误登录密码 → `ACCOUNT_OR_PAY_PASSWORD_WRONG / 登录密码错误`；
  - 正确登录密码 → `ok:true`，`sm_userPWD2` 变为 `MD5("654321")`；审计落两条（成功 + 1001）。
  - 测完把该账号交易密码恢复为 `123456`。**注意：该账号原本没有交易密码（`sm_userPWD2` 为空），
    后台账号无写权限无法还原为空，现为 `123456`。**

## 未完成

- 客户端未构建（`1生成热更新包` / `3上传网页版` 未跑），Creator 未重新导入 prefab、网页与真机未验。
- 未用真实玩家跑一遍完整改密（避免动玩家密码），只用了测试账号。
