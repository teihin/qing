# 游戏内嵌客服接入

## 当前方案

ChatTool 不要求 KB 调用授权接口。Cocos 客户端直接读取当前已登录 Account 的玩家资料，使用项目已有的 `Tool.encrypt()` 生成 AES 密文，再把玩家聊天页加载到游戏内全屏 `cc.WebView`：

```text
http://154.37.155.17/chattool/player?d=<加密后的玩家资料>
```

游戏内实际追加 `embed=game`。玩家页把密文和嵌入标志提交到 `POST /api/player/session`；ChatTool 解密、校验字段和时间戳、创建玩家会话，然后立即把 `d` 参数从地址栏清除。URL 中不出现明文玩家ID或昵称。嵌入页使用透明文档和半透明聊天背景，牌桌仍可见；游戏内只显示文字、图片和视频入口，不显示普通文件或外部浏览器按钮。

原来的独立手机网页仍保持兼容：直接访问同一个 `/player?d=...` 且不带 `embed=game`，继续使用完整网页版界面和 HttpOnly Cookie，不受游戏内简化样式影响。

## 三端媒体兼容

- Web/PWA：Cocos WebView 使用 iframe。服务端只允许 `/player` 被嵌入，客服后台和 API 仍禁止装入第三方页面。
- 跨站 iframe 可能拦截 SameSite Cookie，因此嵌入模式会额外返回只保存在当前 WebView `sessionStorage` 的玩家会话令牌；它不进入 URL。图片和视频使用30分钟、单媒体和单会话限定的临时访问票据回显，不把完整会话令牌放入媒体 URL。
- Android：Creator 2.4.13 默认 `WebChromeClient` 不处理 HTML 文件选择。项目级桥为 `native/android/chat/QingChatWebViewBridge.java`，Creator 重新生成 Android 工程后运行 `python3 tools/sync_android_chat_webview.py`。
- iOS：WKWebView 使用系统相册/视频选择能力。项目级桥位于 `native/ios/chat/`，负责透明背景；同步脚本同时写入相册和相机用途说明。Creator 重新生成 iOS 工程后运行 `python3 tools/sync_ios_chat_webview.py`。
- 两个同步脚本均为幂等脚本，可以重复执行；根目录旧 `runtime-src.zip` 不参与本方案，也不应被覆盖。

## 加密内容

`assets/scripts/UI/panelKefu.ts` 当前发送：

```json
{
  "playerId": "123456",
  "nickname": "玩家昵称",
  "level": "50",
  "platform": "android",
  "channel": "general",
  "metadata": {
    "角色": "普通玩家",
    "当前房间": "888888"
  },
  "ts": 1786442400
}
```

客服通道使用稳定代码而不是中文名称：

- 游戏内“客服”：`general`，显示“普通聊天客服”。
- 游戏内“VIP充值”和“VIP充值2”：`vip_recharge`，显示“VIP充值客服”。

服务端对缺少 `channel` 的旧客户端默认使用 `general`。未知或停用通道会被拒绝。会话复用、自动派单、在线客服数、消息/媒体权限和实时事件都按通道隔离。

`ts` 是客户端当前秒级时间戳，默认15分钟内有效，可通过 `CHAT_PLAYER_LINK_TTL` 调整。后端也兼容旧字段 `vipid`、`phone` 和 `name`。已经发布的旧客户端没有 `ts`，服务端会暂时接受该格式并在玩家资料中标记“旧客户端（无时间戳）”；此类旧链接无法限制重放，只应作为平滑升级兼容，后续客户端覆盖率足够时应删除。

## 地址与口令

- `assets/scripts/logic/ConfigManager.ts` 默认值已经改为 `http://154.37.155.17/chattool/player?d={info}`。
- `panelKefu.ts` 的普通和两个VIP入口均使用同一ChatTool地址和同一轻量加密口令，仅加密载荷中的 `channel` 不同。
- 如果服务器哈希配置 `客服2` 会覆盖默认值，也要把它更新为同一个模板。
- ChatTool 运行环境必须设置 `CHAT_PLAYER_LINK_KEY`，内容与客户端 `Tool.encrypt()` 最终实际使用的口令一致。`panelKefu.ts` 传空字符串时，`Tool.aesKeyBytes()` 会换成客户端内置默认口令，服务端应配置该有效口令而不是空字符串。
- 口令和明文资料不打印到客户端日志；`panelKefu.ts` 只打开最终密文URL。

## 能力边界

这套方案满足“URL中不是明文，普通用户看不懂玩家信息”的轻量要求，但它不是可靠身份认证：加密口令必须随客户端发布，懂逆向或脚本调用的人仍可能提取口令并伪造玩家ID。客服工作台会把资料来源显示为“游戏客户端（轻量加密，未服务端认证）”。

纯 HTTP 下后续聊天文字、图片和视频仍没有传输加密；本方案只隐藏入口URL中的玩家资料。

游戏内页面依赖当前基础包包含对应 Android/iOS 桥。只发布 Web/ChatTool 服务端不能给已经安装的旧原生包补上 Android 文件选择回调；客户端正式发布前必须由 Creator 重新构建，并在原生工程生成后执行相应同步脚本。
