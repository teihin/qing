# 收尾：侧边栏折叠、清测试数据、机器人表单精简、密码明文

目录 `/Volumes/SSD/qing`，分支 `codex/club-ui`。**均已部署到正式（后端 v6 / 前端 index-IE64Hwkm.js），git 未提交。**

这一批全是同一天 20:07–20:22 的零散收尾，单独一篇，避免和
[策略运行参数](2026-10-29-automation-strategy-runtime.md)、[Worker 俱乐部模式](2026-10-29-worker-club-mode.md)混在一起。

## 1. 侧边栏一级菜单可折叠（20:07 + 20:12 修 bug）

> 后台网站左边二级菜单大项不能折叠，导致列表很长 → 支持折叠。
> 一级菜单文字很小 → 保持和二级菜单一样大小，另外默认折叠。
> 「现在展开不了了」→ 修。

- `web/src/components/Layout.tsx`：一级模块标题从 `<p>` 换成 `.nav-group__toggle` 按钮（带旋转箭头
  `.nav-group__arrow`），折叠态存 `localStorage["xuan.nav.collapsed.v2"]`；**默认折叠**，切到某页时自动展开它所在的组。
- `web/src/styles.css`：`__toggle` 字号 15px（与二级一致）、字重 700；`.nav-group.is-collapsed > .nav-link { display:none }`；
  ≤820px（76px 图标态）与 ≤620px（底部横向栏）强制不折叠并隐藏组标题，避免和原有窄屏布局打架。
- **踩坑**：默认折叠用 `current[key] !== false` 判断后，`toggleGroup` 里又写成 `[key]: current[key] !== false`
  （把"当前是否折叠"原样存回），结果永远折叠、点不动。修正为取反：
  ```js
  const collapsedNow = current[key] !== false;
  const next = { ...current, [key]: !collapsedNow };
  ```
  用 node 跑纯状态机（折叠→展开→折叠→展开）验证后才构建部署。
  **教训：交互逻辑不能只靠 tsc/eslint，至少要过一遍纯函数状态机。**
- 只换前端静态目录（`web.previous-navfold-20261029` 备份），后端未重启。

## 2. 清除自动化模块测试数据（20:16）

清前存量：club 1（567671 / 邀请码 773744）、robot 3（`Tmm000000001`~`003`，10-27 建，1 号跑过 348 局）、
worker 1（`mac-mini-2-local`，offline）、worker_event 10902、worker_command 1、strategy 1（用户 19:57 刚建）。

- 备份：`/www/html/.xuanmanager/backups/automation-backup-20261029-2015.sql.gz`（180K，8 张表）。
- **坑**：`mysqldump` 必须加 `--no-tablespaces --skip-lock-tables`（`webcm_user` 缺 PROCESS / LOCK TABLES），
  否则 stderr 被重定向后静默产出 344 字节空包。完整命令见 `SERVER-NOTES.md`。
- 删除：session_event / session / task / alert / worker_event / worker_command / robot / club；
  robot、club 的 AUTO_INCREMENT 重置为 1。
- 保留：strategy（用户刚建的「正常策略」，draft）、worker（本地节点记录）、group / credential / ip_pool（本来空）。

## 3. 机器人创建/编辑表单精简（20:19）

> 创建机器人时的「智力」「默认带入倍数」没用，不应该在这里设置；「添加后参与调度」也没用，分配了就可以被调度了。

- 创建弹窗删掉这三项，提交固定传 `intelligence:0 / buyinMultiple:1 / enabled:true`。
- 编辑弹窗删掉智力与带入倍数输入框（原值回传，避免被清零），**保留启用开关**（列表也有停用按钮，双入口无害）。
- 后端接口未动（字段仍在，只是前端不再让填）。
- 只换静态目录（`web.previous-*` 备份），前端 `index-C23J2q0r.js`。
- 遗留可选项（未做，等确认）：机器人列表「智力」列是否也删掉；编辑弹窗的启用开关是否删掉。

## 4. 机器人登录密码改明文（20:22）

> 创建机器人输入的密码可以明文保存，这样下发给 worker 的时候才不用解密。

- `server/internal/api/automation_robots.go`：批量创建与编辑重置密码都不再调 `security.SealCredential`，
  直接存明文，并删掉该文件对 `security` 的 import。
- `server/internal/api/automation_agent.go`：心跳下发按前缀分流 —— `v1:` 开头走原解密（兼容老数据），
  其余当明文直接下发：
  ```go
  if strings.HasPrefix(sealedPassword, "v1:") {
      plain, err := security.OpenCredential(key, sealedPassword) // 解不开只 warn，不阻塞
      ...
  } else {
      item.Password = sealedPassword
  }
  ```
- 前端 `AutomationRobotModals.tsx` 文案改为「密码以**明文**保存在后台（游戏服只存 MD5）」。
- 部署：后端 20:22 重启 PID 18006，前端 `index-IE64Hwkm.js`，health 200。
- **已知风险**：库、备份、任何能读 `webcm` 库的账号都能直接看到明文密码；游戏服侧仍只写 MD5。

## 5. 密码的「两全方案」（20:50 已实施）

> 状态：本节方案已于 20:50 落地并部署（密文落库 + 独立 `XUAN_CREDENTIAL_KEY` + `cmd/xuanresea` 回封工具），
> 详见 [机器人密码改回密文](2026-10-29-robot-password-sealed.md)。以下为当时的分析记录，保留备查。

主人追问：「又不是明文，也能避免后续下发不知道真实密码」——答案是**这两件事本来就不冲突**：
密文只影响"存在库里长什么样"，下发那一刻后端掌握密钥，随时能解出真实密码，
所以"存密文"不会导致任何"不知道真实密码"的问题。

推荐做法（改动量极小，当前下发链路已兼容，不用改）：

1. 库里恢复存密文：`automation_robots.go` 创建/改密码时改回 `security.SealCredential(s.credentialKey(), pwd)`，
   存 `v1:<base64>`；心跳下发那段**不用动**（已经认 `v1:` 前缀）。
2. 把密钥从"库旁边"挪走：显式设置环境变量 `XUAN_CREDENTIAL_KEY` 为一串独立随机值。
   现在 `config.go` 的兜底是 `CredentialKey == ""` 时**回落成 DB 密码**，而 DB 密码就写在服务器配置文件里 ——
   配置文件和库在同一台机器上被拿到时，加密等于没有。设了独立 env 之后，泄露面从
   「库 + 备份 + 任何能读 webcm 的账号」缩小到「能拿到服务器进程环境的人」。
3. 已存的明文批量回封：一条 `UPDATE ... SET login_password = ...` 需要后端临时接口或在服务器上跑一次性 Go 脚本
   （不能纯 SQL，AES-GCM 得在代码里做）。**未做，等确认。**

取舍：明文的好处只有"少一次解密调用"，而心跳本来就会解密；坏处是任何只读库的权限都等于拿到全部机器人账号。
**建议切回密文 + 独立密钥。**

## 6. 部署记录（2026-10-29）

| 时间 | 内容 | 后端 PID | 前端 hash |
| --- | --- | --- | --- |
| 19:07 | v1 策略管理首版 | — | — |
| 19:18 | v2 策略字段精简 + 打牌阈值参数化 | 6801 | `index-CsmgraLi.js` |
| 19:47 | v3 策略职责重新划分（动作智力 vs 投放） | 11576 | `index-D_lFC4LH.js` |
| 19:52 | v4 参数改名 + 三档安全线加标签（仅前端） | 不变 | `index-BRcv-Obr.js` |
| 20:02 | v5 投放策略/输赢必选 | 14309 | `index-ZIruxfSC.js` |
| 20:07 | 侧边栏折叠（仅前端） | 不变 | `index-D7ckNPAW.js` |
| 20:12 | 折叠点不开修复（仅前端） | 不变 | `index-DfTDc9IC.js` |
| 20:19 | 机器人表单精简（仅前端） | 不变 | `index-C23J2q0r.js` |
| 20:22 | v6 密码明文 | 18006 | `index-IE64Hwkm.js` |

- 迁移 `038_automation_strategy_runtime.sql` 已执行（菜单 `id=47` 恢复可见 + `strategy_id` 索引）。
- `bin/xuanagent` 已重编（8.2M，`bin/` 不在 git 跟踪内）。
- 备份留存：多份 `web.previous-*` 与 `bin/xuanmanager.previous-*` 在服务器 `/www/html/.xuanmanager/`。

## 7. git 状态：全部未提交

分支 `codex/club-ui`，21 项改动：

- 已改：`agent-client/client.js`、`agent-client/strategy.js`、
  `server/cmd/xuanagent/{client,terminal}.go`、`server/internal/api/automation_{agent,clubs,ops,robots}.go`、
  `web/src/components/Layout.tsx`、`web/src/pages/automation/{AutomationDeployPage,AutomationRobotModals,AutomationStrategiesPage,shared}.tsx`、
  `web/src/styles.css`、两个 topics 文档。
- 新增：`server/internal/api/automation_strategy_test.go`、`server/migrations/038_*.sql`、两篇 handoff。

**注意**：`main` 与 `codex/club-ui` 是两条产品线，这批只提 `codex/club-ui`，不要带到 main。
