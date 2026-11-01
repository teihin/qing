# 俱乐部成员额度展示与授信

## 目标

成员列表中，代理成员在比例右侧显示当前额度；从头像打开玩家设置时，直属代理可以开通或调整额度。

## 当前实现

- `assets/scripts/UI/ClubManagementApi.ts`
  - 注册 `GetClubQuota`。
  - 新增 `getQuota(club,user)`，解析 `quota_fen`、`is_agent`、`is_granted`。
  - 新增 `grantQuota` → `授信_俱乐部_额度`，发送 `quota_fen`。
  - 已授信后的增加/减少拆成 `increaseQuota` / `decreaseQuota` 两个动作，都调用额度转移接口 `授信_俱乐部_额度`；增加发送正 `quota_fen`，减少发送负 `quota_fen`。
  - 授信成功 `GC_OK` 无 `context`，在唯一授信请求上安全兜底；查询先接收同步受理，再等待 `GetClubQuota` 异步数据。
- `assets/scripts/UI/ClubManagementView.ts`
  - 代理行查询额度；只有 `is_agent && is_granted` 才显示「额度」和值。
  - 玩家设置的额度行只对代理显示；操作者有直属代理管理权限时显示「开通额度/调整额度」。输入支持元和两位小数，换算为分，0 有效。
  - 授信成功后刷新成员列表并重新查询目标额度。
- `assets/resources/UI/panelMain.prefab`
  - 成员行和下级成员行在比例右侧新增「额度/额度值」节点。
  - 玩家设置使用与备注/比例相同的两行：代理始终显示「开通额度 / 开通（已授信时显示已开通）」；只有已授信时才显示「调整额度 / 当前值 / 增加 / 减少」，未授信时调整行隐藏。

## 验证

- `ClubManagementApi.ts`、`ClubManagementView.ts` TypeScript 转译无诊断。
- `tools/test_club_joiner_protocol.js` 通过。
- 独立桩回归覆盖无 context 的 `GC_OK` 和带 context 的 `GetClubQuota` 异步关联。
- Prefab JSON、额度节点引用和新增 `PrefabInfo.fileId` 检查通过，`git diff --check` 通过。
- 机器上未直接安装 `typescript`，验证使用已有 nexe 内 TypeScript 运行库。

## 待验证

Creator 重新导入 Prefab、真实俱乐部数据回包、网页/构建产物和 Android/iOS 真机交互尚未执行；后台权限和额度仍以服务端最终校验为准。

## 同日补充：俱乐部模式赠送金币

- “我的”页直赠入口 `panelMain.ts`、成员设置弹窗 `panelGivePad.ts`、俱乐部房间玩家头像弹窗 `panelUserInfo.ts` 已按当前俱乐部模式统一发 `添加_俱乐部_成员_积分`，参数为 `club_id`、`user_id`、`user_add_gold`。
  **2026-11-01 晚修正**：“赠送”语义的入口不能用这条代理发筹码的接口——「我的」页直赠已改发 `赠送_俱乐部_积分`（扣自己账户积分、不动额度）。成员设置与牌桌头像两处暂未改（成员设置实为管理员给成员发分，走赠送接口会受“同一授信代理”限制）。
- 牌局内仅当 `Account.roomSetting` 含 `club_id` 才判定为俱乐部模式；普通房和无当前俱乐部的旧入口继续使用 `调用_方法_Exchange2`。
- 服务端更新后，三条俱乐部赠送路径均要求交易密码：脚本从现有密码输入框取值，空值拦截，命令新增 `user_pwd`；成员设置/头像入口成功后 fire `ClubGoldGiftChanged` 刷新大厅记录。
- 服务端回包的 `context` 可能是 `添加_俱乐部_成员_积分_club:gold:...`，不是直接以 `club:` 开头；`panelMain` 已截取 `club:` 后再分派，失败 `0x301` 会展示 `result.error`。赠送弹窗成功、关闭和下次打开都会清空输入，并用 pending 标记避免旧回包影响新弹窗；“请先设置交易密码”的确认回调会直接打开初始化交易密码界面，成员设置赠送会先关闭赠送弹窗。
- “我的 → 赠送”记录在有当前俱乐部时请求 `查询_俱乐部_成员_积分_添加_记录`；真实回包同步返回空 `result`，随后由 `AddMemberGoldList` 推送，行字段为 `guuid / name / gold / date`，客户端已兼容该事件、包装和字段映射。
- TypeScript 转译、赠送/密码/金币流水回归、静态请求断言和协议桩回归通过；未做 Creator、真实服务器、构建或真机验证。
- 兑换钻石弹窗同步按当前俱乐部切换资金：读取 `Account.club_gold`，发送 `reqExChange2(..., "gold,<club_id>")`，无俱乐部隐藏入口/关闭弹窗，顶部金币显示 0，并监听 `set_club_gold` 刷新余额；真实服务器兑换回包仍待联调。
- 无俱乐部时隐藏大厅赠送/兑换入口、牌桌兑换入口和牌桌玩家资料赠送按钮，避免再进入平台金币旧链路。
