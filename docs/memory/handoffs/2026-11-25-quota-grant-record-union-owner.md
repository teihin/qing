# 2026-11-25 「额度授权记录」按身份区分 club_id

## 目录 / 分支

- 项目根：`/Volumes/SSD/qing`，分支 `codex/club-ui`。
- 只改客户端脚本；未构建热更、未真机验证。

## 目标

`查询_联盟_授信_记录` 的归属参数按身份分：

- **大盟主（当前俱乐部所在联盟的总群主）**：看全联盟 → 只带 `union_id`，**不传 `club_id`**。
- **盟主（已入盟的俱乐部创建者）**：只看自己名下俱乐部 → `club_id` + `union_id` 都带。

## 改动

- `assets/scripts/UI/panelMain.ts`（`额度授权记录` 分支）
  - `showPanel` 的 strUserData 由 `{club_id,union_id}` 扩成
    `{club_id,union_id,is_union_owner}`，`is_union_owner = this.IsUnionOwnerOfClub(grantClubId)`
    （沿用「大盟主判定只认服务端结论、不落盘」的既有口径）。
- `assets/scripts/UI/panelQuotaGrantRecord.ts`
  - `ReadEntry()` 返回值增加 `unionOwner:boolean`，解析 `is_union_owner`（兼容 `true` / `1` / `"1"` / `"true"`）。
  - `GetRecords()` 新增 `sendClubId = !(entry.unionOwner && unionId !== "")`：
    大盟主只发 `union_id`；`requestContext` 里 club 段写 `-` 便于回包配对。
    **大盟主但 `union_id` 为空时仍带 `club_id`**，避免报文没有任何定位参数。
  - 类头协议注释同步为「按身份分」口径。

## 验证

- `node` + TypeScript 5.9.3 `ts.transpileModule`：两个文件各 0 诊断（仅语法）。
- 未跑 Creator 编译/构建，未实机抓报文。

## 下一步

- Creator 编译 → 构建热更 → 实机分别用大盟主 / 盟主账号点「我的 → 额度授权记录」，
  抓 `查询_联盟_授信_记录` 报文确认：大盟主无 `club_id`、盟主两者都有。
- 若服务端对大盟主缺 `club_id` 仍报错，需与服务端确认该分支已支持「只按 union_id」定位。
