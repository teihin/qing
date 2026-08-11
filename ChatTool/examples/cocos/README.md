# Cocos 直接接入

游戏已在 `assets/scripts/UI/panelKefu.ts` 中直接实现 ChatTool 接入：读取当前 Account 的玩家ID、昵称、等级、平台、角色和房间，加入客服通道及当前秒级时间戳后用现有 `Tool.encrypt()` 加密，再打开：

```text
http://154.37.155.17/chattool/player?d=<AES密文>
```

“客服”传 `channel=general`；“VIP充值”和“VIP充值2”传 `channel=vip_recharge`。两类入口地址相同，由加密载荷决定进入哪个隔离通道。

`assets/scripts/logic/ConfigManager.ts` 已将该地址设为默认客服地址。线上哈希配置 `客服2` 如果会覆盖默认值，也必须更新成：

```text
http://154.37.155.17/chattool/player?d={info}
```

ChatTool 运行环境的 `CHAT_PLAYER_LINK_KEY` 必须和客户端 `Tool.encrypt()` 最终实际使用的口令一致。`panelKefu.ts` 传空字符串时，应配置 `Tool.aesKeyBytes()` 采用的有效默认口令，不能把服务端配置也留空。该口令随客户端发布，只用于避免普通用户直接读懂URL参数，不属于可靠身份凭据。
