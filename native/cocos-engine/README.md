# Cocos 引擎补丁：尾点域名无法建立 WebSocket

## 问题

CDN/高防下发的是带尾点的 CNAME（`xxx.hcnamedns.com.`），客户端用它连 KBE 时报
`onerror_before_onopen error:undefined`，服务端完全收不到连接。

排查结论：DNS 能解析（系统 `getaddrinfo` 正常）、TCP 能连通（`toybox nc` rc=0），
但 Cocos 的 libwebsockets 实现无法用带尾点的 `address` 建连。

## 改法

文件：`/Applications/Cocos/Creator/2.4.13/CocosCreator.app/Contents/Resources/cocos2d-x/cocos/network/WebSocket-libwebsockets.cpp`
位置：约第 1046 行，`WebSocketImpl` 构造 `lws_client_connect_info` 处。

只把「建连地址」去掉尾点，**`connectInfo.host` 保持原样**：

- `connectInfo.address` → DNS 与 TCP 连接用，去尾点（否则解析失败）
- `connectInfo.host` → 握手时发出的 `Host:` 头，保留尾点（高防按 Host 识别站点）

两者是 lws 的独立字段，互不影响。若把 Host 也去尾点，高防会返回 `403 Server: Beaver`。

## 重放

Creator 升级或重装后补丁会丢失，重新打：

```bash
patch -p0 "/Applications/Cocos/Creator/<版本>/CocosCreator.app/Contents/Resources/cocos2d-x/cocos/network/WebSocket-libwebsockets.cpp" \
  < native/cocos-engine/websocket-trailing-dot-host.patch
```

或手动按 `websocket-trailing-dot-host.patch` 里的 diff 改。

## 回滚

```bash
cp native/cocos-engine/WebSocket-libwebsockets.cpp.orig \
  "/Applications/Cocos/Creator/2.4.13/CocosCreator.app/Contents/Resources/cocos2d-x/cocos/network/WebSocket-libwebsockets.cpp"
```

## 编译生效条件

Android Studio 的 NDK 编译直接读 Creator 包内这份源码，无需额外配置。但必须：

1. `Build → Clean Project` 后再 Build（否则 Gradle 可能判定 `buildNdkBuildDebug` UP-TO-DATE 直接跳过）
2. 确认 Build 输出里 `:qing:buildNdkBuildDebug[arm64-v8a][cocos2djs]` 不是 UP-TO-DATE
3. 确认 `app/libs/<abi>/libcocos2djs.so` 的修改时间已更新

## 注意

- 只影响 Android。iOS 走 `cocos/network/WebSocket-apple.mm`（NSURLSession 实现），未改动。
- 修改 `.app` 内部文件会破坏其签名，不影响 AS 编译；若 Creator 启动异常，用上面「回滚」恢复。
- 若本补丁无效（连接仍失败），升级方案：在 C++ 层自行 `getaddrinfo` 解析成 IP 后赋给
  `connectInfo.address`，彻底绕开 lws 的域名处理，`host` 仍保留原域名。
