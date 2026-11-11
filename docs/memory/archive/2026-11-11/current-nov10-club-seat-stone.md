# 2026-11-10 已归档条目（2026-11-11 归档）

## 2026-11-10 俱乐部「同步带入钻石」开关 + 后台兑换比例（后台已部署；客户端未构建）

- 创建规则弹窗新增「同步带入钻石」开关（默认关），勾选时 `创建_俱乐部_玩法` 带 `"special_rule": "入座扣钻"`；弹窗显示后台比例（`usr_hash_info.俱乐部积分对应钻石输赢比`，默认 1:1，0=不扣）。测试服已加 `club_room_play_info.special_rule` 并回填 play_id=24，**待重启**；规则列表按 `ClubPlayList.special_rule` 显示「带入钻石」，带入弹窗在房间含 token 时显示玩家钻石余额（prefab 与 drh8 场景都已补）。
- 后台「钻石消费价格」页把比例并入主列表、删「原金币价」列，统一确认/保存；复用 `configuration.stone_consume` 权限。Go/Web 已部署 8891（二进制 `123e56f5…`、前端 `index-D0v-JYHS.js`），回滚见[交接](../../handoffs/2026-11-10-club-seat-stone-ratio.md)。
- 客户端正式 prefab 已改（弹窗高度 1020→1080），1334/1624 布局通过；未 Creator 构建/真机。

