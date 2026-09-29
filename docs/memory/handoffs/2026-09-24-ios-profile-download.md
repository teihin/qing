# 苹果描述文件下载入口核查：额外修复已撤回

- 目录与分支：`/Volumes/SSD/qing`，`main`；未提交、未推送。
- 现象：iPhone Safari 下载记录有 BY 文件，但设置里没有待安装的描述文件。
- 已确认原因：服务器日志中的实际 iPhone 请求为 `http://154.37.155.17/webhome/downloads/BY.mobileconfig`，此 IP 入口没有返回 `Content-Type`；正式 HTTPS 域名原本正确返回 `application/x-apple-aspen-config`。新旧描述文件主要差别为游戏地址和图标，文件结构有效；不能把域名请求的检查结果用于证明 IP 入口正常。
- 用户决定：只支持正式 HTTPS 域名，撤回这次苹果问题的额外改动。入口为 `https://154-37-155-17.nip.io/webhome/`。
- 已撤回：按钮改链接、移除延迟跳转、CSS、强制正式域名下载、`inline` 响应、IP 自动跳转及相关脚本/示例修改。服务器原始路由文件和定时恢复脚本从本次修改前备份恢复；IP 跳转路由已删除。客服键盘修改保留。
- 已验证：恢复后重新发布成功；公网 HTML、JS、CSS、描述文件逐字节与原版一致，HTTPS 描述文件返回 HTTP 200、正确 MIME 和原有 `attachment`。`WebHome` 与 `tools/webhome_caddy_headers` 没有本次代码差异。未代替用户执行 iPhone 真机安装。
- 避免：未先核对实际访问 URL 就修改描述文件/按钮；先前仅修改 `inline` 和按钮未解决实际 IP 入口问题，没有证据需要保留。
