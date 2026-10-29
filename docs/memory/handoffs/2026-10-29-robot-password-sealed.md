# 机器人登录密码改回密文 + 独立密钥（已部署）

目录 `/Volumes/SSD/qing`，分支 `codex/club-ui`。**后端已部署（PID 22966），前端已部署（`index-CcSNTgVz.js`），git 未提交。**

承接 [机器人/控制台收尾](2026-10-29-automation-robots-and-console.md) 第 4、5 节：把 20:22 改成的「明文落库」恢复为
AES-256-GCM 密文，并把落库密钥从「回落 DB 口令」换成独立的 `XUAN_CREDENTIAL_KEY`。

## 目标与结论

- 存密文不影响下发：心跳下发时后端自己解密，随时拿得到真实密码，不存在「以后不知道真实密码」。
- 泄露面从「库 + 备份 + 任何能读 webcm 的账号」缩小到「能拿到后端进程环境的人」。

## 改动文件

| 文件 | 改动 |
| --- | --- |
| `server/internal/api/automation_robots.go` | 创建（批量）与编辑重置密码两处改回 `security.SealCredential(s.credentialKey(), pwd)`，恢复 `security` import；错误码 `SEAL_ERROR` |
| `server/cmd/xuanresea/main.go`（新增） | 一次性回封工具：明文 → 当前密钥密文；旧兜底密钥的 `v1:` 密文 → 重封为当前密钥；已是当前密钥的解一遍确认后跳过；`-dry` 只报告 |
| `web/src/pages/automation/AutomationRobotModals.tsx` | 文案「明文保存」→「密文保存，Worker 拉起时由后台解密后下发」 |
| 服务器 `runtime.env` | 追加 `XUAN_CREDENTIAL_KEY=<64 位随机 hex>`（备份 `runtime.env.previous-sealpwd-20261029`） |

下发链路 `automation_agent.go`（`v1:` 前缀解密、否则当明文透传）**未改**，天然兼容新旧两种格式。

## 上线过程

1. 构建：`GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w"`（`-s -w` 是线上既有约定，
   不带它体积 13.2M，带它正好 9453752 字节与线上一致）。
2. 同源验证：把改动前的 `automation_robots.go` 在副本里还原后构建，与线上二进制字符串比对，业务 SQL 只差
   字符串打包边界（`tbl_Account`、`hash_key` 两边都在），新增的仅 `SEAL_ERROR` 等本次改动 → 线上跑的就是改动前源码。
   （副本不在 git 仓库里，缺 `vcs.revision=4c0107d` 构建信息，所以 sha256 不同属正常，体积一致。）
3. 部署脚本 `deploy-sealpwd-20261029.sh`：备份旧二进制 → 追加密钥进 runtime.env → 停/换/起 → health →
   跑 `bin/xuanresea`（先 `-dry` 再实跑）→ SQL 校验无残留明文 → 前端原子替换 → 回读验证；失败自动回滚。
4. 回滚备份：`bin/xuanmanager.previous-sealpwd-20261029`、`web.previous-sealpwd-20261029`、
   `runtime.env.previous-sealpwd-20261029`。

## 验证结果（2026-10-29 20:50）

- 线上二进制 sha256 `de47f71e…`，含 `SEAL_ERROR` 与「加密登录密码失败」；进程 22966 环境变量里确有 `XUAN_CREDENTIAL_KEY`。
- `runtime.env` 中 `XUAN_CREDENTIAL_KEY` 1 处；密钥临时文件已删，持久副本只在 runtime.env。
- `xuanresea` 实跑：处理 0 行（**机器人表当前为空，无存量明文需要回封**）；SQL 校验残留明文 = 0。
- 前端 `index-CcSNTgVz.js` 在线，内容含「密文保存在后台」；health 200；8891=xuanmanager、8893=chattool。
- 本地 `go vet` + `go test ./...` 全过；eslint + tsc + vite build 通过。

## 未验证 / 待办

- **端到端未验**：后台建机器人 → 库中应出现 `v1:` 密文 → worker 心跳拿到明文并登录。需要管理员登录态与在跑的 worker，
  交给主人操作；建 1 个测试机器人验证后可按 20:16 的方式清理。
- **密钥备份**：`runtime.env` 是密钥唯一持久副本。一旦丢失/改动，库里所有机器人密码永久解不开，只能逐个重置。
  建议主人另存一份离线备份（不要进 git）。
- 若以后更换 `XUAN_CREDENTIAL_KEY`，必须先用旧密钥跑 `bin/xuanresea` 重封，再换新密钥重启（`xuanresea` 支持
  「当前密钥解不开 → 用 DB 口令派生的兜底密钥解 → 重封」，仅覆盖旧兜底场景，不覆盖任意两次换钥）。

## 踩坑记录

- 首次部署最后一步用了 `ss -ltnp`，该服务器没有 `ss`，命令 127 触发回滚；更糟的是 `trap rollback ERR` 在
  rollback 返回 0 时**不会终止脚本**，于是回滚后又继续执行到「成功」分支并删掉了密钥临时文件。
  已改为 `trap 'rollback; exit 1' ERR`，端口检查改为 `(ss || netstat || true)` 非致命。回滚本身完整，
  重跑后一次通过。
- `strings` 不提取非 ASCII，「加密登录密码失败」用它查为 0 属误报，查中文串要直接 `grep -a` 二进制。
