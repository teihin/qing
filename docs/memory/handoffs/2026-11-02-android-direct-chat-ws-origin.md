# 安卓直聊 WebSocket Origin 修复交接

日期：2026-11-02。目录 `/Volumes/SSD/qing`，分支 `codex/club-ui`。本次未提交、未推送；服务端修复已部署。

## 现象与目标

- 网页调试版能收到直聊新消息提醒；发布安卓包只有手动打开消息页才刷新。
- 目标是确认安卓直聊长连接是否建立，并定位网页与原生差异。

## 远程证据

- 通过安卓 `192.168.3.100:9527` 的 Cocos V8 Inspector 读取运行时：`cc.sys.isNative=true`、`os=Android`，全局存在 `WebSocket`。
- 安卓请求 `/chattool/api/direct/ws-ticket` 返回 HTTP 200，随后创建 `ws://154.37.155.17/chattool/api/direct/ws?ticket=...`；原生测试回调为 `onerror` 后 `onclose`，`readyState=3`，没有 `onopen`。
- 同一会话临时 ticket 由电脑直连同一公网 `ws://` 地址成功 `OPEN`，排除 ChatTool/Caddy 路由和 ticket 签发整体失效。
- 服务端现行 `handleWebSocket` 在消费 ticket 前执行 `originAllowed`；白名单只含网页调试来源和公网网页来源。用临时 ticket 对 `http://localhost`、`file://`、`null`、公网 IP 等非白名单 Origin 做原始 Upgrade 均返回 403；无 Origin 的电脑连接返回 101。

## 复核补充（同日第二轮，手机 192.168.3.109:9527）

- V8 Inspector 仍在 9527（不是 Creator 默认 6086）：`cc.sys.isNative=true`、`os=Android`、`typeof WebSocket=="function"`。
- 在手机运行时新建 `ws://154.37.155.17/chattool/api/direct/ws?ticket=probe`，结果为 `onerror`→`onclose`，`readyState` 由 0 变 3，无 `onopen`，与本机浏览器行为不同。
- 手机向电脑自建 TCP 探针发 `ws://192.168.3.111:9002/probe`，抓到的请求头为 `Origin: http://192.168.3.111:9002`。**原生 Cocos WebSocket 的 Origin 由连接地址推导成 `http://<host>`，即直连时固定为 `http://154.37.155.17`**（不是 `file://` 或 `null`）。
- 对线上 `ws` 路由做原始 Upgrade 对照：`Origin: http://154.37.155.17` → **403**；`Origin: https://154-37-155-17.nip.io` → 401（已过来源校验，仅票无效）。线上未设 `CHAT_DIRECT_CORS_ORIGINS`，实际生效白名单是默认值 `http://localhost:7456,http://127.0.0.1:7456,https://154-37-155-17.nip.io`。
- 403 由 ChatTool 自身返回，说明手机的握手请求已完整到达服务端，Caddy 反代与网络链路都通，唯一被拒的就是 Origin。
- 部署前线上 `bin/chattool` SHA-256 为 `897cb0a5…`；本地构建后上传并替换为 `368f80a8cfaa1ba53a6ef4f88efe8ac8cbc6e40669143d475710e03f795c0cbd`。

## 修改

- `ChatTool/server/internal/directchat/realtime.go`：带一次性 `ws-ticket` 的连接跳过网页 Origin 白名单；未带 ticket 的旧兼容连接继续执行来源校验。ticket 仍必须通过 `consumeWSTicket`、未过期且只能消费一次。
- `ChatTool/server/internal/directchat/realtime_test.go`：增加原生 Origin 放行与旧连接来源校验回归测试。

## 验证、部署与未完成

- `gofmt` 已执行；`go test ./...` 全绿；记忆结构检查 0 个错误。
- 已完成安卓运行时复现和电脑同 ticket 对照；尚未把 ChatTool 二进制部署到正式服务器，因此安卓包当前仍会复现旧问题。
- 已通过 `client_update@154.37.155.17:2233` 部署到 `/www/html/.chattool`：先停止服务，保留回滚文件 `/www/html/.chattool/bin/chattool.previous-android-origin-20261102-010509`，原子替换后由现有 `start.sh` 重启；本次未提交、未推送、未构建安卓包。
- 重启后本机健康检查和公网 `http://154.37.155.17/chattool/api/health` 均返回 200；带 `Origin: file://` 的无效 ticket 请求返回 `401 DIRECT_AUTH_REQUIRED`，说明已越过 Origin 校验并进入 ticket 鉴权，未知网页 Origin 也保持同样行为。
- 仍待用两个真实账号在已发布安卓包和网页调试版互发消息，确认大厅红点、提示音、消息页增量和断线重连；本次公网回归未使用真实会话 ticket。
