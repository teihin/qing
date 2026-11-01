# 牌桌内统一使用俱乐部金币

日期：2026-11-01
目录：`/Volumes/SSD/qing`
分支：`codex/club-ui`
状态：代码已改，未构建、未真机、未做真实服务器带入回包验收

## 目标

依据《俱乐部积分与额度方案-客户端接口文档》，俱乐部房内涉及玩家余额、带入和兑换的客户端路径统一按当前房间 `club_id` 使用 `Account.club_gold`。普通大厅/普通房继续使用平台金币。

## 改动

- `assets/scripts/logic/RoomClubContext.ts` 增加当前房间俱乐部 ID 的严格读取，以及 `Account.club_gold` 映射解析；缺失、非法值和 `-99` 按 0 处理。
- `panelGameView.ts` 的带入窗口改读俱乐部金币并监听 `set_club_gold`；带入请求按当前房间 ID 发送，俱乐部余额不足/额度不足提示不再引导平台充值；普通房保留平台金币逻辑。
- 补分快捷入口也先刷新带入窗口余额，避免窗口从旧状态打开后仍显示旧的普通金币余额/提示。
- 牌桌聊天余额、牌桌玩家资料充值入口、牌桌兑换入口按俱乐部房上下文处理。
- `RoomInviteManager.ts` 对带 `club_id` 的邀请按俱乐部金币判断最低带入，进入房间继续携带该邀请的俱乐部 ID。
- `panelCreateRoom.ts` 在创建当前俱乐部房时显示该俱乐部金币。
- 复查全量金币余额入口后，补上大厅进入俱乐部房失败码 `0x304` 的提示：有当前俱乐部时显示“俱乐部金币不足”，无俱乐部仍显示普通“钱不够啦”。
- 其余直接读取 `Account.gold/gold2` 的位置均为普通房/无俱乐部回退，或独立的 Bigball、活动、后台模块；牌桌 `nGoldNum/money_score/init_money` 是服务端下发的牌局积分/筹码字段，不应替换成客户端账户余额。

## 验证

- 8 个修改脚本使用项目现有 TypeScript 5.9.3 `transpileModule` 转译无诊断。
- `node tools/room_invite_logic_mock_regression.js` 通过。
- 临时兼容桩执行买入回归的数值配置、带入请求、普通补分和取消清理断言通过；仓库原测试缺少 `cc.isValid` 桩，且其 Prefab 基线快照与当前 `panelGameView.prefab` 已不一致，完整脚本不能据此判定资源回归。
- `git diff --check` 通过；未执行 Creator 导入/预览、正式构建、真机和真实服务器回包。

## 后续

在 Creator 导入后用有俱乐部积分和无积分账号分别验证：打开带入窗口、俱乐部金币变化刷新、普通房回归、邀请最低带入、兑换 `gold,<club_id>`、额度不足提示，以及牌桌头像资料页不再出现平台充值入口。
