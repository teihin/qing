# Cocos 游戏内嵌接入

游戏已在 `assets/scripts/UI/panelKefu.ts` 中直接实现 ChatTool 接入：读取当前 Account 的玩家ID、昵称、等级、平台、角色和房间，加入客服通道及当前秒级时间戳后用现有 `Tool.encrypt()` 加密，再通过全屏透明 `cc.WebView` 打开：

```text
http://154.37.155.17/chattool/player?d=<AES密文>
```

“客服”传 `channel=general`；“VIP充值”和“VIP充值2”传 `channel=vip_recharge`。两类入口地址相同，由加密载荷决定进入哪个隔离通道。

游戏内会自动追加 `embed=game`，只显示文字、图片和视频，并以半透明背景覆盖牌桌；不显示跳出浏览器按钮。独立网页版仍可继续使用不带 `embed=game` 的原地址。

`assets/scripts/logic/ConfigManager.ts` 已将该地址设为默认客服地址。线上哈希配置 `客服2` 如果会覆盖默认值，也必须更新成：

```text
http://154.37.155.17/chattool/player?d={info}
```

ChatTool 运行环境的 `CHAT_PLAYER_LINK_KEY` 必须和客户端 `Tool.encrypt()` 最终实际使用的口令一致。`panelKefu.ts` 传空字符串时，应配置 `Tool.aesKeyBytes()` 采用的有效默认口令，不能把服务端配置也留空。该口令随客户端发布，只用于避免普通用户直接读懂URL参数，不属于可靠身份凭据。

Creator 重新生成原生工程后还要执行：

```text
python3 tools/sync_android_chat_webview.py
python3 tools/sync_ios_chat_webview.py
```

Android 脚本补齐系统图片/视频选择回调；iOS 脚本加入透明 WKWebView 桥和相册权限说明。脚本不修改根目录 `runtime-src.zip`。
