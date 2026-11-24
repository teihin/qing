# 2026-11-24 客服上分同步增加盟主额度（已上测试服）

## 目录 / 分支

- 项目根：`/Volumes/SSD/qing`，分支 `codex/club-ui`。
- 只改 ChatTool（前端 + 后端）和 XuanManager 后端；**只部署测试服 `154.37.155.17`，正式服未动**。
- 未提交、未推送（工作区另有他人未提交的 `panelMain.ts` / `panelQuotaGrantRecord.ts` / `GameDef.ts`）。

## 目标

客服工作台「托管会话 → 上分」弹窗加一个「同步增加盟主额度」勾选，**默认勾选**：上多少分就给该俱乐部盟主同步增加多少额度。

## 关键结论：授信_联盟_额度 走不通，改用 发放_盟主_奖励

用户原本指定调 `授信_联盟_额度`。测试服实测（`885399` / union `947486`）：

```
GET 8890/hall/command?header=授信_联盟_额度&param={"club_id":"885399","quota_fen":1,...}
→ {"ret_code":769,"ret_result":{"error":"该俱乐部不在你的联盟里"}}
```

原因：该命令按**调用者自己的联盟**判定（`club_union_info.owner_guuid == 调用者`），而后台 `/hall/command` 固定用 `Hall.boss`，boss 没有联盟 → 恒失败。这与 `docs/memory/handoffs/2026-11-03-club-union-v2-gap.md:261` 记的「能力缺口」一致。

替代：`发放_盟主_奖励`（2026-11-13 上线，仅 `Hall.boss` / `level>=99`，语义同为「联盟池 → 盟主俱乐部」，写库类型 `额度奖励`）。实测：

```
GET 8890/hall/command?header=发放_盟主_奖励&param={"union_id":"947486","club_id":"885399","quota_fen":1,...}
→ {"ret_code":512,"ret_result":{"union_id":"947486","club_id":"885399","union_quota":"40231999","club_quota":"6123001"}}
```

## 改动

- `ChatTool/web/src/AgentApp.tsx`（`HostedGoldModal`）：新增 `syncQuota` 状态（默认 `true`），**只在 `action==='up'` 时渲染**勾选行；提交带 `syncUnionQuota: action==='up' && syncQuota`；响应里 `quotaSyncError` 拼进成功提示（红字警告，不改系统消息文案）。
- `ChatTool/web/src/styles.css`：`.hosted-gold-sync` 覆盖通用 `input`（否则 checkbox 被撑成 44px 输入框）与 `.transfer-modal > label > span` 的块级样式。
- `ChatTool/server/internal/api/hosting_gold.go`：`callXuanMemberGold` 加 `syncUnionQuota` 参数并透传；解析 `data.quotaSyncError` 返回；`handleHostedGold` 接收该字段（**仅上分时为 true**）、写审计、回传前端；HTTP 客户端超时 10s → **25s**（上分 + 授信串行）。
- `ChatTool/server/internal/api/hosting_gold_test.go`：同步改签名，新增 `syncUnionQuota` 透传与 `quotaSyncError` 回传断言。
- `XuanManager/server/internal/api/service_gold.go`：请求加 `SyncUnionQuota`；上分成功后调 `syncClubUnionQuota`：
  - 先读 `club_guuid_info.union_id` + `union_quota`；`union_id` 空 → 返回「该俱乐部未加入联盟，无法同步盟主额度」（**不静默跳过**，否则客服以为加了）；
  - 调 `发放_盟主_奖励`（`union_id` / `club_id` / `quota_fen` / `context = <上分 context>-quota`），`ret_code==512` 才算成功；
  - 回读 `union_quota` 期望 `before+delta`（6×400ms），不一致只警告不判失败；
  - 第二步失败**不回滚积分**，原因放 `data.quotaSyncError`；审计里同时记 `syncUnionQuota` / `quotaSyncError`。
- 文档：`ChatTool/docs/api.md`、`XuanManager/新后台管理系统接口文档.md` §9.11 各补一段（含「不要改回 `授信_联盟_额度`」的说明）。

## 验证

- `go vet` + `go test ./internal/api/`：ChatTool 通过；XuanManager 仅剩既有失败 `TestGameRegistrationHoneypotRejectsAndBansIP`（与本次无关）。前端 `tsc -b && vite build` 通过，产物含「同步增加盟主额度」。
- 端到端（测试服，service token 直调 8891）：
  - `{"delta":1,...,"syncUnionQuota":true}` → `{"message":"上下分成功","quotaSyncError":"","retCode":1280}`
  - 玩家 `937177` 俱乐部积分 1337 → 1338；俱乐部 `885399` 额度 6123001 → 6123002；联盟池 40231999 → 40231998；
  - `club_history_info` 新增 `额度奖励 6123001→6123002` 与 `添加积分 1338` 两条。
- **「授信_联盟_额度」被拒的那次上分本身已真实生效**（17:45:33 那一笔 `+1`，玩家积分 1336→1337），属预期内的小额测试；最终验证那笔再 `+1` → 1338。如需还原可手工下 2 分。
- 未做：真实客服账号登录后点选勾选框的 UI 验证（无客服凭据）；网页端视觉效果未截图。

## 部署（只测试服）

- 前端：`/www/html/.chattool/web` 原子替换，`index.html` sha `c67dfb08…`、`assets/index-CCJtSAUV.js` sha `2cbd5b4b…`（与本地 dist 一致）；回滚点 `web.previous-sync-union-quota-20261124-174026`。
- ChatTool 二进制：sha `ec68ba29…`（8,822,968 B），17:44:20 重启，health 200；回滚点 `backups/chattool.20261124-1740-rollback`。
- XuanManager 二进制：最终版 sha `1cdd9f52…`，17:50:39 重启，`/proc/<pid>/exe` 与磁盘一致，health 200；回滚点 `backups/xuanmanager.20261124-1750-rollback`（上一版 `…1740-rollback` 是「授信」版，别用于回滚到旧行为）。

## 踩坑

- **替换二进制后 `start.sh` 报「already running」= 跑的还是旧进程**：`stop.sh` 与 `install` 之间有窗口期，`supervise.sh` 会立刻拉起**磁盘上当时那份旧二进制**。现象是服务健康但新字段被 `DisallowUnknownFields` 拒成 `INVALID_JSON`。正确顺序：先 `install` 替换磁盘文件，再 `stop.sh` → `start.sh`；并用 `sha256sum /proc/<pid>/exe` 与本地构建比对确认。
- 测试服 `/tmp` 里有别的用户占用的文件（`Permission denied`），临时 body 放 `~` 下。
- `club_member_score_info` 是按天历史，**不是实时余额**；实时积分看 `tbl_Account.sm_club_gold`（JSON：`{"<clubId>": 分值}`）。

## 下一步 / 待拍板

- 是否要把勾选状态改成「记住上次选择」（现在每次打开默认勾选）。
- 若产品要求「额度从联盟池划出」必须记成 `额度联盟授信` 类型（而不是 `额度奖励`），需要服务端给 boss 开一条授信通道 —— 后台侧无法绕开。
