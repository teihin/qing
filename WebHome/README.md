# 8L 官方下载站

这是一个零依赖静态下载站，支持：

- 自动识别 iPhone、iPad、Android 和桌面浏览器。
- 识别微信、QQ、微博、抖音、支付宝等内置浏览器并给出切换提示。
- Android 下载正式 APK。
- iPhone/iPad 通过 `.mobileconfig` 安装全屏 Web Clip；即使进入同域的客服、语音等其他路径，也继续保持无 Safari 地址栏的全屏模式。
- iPhone 非 Safari 浏览器引导复制地址并切换 Safari。
- 桌面和手机响应式布局、刘海屏安全区、减少动画偏好和键盘关闭弹层。

## 目录

```text
WebHome/
├── index.html
├── styles.css
├── app.js
├── site-config.json
├── assets/
├── downloads/
│   ├── 8L.mobileconfig
│   └── 8L.apk              # 上传时由app/release唯一APK映射，不需手工复制
└── scripts/generate_mobileconfig.py
```

## 修改发布配置

所有下载地址集中在 `site-config.json`：

- `promotionSiteUrl`：推广下载站正式访问地址。
- `androidApkUrl`：Android APK地址。
- `iosProfileUrl`：苹果描述文件地址。
- `iosGameUrl`：安装到桌面后打开的游戏网页，目前为 `https://154-37-155-17.sslip.io/web-mobile/`。

修改 `iosGameUrl`、名称、组织或描述后，必须重新生成描述文件：

```bash
python3 WebHome/scripts/generate_mobileconfig.py
plutil -lint WebHome/downloads/8L.mobileconfig
```

## 本地预览

在项目根目录运行：

```bash
python3 -m http.server 7460 --directory WebHome
```

打开 `http://127.0.0.1:7460/`。可以使用查询参数检查不同展示：

- `?platform=android`
- `?platform=ios&browser=safari`
- `?platform=desktop`

## 正式部署

1. 确保Cocos Android生成目录的`app/release/`第一层只有一个已签名并经过真机验证的APK，文件名不限。
2. 重新执行描述文件生成脚本并通过 `plutil -lint`。
3. 把整个 `WebHome` 目录上传到静态服务器。
4. 为 `.mobileconfig` 返回 `application/x-apple-aspen-config`，为 `.apk` 返回 `application/vnd.android.package-archive`。
5. 用Android系统浏览器、iPhone Safari、微信和QQ内置浏览器分别检查一次。

也可以在项目根目录双击 `4上传推广网站.command`。脚本会重新生成并校验描述文件，从`build/jsb-link/frameworks/runtime-src/proj.android-studio/app/release/`读取唯一APK，打包后上传到服务器 `/www/html/webhome`，原子替换目录并把上一版保留在 `/www/html/.webhome.previous`。如果服务器APK的SHA-256与本地一致，本次ZIP不会包含APK，切换网站时直接沿用服务器文件，避免重复传输约几十MB内容。

`Caddyfile.example` 提供了部署到 `/webhome/` 的示例。`.mobileconfig` 当前未做证书签名，安装时iOS会显示描述文件信息并要求玩家在“设置”中确认；如面向大量陌生用户分发，建议使用可信证书签名以降低用户疑虑。

## 重要边界

- `.mobileconfig` 只是把网页入口添加到iPhone/iPad桌面，不是IPA，也不把Cocos资源离线安装进手机。
- 玩家下载描述文件后需要在8分钟内进入“设置 → 已下载描述文件”完成安装。
- 清理Safari网站数据可能清除网页版设备标识；Web Clip不能提供原生设备ID保证。
- 网页语音仍受HTTPS/WSS和浏览器麦克风权限约束。
