# 直聊图片：相册选图 + 拍照（安卓/iOS）

日期：2026-11-02。目录 `/Volumes/SSD/qing`，分支 `codex/club-ui`。本次**未提交、未推送、未出包、未真机验证**；本轮已完成源码、生成工程和线上网页产物复核。

## 目标

消息页底部两个入口真正区分开：`发送图片` 走相册/文件选择，`拍照上传` 调系统相机。两端都要支持，并处理权限、方向、体积。

## 改动

### 原生桥（仓库源码，入库）

- `native/android/chat/DirectChatImageBridge.java`
  - 新增 `TakePhoto(String requestId)`：`MediaStore.ACTION_IMAGE_CAPTURE` + `EXTRA_OUTPUT` 指向自建 provider；Android 6.0+ 先申请 `CAMERA` 运行时权限，结果在 `onRequestPermissionsResult` 里续跑。
  - 拍照结果 `finishPhoto()`：读 EXIF 方向并旋转、最长边压到 **2560**、JPEG 90 重编码后才回调；EXIF 读取在 API<24 用 `catch (Throwable)` 降级为不旋转。
  - 回调 payload 统一增加 `error` 字段：`""` / `denied` / `unsupported`。
  - `Pick()`（相册）逻辑不变，只是回调多带 `error:""`。
- `native/android/chat/DirectChatMediaProvider.java`（新增）
  - 工程没有 androidx，用最小 `ContentProvider` 代替 FileProvider：只暴露 `cache/direct_chat` 下的文件名，`exported=false` + `grantUriPermissions=true`，靠 Intent flag 授权。
  - `getType` 返回 `image/jpeg`，`query` 返回 `_display_name`/`_size`（部分相机应用写盘前会查）。
- `native/ios/chat/DirectChatImageBridge.h/.mm`
  - 新增 `+ (void)TakePhoto:`：`UIImagePickerControllerSourceTypeCamera` + `AVCaptureDevice` 授权判断；未授权先请求，拒绝回 `denied`，设备无相机回 `unsupported`。
  - 相机原图按最长边 2560、JPEG 0.9 缩放重编码（`UIImageJPEGRepresentation` 会带上正确方向）。
  - `notifyRequest` 增加 `error` 参数；相册分支保持原文件直传。

### TS

- `assets/scripts/logic/DirectChatManager.ts`
  - 新增 `export type DirectImageSource = "library" | "camera"`。
  - `PickImage(source = "library")`；浏览器 camera 追加 `input.capture = "environment"`；原生分别调 `TakePhoto`/`Pick`。
  - 新增 `PickImageError(code, source)` 把 `denied`/`unsupported` 转成可读文案（`MEDIA_PERMISSION` / `MEDIA_INVALID`）。
  - 原生分支加 **30s watchdog**：老包里没有原生桥时 `jsb.reflection` 既不抛异常也不回调，原来会永远 pending（用户看到“点了没反应”），现在会给出“当前版本不支持…请更新客户端”。
- `assets/scripts/UI/panelMessageChat.ts`
  - `SendImage(source = "library")`；`拍照上传` → `camera`，`图片`/`发送图片` → `library`。

### 构建工程（`build/*` 不入库，需同步）

- `.../proj.android-studio/app/AndroidManifest.xml`：加 `CAMERA` 权限、`uses-feature camera(required=false)`、`DirectChatMediaProvider`（authorities `${applicationId}.directchat.media`）。
- `.../app/src/org/cocos2dx/javascript/AppActivity.java`：`onRequestPermissionsResult` 最前面转发给 `DirectChatImageBridge`。
- `.../proj.ios_mac/ios/DirectChatImageBridge.h/.mm`：与 `native/ios` 同步（md5 一致）。
- 已镜像到 `build-templates/jsb-link/...`（manifest、AppActivity、两个 java），避免下次 Creator 重建原生工程丢改动；iOS 的 `.mm` 与 pbxproj 引用仍需手工维护。

## 关键取舍

- **不引入 androidx**：minSdk 16、dependencies 只有 fileTree，加 `androidx.core` 会引入依赖下载。自写 provider 零依赖。
- **拍照必须限尺寸**：服务端附件上限 10MB，相机原图常见 4-8MB，限 2560 后稳定在 1MB 内。
- **必须有超时**：老包（现网 07-28 的 APK/IPA）没有桥，`jsb.reflection` 找不到类时**静默失败**（不抛异常，已用不存在的类名对照验证）。

## 验证

- Android：`./gradlew :qing:compileDebugJavaWithJavac --offline` **BUILD SUCCESSFUL**（含 manifest 合并）。
- iOS：`clang -fsyntax-only -fobjc-arc -x objective-c++`（iPhoneOS SDK + V8 头）通过，仅剩 `keyWindow`/`windows` 的既有 deprecation 警告。
- TS：`ts.transpileModule` 语法检查 0 诊断。
- 工程内已有 `-keep public class org.cocos2dx.**`，release 的 R8 不会破坏反射调用的类名。

## 2026-11-02 后续复核

- Cocos Web 端的「发送图片」使用 `<input type=file>`，移动端「拍照上传」追加 `capture=environment`；桌面浏览器会退化为文件选择。线上 `/chattool` 网页包与本地 `ChatTool/web/dist` 的 JS/CSS SHA-256 一致，线上包包含图片选择、拍摄和 `/api/player/uploads`。
- Android 当前 `build/jsb-link` 生成工程已包含相册 `ACTION_OPEN_DOCUMENT`、相机 `ACTION_IMAGE_CAPTURE`、相机运行时权限、`ContentProvider` 和 `AppActivity` 的权限/Activity 回调；`./gradlew :qing:compileDebugJavaWithJavac --offline` 通过。
- iOS 当前生成工程已包含 `DirectChatImageBridge.mm` 的 Compile Sources 引用、相册/相机桥和 `NSPhotoLibraryUsageDescription`/`NSCameraUsageDescription`；此前 iPhoneOS clang 语法检查已通过。
- Android、iOS 和 Cocos Web 的直聊客户端均只在交互完成后把 JPEG/PNG/WebP 交给同一图片附件上传链路；服务端 `SniffImage`、10 MB 大小和 4096 像素限制一致支持这三种格式。
- 仍不能据此宣称真机完全验收：当前没有重新生成 APK/IPA，也没有在 Android、iPhone 上实际点选相册、首次授权/拒绝、拍照、取消、上传和回显；Cocos Web 的真实摄像头权限/浏览器行为也未现场操作。

## 未完成 / 下一步

1. **重新打安卓包**（热更换不了 Java 与 manifest）；iOS 同理需重新出 IPA。
2. 真机验证：相机权限首次/拒绝/不再询问、拍完方向、大图体积、相册选 PNG/WebP、取消返回。
3. iOS 重建工程时确认 `DirectChatImageBridge.mm` 仍在 Build Phases → Compile Sources。
4. 直聊长连接的 Origin 403 仍未部署修复，与本次图片改动无关，见 `2026-11-02-android-direct-chat-ws-origin.md`。
