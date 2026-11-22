# BF 官方下载站

这是一个零依赖静态跳转站（2026-11-22 起不再站内发文件）：

- 自动识别 iPhone、iPad、Android 和桌面浏览器。
- iPhone/iPad 点击主按钮跳转苹果安装页（不自动跳，先给用户看落地页）。
- Android 点击主按钮跳转安卓下载页。
- 桌面浏览器提供两个平台的入口按钮。
- 响应式布局、刘海屏安全区、减少动画偏好。

跳转地址取值顺序（前者优先）：

1. 后台「系统配置 → 游戏推广下载地址」配的两个地址，落地页用本目录下的
   `links.json` 读取（Caddy 内部转给后台只读接口，页面里不会出现 `/xuanmanager`）。
2. 同目录 `site-config.json` 的 `iosInstallUrl` / `androidInstallUrl`（接口不可用时的兜底）。
3. `app.js` 里的 `DEFAULT_CONFIG`。

当前地址：苹果 `https://dgwsd.yycdzx.com/UMuGWv`，安卓 `https://www.gulubase.com/bf888`。
公网地址只用于上传脚本打印，可用 `--public-url` 指定。

## 目录

```text
WebHome/
├── index.html
├── styles.css
├── app.js
├── site-config.json
├── assets/
├── downloads/          # 仅本机留档，不发布到公网（含历史服务器地址）
│   └── BF.mobileconfig
└── scripts/generate_mobileconfig.py
```

## 旧版站内文件（仅历史保留）

`downloads/BF.mobileconfig` 与 `scripts/generate_mobileconfig.py` 是改版前的苹果 Web Clip 安装流程，
页面已不再引用。只有当 `site-config.json` 里重新配置相对的 `androidApkUrl` / `iosProfileUrl` /
`iosGameUrl` 时，上传脚本才会重新生成描述文件、打包 APK 并做对应校验；三者为空即按跳转模式发布。

## 本地预览

在项目根目录运行：

```bash
python3 -m http.server 7460 --directory WebHome
```

打开 `http://127.0.0.1:7460/`。可以使用查询参数检查不同展示：

- `?platform=android`
- `?platform=ios`（会立刻跳转到苹果安装页）
- `?platform=desktop`

## 正式部署

1. 改 `site-config.json` 的两个跳转地址（如需要）。
2. 双击上面对应的上传脚本，或在根目录执行
   `python3 tools/upload_promotion_site.py --dry-run` 先校验打包结果。
3. 用 Android 系统浏览器、iPhone Safari 各开一次公网地址，确认跳转目标正确。

也可以直接双击根目录的上传脚本：

- `4上传推广网站.command`：测试服（`.hot-update-upload-config.json`）。
- `9-4上传推广网站-正式服.command`：正式服（`.hot-update-upload-config.prod.json`，8.153.70.197）。

打包后上传到服务器 `/www/html/webhome`，原子替换目录并把上一版保留在 `/www/html/.webhome.previous`。
跳转模式下 ZIP 约 1.5 MB，不含 APK。

`Caddyfile.example` 提供了部署到 `/webhome/` 的示例。

## 重要边界

- 本页只做跳转，不再提供 APK 与描述文件下载；装包流程由苹果安装页和安卓下载页各自负责。
- 只在用户点击按钮后才跳转；关掉脚本时页面仍给出两个平台的直链（`<noscript>` 兜底）。
- 微信/QQ 等内置浏览器可能拦截外跳或二次跳转，需要时引导玩家用系统浏览器打开。
