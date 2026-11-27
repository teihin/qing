# CURRENT 归档：2026-11-21 ~ 11-22 批次

> 从 `docs/memory/CURRENT.md` 按文档预算归档（2026-11-25）。内容原样保留，改动状态以原文为准。

## 2026-11-22 后台「关联账号」去掉同公网 IP 维度（两台已部署）

- 原因：服务器已接入高防，玩家出口 IP 被统一改写，同 IP 关联出来的都是假关联。用户要求只去掉 IP 这一路。
- 后端 `XuanManager/server/internal/api/relations.go`：删掉 `usr_login_ip_info` 两段查询、`relationAllowedIPs` 与 IP 共享阈值，评分只留同设备 100 分（90 天）/ 同 GPS 网格 60 分（7 天）；`types` 只返回 `device` / `gps`。
- 前端 `PlayersPage.tsx` 去掉「同公网IP」标签、说明与空状态文案、弱强度档；`styles.css` 删 `.relation-tag--ip`、`.relation-strength.is-weak`；`types.ts` 注释同步；接口文档 §4.5.6 同步。
- **玩家列表「IP短码」列和详情「最近上报 IP」保留**：只砍关联判定，不动 IP 展示。
- 部署：同一二进制 sha256 `65bbe034…`（15,925,958 B）+ 前端 `index-CstP5xGn.js` / `index-BZMncE-w.css` 已上测试服 16:45、正式服 16:46；两台 health 200、页面与资源 200、关联接口未登录 401、产物 md5 与本地一致。
- 回滚点：测试服 `bin/xuanmanager.previous-iprel-20261122-1645` + `backups/web.previous-iprel-20261122-1645/`；正式服 `bin/xuanmanager.previous-iprel-20261122-1646` + `backups/web.previous-iprel-20261122-1646/`。回滚 = stop.sh → 还原两处 → start.sh。**代码未提交。**
- **2026-11-22 16:53/16:54 追加兜底**（用户要求只改后台、不动库和游戏服）：`relations.go` 的 `add()` 增加 `isNumericPlayerID`，非纯数字 guuid 一律不参与关联。起因是库里存在 `user_guuid='ID???' / user_name='匿名'` 的脏行（游戏服上报设备/登录 IP 时账号未就绪，把界面占位文字写进了库，测试服 5 台设备各 1 条，与真实玩家共设备），导致关联列表多出「匿名 ID：ID???·同设备·强」。
- 本次只换二进制（sha256 `7214aaf7…`），**web、配置、数据库均未改**；备份 `bin/xuanmanager.previous-anonfilter-20261122-1653`（测试服）/ `…-1654`（正式服）。两台 health 200、首页 200、关联接口未登录 401。
- **遗留（用户明确暂不处理）**：脏行没清、游戏服写入侧没改（`/home/release/kbe` 需 release 权限），新脏行仍会写库，只是后台不再展示。

## 2026-11-22 推广站跳转地址改由后台配置（正式服已上线）

- 后台「系统配置 → 游戏推广下载地址」页下半部分可改苹果/安卓跳转地址，存 `mgr_platform_setting`（`promotion.site.ios_url` / `promotion.site.android_url`），保存即时生效，不用重传网站。
- 落地页每次打开请求同目录 `links.json`（Caddy 改写到后台只读接口，**页面里不出现 `/xuanmanager`**；no-store，只接受 https），取不到回退 `site-config.json` → 内置默认值。
- 后端新增 `promotion_site_links.go` 三条路由，沿用 `configuration.promotion_download.*` 权限，无迁移；正式服 bin `67942c12…`、前端 `index-SozfhwRq.js`；回滚点 `bin/xuanmanager.previous-hidelinks-20261122-112901`、Caddy `Caddyfile.bak.weblinks-20261122-112831`。**代码未提交。**

## 2026-11-22 推广站改为按平台跳转（正式服已发布，测试服未动，详见[交接](handoffs/2026-11-22-promotion-site-redirect.md)）

- 不再站内发 APK/描述文件：iOS 和安卓都是**点主按钮才跳**（`https://dgwsd.yycdzx.com/UMuGWv` / `https://www.gulubase.com/bf888`，不做自动跳，避免落地页一闪而过），桌面给两个入口；iOS 安装弹层/浏览器引导/描述文件下载整段删除。
- `site-config.json` 改 `iosInstallUrl`/`androidInstallUrl`；`downloads/BF.mobileconfig` 与生成脚本留档不再引用。`upload_promotion_site.py` 变跳转模式（无 APK 配置就不打包/不校验，ZIP 1.43 MB），新增 `--public-url`；新增 `9-4上传推广网站-正式服.command`。
- 正式服 `8.153.70.197:/www/html/webhome` 已发布（7 文件，index sha `6eb9c977…`；已清掉公网 `downloads/` 与测试服域名，app.js 只接受 https 目标），`:28800` 默认 `root /www/html` 直接可用；公网转发域名 200。**测试服 `154.37.155.17` 仍是旧下载页，双击 `4上传推广网站.command` 才同步（会替换掉服务器上的旧 APK）。** 未真机验证。

## 2026-11-22 客服站两步验证 404（正式服已修，详见[交接](handoffs/2026-11-22-chattool-totp-path.md)）

## 2026-11-21 大厅排行榜入口按俱乐部/联盟开关（客户端 + 后台就绪，未构建/未部署/未真机）

- 大厅「发现」页「排行榜」按钮原来一直显示。现在后台按俱乐部放行：独立俱乐部自己设，已入盟由联盟统一设，玩家切俱乐部后按新归属重判。
- 存储沿用哈希表，**不改游戏服命令**：`kbedm.usr_hash_info` 的 `排行榜_俱乐部_<clubId>` / `排行榜_联盟_<unionId>`（1=显示）。客户端读 `查询_哈希_信息`；后台后端直接读写并回读校验。
- 客户端（`panelMain.ts`）：`union_id` 非空读联盟 key、确认未入盟读俱乐部 key、归属未知先隐藏并补查 `查询_俱乐部_信息`；进大厅/进发现页/切俱乐部/入盟推送/关系变化都会重算；5 秒超时按隐藏，同 key 10 秒节流，迟到回包按 key 丢弃。只切 `Main/发现/排行榜` 的 `active`，未改 Prefab。
- 后台：新增 `PUT /api/game/{clubs|unions}/{id}/leaderboard-entry` + 权限迁移 074；俱乐部/联盟列表回 `leaderboardEnabled`；行内加「排行榜」按钮与状态列，**旧「荣耀榜」按钮已去掉**（配置仍走独立模块「排行榜」，`HonorRankModal.tsx` 已删）。
- 验证：`go build`、`go vet`、排行榜/暗抽相关测试、`npx tsc --noEmit` 全通过；`go test ./internal/api/` 仅剩既有失败 `TestGameRegistrationHoneypotRejectsAndBansIP`（`REGISTRATION_MOVED`，与本次无关）。客户端只做语法转译。详见[交接](handoffs/2026-11-21-lobby-leaderboard-entry.md)。
- 后台**两台都已部署**：测试服 22:15（`154.37.155.17:/www/html/.xuanmanager`，权限角色 1/4）、正式服 22:17（`8.153.70.197:/www/.xuanmanager`，只有 super_admin）。同一二进制 `9c76aa1d…`，health 200，迁移 074 均已应用，新路由 401、页面已换 `index-BD8zmkfA.js`。回滚点：测试服 `backups/20261121-2218-rollback/`，正式服 `bin/xuanmanager.previous-leaderboardentry-20261121-2220` + `web.previous-leaderboardentry-20261121-2220/`。
- 待办：默认全隐藏，需运营逐个放开；客户端构建后测三种情况（独立俱乐部开/关、入盟跟随联盟、切俱乐部切换）。

## 2026-11-21 iOS 未签名包（BF 品牌，热更基线 7.0.6，含声音修复；待企业签名/真机）

- 三次出包都在 `build/ios-unsigned/`，均在 Creator 构建 jsb-link + 「1生成热更新包」之后直接 archive（不重复构建，44–50s）：`unsigned-20261121.ipa`（20:22，基线 7.0.4，**缺声音修复**）、`qing-unsigned-20261121-2322.ipa`（7.0.6）、`qing-unsigned-20261121-2325.ipa`（7.0.6 + 声音修复，**交付这版**，SHA-256 `eb3fa9e8…`）。忽略 2322 中间版，只发 2325。
- 共同核验：136 MB、`CODE_SIGNING_ALLOWED=NO` 且 `codesign -dv` = not signed at all（无 `_CodeSignature`/描述文件）、arm64、`CFBundleDisplayName=BF`/`com.fireball.qing`/1.0.0(1)/最低 iOS 12.0、包内 `index.jsc` 与 build 同哈希、`unzip -t` 通过、无 AppleDouble。
- 声音修复只改 `build-templates/.../proj.ios_mac/ios/QingVoiceBridge.{h,mm}`（22:03/22:43，出房间静音 + 切后台回前台 `end()`/`lazyInit()` 重建引擎 + 1.2s 补恢复），Creator 23:18 构建已自动同步（两侧 diff 一致），archive 日志确认 `QingVoiceBridge.mm`/`AppController.mm` 重新 CompileC。**判据：二进制 `RestoreGameAudio` 旧包 count=0、新包 count=1**（Objective-C 方法名在 `__objc_methname` 段，strip 不掉；二进制大小差 104 字节、中文字符串零差异都不可当判据）。
- 线上 `/up` 仍 6.0.26，7.0.6 未上传；dSYMs 为空（该配置不产，企业签名不依赖）。真机未验。

