# 2026-11-14 iOS 原生能力补齐（未签名包已出，待签名真机）

## 目录 / 分支

- 项目根：`/Volumes/SSD/qing`，分支 `codex/club-ui`。
- 未改游戏逻辑；新增/补齐 iOS 原生桥、权限和工程链接，并重出未签名包。

## 这次查出的缺口

1. **登录设备标识**：桥源码 `native/ios/device/QingDeviceBridge` 和工程引用早已存在，但 7 月 IPA 早于功能，实际登录一直退化为 `"登陆"`、不带 `device_id`。
2. **AppController 手写方法不可持久**：`GetCurGps`、`saveTextureToLocal:`、`CopyData:`、`GetCopyData` 只写在生成工程 `build/jsb-link/.../AppController.mm` 里，没有任何同步脚本；Creator 重建 iOS 工程会全部丢失，JS 的 GPS/相册保存/剪贴板调用会静默失效。
3. **ImageIO 未链接**：直聊图片桥 `DirectChatImageBridge.mm` 使用 `CGImageSource*`，Xcode 工程没链接 `ImageIO.framework`，Release 链接报未定义符号。
4. **权限键没有持久化**：`NSLocationWhenInUseUsageDescription`、`NSPhotoLibraryAddUsageDescription`、`NSLocalNetworkUsageDescription`、ATS 只手工写在生成的 Info.plist，重建会丢。
5. CoreLocation 依赖 Clang 自动链接，工程里没有显式引用。

## 改动

- 新增 `native/ios/app/QingAppServices.h/.mm`
  - 以 `AppController (QingAppServices)` 分类实现 `GetCurGps`、`saveTextureToLocal:`、`CopyData:`、`GetCopyData`，位置更新由私有 `QingAppLocationService` 承担，不再依赖生成的 `AppController.h` 属性。
  - 删除了生成工程 `AppController.mm` 里的手写实现，`AppController.h` 恢复原模板；语音钩子仍由 `sync_ios_voice.py` 维护。
- 新增 `tools/sync_ios_app_services.py`
  - 复制分类源码并写入 pbxproj（ARC 编译）；
  - 显式链接 `CoreLocation.framework`；
  - 补 Info.plist：定位、相册写入、本地网络、`NSAllowsArbitraryLoads`；
  - 幂等，可重复执行。
- `tools/sync_ios_chat_webview.py`
  - 增加 `ImageIO.framework` 的 pbxproj 补丁。

## 原生能力对照（JS 调用 → iOS 实现）

| 能力 | JS 入口 | iOS 实现 | 状态 |
| --- | --- | --- | --- |
| 设备 ID | `QingDeviceBridge.GetDeviceId` | Keychain UUID | 已编入 |
| 选图/拍照 | `DirectChatImageBridge Pick:` / `TakePhoto:` | UIImagePickerController + ImageIO 降采样 | 已编入 |
| 房间语音 | `QingVoiceBridge Prepare:` / `StartRecord:clientTag:` / `StopRecord` / `PlayFile:voiceId:` / `PreloadFile:voiceId:` / `LeaveRoom` | AVAudioEngine + AVPlayer | 已编入 |
| 客服 WebView | `QingChatWebViewBridge Enable` | WKWebView 透明背景 | 已编入 |
| GPS | `AppController GetCurGps` | CoreLocation 分类 | 已编入 |
| 截图/二维码存相册 | `AppController saveTextureToLocal:` | UIImageWriteToSavedPhotosAlbum | 已编入 |
| 剪贴板写/读 | `AppController CopyData:` / `GetCopyData` | UIPasteboard | 已编入 |

权限已覆盖：相机、相册读、相册写、麦克风、使用期间定位、本地网络、HTTP ATS。

## 构建产物

- `build/ios-unsigned/qing-device-unsigned.ipa`
  - SHA-256：`6e4414fa2d034b3ae6d8dff59fac684db33ecefe495a4806fd4a46048ab2177e`
- `build/ios-unsigned/qing-device-unsigned.xcarchive`
- 配置：Release、`iphoneos`、`CODE_SIGNING_ALLOWED=NO`，Bundle ID `com.fireball.qing`，最低 iOS 12.0，未签名。

## 验证

- `xcodebuild archive` 成功。
- 二进制内可查到全部反射选择器：`GetDeviceId`、`Pick:`、`TakePhoto:`、`Prepare:`、`StartRecord:clientTag:`、`StopRecord`、`PlayFile:voiceId:`、`PreloadFile:voiceId:`、`LeaveRoom`、`Enable`、`GetCurGps`、`saveTextureToLocal:`、`CopyData:`、`GetCopyData`。
- 实际链接：CoreLocation、ImageIO、Security、WebKit、AVFoundation、AudioToolbox、UIKit。
- 构建后 Info.plist 含六类用途说明与 ATS。
- 包内 `assets/main/index.jsc` 与 `build/jsb-link` 同哈希（`8953fc61…`），解包后含 `createLoginData`、`device_id`。
- IPA `unzip -t` 通过，无 `._*`。

## 未完成 / 下一步

- 未签名包不能直接安装；需正式证书重签后真机验证。
- 真机待验：登录第三参数带 `device_id` 且 `platform:"ios"`；选图/拍照、语音、GPS、存相册、剪贴板、客服 WebView、防盗号绑定/校验。
- App Store 合规项未加：`PrivacyInfo.xcprivacy`（UserDefaults/文件时间戳等 required-reason API）和 `ITSAppUsesNonExemptEncryption`，需发布方按实际申报口径决定。
- 直聊只支持图片，JS 没有视频路径；相机/相册权限文案里的“视频”字样未改，不影响功能。
