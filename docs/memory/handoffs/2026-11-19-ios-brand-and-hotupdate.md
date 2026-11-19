# iOS 品牌名/图标 + 热更链路体检（2026-11-19）

分支 `codex/club-ui`，工作目录 `/Volumes/SSD/qing`。

## 一、iOS 应用名与图标（已改，待重新打包验证）

- `build/jsb-link/frameworks/runtime-src/proj.ios_mac/ios/Info.plist`：`CFBundleDisplayName`、`CFBundleName` 由 `8L` 改为 `BF`。
- `…/ios/Images.xcassets/AppIcon.appiconset/`：21 张 PNG（25 个条目，含 `Icon-1024.png`）整组换为 BF 版。
  - 以 Android 现行 BF 图标（`proj.android-studio/res/mipmap-xxxhdpi/ic_launcher.png`，仅 192px）为风格基准，AI 重绘 1024 满幅方图，再逐级减半下采样到各尺寸。
  - 全部 RGB 无 alpha、四角不透明；`Contents.json` 条目与磁盘文件一一对应。
- 持久化：同步到 `build-templates/jsb-link/frameworks/runtime-src/proj.ios_mac/ios/`（`Info.plist` + `AppIcon.appiconset`），防 Cocos 重新构建打回 8L。与 Android 侧 11-03 的做法一致。
- 未动：`8L.xcodeproj/project.pbxproj` 的 target 名与 `productName`（产物仍为 `8L-mobile.app`，打包脚本按此路径取包）；`CFBundleIdentifier` 仍为 `com.fireball.qing`。
- `build/ios-unsigned/` 下的 `.xcarchive`/`.ipa` 均为旧产物（含 11-14 那个：内置本地热更版本 6.0.7、图标仍是 8L），需重新 archive。

## 二、热更链路体检结论

链路：`panelUpdate` → `jsb.AssetsManager`（storagePath = `getWritablePath()+"Remote"`）→ 本地 manifest `assets/resources/project.manifest`（prefab 绑 uuid `2523d19d…`）→ 远端 `http://154.37.155.17/up`。

已核实：

- 服务器 `version.manifest` 200（6.0.24）、`project.manifest` 200（773 KB，6194 个资源）；抽样 25 个资源下载后 md5 与清单一致，含 `assets/main/index.jsc`（531,816 B）与 `src/cocos2d-jsb.jsc`。
- 热更包内 `src/` 仅 3 个文件（`settings.jsc`、`cocos2d-jsb.jsc`、`assets/scripts/UI/qrcode.jsc`），业务逻辑在 `assets/main/index.jsc`；两侧都在清单内，js 可更新。
- 恢复搜索路径靠 `tools/generate_hot_update.py` 注入 `main.js` 的 `QING_HOT_UPDATE_SEARCH_PATHS` 段（读 localStorage `HotUpdateSearchPaths` → `jsb.fileUtils.setSearchPaths`），写入方是 `panelUpdate.ts` 约 675 行。
- 明文 http 可行（`Info.plist` 有 `NSAllowsArbitraryLoads=true`）。
- `UpdateManager.ts` 是死代码（仅 `panelMain.ts:490` 注释调用），其中 `vL[0]<vR[1]` 的笔误无影响；实际生效的 `panelUpdate.ts` 写的是 `vL[0]<vR[0]`。

**本轮修复**：11-19 13:15 重新构建把 `build/jsb-link/main.js` 的热更补丁冲掉了（补丁只在「1生成热更新包」时注入）。已调用 `patch_native_main_js()` 重新打上，`node --check` 通过；`validate_official_hot_update_build()` 同时通过（无 MD5 哈希产物、`assets/main/index.jsc` 新于全部 ts）。

## 三、发布顺序（重要）

1. 先跑「1生成热更新包」（把版本推到 config 里的 `next_version` = 6.0.25，同时打 main.js 补丁、加密 build 内 PNG、同步 native manifest）。
2. 再跑「2上传」。
3. 最后构建/archive iOS 包。

若颠倒（先 archive 再生成），包内本地版本落后于服务器，用户首次启动要额外下载一次全量；且老用户 `Remote` 缓存不会被清理（`tempver == local` 走保留分支），可能出现"装了新包仍跑 Remote 旧文件"。发基础包务必升热更版本号，让 `tempver != local` 触发清缓存重启。

## 四、13:38 复核（Cocos 重新构建 + 已跑「1生成热更新包」）

- 版本已生成到 **6.0.25**，`next_version` 推进为 6.0.26；`assets/resources` 与 `build/jsb-link/assets/resources/native` 两侧 manifest 均同步为 6.0.25；线上仍为 6.0.24（未上传）。
- `build/jsb-link/main.js` 补丁在位（13:37，脚本注入）；`validate_official_hot_update_build()` 通过。
- 热更包 `hot-update-output/ver_6_0_25.zip`（127 MB / 6196 项）抽样 20 个与 build 完全一致，`assets/main/index.jsc`、`src/settings.jsc` 在包内，`main.js` 不入包（符合设计）。
- build 内 native PNG 与包内 1964 张 PNG 均为加密态。
- 重新构建只覆盖了 `ios/Info.plist` 与 `AppIcon.appiconset`（来自 `build-templates`，值仍为 BF）；`project.pbxproj`（13:09）与 5 个自定义 bridge 文件未被覆盖，Xcode 工程 targets 正常可列。
- Xcode 工程以 folder reference 引用 `../../../main.js`、`../../../assets`、`../../../src`，archive 直接读 build 目录当前内容。

## 五、未验证

- 重打后的 iOS 包真机启动、桌面显示名与图标、热更下载→重启→生效的完整闭环，均未实测。
- `src/settings.jsc` 当前构建产物（220 B）与线上 6.0.24（224 B）不一致，`assets/resources/native/*.png` 有 11/25 抽样不一致（因今天重构建把 PNG 还原为未加密态）；跑一次生成脚本后会被重新加密并同步，届时需复核。
