# 2026-11-24 「额度授权记录」请求补 club_id + union_id

## 目录 / 分支

- 项目根：`/Volumes/SSD/qing`，分支 `codex/club-ui`。
- 只改客户端；未构建热更、未真机验证。

## 目标

`查询_联盟_授信_记录` 原来不传任何归属参数（按注释是让服务端按身份判定范围），
导致服务端定位不到当前俱乐部/联盟（多俱乐部账号、刚切过俱乐部时查不到记录）。
最终口径：**`club_id` 和 `union_id` 两个都带**（当天先做过只带 club_id、再改只带 union_id 两版，最后定两个都传）。

## 改动

- `assets/scripts/UI/panelQuotaGrantRecord.ts`
  - 引入 `normalizeRoomClubId` / `normalizeRoomUnionId` / `resolveRoomClubId` / `resolveRoomSettingUnionId`。
  - 新增 `ReadEntry()`：解析入口 `strUserData`，格式 `{"club_id":"...","union_id":"..."}`
    （JSON，同 panelClubPlayerInfo 惯例）；兼容纯 6 位字符串按 club_id 处理。
  - `ResolveClubId(account,fromEntry)`：入口值优先，否则 `resolveRoomClubId(account)`。
  - `ResolveUnionId(account,fromEntry)`：入口值优先，否则 `resolveRoomSettingUnionId(account)`（联盟共享房才有）。
  - `GetRecords` 报文按非空分别写 `club_id` / `union_id`；
    `requestContext` 拼进两个号（`union:grant-list:<clubId|->:<unionId|->:<page>:<ts>`）便于回包配对。
  - 类头协议注释由「不传 club_id」改为「club_id 与 union_id 都带」，说明范围仍由服务端按身份判定。
- `assets/scripts/UI/panelMain.ts`
  - 「额度授权记录」入口取 `grantClubId = ResolveRoomClub()` 与 `ResolveClubUnionId(grantClubId)`，
    通过 `showPanel(..., JSON.stringify({club_id,union_id}))` 透传；联盟未知时该字段为空串。

## 验证

- `node` + TypeScript 5.9.3 `ts.transpileModule`：两个文件各 0 诊断（仅语法）。
- 未跑 Creator 编译/构建，未在真机或网页实际点击验证报文。

## 下一步

- Creator 里编译脚本 → 构建热更 → 实机确认：大盟主（联盟总群主）与盟主都能查到列表；
  多俱乐部账号切到另一家俱乐部后再进页面，记录仍对应当前俱乐部/联盟。
- 若服务端对 club_id 与 union_id 的配对有校验（不一致就报错），需联调确认错误码与文案。
