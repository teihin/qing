# 内嵌客服输入框的键盘可见区

- 目录 `/Volumes/SSD/qing`，分支 `main`；本轮开始时工作区无未提交修改。用户报告客服纯网页输入可见，但嵌入客户端后键盘遮住输入内容，要求只改网页、避免重新安装客户端。客服顶部换肤的历史状态见[09-20 交接](2026-09-20-kefu-header-v8.md)。
- 仅改 `ChatTool/web/src/PlayerApp.tsx` 与 `styles.css`。`embed=game` 使用 `visualViewport.offsetTop + height` 与 `innerHeight` 的可见底边；全屏 WebView 完全不报告收缩时按原视口约 50% 预留键盘空间（最少 320、最多 500 CSS 像素），报告收缩时另留 32 像素缓冲。失焦短延迟恢复，避免点击发送按钮时布局先移动导致点击丢失。普通浏览器页、会话协议、原生层、游戏脚本与 Prefab 未改。
- 18:15 的首版曾把输入栏移到顶端；用户实测否定，要求贴近键盘上方。该版已被第二版替换，不应再作为现行方案。
- 18:23（北京时间）经用户此前本任务的部署授权重新构建部署第二版。`npm run build`、`npm run lint`、`git diff --check` 通过；先上传暂存、核对包与 HTML/JS/CSS 哈希，确认线上仍为首版后切换。当前静态目录 `/www/html/.chattool/web`，第一版回滚点 `/www/html/.chattool/web.previous-keyboard-position-20260924-102310`，发布前的旧版回滚点 `/www/html/.chattool/web.previous-keyboard-20260924-101558`。未重启 Go 后端或更换游戏包。
- 公网 `/chattool/` 首页 `c4ad4a71...`、JS `index-BRSZu21M.js`、CSS `index-B-ILFBg4.css` SHA-256 与本地构建完全一致，`/chattool/player` 与 `/chattool/api/health` 均返回 200。
- 用户在华为 Pura X 与小米 MIX 3 实测第二版：一台输入栏被键盘遮住下半部，另一台在键盘出现 1–2 秒后整页上跳。截图显示一个输入栏贴在键盘上沿且被遮，另一个输入栏跑到页上方并留下大块空白。定位到玩家端每 2 秒轮询消息并产生新数组，旧 `listEnd.scrollIntoView()` 每次都会执行，可能滚动外层 WebView。第三版改为仅在消息末条/数量或输入状态改变时设置 `.player-messages.scrollTop`，不再滚动外层页面；同时扩大未报告键盘高度时的预留空间。由 `normalViewportWidth` 在折叠机宽度变化时重置高度基线。
- 18:58（北京时间）第三版网页静态文件已部署；线上首页 `9a5f5529...`、JS `index-C3P7abHa.js`、CSS `index-B-ILFBg4.css` SHA-256 与本地构建完全一致，`/chattool/player` 和 `/chattool/api/health` 均为 200。第二版回滚点 `/www/html/.chattool/web.previous-keyboard-scrollfix-20260924-105600`，更早回滚点仍保留。`npm run build`、`npm run lint`、`git diff --check` 通过；未重启 Go 后端或更换游戏包。
- 第三版尚待用户在两台手机再次验收，未发送客服消息。若某机型完全不报告 IME 高度，网页无法直接获取准确键盘边界，当前预留值仍是近似值；需以实际设备反馈继续校准。用户于本轮明确要求提交并推送当前键盘改动。
