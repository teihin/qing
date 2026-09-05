# 历史原文摘录：已确认的高优先级问题

状态：历史证据，不是当前指令。原记录可能已经被后续决策替代。
来源：[完整原文](AGENTS.original.md)，原第 328–386 行；以 [当前状态](../../CURRENT.md) 和 [决策记录](../../DECISIONS.md) 确认适用性。

---

## 已确认的高优先级问题

以下来自 2026-07-22 的静态审查，尚未全部经过真实服务器和原生包运行验证。

### 安全与更新

- 热更新清单使用 HTTP，`panelUpdate.ts` 的资源校验回调无条件返回 `true`；更新包包含可执行脚本。优先改为可信 TLS、签名清单及真实完整性校验。
- 客户端源码中存在第三方服务凭据，微信换取 Token 也在客户端完成；不得在文档、日志或回复中复述具体值。应视为已暴露并安排轮换。
- 登录密码明文写入 `localStorage`。
- 钱包部分接口通过 HTTP 传递姓名、银行卡、手机号、身份证等敏感信息。
- Git 中存在签名文件，旧原生配置中还有明文签名信息。不要输出具体值；修复时不仅要删当前文件，还要评估轮换及清理历史。
- 当前 KBE 配置可见明文 WebSocket；支付、登录、更新和业务接口均需确认线上是否已统一使用 TLS。

### 确定性功能缺陷

- 以下活跃调用没有对应的 `assets/resources/UI/<名称>.prefab`，触发时会加载失败：
  - `panelCreateRoom`
  - `panelJiangli`
  - `修改预留信息`
  - `panelSJB`
  - `panelSJBWeb`
  - `panelTalkMsg`
  - `panelDrhClubEnd`
- `UIManager.showPanel()` 加载失败时不清理加载中标记，同名面板后续可能一直无法再次加载；并发加载也只共用一个字符串标记。
- 解散投票使用 `map[id] = value` 写入，却用 `Map.has/get` 读取，恢复投票状态失败。
- 玩家/座位映射更新前未完整清理，断线状态可能落到旧座位或被稀疏键判断漏掉。
- `DrhPlayerLogic` 在读取当前消息的 `is_action` 前先处理 `role`，部分操作界面可能使用上一条消息状态。
- 观战者刷新隐藏牌时索引未递增，会反复更新第 0 张牌。
- 牌型点数兜底会直接修改传入牌对象，存在污染真实手牌数据的风险。
- VIP 数据界面会把 `bIsVip` 强制设为 `true`；开通 VIP 与扣款又是两条独立请求，服务端必须保证权限、幂等和原子性。
- Android 首次申请定位权限存在 `locationManager` 空指针路径。
- Android Manifest 的微信回调 Activity 包名与实际 Java 类包名不一致。
- JS 调用的录音播放方法名是 `PlayRecord`，Android/iOS 实现的是 `PlayFile`。

### 构建与原生配置

- `settings/builder.json` 是横屏，但归档原生配置中存在竖屏设置，打包前需确定唯一基准。
- 旧 Android 配置为 SDK 28、仅 `armeabi-v7a`，并包含动态依赖、HTTP Maven、过宽或废弃权限。
- 2026-07-23 Cocos 将应用显示名从 `qing` 改为 `Qing` 后重生成 Android 工程，同时把 Gradle 模块名和 namespace 也改成了大写形式；显示名可以保留 `Qing`，但内部模块名与 namespace 已规范为小写 `qing` / `com.fireball.qing`。本次实际阻断构建的根因是旧 AGP 8.0.2 无法正确处理 API 35 的资源表，并叠加外置 exFAT 盘产生的 `._*` Gradle 缓存、无用 `instantapp` 模块和 NDK 版本漂移。当前生成工程已升级为 AGP 8.7.3 + Gradle 8.9 + Build Tools 35.0.1，固定 NDK 25.1.8937393，移除 `instantapp`，并把 Gradle 项目缓存与构建中间产物迁到本机临时盘；`:qing:processDebugResources` 与完整 `:qing:assembleDebug` 均已通过。Cocos 再次重生成工程可能覆盖这些生成目录修改，需复查或固化到构建模板。
- 2026-07-23 旧 Cocos Android `app/build.gradle` 通过 `variant.mergeAssets.doLast` 从 `runtime-src` 复制游戏资源，但没有声明这些目录为任务输入，Cocos 重构建后 Gradle 仍可能把 `mergeReleaseAssets` 判为 `UP-TO-DATE`，从而复用旧 APK 资源。当前生成工程已将 `mergeAssets` 设置为每次执行，重新构建后的 APK 内 `assets/main/index` 与 Cocos 最新输出 SHA-256 一致；实际 Release 输出因 exFAT 规避策略先生成在本机临时构建目录，再复制到 `proj.android-studio/app/release/qing-release.apk`。再次由 Cocos 覆盖原生工程后需确认该保护仍存在。
- Android Studio 的“Generate Signed APK”若把输出目录直接选为外置 exFAT 盘上的 `app/release`，macOS 可能同时产生 `._qing-release.apk`、`._output-metadata.json`；下一次出包在清理该目录时会报 `Unable to delete directory`。该隐藏副本可以安全删除，它不是 APK 内容。当前生成工程的 `app/build.gradle` 已加入 `cleanReleaseAppleDouble`，并作为 `preReleaseBuild` 前置任务，每次 Release 构建前自动清理 `app/release/._*`；任务顺序已通过 Gradle dry-run 验证。若 Android Studio 在启动 Gradle 前由 IDE 自身先清理目标目录，仍应改用本机 APFS 输出目录。
- iOS 配置包含旧 SDK 路径、任意网络加载和占位 Universal Link；发布前需重新核查。
- `runtime-src.zip` 内包含构建缓存和旧工程文件，不能直接当作干净、当前可发布的原生模板。
- 2026-07-23 Android Studio 首次显示 Release 成功时，实际生成的是 `instantapp/release/instantapp-release.apk`，其包名为 `org.cocos2dx.javascript`，不是主游戏预期的 `com.fireball.qing`。重新选择主模块签名后，正式包生成在 `build/jsb-link/frameworks/runtime-src/proj.android-studio/app/release/qing-release.apk`，已核对包名为 `com.fireball.qing`。签名打包时应选择 `qing`（部分 Android Studio 界面可能显示为 `app`）模块，不能选择 `instantapp`。普通 Gradle 任务的中间输出因根 Gradle 的 `buildDir` 重定向而位于系统临时目录；Android Studio 签名向导指定的最终 APK 则可能直接写入工程的 `app/release/`。
- 2026-07-23 新生成的 iOS 工程已从历史参考中最小迁移仍在使用的原生能力：`AppController` 提供按需申请“使用期间”定位、GPS 坐标读取、截图保存到相册以及剪贴板读写；`Info.plist` 只增加定位和“仅添加照片”用途说明。微信授权、TalkingData、GCloudVoice、旧头像相册/相机选择均未迁移；头像流程当前使用本地头像库，不需要相机或读取相册权限。
- iOS 工程已为定位补充 `CoreLocation` 链接。Creator 2.4.13 自带的旧胖包 `libwebp.a` 会被当前 Xcode 链接器以成员未按 8 字节对齐为由拒绝；已从其 arm64 slice 原样重新封装为项目内 `proj.ios_mac/ios/libs/libwebp.a`，并由 Debug/Release xcconfig 显式链接，不修改全局 Creator 安装。Release iphoneos arm64 的 Objective-C++ 编译和最终链接已成功。
- 受限执行环境无法访问 CoreSimulatorService 时，`actool`/`ibtool` 会误报 `iOS 26.5 Platform Not Installed`；这不是本机 Xcode 组件损坏。2026-07-23 已在系统权限环境确认 iOS 18.4、iOS 26.5 和 watchOS 26.5 Runtime 均已安装，完整 AppIcon 与启动图资源编译正常，无需重装平台组件。
- 2026-07-23 已用 `CODE_SIGNING_ALLOWED=NO` 成功生成完整未签名归档，包内为 arm64、Bundle ID `com.fireball.qing`，并确认 `code object is not signed at all`、`Assets.car` 与 `LaunchScreen.storyboardc` 均存在。最终交付文件位于 `build/ios-unsigned/qing-unsigned-full.xcarchive` 和 `qing-unsigned-full.ipa`，可交第三方重签；早先排除 AppIcon/启动图的 `qing-unsigned-check.*` 只保留为检查产物，不应再用于交付。
- 2026-07-23 当前 `build/jsb-link` Android Debug 工程已可成功编译。项目位于 exFAT 卷时，macOS 会把扩展属性写成 `._*` AppleDouble 文件，AGP 8 会将其误判为资源目录并在 `parseDebugLocalResources` 失败；当前工程在根 `build.gradle` 中把各模块 `buildDir` 定向到本机 APFS 临时目录规避，APK 再复制回 `app/build/outputs/apk/debug/qing-debug.apk`。同类伴生文件也可能污染 `.git`，可用 `dot_clean -m .git` 只清理 AppleDouble 元数据。
- 2026-07-23 直接执行Gradle `:qing:assembleDebug`只会重新编译当前生成工程的Java/Native并打包现有`build/jsb-link/src`与`assets`，不会把项目`assets/scripts`自动编译成最新Cocos运行资源。曾因此安装出“原生键盘补丁最新、但Cocos内容和panelUpdate仍旧”的Debug包，首次启动报旧的本地manifest解析失败；用户从Creator重新构建后制作的Release内容正常。验证原生改动前必须先由当前Creator实例重新构建Android，再执行Gradle打包并核对APK内`assets/main/index`与最新Creator输出一致。为绕过旧热更新页临时加入的原生输入框自动弹出测试钩子已完整撤销，未保留在工程。
- 当前 Android 工具链已升级为 AGP 8.7.3、Gradle 8.9、NDK 25.1.8937393、compile/target SDK 35 和 Build Tools 35.0.1。Java层最低API仍为16，但NDK 25会把Native最低平台提升为19并给出警告；后续正式发布前应统一最低API声明，不能继续把API 16设备视为已验证支持。
- 最新 Debug APK 已验证 ZIP 完整，且同时包含 `arm64-v8a` 与 `armeabi-v7a` 的 `libcocos2djs.so`；尚未做本轮语音版APK的安装、启动、登录和真机功能回归。
- 2026-07-23 已参考根目录`跨平台生成历史参考/build/jsb-link`把仍在使用的 Android 项目桥接移入当前`build/jsb-link`：`AppActivity.java`现提供常亮屏幕、运行时定位授权/更新与`GetCurGps`、兼容 Android 10 分区存储和 Android 9 及以下公共相册的`saveTextureToLocal`、以及转义后在 GL 线程回调 JS 的剪贴板读写。历史定位代码中`locationManager`未初始化即读取的空指针路径已消除，生命周期销毁时会注销定位监听。
- GCloudVoice、TalkingData和微信授权登录均未迁回：自研Android/iOS语音不使用腾讯JAR/AAR/SO、Framework或SDK初始化，只新增项目自有原生桥与系统麦克风权限；微信和统计入口继续为空操作。历史PictureSelector/相册选头像也未迁移，因为当前头像流程已经改成本地20张资源选择。
- 原生桥接整合后已执行不依赖旧缓存的`:qing:clean :qing:assembleDebug`并成功；APK ZIP校验通过、保留`arm64-v8a`和`armeabi-v7a`，实际权限为网络、精确/粗略定位以及仅限API 28以下的旧存储写权限。因Gradle `buildDir`已移到APFS临时目录，`app/instantapp build.gradle`的资源源目录必须用`projectDir/../../../..`定位`jsb-link`，并排除`._*`/`.DS_Store`，不能再从`buildDir`反推。GPS授权、关闭定位、剪贴板特殊字符、Android 9/10+保存相册和真机启动仍待设备回归。当前原生修改位于Creator生成的`build/jsb-link`，若日后删除该目录并“重新构建”，必须先迁入项目级原生构建模板或重新应用，不可假定会自动保留。
- Android权限兼容按系统版本分流：API 23以下定位无需运行时申请，API 23以上同时请求精确/粗略定位且任一获批即可工作，以兼容只授予大致位置；只使用前台定位，不申请后台定位。API 29以上保存本应用生成图片通过MediaStore的pending/publish流程，不申请读取相册、媒体位置或广泛存储权限；API 23～28仅在实际保存时请求`WRITE_EXTERNAL_STORAGE`并在授权后自动继续，Manifest将该权限限制到`maxSdkVersion=28`；API 22以下使用安装时权限。`INTERNET`和`ACCESS_NETWORK_STATE`属于安装时普通权限，不做运行时弹窗。该调整再次通过Android Debug完整编译，仍待Android 6/9/10/12/13+代表设备或模拟器分版本验证。
- 2026-07-23 Android 真机复现“键盘上方输入内容/完成栏瞬间消失”：系统输入法实际保持显示（`mInputShown=true`），Cocos 原生 `Cocos2dxEditBox` 也仍持有输入连接，但输入栏定位异常。根因是 Creator 2.4.13 的 `registKeyboardVisible()` 不适配新版 Android 全屏/inset 行为；与本轮合并的 `AppActivity` 定位、相册和剪贴板桥接无关。已排除：只改内部EditText的`topMargin`会压缩输入框；用当前根布局高度判断会在`ADJUST_RESIZE`动画中误判关闭；从被平移控件或窗口可视矩形反推高度会受系统平移影响并产生过量位移，真机曾记录输入栏跳到`y=104–238`。当前第五版全局2.4.13 `Cocos2dxEditBox.java`在Android 11及以上直接使用系统`WindowInsets.Type.ime()`给出的IME底部inset定位，不再反推键盘高度；若父布局已被`ADJUST_RESIZE`缩小则不重复平移，否则按IME inset整体上移“输入框+完成按钮”。Android 10及以下继续用稳定物理屏幕高度差兜底，不写死机型、分辨率或键盘高度。原版备份为同目录`Cocos2dxEditBox.java.qing-before-ime-fix-20260723`，第五版`:qing:assembleDebug`已成功并重新编译`libcocos2dx` Java；仍需正式签名包真机复测，并建议补测Android 10及以下、另一台正常resize设备、横屏和切换输入法。Creator升级或重装会覆盖该全局补丁。
- 后续真机日志进一步确认，“闪一下后关闭”的直接调用源不是inset定位：每次`onShown`后，`Cocos2dxGLSurfaceView`收到新的`ACTION_DOWN`，其2.4.13默认分支在`mStopHandleTouchAndKeyEvents`期间立即调用`Cocos2dxEditBox.complete()`，随后出现`HIDE_SOFT_INPUT`和JS `editing-did-ended`。现已最小修改全局`Cocos2dxGLSurfaceView.java`：编辑期间GL画布的单指/多指按下只拦截，不再隐式确认关闭；“完成”按钮、IME动作和系统返回键仍可结束输入。原版备份为同目录`Cocos2dxGLSurfaceView.java.qing-before-editbox-touch-fix-20260723`，`:libcocos2dx:compileDebugJavaWithJavac`已通过；待用户从Android Studio直接运行真机验证。

