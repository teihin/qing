# 当前状态归档：2026-11-06 默认对话 / 俱乐部总积分

摘自 CURRENT.md（2026-11-08 归档）。

## 2026-11-06 默认对话只留盟主 / 大盟主（已部署）

- 玩家、合伙人的消息首页默认对话只剩 BF客服、盟主（未入盟为群主）、大盟主；直属上级合伙人等代理层级不再生成入口，历史会话降为普通会话。
- 22:28 部署 ChatTool `bce3b475…`（回滚 `bin/chattool.previous-defaultchat-20261106-2228`，旧 `c7f6cd15…`），健康 200、未登录 401；客户端缓存版本 1→2 待构建。详见[交接](handoffs/2026-11-06-default-chat-targets.md)。

## 2026-11-06 后台俱乐部列表新增「俱乐部总积分」（已部署）

- 俱乐部管理列表在「钻石池」后新增「俱乐部总积分」列，单位元；详情接口同字段一并返回。
- 游戏服 `查询_俱乐部_成员_总分` 的同步回包是空对象（数据只推玩家端 `AllPlayerGold`），后台拿不到；改为聚合 `tbl_Account.sm_club_gold/sm_club_gold2` 的 `{"俱乐部ID": 积分}` 映射，mode 2/3 优先 `*_2` 列，`-99` 不计入。
- 部署 19:14：二进制 `e9fd5d74…` + 前端 `index-6HAkVMKQ.js`（CSS 未变），回滚 `bin/xuanmanager.previous-clubtotalgold-20261106`、`web.previous-clubtotalgold-20261106`；health 200、未登录 clubs 接口 401。真实登录态目视待验。详见[交接](handoffs/2026-11-06-admin-club-total-gold.md)。

