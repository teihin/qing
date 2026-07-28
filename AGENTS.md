# 项目记忆（Codex 自动读取）

最后更新：2026-07-28

本文件保存跨对话需要持续使用的项目事实与工作约束。涉及服务端行为、线上配置或原生包状态时，仍应在当前环境重新验证。

## 记忆维护规则

- 用户已要求持续维护本文件。以后每次处理本项目的需求、问题排查、代码修改或运行验证后，都应在任务结束前把新增的可复用信息整理到本文件，无需再次询问。
- 优先记录：问题现象、根因、解决方案、涉及文件、验证结果、仍未解决的风险、关键技术决定和可复用操作经验。
- 已验证事实与推测必须分开；没有运行或联调验证的内容要明确标注为“待验证”。
- 新结论改变旧结论时，直接修正原条目并更新日期，避免不断追加互相冲突或重复的记录。
- 保持内容精炼、可检索；临时终端输出、一次性进度和无长期价值的细节不写入。
- 不记录密钥、密码、Token、验证码、签名信息、身份证、银行卡、手机号或其他敏感数据；只记录其所在模块、风险和处理状态。
- 每次实际更新本文件时，同步修改顶部“最后更新”日期，并在最终回复中简要说明新增了哪些记忆。

## 项目概况

- Cocos Creator 版本：`2.4.13`。
- 客户端类型：8 座牌九类游戏，四张牌分成两组进行比较。
- 架构：服务端权威。客户端主要展示房间/玩家状态、发送操作指令和播放动画；胜负、牌型结算、下注合法性不能只依赖客户端。
- 设计分辨率：`960 x 640`，`fitHeight = true`。
- 正常启动场景是 `assets/Scenes/login.fire`；主要牌桌场景是 `assets/Scenes/drh8.fire`。
- `settings/project.json` 的启动场景是 `login`，但 `settings/builder.json` 当前指向 `drh8`。修改或打包前必须先确认目标，不能直接假定二者应相同。
- `assets/Scenes/login - 001.fire` 属于测试/备用场景。
- Android/iOS 原生工程目前封装在根目录 `runtime-src.zip`，不是普通活动源码目录。不要未经确认就解压覆盖或假定 Creator 构建会自动使用它。

## 启动与业务链路

```text
login.fire
  -> StartGameManager
  -> GameDataManager（持久化单例、KBE、心跳、重连、移动 SDK）
  -> panelUpdate（Web 跳过热更，Native 使用 AssetsManager）
  -> panelLogin
  -> panelMain（大厅）
  -> drh8.fire（牌桌）
```

- `assets/scripts/StartGameManager.ts`：启动入口。
- `assets/scripts/GameDataManager.ts`：全局会话、网络、登录状态、重连和场景跳转中心。
- `assets/scripts/common/UIManager.ts`：把 `assets/resources/UI/<面板名>.prefab` 动态加载到 `Canvas/Normal` 或 `Canvas/Top`。
- `assets/scripts/common/GameDef.ts`：服务器、状态、数据结构及公共常量。
- `assets/scripts/UI/panelMain.ts`：大厅、房间列表、钱包、个人中心和管理入口。
- `assets/scripts/UI/panelGameView.ts`：牌桌 UI 与玩家交互。
- `assets/scripts/logic/DrhLogicMgr.ts`：房间和牌局总状态。
- `assets/scripts/logic/DrhPlayerLogic.ts`：单座位状态、发牌、操作和结算表现。
- `assets/scripts/logic/DrhNameManager.ts`：牌型名称与点数。
- `assets/scripts/kbe_scripts/kbengine.js`：定制 KBEngine WebSocket 客户端。
- `assets/scripts/kbe_scripts/Account.js`：业务 RPC 包装及服务端事件转发。
- `assets/scripts/mobile/MobileManager.ts`：微信、语音、统计、GPS、图片和原生桥接。
- `assets/scripts/UI/panelUpdate.ts`：当前实际使用的热更新逻辑；`logic/UpdateManager.ts` 基本未使用。

## 网络与牌局协议

- 网络层使用 KBEngine/WebSocket 和全局字符串事件总线。
- `PlayerList` 是房间/玩家全量快照；`状态鸡` 是逐座位增量状态。
- 大量协议以手拼 JSON、中文命令字符串及 `reqHallCommand`、`reqGameCommand` 等接口传递。
- 修改事件名、字段名、动作编码或中文命令前，必须同时核对服务端协议；本仓库不包含完整服务端实现。
- 下注动作中可见的特殊编码包括：跟 `-1`、敲 `-3`、休 `-5`、滚 `-6`、丢 `-7`。
- 房间外层状态大致为 `init -> ready -> running -> end`。

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

## 自研房间语音替换（服务端、Web、Android和iOS已实现）

- 2026-07-28 静态确认当前房间语音 UI 与消息链仍保留：`panelGameView.ts`在按下/松开时调用`MobileManager.StartRecord/StopRecord`，上传成功后原设计通过`reqSay("@@语音@@"+文件ID)`广播，`DrhLogicMgr`负责排队，`DrhPlayerLogic`触发下载与播放；因此可以保持现有界面和`@@语音@@`房间消息外壳不变，只替换媒体通道。
- 2026-07-28 Web客户端已接入：`WebVoiceRecorder.ts`优先使用`getUserMedia + AudioWorklet`、回退`ScriptProcessor`，连续重采样为16kHz单声道PCM16LE；`WebVoiceClient.ts`优先通过WS边录边传，松手发送尾包，WS失败时保留整段PCM并尝试HTTP补传；收到房间语音消息即并发预下载，轮到播放时复用同一下载或命中最多20条Blob URL缓存，再用`HTMLAudioElement`播放。`MobileManager.ts`保持原`StartRecord/StopRecord/DownLoadRecord`入口，上传完成仍通过`reqSay("@@语音@@"+voiceId)`广播；单条录音客户端上限9.8秒。
- 用户已明确确认安卓、苹果、网页所有平台均不需要语音令牌。统一流程是客户端直接上传语音，AudioServer返回`voiceId`文件名，客户端调用现有`reqSay("@@语音@@"+voiceId)`，KB只广播文件名；接收端用文件名直接下载播放。不得再增加`申请_语音_令牌`、`AudioToken`、Authorization或KB游戏服签发流程。
- Web客户端的默认明文入口是`http://154.37.155.17/audio`和`ws://154.37.155.17/audio/v1/stream`。HTTPS网页自动改用当前站点同源`/audio`的HTTPS/WSS，不允许静默降级到明文；受控环境可用`localStorage.AudioServerBaseURL`覆盖。
- Web端已用Cocos Creator 2.4.13命令行完成无令牌版`web-mobile` Debug构建，新增的录音、上传、预下载和播放模块均进入`assets/main/index.js`，客户端不再依赖任何KB新增接口。
- 2026-07-28 用户实测网页版每条语音开头会被截掉，根因是旧实现每次按下后才重新调用`getUserMedia`、创建`AudioContext`和处理节点，UI已显示录音但采集链路尚未就绪。`WebVoiceRecorder`现改为进入房间时预热并在录音间复用麦克风、AudioContext和处理节点，离开房间才完整释放；空闲时仅在内存保留约180ms滚动PCM前置缓冲，按下后先发送前置缓冲再发送实时音频。为给服务端10秒上限留余量，自动停止时间从9.8秒调整为9.6秒，最坏录音约9.78秒。Cocos Creator 2.4.13 Web Mobile构建及180ms/总时长边界检查已通过，实际语音开头效果待用户复测。
- 2026-07-28 网页版偶发HTTP补传`409 Conflict`已定位为同一请求ID的WS录音尚未完成清理时，客户端立即又发起HTTP补传。`WebVoiceClient`现会先向旧WS发送`cancel`、短暂等待`cancelled`并关闭连接，再对409、限流、常见5xx、网络失败和8秒超时使用同一请求ID做有界幂等重试；服务器无需修改或重新部署。每次按住现使用完全独立的请求ID、PCM、WS和控制响应状态，上一条正在补传时可继续录制下一条，不会覆盖文件名或音频缓存；最多保留6个并发待发送会话防止断网刷屏耗尽内存。
- 同次边界加固还包括：重复按下/重复松开只处理一次；不足300ms的快速点按静默丢弃；普通松手保留50ms尾音窗口，旧浏览器`ScriptProcessor`缓冲从4096降为2048样本；页面隐藏或`pagehide`时立即提交已录PCM；离开房间会中止录音、上传和播放且禁止旧语音广播到新房间；客户端硬限制PCM不超过9.8秒。Cocos Creator 2.4.13 `web-mobile` Debug构建已通过且上述逻辑已进入`assets/main/index.js`，AudioServer完整`go test ./...`也已通过；快速连点、断网恢复和切后台的真实浏览器交互仍需用户复测。
- 2026-07-28 用户实测切换房间后语音消息和播放气泡正常但听不到声音。Chronicle画面确认`reqSay`、`SayInfo`及播放UI均已触发且控制台无下载/自动播放错误；从公网AudioServer取回其中两条切房后M4A，时长为1.711秒和1.823秒，但平均与峰值均为`-91 dB`，文件本身是数字静音。因此问题在切房后的Web麦克风采集恢复，不在KB广播、下载或播放器。
- 上述切房静音已修复：`LeaveVoiceRoom`现只清理旧房间录音会话、上传、下载缓存和播放状态，健康麦克风链保留5秒供紧接着进入的新房间复用，超时或组件销毁才完整释放；新房间`prepare/start`会取消延迟释放。`WebVoiceRecorder`不再只看`readyState`，同时拒绝`muted`、`disabled`、已结束或收到`mute/ended`事件的轨道，并可在录音中原地重建采集链。`WebVoiceClient`检查PCM是否全零：开始600ms仍无任何非零样本时自动重建一次麦克风；松手时仍为全零则取消WS/HTTP上传、强制使输入链失效并提示“麦克风没有采集到声音”，不再生成和广播静音文件。Cocos Creator 2.4.13 `web-mobile` Debug构建已通过，修复逻辑已进入`assets/main/index.js`；真实切房后连续录音仍待用户复测。
- Android/iOS语音不能只靠Cocos TypeScript实现：Native JSB环境没有浏览器`getUserMedia/AudioWorklet/HTMLAudioElement`。三端继续共用Cocos层的按住/松开UI、房间队列、`voiceId`及`reqSay("@@语音@@"+voiceId)`逻辑；Android原生负责`AudioRecord`采集和`MediaPlayer`播放，iOS原生负责`AVAudioEngine`采集和`AVAudioPlayer`播放。PCM高频数据、边录边传和HTTP补传均留在各自原生层，只把开始、停止、返回`voiceId`及播放完成事件跨JSB桥传递。
- 2026-07-28 Android原生语音已实现：项目级主源码为`native/android/voice/QingVoiceBridge.java`，采用16kHz单声道PCM16LE；按下即通过HTTP或HTTPS chunked body边录边上传，松开只结束请求体并等待AudioServer编码，流式请求失败时保留最多9.8秒PCM并用同一requestId做有界HTTP补传，对409、限流、常见5xx和网络失败重试。实现不依赖第三方网络/语音SDK，也不使用令牌；进入房间且已有权限时会预创建`AudioRecord`以降低首音延迟，录音间自动再次预热。
- Android边界保护包括：重复按下/松开去重、权限弹窗期间松手取消本次录音、不足300ms静默丢弃、全零采样拒绝上传、9.6秒Cocos自动停止和9.8秒原生硬上限、每条录音独立会话编号、旧上传晚返回不影响下一条录音、切房取消旧录音/上传/下载/播放且禁止旧房广播。播放端收到文件名即预下载到应用缓存，最多保留20条M4A，轮到时使用`MediaPlayer`串行播放，成功或失败都会推进Cocos语音队列。
- `tools/sync_android_voice.py`会幂等把项目级Java源码复制到Creator生成工程，并只给`AppActivity`补初始化、权限回调和销毁清理，同时给Manifest补`RECORD_AUDIO`。Creator重建Android工程后必须再次运行此脚本；不能只依赖易被覆盖的`build/jsb-link`副本。
- Android验证已完成：Cocos Creator 2.4.13的Web Mobile与Android Debug/Release脚本构建通过，Java编译和双ABI`:qing:assembleDebug`通过；公网Caddy入口已用HTTP/1.1 chunked短PCM探针验证并按预期返回422且不落文件。最终Debug APK位于`build/jsb-link/frameworks/runtime-src/proj.android-studio/app/build/outputs/apk/debug/qing-debug.apk`，包名`com.fireball.qing`，包含`INTERNET`、`RECORD_AUDIO`、`QingVoiceBridge`及与最新Creator产物SHA-256一致的`assets/main/index.jsc`。2026-07-28用户反馈Android房间语音已测试通过；具体机型和HTTP/HTTPS覆盖矩阵未逐项记录。
- 2026-07-28 iOS原生语音已实现：项目级主源码为`native/ios/voice/QingVoiceBridge.h/.mm`，使用`AVAudioEngine + AVAudioConverter`采集16kHz单声道PCM16LE，`AVAudioSession`使用语音聊天模式并默认扬声器播放；进入房间且已有权限时预创建音频引擎以降低首音延迟。按下即使用Apple规定的`uploadTaskWithStreamedRequest`和`needNewBodyStream`向HTTP或HTTPS入口边录边传，并通过`Expect: 100-continue`避免服务器已拒绝时继续发送请求体；失败后保留最多9.8秒PCM并用相同requestId做有界整段HTTP补传。实现不用语音令牌、第三方SDK或无效证书信任绕过，HTTPS只接受系统信任的有效证书。
- iOS边界保护与Android一致：重复按松去重、权限弹窗期间松手取消、不足300ms或全零语音拒绝上传、9.6秒Cocos自动停止和9.8秒原生硬上限、每条录音独立会话、切房/退后台取消旧录音、待重试上传和播放并禁止旧房广播。2026-07-28复核又修正了音频回调恰在松手结束等待后才进入的极小并发窗口，以及旧房失败回调在切房后显示的问题。播放端按`voiceId`预下载M4A到应用Caches目录，原子写入并最多保留20条，`AVAudioPlayer`完成或失败均回调Cocos推进串行队列。
- `tools/sync_ios_voice.py`会幂等把项目级iOS源码复制到Creator生成工程，为`AppController`补初始化、退后台取消和进程结束清理，为`Info.plist`补`NSMicrophoneUsageDescription`，并把桥文件以ARC方式加入`Qing-mobile`源文件阶段。脚本同时把最低系统规范为当前Xcode支持的iOS 12.0，并确保Xcode构建项和Info.plist的Bundle ID均为`com.fireball.qing`；`settings/builder.json`的iOS包名也已同步。Creator重新生成iOS工程后必须再次运行该脚本，不能只依赖易被覆盖的`build/jsb-link`副本。
- iOS静态与构建验证已完成：Cocos Creator 2.4.13 Web Mobile和iOS Release脚本构建通过；当前Xcode/iphoneos arm64完整Release编译、链接、静态分析和未签名归档通过，`QingVoiceBridge`静态分析诊断为0。真实Foundation流式上传探针验证单次body stream回调、32000字节PCM、`Expect: 100-continue`和201响应均正确；真实`AVAudioConverter`探针验证48kHz双声道Float到16kHz单声道PCM16有有效信号；AudioServer全套Go测试通过。最终干净归档为`build/ios-unsigned/qing-ios-voice-unsigned-clean.xcarchive`，干净IPA为`build/ios-unsigned/qing-ios-voice-unsigned.ipa`，IPA SHA-256为`41f7d74c9b064ab44780224749a6102cfc4e396cb1820b3ecb22a5e8dbf53cc4`；归档和IPA内Bundle ID均为`com.fireball.qing`，最低iOS 12.0、Mach-O仅arm64、麦克风用途说明和HTTP兼容配置存在、`QingVoiceBridge`及反射选择器存在、`assets/main/index.jsc`与最新Creator产物SHA-256一致、两份产物均无AppleDouble/`.DS_Store`且IPA ZIP校验通过，应用未签名。Xcode直接向外置exFAT卷归档会在App内生成大量`._*`，需要复制时排除后再执行`dot_clean -m`。
- 当前没有可用iPhone，因此不能把“真实麦克风权限弹窗、物理麦克风首音、听筒/扬声器/蓝牙路由、电话或系统音频打断、真实蜂窝/Wi-Fi、签名安装和HTTP/HTTPS公网联调”标为已验证，也不能诚实承诺零真机问题；这些是最后仅能由iPhone确认的风险，不是本轮自动化验证已发现的代码错误。
- 公网浏览器只有在可信HTTPS页面中才能调用麦克风，并且HTTPS页面必须使用HTTPS/WSS语音入口。当前服务器只有HTTP/WS，所以标准公网网页版仍不能实际录音；localhost网页可以使用现有HTTP/WS联调。Android和iOS原生客户端均可直接使用当前HTTP入口，也都接受有效证书的HTTPS入口。
- 2026-07-28 用户确认语音实现必须同时兼容带证书和不带证书的部署。服务端采用`plain/secure/proxy`三种传输配置：始终可提供HTTP/WS，可选直接加载证书提供HTTPS/WSS，或由外层反向代理终止TLS；客户端按环境使用HTTP(S)/WS(S)，不得因证书校验失败静默降级或信任无效证书。Android当前原生上传/下载同时接受HTTP和HTTPS；公网网页版录音仍必须处于可信HTTPS环境。
- 2026-07-28 已在根目录`AudioServer`实现第一版独立Go语音服务器：16kHz单声道PCM通过WS直接送入FFmpeg，不长期落盘；编码结果先写随机后缀的`.m4a.part`，完成后按日期和语音ID前缀分片原子移动为正式M4A。元数据当前使用同样分片的原子JSON文件索引，记录`voiceId`、请求ID、时长、大小、SHA-256、存储键和过期时间，不保存音频BLOB；默认保留7天，过期语音和未完成临时文件均自动清理。多实例部署前仍需把文件索引和本地磁盘适配为共享数据库/自建MinIO。
- `AudioServer`已实现HTTP/WS无证书监听、HTTPS/WSS直接证书监听及Nginx代理示例，两种监听可同时开启且不会自动降级；提供无令牌WS边录边传、无令牌HTTP PCM补传、无令牌文件下载、幂等请求ID、不可预测文件ID、ETag/Range、并发限制、健康检查和Prometheus文本指标。服务端内部`voice_id_secret`仅用于生成不可预测且可幂等重试的文件ID，不发送给客户端，也不是访问令牌。
- 服务端验证结果：无令牌版`go test -race ./...`、`go vet ./...`及Linux amd64无CGO构建均通过；Cocos Creator 2.4.13 Web Mobile构建也通过。
- 2026-07-28 已把AudioServer部署到现有热更新服务器`154.37.155.17`。服务器是CentOS 7 x86_64，`client_update`没有免密sudo且系统无FFmpeg，因此使用Linux amd64静态Go二进制和校验后的FFmpeg 7.0.2静态版，私有部署目录为`/www/html/.audio-server`且权限`0700`；AudioServer内部监听`18080`，公网不直接开放该端口，而是经现有Caddy提供`http://154.37.155.17/audio`和`ws://154.37.155.17/audio/v1/stream`。Caddy原配置已备份到部署私有目录，新增路由带唯一ID且不覆盖热更新路由。
- 当前服务器采用普通用户守护脚本，异常退出3秒后重启；`client_update`的crontab在服务器重启时启动服务，并每分钟只读确认Caddy语音路由，只有路由丢失时才重新插入。2026-07-28 无令牌版已原位更新并保留可回滚备份，公网WS已完成直接`start`、连续10个PCM帧、松手生成1秒M4A及无需Authorization下载闭环，测试音频和元数据随后已清理。HTTP补传集成测试通过；当前公网HTTP链路仍建议发送`Expect: 100-continue`，WebSocket主链路不受此问题影响。
- 当前公网入口仍是无证书HTTP/WS，Android和iOS均已按同一协议接入，但标准公网浏览器无法在此环境申请麦克风；要支持公网网页版录音仍需可信HTTPS/WSS。Android已由用户反馈真机测试通过；尚未完成生产负载测试、iOS签名包真机房间联调和三端完整覆盖矩阵联调。

## Cocos Creator 2.2.1 项目定制引擎审查

2026-07-22 已将 `/Applications/Cocos/Creator/2.2.1` 与 Cocos 官方 `2.2.1-release` 源码基线逐文件比较，并映射到 2.4.13。用户已确认本轮只迁移图片解密兼容功能，键盘、WebView、调试器和工程配置等其他差异均不动。

- JavaScript 引擎层没有项目定制逻辑。EditBox、事件、资源库、实例化、粒子等差异均为官方发行补丁、BOM 或版本元数据，不应迁移。
- 2.2.1 的 `cocos/platform/CCImage.cpp/.h` 有明确的 Native 加密 PNG 兼容补丁：识别项目旧格式文件头，重建 PNG 头尾，并用源码内固定参数循环 XOR 还原中间数据。该机制只是旧资源兼容/混淆，不应视为安全加密。
- 图片兼容功能已最小移植到 `/Applications/Cocos/Creator/2.4.13/CocosCreator.app/Contents/Resources/cocos2d-x/cocos/platform/CCImage.cpp`。只修改这一份 `.cpp`，未修改 `CCImage.h`、公开枚举或其他引擎文件，因此保留了 2.4.13 的 ASTC 等新增格式能力。原文件备份为同目录的 `CCImage.cpp.qing-before-image-crypto-20260722`。
- 2.4.13 实现是在 CCZ/GZip 解压后、正常格式检测前识别并恢复旧格式，再交给原生 PNG 解码器；同时增加空指针、长度溢出、分配失败和内存释放保护。它只提供运行时解密兼容，不会自动加密项目图片；当前仓库仍未发现正式加密器或发布期加密脚本。
- 兼容验证已通过：3 个真实项目 PNG 经旧格式往返后逐字节一致；2.4.13 的 `cocos2d::Image` 实际运行时分别解码 290×30 索引色、608×117 RGBA、85×85 RGBA 样本，普通图与加密图的尺寸、格式、数据长度和像素数据完全一致。11 组短输入和 6 组损坏输入在独立格式校验中均安全失败，命中旧格式标记的畸形/损坏输入在真实 Cocos 解码路径中也返回失败而未崩溃。
- 编译验证已通过：补丁源码分别用 macOS arm64、Android arm64、iOS arm64 的 C++11 环境成功生成目标文件；2.4.13 macOS 引擎静态库 arm64 和 x86_64 整体构建成功。Android/iOS 真机包尚未运行，发布前仍需清理原生缓存、重新编译并各做一次真机加载验证。
- 此功能只影响重新编译的 Native 包，不影响 Web、编辑器资源导入或未重编译的 Creator 内置 Simulator。Creator 升级或重装可能覆盖引擎补丁；热更资源若要使用旧格式，必须先加密资源，再生成 manifest/MD5。
- 当前项目 `assets` 下 1278 个 PNG 均为标准 PNG，工作区和 `runtime-src.zip` 未发现加密图片、配套加密器或加密脚本；本次移植的实际用途是兼容旧线上包或外部发布流程产生的旧格式资源。
- Android `Cocos2dxActivity` 曾把软键盘窗口策略从 `ADJUST_RESIZE` 改为 `ADJUST_NOTHING`。项目有大量 EditBox、`InputBK` 和 `EditBox2` 输入遮罩；2.4.13 仍默认 `ADJUST_RESIZE`。该项只在真机确认键盘导致布局缩放后迁移，优先放在项目 AppActivity/原生模板而非污染全局引擎。
- 2026-07-23 Android 原生 EditBox 的“输入内容+完成”栏真机表现为闪现后关闭。日志曾显示输入栏出现后，GLSurfaceView 收到一次 `ACTION_DOWN` 并调用 `Cocos2dxEditBox.complete()`，因此已修改 Creator 2.4.13 的 `Cocos2dxGLSurfaceView.java`：原生编辑期间送到 GL 画布的按下事件只拦截，不再隐式完成输入。排查确认 Android Studio 曾复用12:23的旧引擎class；禁用构建缓存重编后，14:00的实际runtime class已反编译确认两处`complete()`调用消失。随后真机日志与截图确认IME一直保持显示；窗口已使用`ADJUST_RESIZE`，再按929px键盘高度平移会重复避让并把输入栏推走，因此不再手工叠加键盘高度。取消平移后输入栏稳定显示但落在屏幕顶部；恢复可见区域底边定位后又因外层`WRAP_CONTENT + 底部对齐`与内部屏幕坐标混用而落到整屏底部、被键盘遮挡。当前`Cocos2dxEditBox.java`已把输入覆盖层改为`MATCH_PARENT`坐标容器，用`getWindowVisibleDisplayFrame().bottom - 容器屏幕Y - 输入栏高度`计算内部topMargin，使输入栏底边严格等于键盘上沿，并动态兼容刘海、导航模式和不同输入法。生成Android工程根`build.gradle`强制`libcocos2dx` JavaCompile每次执行；Java编译已通过，最终位置仍待用户从Android Studio再次运行验证。
- 2026-07-23 用户在上述坐标修正后报告“没有变化”，ADB核对发现手机包`lastUpdateTime=13:58:26`，早于修正后的`Cocos2dxEditBox.class`时间14:12:46，证明该次观察仍来自旧安装包而不是新坐标代码。已禁用构建缓存完整执行`:qing:assembleDebug`并成功，最新APK位于本机APFS临时构建目录，时间14:13:41；再次验证前必须由Android Studio普通Run重新安装，不能使用Apply Changes，并以手机包`lastUpdateTime`更新为准。
- 2026-07-23 删除重装后已由ADB确认主游戏新包首次安装时间14:15:51。MIUI/Android 11+沉浸式窗口中`getWindowVisibleDisplayFrame().bottom`可能仍返回整屏底边，不能作为IME上沿；当前定位已按版本分流：Android 11+使用`WindowManager.getCurrentWindowMetrics().bounds.bottom - WindowInsets.Type.ime().bottom`，旧系统使用可见窗口底边，再统一转换为全屏输入容器内坐标。完整`:qing:assembleDebug`已通过，仍待重新安装后的真机位置验证。
- 2026-07-23 安装时间14:19:41的新包仍被键盘遮挡；实时系统边界显示键盘上沿1471，而UI层级中输入覆盖层实际底边1679，说明依赖EditText首次`getHeight()`计算topMargin仍受首次布局高度为0影响。现改为不依赖控件高度：EditText固定`ALIGN_PARENT_BOTTOM`，动态设置`bottomMargin = 输入容器屏幕底边 - 键盘上沿`（该机实时差值208px），各设备按自身容器和IME边界计算。完整Debug构建已通过，待再次安装验证。
- 2026-07-23 动态bottomMargin版真机表现为输入栏先在正确位置闪现、随后跳到上方，证明系统初始`ADJUST_RESIZE`定位正确，但Insets回调发生了二次避让。根因是部分设备的`WindowMetrics`本身已经缩到键盘上沿，再减一次IME高度会得到过小坐标。Android 11+现先比较物理屏高、当前WindowMetrics底部和IME高度：窗口已明显缩小时直接用其底部，仍为全屏时才减IME高度；完整Debug构建已通过，待重新安装验证。
- 2026-07-23 上述WindowMetrics分流版仍出现“先在正确位置闪现、再跳到上方”，因此已撤销本轮对`Cocos2dxEditBox.java`的全部自定义Insets、平移、MATCH_PARENT和margin计算，恢复任务开始前备份的Cocos Creator 2.4.13原生EditBox布局。仅保留`Cocos2dxGLSurfaceView.java`中已由日志证实的修复：原生编辑期间GL画布ACTION_DOWN不再调用`Cocos2dxEditBox.complete()`。恢复后的完整Debug构建已通过，待真机重新安装验证；若仍异常，应只围绕原生布局采集日志，不再叠加自定义坐标策略。
- 2026-07-23 用户决定把通用键盘定位延后处理，当前先采用临时可见性方案：在恢复后的Cocos原生`setTopMargin()`计算上额外向上移动两个EditText自身高度，即从原生`topMargin - height`改为`topMargin - 3 * height`，不使用固定像素；GL画布不自动`complete()`的修复继续保留。`:libcocos2dx:compileDebugJavaWithJavac --no-build-cache`已通过，需重新构建并安装APK后验证，热更新不能下发该全局原生引擎修改。
- 2026-07-23 房间内“别人都是头像1、自己头像正确”已由真机日志定位：服务端`PlayerList`中的玩家对象没有下发`photo`字段，客户端只能先显示头像1并逐个发送`查询_用户_头像`；服务端对测试账号773818、959117实际均返回`photo:"1"`，因此显示层按返回值显示头像1，并非座位Sprite串用。自己头像正确是因为当前账号属性/本地缓存已有其数字头像。另观察到一次对`user_id:"init"`的无效头像查询，属于独立的空座位/座位刷新时序问题。要让他人显示所选头像，应优先确认服务端`reqSetProperty("photo", 序号)`是否写入`查询_用户_头像`读取的同一字段，并最好让`PlayerList`直接携带photo；客户端不能凭空还原服务端返回为1的头像。
- 2026-07-23 进一步结合新玩家坐下的浏览器日志确认客户端还有缓存短路：`PlayerList`不带photo时，`GetImageByName(id,"",img)`若命中`mapID2Avatar`（尤其以前缓存的头像1）会返回true，导致新座位不再发送`查询_用户_头像`。现已修改`DrhLogicMgr`：新绑定座位且PlayerList缺photo时无论缓存是否命中都刷新一次服务端头像；`ImageManager.AddWaitFreshImage2Catch`在已有缓存时保留当前显示，只在完全无缓存时先放头像1，且等待映射继续保证同一查询未返回前只发一次。`validate_local_avatar_flow.py`与`git diff --check`通过，待Creator/真机观察新玩家坐下日志应出现查询请求。
- 2026-07-23 房间头像偶发只显示默认1、重进恢复的根因是异步资源回调竞态。真机日志确认服务端已返回例如`photo:"10"`且无本地资源加载失败；同一座位Sprite会先等待头像1、随后等待真实头像，两个`loadRes`完成顺序不固定，旧头像1回调可能最后覆盖真实头像。`ImageManager`现为每个Sprite记录最新期望头像序号，缓存命中、成功回调和失败回退都仅在序号仍匹配时写入，过期回调直接忽略。头像流程验证与`git diff --check`通过，待Creator/真机做首次进入和连续换座验证。
- 2026-07-23 热更新“下载完成但重启后不生效”已定位并加入生成流程：`panelUpdate.ts`在`UPDATE_FINISHED`中已经把Manifest搜索路径置顶、保存到`HotUpdateSearchPaths`并调用`jsb.fileUtils.setSearchPaths()`，缺的是重启后在加载settings/引擎/bundle前恢复该值。`tools/generate_hot_update.py`现会在打热更包前幂等修补`build/jsb-link/main.js`顶部：Native环境读取全局`localStorage`、解析路径并调用`jsb.fileUtils.setSearchPaths()`；使用成对唯一标记防止重复插入，标记残缺、找不到`window.boot`或位置过晚时拒绝继续。该`main.js`不会进入只含src/assets的热更ZIP，只会由Android/iOS后续基础包携带，因此必须先发布一次包含补丁的新基础包，旧包不能靠热更新自举。临时文件首次/重复插入测试、真实当前main副本的`node --check`、Python语法和`git diff --check`均通过。
- Android `Cocos2dxWebView` 曾为客服网页增加图片文件选择、禁缓存、文件访问、混合内容和返回键处理。当前 `panelKefu` 在 `cc.sys.openURL()` 后直接返回，内嵌 WebView 不可达；`panelSJBWeb` 又缺少 Prefab。默认不迁移；若恢复内嵌客服，只重写最小文件选择能力，不照搬全局混合内容和文件访问放开。
- iOS `CCDevice-ios.mm` 曾在读取电量前启用电量监控；项目牌桌确实显示电量，但 2.4.13 已内置相同处理，无需迁移。
- 2.2.1 `config.hpp` 强制启用 V8 Inspector 属于历史调试修改；2.4.13 已等效启用，不迁移旧 `#if 1`，发布前应另行评估是否关闭远程调试。
- 2026-07-23 按用户测试需求，当前生成工程的 `Classes/AppDelegate.cpp` 已取消 `COCOS2D_DEBUG` 条件，使 Debug 与 Release 都调用 `jsb_enable_debugger("0.0.0.0", 9527, false)`；iOS `Info.plist` 已增加本地网络用途说明。启用后的完整 Release 未签名归档编译成功，交付为 `build/ios-unsigned/qing-unsigned-debuggable.xcarchive/.ipa`。该端口暴露 V8 Inspector 和脚本执行能力，只限内部测试包；正式对外发布前必须恢复条件保护或关闭该调用。
- 旧 Xcode engine 工程有 arm64 和删项兼容修改，2.4.13 工程结构已变化，不能按旧工程覆盖或照搬删项；只在新生成项目中配置目标架构并实际编译验证。
- 旧 `CCImage的副本.cpp/.h` 与官方源码一致，只是修改前备份，不参与迁移。旧 Simulator 中的本项目资源属于预览缓存，不是引擎补丁。

## 已知未完成界面需求

根目录 `问题.txt` 记录了已有缺口，包括提取奖励按钮、经理页面分享文字/比例按钮、牌局实时统计、牌型提示、切牌动画、牌桌图片和奖池数字等。实施前应再次确认哪些仍是当前需求。

- 2026-07-23 静态定位钱包“银联选择金额后点充值一直转圈”：`panelQianBao.ts`读取金额Toggle的`node.name`作为订单`amount`，但支付配置刷新又把该名称写成`<金额>元`，请求可能提交非纯数字金额；显示`panelLoading`后仅在HTTP 200或XHR error回调中关闭。公共`Tool.HTTP_GET()`只对200调用成功回调，对4xx/5xx静默不处理，且未设置`xhr.timeout`，因此服务端拒绝、非200或长期无响应都会永久保留转圈遮罩。另有`arrayAll.Length`大小写错误，应为JavaScript的`length`。以上为代码静态结论，尚未抓到该次订单接口的实际HTTP状态，未修改业务代码。
- 2026-07-23 按用户要求临时停用钱包充值入口：`panelQianBao.ts`的“确认充值”按钮回调最前面直接显示“暂未开通，后续处理”并返回，不再创建订单或显示加载遮罩；提现功能未改。后续恢复充值时需先修复上一条记录的金额格式、非200处理和请求超时问题，再删除该临时拦截。
- 2026-07-23 红利界面的“推广”页面已从高对比满屏金纹改为克制暖黑背景和单一中央邀请卡，新增标题、扫码说明及分享引导层级；保持原`背景.png`、`二维码框底.png`、`分享二维码.png`的尺寸、Meta和UUID不变。`panelHongli.prefab`仅把二维码Y从-14.654调整为80、分享按钮Y从-491.111调整为-340，节点名、动态二维码`Graphics`和分享事件不变。新增独立生成器`tools/generate_qin_promotion_skin.py`，并让`generate_qin_panel_main_remaining_skin.py`不再覆盖这三张推广专用资源。现有`validate_qin_hongli_skin.py`已通过58张运行PNG、Prefab结构、绑定、RGBA/Meta裁剪及无蓝青像素检查；Creator实际显示与二维码识别、分享点击仍待用户验证。

## 换皮美术方向

- 2026-07-22 开始进行整套游戏换皮，暂定新游戏名为“秦”，原游戏名为 `Battle`。
- 已确认主风格为黑金、高档、克制的东方帝王风；曾尝试“未来东方奢华”科技版，但用户否定该方向并确定回到第一版风格。
- 第一阶段从竖屏登录界面开始，采用秦代宫阙、黑曜石、暗金纹样与鎏金品牌字，保留账号、密码、登录按钮的原交互层级；品牌字已使用可控字体重绘为准确的“秦”。
- Creator 协作约束：如果项目已经在 Cocos Creator 中打开，不得再次启动新的 Creator 实例；后续换皮任务只修改美术文件及必要的序列化资源引用，Creator 的打开、预览、保存和运行操作全部交由用户完成。
- 效果图落地约束：用户确认后的效果图就是实际运行资源的视觉基准，后续切图和替换必须完整保留其构图、纹样、材质、层次与装饰细节，不得为了便于生成而自行简化；若现有节点尺寸或结构确实无法原样承载，必须先说明限制并确认处理方式，不能先做简化版。
- 登录换皮已生成并接入：新增 `秦_登录背景.png`（750×1334）、`秦_输入框.png`（573×86）和 `秦_清除.png`（45×45），原位替换登录专用的 `账号.png`、`密码.png`、`手机登陆.png`；`panelLogin.prefab` 保持节点结构和节点名不变，只更新对应 SpriteFrame 引用及输入/占位文字颜色。
- 登录背景、输入框和清除按钮原资源均被其他界面共用，因此本次采用新增登录专用资源并只重绑 `panelLogin`，没有覆盖 `背景.png`、`公用/输入框.png`、`CHACHA.png`。新 UUID 已被 Creator 资源库识别，静态尺寸和引用检查通过；实际运行显示与交互由用户在现有 Creator 实例中验证。
- 登录页顶部LOGO已从会被四边Widget非等比拉伸的`秦_登录背景.png`中完整分离：圆环、“秦”和`QIN`现合并为新增的400×400 RGBA资源`秦_登录LOGO.png`，`panelLogin`新增同级节点`登录LOGO`，Sprite使用SIMPLE/CUSTOM且trimmed=false，Widget只启用TOP+HORIZONTAL_CENTER（alignFlags=17、top=118），固定宽高与1:1比例；背景仍保持750×1334 RGB及原UUID，只在原LOGO区域补回宫阙暗纹。生成脚本`tools/generate_qin_login_skin.py`使用原始带环源图生成独立LOGO，并用`art_sources/login/qin_login_background_clean_source.png`局部修复无LOGO背景；输入框、按钮、业务节点与逻辑均未改。实际多设备显示仍由用户在现有Creator实例中验证。
- 2026-07-23 用户认可登录页整体构图但认为背景碎金、云纹和微小暗纹过多；现已新增`art_sources/login/qin_login_background_minimal_source.png`并将其设为登录生成器默认背景源。新版保留宫殿、阶梯、两侧建筑和地面秦纹法阵，明显减少随机亮点、云纹及重复墙纹，压暗外围烟雾和栏杆，扩大输入控件后的平静暗面；运行背景仍为750×1334 RGB、原文件名/Meta/UUID，LOGO和控件资源及Prefab布局未改。`qin_login_runtime_preview.png`已同步重建并完成视觉检查，Creator真机显示仍待用户验证。
- 2026-07-22 用户指出登录LOGO的宋体“秦”与最初确认效果图不一致；现已按用户提供的确认图改为横向展开、尖角收笔的定制金属“秦”字及独立`QIN`排版，继续使用原400×400透明资源、同一`.meta`/UUID、Prefab节点和Widget参数；自动裁剪边界已随新透明像素更新为`trimX=34、trimY=9、331×382`。最终源图保存为`art_sources/login/qin_login_logo_final_source.png`，生成脚本优先使用该源图，避免重建时退回系统字体；静态合成预览已更新，Creator实际显示仍待用户验证。
- 当前 `assets/resources/project.manifest` 仍是旧热更新清单；换皮资源进入 Native 热更新或发布包前必须重新构建生成清单。
- 2026-07-23 已新增独立热更新生成器 `tools/generate_hot_update.py` 和双击入口 `生成热更新包.command`，替代旧 2.2.1 `hot-update-tools` 的生成/打包功能。脚本读取 Creator 2.4.13 Native 构建目录 `build/jsb-link` 的 `src/` 与 `assets/`，生成 MD5 清单、完整部署目录和 `ver_<版本号>.zip`；本次版本号、资源服务器根地址、是否同步项目内manifest、是否加密PNG均保存在Git忽略的`.hot-update-config.json`，每次交互运行都会显示全部当前值，直接回车沿用、输入新值修改，成功后自动递增版本最后一段。选择同步时覆盖 `assets/resources/project.manifest` 与 `version.manifest`。生成时可按当前 `CCImage.cpp` 已兼容的旧格式混淆输出包内PNG，默认启用，并实时显示当前张数/总张数、百分比和当前文件；只转换输出副本、不修改 `build/jsb-link` 或项目源图，清单大小与MD5按转换后的最终文件计算，已是旧格式的PNG不会重复转换。已对照旧版 `/Volumes/CB/nnnn2/tool.py`：标准PNG移除签名和IEND后转换，缺少标准IEND时按旧行为转换去掉签名后的全部数据，扩展名为PNG但无PNG签名时原样跳过并计数。脚本不自动构建 Creator、不上传服务器；生成前必须先确认 `build/jsb-link` 是最新构建，部署时客户端所需的 manifest、`src/`、`assets/` 必须在配置的服务器根地址可直接访问，不能只上传未解压 ZIP。最小夹具端到端测试、ZIP内容、图片往返、加密后MD5、版本递增与 `git diff --check` 已通过；完整当前构建尚未实际打包。
- 本游戏热更新包通过 SFTP 上传到 `154.37.155.17:2233`，账号为 `client_update`，本机使用 `~/.ssh/id_ed25519_newserver`。SFTP登录后的受限根目录显示为`/`，上传更新内容时进入`/html`：`latest.json`放`/html/latest.json`，更新压缩包放`/html/packages/<包名>.zip`。2026-07-28 已重新验证同一端口和账号当前也可使用SSH Shell，语音服务器即通过该Shell完成原位更新、重启和健康检查；“只能SFTP、不能SSH Shell”的旧结论已失效。网页对应`http://154.37.155.17/latest.json`与`http://154.37.155.17/packages/<包名>.zip`。上传前仍需核对本次实际清单文件名、压缩包名和版本，不能把示例`xxx.zip`当成固定名称。
- 2026-07-23 `tools/upload_latest_hot_update.py` 与双击入口 `上传最新热更新.command` 已按服务器自动部署流程调整：自动选择 `hot-update-output` 中版本号最高且同时含manifest、`src/`、`assets/`的完整版本，直接使用生成脚本已经产出的 `ver_<版本号>.zip`，验证ZIP完整且不含 `.DS_Store`/`._*` 后，通过受限SFTP上传到默认 `/html/_incoming`，不再重复压缩。上传时先使用隐藏 `.uploading` 临时文件名，完整传输后原子改名为正式ZIP，避免服务器提前解压半包；服务器随后自动解压到服务端 `/www/html/up`，客户端通过 `http://154.37.155.17/up/...` 访问。上传后脚本会最多等待90秒并用防缓存参数轮询HTTP部署结果，只有远端`version.manifest`与`project.manifest`版本正确、完整资源清单与本地完全一致，且均匀抽检的5个远端资源大小和MD5全部一致，才报告上传及部署成功；超时或任何不一致均以错误退出。`generate_hot_update.py` 的ZIP步骤也已修正为排除macOS隐藏文件；旧上传配置若仍为 `/up` 或 `/_incoming` 会自动迁移为 `/html/_incoming`。新增校验已针对当前服务器1.0.10实际通过：远端项目清单3457项完全一致，5项资源大小和MD5一致。部署完成瞬间可能短暂返回404，脚本会继续等待而不会提前误判。
- 2026-07-23 当前双击入口文件名为 `1生成热更新包.command` 与 `2上传最新热更新.command`。两者执行成功或失败后都会显示对应结果并等待回车；在 macOS Terminal 中按回车后会延迟0.2秒自动关闭当前前台终端窗口，不再依赖Terminal的窗口关闭偏好。失败时保留原Python退出码。最初误用zsh只读特殊变量`status`导致脚本启动即在第5行退出，现已改为普通变量`result_code`；已用模拟Python失败返回码分别实际执行两个入口，确认提示、回车和退出码传递正常，语法与`git diff --check`也通过。
- 2026-07-23 Android 真机首次验证1.0.6时卡在热更新页；ADB日志明确显示尚未请求远端即报“解析本地 manifest 文件失败”。服务器地址不是根因：同一手机用curl访问 `http://154.37.155.17/up/version.manifest` 返回200，Manifest为1.0.6，应用也已声明INTERNET并允许明文HTTP；Release APK内两份RawAsset manifest内容完整。根因是`panelUpdate.ts`把`cc.RawAsset`对象本身传给`jsb.AssetsManager.loadLocalManifest()`，Cocos 2.4.13应传`nativeUrl`字符串。现已增加`getLocalManifestUrl()`，优先取`nativeUrl`/`url`，并修正检查与更新两个加载入口。该源码修复尚需在现有Creator实例中重新构建Android、在Studio重新出包并真机复测；不要仅清缓存后继续测试旧APK。
- 2026-07-23 上述修复重新出包后的第二次真机验证已能解析Manifest并完成版本比较：日志显示本地1.0.6、远端1.0.6，正确进入`ALREADY_UP_TO_DATE`，因此进度条为0是“无需下载”而非网络卡住。后续阻塞来自首次安装`tempver == null`被旧逻辑误判为缓存过旧，删除Remote后强制`cc.game.restart()`；`panelUpdate.ts`现已把首次安装单独处理为记录`tempver=local`并直接打开`panelLogin`，只有真实的非空旧版本才删除缓存并重启。2026-07-23 对安装新包后升级到1.0.10的真机日志进一步确认：资源下载完成，实际卡在`cc.game.restart()`销毁常驻`GameDataManager`时，`onDestroy`触发`logout`，而KBEngine消息表已开始清理，导致`Bundle.newMessage(undefined)`连续抛出`Cannot read property 'length' of undefined`并阻断重启。现已移除`GameDataManager.onDestroy()`中的网络登出（Native重启会关闭旧连接），并在`kbengine.js`的`logout()`增加消息定义缺失保护；JS语法和diff检查通过。当前手机强制重启应用后已识别缓存本地1.0.10与远端1.0.10一致，并成功加载`panelLogin`且未再出现该异常，说明已下载资源完整可用；源码修复仍需随下一个更高版本热更新包真机验证“一次更新即可自动重启进入登录页”。
- 2026-07-23 Android真机更新到1.0.18后进一步确认：更新文件、`Remote`搜索路径和`main.js`启动恢复均已生效，新版`panelMain`导入文件也确实下载到手机；完全杀进程冷启动后，`jsb.fileUtils`能把新配置和新版Prefab正确解析到`Remote`，但运行时`resources` Bundle仍持有安装包旧Prefab映射`2444b`，而远端新配置映射为`9b875`，实际大厅节点树中也没有新版测试文字。最终根因不是单纯软重启缓存，而是Creator 2.4 Native内置Bundle加载器用相对`assets/resources`初始化时没有按预期采用热更新目录。生成器现除恢复搜索路径外，还会在`main.js`中提取热更新根目录，并用绝对`<Remote>/assets/resources`加载内置`resources` Bundle；补丁可重复执行且Python/JS语法及幂等检查通过。Android更新成功后仍通过`AppActivity.RestartApplication()`启动新进程，确保重新初始化Bundle；`:qing:compileDebugJavaWithJavac`已通过。上述`main.js`和Java都属于基础原生包内容，需重新构建安装APK后再制作更高版本热更新验证，不能只上传热更新ZIP。重新生成原生工程时仍需保留或重新应用。
- 2026-07-23 首版绝对Bundle路径修复真机出现黑屏，日志显示基础包`settings.bundleVers.resources`要求`config.3127e.json`，而热更新目录的实际配置哈希不同，直接沿用基础包哈希会反复读取不存在的文件。现已改为启动时枚举`Remote/assets/resources/config.<hash>.json`，仅在同哈希`index.<hash>.js/.jsc`同时存在时启用该热更新Bundle，并同步覆盖本次启动的`settings.bundleVers.resources`；未找到完整配对时不设置热更新根目录，自动回退APK内置`resources`，避免首次安装或不完整缓存黑屏。当前黑屏手机上已用V8验证可正确识别实际`config.8d00d.json`及其`index.8d00d.jsc`，Python/JS语法、补丁幂等和diff检查通过；仍需重新构建安装基础APK后做启动及下一版热更新验证。
- 2026-07-23 经官方Creator 2.4文档复核后，已放弃上述“绝对Bundle路径+枚举config哈希”的试验方案：它混用了传统`jsb.AssetsManager/searchPaths`与2.4 Bundle MD5版本体系，真机已证明会因基础包与远端`bundleVers`不一致而黑屏，不作为正式方案。当前恢复官方传统流程：`main.js`只在所有脚本加载前恢复`HotUpdateSearchPaths`，`panelUpdate.ts`更新成功后使用`cc.game.restart()`，Android临时原生强制重启方法已删除。生成器新增官方兼容性门禁，若检测到`settings.<hash>.js`或`assets/*/config.<hash>.json`则拒绝生成，并提示在Creator构建面板关闭MD5 Cache后重新构建；禁止为此直接删除整个`build/jsb-link`，以免丢失现有原生定制。当前旧构建确实被门禁拦截（可见`settings.405b2.js`及三个哈希Bundle配置），Python/JS语法、Android Java编译和diff检查通过；下一步需由用户在现有Creator实例确认MD5 Cache关闭并重新构建，再验证稳定文件名、生成热更包和真机A→B更新。
- 2026-07-23 用户关闭MD5 Cache重新构建后，官方兼容性门禁通过：产物已稳定为`src/settings.jsc`以及`assets/{internal,main,resources}/config.json`、`index.jsc`。Creator重构建会覆盖`main.js`补丁，生成器已成功自动恢复官方搜索路径代码。无MD5产物同时让两份RawAsset清单文件名从`UUID.<hash>.manifest`变为`UUID.manifest`，生成器现兼容两种命名。1.0.21官方结构测试包已在本地生成，清单含3457项，明确包含稳定的`src/settings.jsc`、`assets/resources/config.json`和`index.jsc`；ZIP共3459项、无`._*`/`.DS_Store`且完整性测试通过，项目内及Native构建清单已同步，下次版本为1.0.22。尚未上传服务器；应先从当前已补丁和同步清单的Native工程重新出基础APK并安装，再发布更高版本做A→B真机更新，不能把同一1.0.21同时作为基础包和“新版本”验证。
- 2026-07-23 1.0.21基础APK干净安装后升级1.0.22，资源下载完成但更新页卡住。日志显示基础APK中的`panelUpdate`仍是已撤销的原生强制重启版本，调用已不存在的`AppActivity.RestartApplication()`触发`JavaScriptJavaBridge::CallInfo isn't valid`，且旧代码无论反射是否真正成功都会立即`return`，没有执行回退`cc.game.restart()`。1.0.21与1.0.22清单差异仅有新版`panelMain` Prefab和两份Manifest，`assets/main/index.jsc`完全未变化，证明Creator构建复用了旧脚本产物而非热更下载失败。ADB系统级强制重启后已恢复`Remote`搜索路径并识别当前为最新版本，无配置加载错误。当前`panelUpdate.ts`官方重启日志增加唯一`v2`标记；生成器新增脚本新鲜度门禁，若`assets/main/index.jsc`修改时间早于任一`assets/scripts/*.ts`则拒绝生成，当前旧构建已正确被拦截。需等待Creator完成脚本编译并重新构建，确认`assets/main/index.jsc`变化后再生成下一版本。
- 2026-07-23 用户再次修改大厅文字并重构建后，官方兼容性和脚本新鲜度门禁均通过：构建后的`panelMain`导入JSON含测试文字，`assets/main/index.jsc`时间晚于`panelUpdate.ts`。1.0.23相对1.0.22恰好变化4项：`assets/main/index.jsc`、`panelMain`导入JSON及两份RawAsset Manifest，ZIP完整性通过。真机成功下载并将本地版本更新为1.0.23，但该次更新仍由进程启动时已加载的1.0.22旧脚本收尾，旧脚本调用已删除的`AppActivity.RestartApplication()`失败后停在结束页；刚下载的新版`index.jsc`不可能反向替换当前正在执行的JS。ADB强制停止并重启一次后，客户端识别本地/远端均为1.0.23并正常进入大厅，证明更新文件与搜索路径有效。修改更新器自身时必须把当前更新视为一次迁移版本并允许一次外部重启；真正验证新版`cc.game.restart()`需从已运行1.0.23脚本的客户端继续升级到1.0.24或更高版本。
- 登录换皮已以提交 `c0859bc` 推送到 `origin/main`；提交正文使用中文详细记录了资源、结构、验证结果和待验证风险。
- 共享弹窗背景 `assets/imagesKK/公用/框.png` 已经用户确认并替换为黑曜石、暗金多层边框、秦纹标题栏和底部秦印收口风格。图片保持635×680 RGBA，`.meta`、纹理UUID、SpriteFrame UUID及九宫格边距左83/右81/上106/下42均未改变；12个场景或Prefab共34处原引用继续生效。PNG、尺寸、透明通道和引用数静态检查通过，Creator实际显示仍由用户验证。
- 同目录4张原蓝色主操作按钮已同步为黑曜石暗金风：`充值.png`（154×54，1处引用）、`确定.png`（295×85，47处引用）、`赠送按钮.png`（305×85，1处引用）、`赠送按钮1.png`（258×84，1处引用）。均保持原文件名、尺寸、RGBA、`.meta`和UUID；箭头/返回/开关图标及原本米金色的`取消.png`不在本轮范围。静态图片检查通过，缩放显示和点击区域仍待用户在Creator中验证。
- `panelMain` 游戏大厅“发现”页首版效果已获用户确认并完成原位换皮：保留顶部“游戏大厅/客服”、快速加入及1/2/5/10/20档位、底部五项导航的现有结构；顶部仍严格使用750×92窄标题带和128×39中央标题，没有扩大节点或装饰占用范围。
- 发现页基础美术已原位覆盖31张现有PNG，包含大厅背景、共用顶部、客服、快速加入、房间卡、档位、底部导航和房间状态；共用图片按用户要求直接覆盖，因此`顶部.png`等其他引用位置会同步换皮。所有基础图片保持原文件名、像素尺寸、RGBA/RGB模式、自动裁剪边界、`.meta`和UUID。
- 用户随后明确取消大厅LOGO和底部“发现”按钮的DragonBones动画。`panelMain`保留原`LOGO`与`Down/发现/New Node`节点，但动画组件已改为普通`cc.Sprite`：顶部绑定`秦_大厅主视觉.png`（672×349），保持用户已保存的y=400.27/Widget top=92.225；底部绑定`秦_发现按钮.png`（209×146），为补偿旧骨骼原点将节点y从-77.97改为-4.295。两张静态图均使用CUSTOM尺寸、trim=false；对应动画图集不再被`panelMain`运行时引用。
- `地九王`不是旧游戏品牌名，而是本游戏的一种特殊规则；任何换皮都必须保留“地九王”原文字义，不得改成“秦牌九”等品牌字样。发现页房间卡的`地九王.png`已恢复为黑金“地九王”，倒计时Label（示例“剩余:30:00”）颜色已由蓝色改为暖金RGB(232,193,111)，规则逻辑和动态时间内容未改。
- 大厅换皮可由`tools/generate_qin_hall_skin.py`从`art_sources/hall/`源图确定性重建，当前脚本输出31张基础图片和2张静态主视觉图片；静态合成预览为`art_sources/hall/qin_hall_runtime_preview.png`。两张静态图尺寸、RGBA、透明裁剪、UUID及Prefab引用检查通过，实际显示与点击仍由用户在现有Creator实例中验证。
- `panelMain.prefab`剩余内嵌页面与弹窗已在2026-07-22完成补充换皮：按SpriteFrame UUID审计了127张直接引用图片，重点原位重绘公告/惩罚列表、加入房间数字键盘、推广二维码、设置、修改个人信息、修改登录/交易密码、赠送/受赠记录、资金明细等旧蓝色组件，共由`tools/generate_qin_panel_main_remaining_skin.py`确定性生成72张目标资源；共享`公用/输入框.png`、`公用/取消.png`和`登陆/CHACHA.png`也同步统一为黑曜石暗金风，因此其其他引用位置会一并变化。
- `panelMain`补充换皮使用`art_sources/panel_main_remaining/qin_obsidian_lacquer_source.png`作为克制黑曜石/黑漆母材质，禁止重新引入蓝青霓虹和密集纹样；公告1至5的既有中文说明及牌面示意通过本地色彩映射保留内容，只替换旧蓝青/紫色界面色，不使用AI重写正文。总览预览为`art_sources/panel_main_remaining/qin_panel_main_remaining_preview.jpg`。全部127张Prefab引用图片尺寸与`.meta`一致、没有修改任何UUID，`panelMain.prefab`保留原节点/Widget/按钮和业务结构，仅把7处亮青色动态文字改为暖金、2处蓝灰占位色改为灰金；Prefab JSON解析和`git diff --check`通过，Creator实际弹窗逐项显示与交互仍待用户验证。
- 用户反馈公告背景的石纹颗粒和四角云纹过于复杂；`公告底.png`、`弹窗公告底.png`、`透明底框.png`及`惩罚标题框.png`已改为无纹样的纯净暖黑漆渐变，前三者只保留大面积留白与细暖金边，标题框也取消角花。生成脚本已用`clean_lacquer()`固定该简洁方向，后续重建不得恢复整面石纹或四角装饰；对比预览为`art_sources/panel_main_remaining/qin_announcement_clean_backgrounds_preview.jpg`。
- `panelNotifyView`、`panelNotifyViewCZ`、`panelNotifyViewHD`三个同构公告弹窗已在2026-07-23统一完成专用黑金换皮：新增633×880 RGBA的`assets/ImagesLuck/公告/秦_通知弹窗底.png`并只重绑这三个Prefab，避免被`generate_qin_panel_main_remaining_skin.py`后续重建共享`弹窗公告底.png`时覆盖。新背景按真实700×880显示区域组织为清爽标题栏、纯净正文阅读区和底部操作区，只保留细金边、单枚秦印与极少量收口线；`最新公告/充值公告/活动公告`三张旧蓝青标题原位改为暖金字。三个Prefab的动态正文均从纯白改为象牙金RGB(232,215,180)，共享黑金`确定.png`继续复用且未覆盖。
- 三个公告Prefab原右上163×191关闭热区只有名为`确定`的Button而无可见图标；现保留该节点、名称、尺寸和点击逻辑不动，在`bk`末尾新增45×45的`关闭图标`视觉节点并复用现有金色`公用/btn_4.png`。`panelMsgView.ts`、Base64解码、`bk/msg`硬编码路径、服务器动态正文、字号/换行/收缩行为及确定/取消关闭规则均未修改。`tools/generate_qin_notify_view_skin.py`使用`art_sources/notify/qin_notify_lacquer_source.png`确定性生成4张专用运行图片和两张预览，`tools/patch_qin_notify_view_prefabs.py`可重复应用三份Prefab绑定，`tools/validate_qin_notify_view_skin.py`执行只读全量校验；双遍哈希、PNG尺寸/RGBA/Meta透明裁剪、强蓝青为0、关键节点/UUID/标题状态/共享资源保护和运行契约均已通过，Creator中的服务器长公告缩放及三个入口点击仍待用户在现有实例中验证。
- `assets/resources/Prefabs/排行榜.prefab`已按同一黑金秦风完成美术原位替换：排行榜目录16张专用PNG全部覆盖，准确保留“排行榜”“开始时间/结束时间”“玩家手数排行榜”“名次/玩家信息/手数/奖励”及`1皮/2皮/5皮/10皮/20皮`规则文字；节点、Toggle、动态Label、服务端字段和两个排行榜条目模板均未改动。
- 排行榜同时覆盖12张其引用的共用PNG，包括通用背景、垫底、表格标题头、金币、列表分割线、返回、四个分页箭头、栏目标题框和提示底框；这些图片会按用户确认的共用资源原则同步影响其他界面。`tools/generate_qin_ranking_skin.py`可从`art_sources/ranking/qin_ranking_trophy_source.png`确定性重建28张运行图片，静态合成预览为`art_sources/ranking/qin_ranking_runtime_preview.png`。28张图片的尺寸、RGBA/RGB模式和自动裁剪范围均与现有`.meta`一致，强蓝色像素检查为0，`.meta`/UUID未修改；Creator实际布局和交互仍由用户在现有实例中验证。
- `assets/resources/zuotype/1.jpg`至`5.jpg`五张竖屏牌桌背景已按用户确认的候选图原位替换，依次为克制黑金、皇家深蓝、经典翡翠绿、低饱和酒红和暖灰胡桃木风格。五图均保持原文件名、750×1334 JPEG规格及原`.meta`/UUID，中央牌面操作区无文字和品牌标记；静态格式和画面检查通过，Creator中的实际遮挡、缩放与牌局UI叠加效果仍待用户在现有实例中验证。
- 2026-07-23 真机反馈牌局设置中的5个桌面预览与点击后实际背景不一致。根因是`drh8.fire`内嵌的`panelGameView/桌面1`至`桌面5/Background`仍绑定`ImagesLuck/游戏内/额外/1.png`至`5.png`旧缩略图，而`UpdateTableImg()`实际按序加载`resources/zuotype/1.jpg`至`5.jpg`；运行时使用场景内嵌实例，不会读取同名Prefab。现已把`drh8.fire`内5个预览Sprite直接重绑到对应真实桌面SpriteFrame UUID，并同步更新`panelGameView.prefab`保持两处一致；均使用CUSTOM模式及原95×175节点尺寸，Toggle名称、索引、本地存储和切换逻辑未改。两个序列化文件的JSON、1→1至5→5映射和`git diff --check`已通过，Creator与真机显示仍待验证。
- `panelMain/Main/我的`主页面已完成黑金秦风换皮：原位覆盖18张“我的”专用PNG及2张共享头像PNG，包含页面标题、头像框、默认头像、上传按钮、金币框、VIP垫/三种VIP卡、五个隐藏统计标题和六个功能选择条；六个入口继续准确保留“战绩、代理、交易明细、赠送/受赠、个人数据、设置”文字及原业务节点名、顺序、SpriteFrame UUID和点击逻辑。
- 旧默认头像中的`BATTLE`品牌已移除；初版无文字秦将头像因整体过黑被用户否定，2026-07-22 已改为明亮亲和的棋牌游戏人物：暖红金云纹背景、清晰暖肤色、象牙与红金衣领、轻量秦式发冠，不使用盔甲、阴影遮脸、文字或外部品牌。共享`resources/other/默认头像.png`会同步影响31处/10个文件，`ImagesLuck/公用/头像2.png`仍作为金色头像框同步影响26处/7个文件；昵称、ID、金币、VIP到期时间及隐藏统计数据仍由原动态Label显示，未修改数据字段、显隐逻辑或头像层级。
- 20张玩家头像库位于`assets/resources/avatars/头像01.png`至`头像20.png`：包含男女、青年/中年/老人及文士、侠客、商贾、将领、乐师、长者等不同气质，统一为明亮暖色、清晰五官、圆形金边的秦风棋牌游戏插画。每张为256×256 RGBA，拥有独立Texture/SpriteFrame UUID和Creator 2.4.13 `.meta`；母版与总览位于`art_sources/avatars/`，`tools/generate_qin_avatar_library.py`可确定性重新裁切和打包。
- 头像母版的外框和分隔线并非严格等宽网格，旧脚本按整图宽高等分后再取方形会让20张金色圆框相对256画布产生不同方向的偏移。2026-07-23 已逐张拟合并固定真实圆框中心，生成器现以每个圆心裁256×256，使原图圆框、透明圆形Mask和运行时选中圈同心；20张运行PNG及`qin_avatar_library_preview.png`、`qin_avatar_picker_runtime_preview.png`均已重建，既有`.meta`不再重写且UUID保持不变。`tools/validate_qin_avatar_alignment.py`逐张拟合输出圆框，验证19张正好位于(128,128)、头像01仅纵向偏1像素；Creator实际显示仍待验证。
- 2026-07-23 已把头像流程接入上述本地资源：账号`photo`字段现在只保存未补零的字符串序号`"1"`至`"20"`，本账号字段首次为空时在大厅初始化随机选择1～20并回写；非空但不是有效序号的旧网址、文件名或越界值会迁移为`"1"`，查询到的其他旧账号无效值也只显示头像1。所有保存入口都会再次规范化序号。
- “我的”页原`ImagesLuck/我的/点击上传.png`入口文案已改为“修改个人资料”。打开`修改个人信息2`（以及兼容的首次资料面板）后，`panelMain.ts`会按真实750×1334布局一次性创建5列×4行的20头像选择区，当前选择显示金色外圈与勾选标记；点击头像只更新顶部预览和隐藏序号，原“确定/修改个人信息”流程确认后才把该序号写入`photo`。原“选择头像”图片保留为列表标题，不再使用逐次切换或系统相册。静态运行预览为`art_sources/avatars/qin_avatar_picker_runtime_preview.png`，可由`tools/render_qin_avatar_picker_preview.py`重建；`tools/validate_local_avatar_flow.py`已补充全量列表、点击选择和移除旧轮换路径检查，Creator实际点击与服务端回写仍待验证。
- `ImageManager.ts`已改为仅用`cc.loader.loadRes("avatars/头像XX")`加载和缓存本地SpriteFrame，大厅、牌桌座位/观战、玩家资料、赠送、战绩详情及牌局回顾等现有头像入口均复用该逻辑；旧图片HTTP下载、可写目录缓存、头像上传、系统相册回调和头像服务器常量已移除。`查询_用户_头像`仍保留，但只查询很小的`photo`字段；若`PlayerList`直接包含`photo`则牌桌立即使用该序号。`tools/validate_local_avatar_flow.py`已验证20张256×256资源、UUID唯一性、序号写入、旧值回退及无网络头像代码，8个相关TypeScript文件也已通过Babel语法解析；Creator真实账号/多客户端同步和Native运行仍待验证。
- Creator预览曾因快速编译仍引用已注册的旧`ImageManager`构造器，导致新加的`ImageManager.IsAvatarIndex`静态成员在运行时为`undefined`。头像数量、校验、规范化、随机和资源路径现均改为`ImageManager.getInstance()`返回组件上的实例成员，`panelMain`、`DrhLogicMgr`及`ImageManager`内部已清除这些新增静态调用；修改后首次验证需刷新或重新运行浏览器预览，让Creator同时重编译`ImageManager.ts`与调用方。
- “我的”换皮可由`tools/generate_qin_mine_skin.py`从`art_sources/mine/qin_default_avatar_source.png`确定性重建，静态合成预览为`art_sources/mine/qin_mine_runtime_preview.png`。20张运行图片的尺寸、`.meta`宽高/裁剪范围和UUID均保持不变，强蓝/青像素检查为0；独立点击子面板`panelRecordList`和`panelHongli`现已分别完成换皮，`panelVipInfo`及其专用图片仍未修改。Creator实际布局、动态数据和点击交互仍由用户在现有实例中验证。
- `panelRecordList`战绩界面已完成黑金秦风换皮：原位覆盖`assets/ImagesLuck/战绩`目录19张PNG及共享`assets/ImagesLuck/公用/我的战绩框.png`，包含标题、统计框、今天/昨天/前一天选中与未选中态、列表栏目文字及房间/底皮/时间/输赢条目图标；准确保留原业务文字、Toggle状态、分页按钮、节点名和查询逻辑。
- 战绩动态文字已同步匹配黑金风：`panelRecordList.prefab`的总局数、总手数和页码改为暖金；`战绩对象.prefab`的房间号为暖金、底皮/时间为象牙金、默认输赢为铜红；`panelRecordList.ts`仍按正负分支动态着色，但纯红/纯绿分别收敛为铜红RGB(196,86,66)和沉稳绿RGB(92,156,111)，没有修改字段、分页、Toggle或点击逻辑。生成脚本`tools/generate_qin_record_list_skin.py`使用已确认的完整战绩框源图`art_sources/record_list/qin_record_header_final_source.png`确定性重建20张运行图片，静态预览为`art_sources/record_list/qin_record_list_runtime_preview.png`；全部图片保持原尺寸、模式、自动裁剪边界、`.meta`和UUID，3张索引色图片也已固定透明裁剪边界，强蓝/青像素检查为0，Prefab JSON校验通过。共享背景、顶部、表格标题头、分割线、返回及分页箭头继续复用此前完成的黑金资源；Creator实际布局、Toggle切换、动态列表和点击进入详情仍待用户在现有实例中验证。
- 用户在Creator预览中反馈战绩统计框上半部留白过大、右上徽章过小且失衡，并明确要求实际资源不得简化效果图。`我的战绩框.png`现已直接按确认稿完整保留大型秦卷轴、圆形回纹、月桂、云纹、两侧精细装饰线、黑曜石纹理、分隔线和多层圆角金框，只去除预览棋盘格并适配为原612×279 RGBA；为避免独立统计条遮挡徽章底部，`局数手数`及两个动态数字节点整体下移20像素进入效果图预留的下方区域，节点名、引用和数据逻辑不变。
- `panelRecordInfo`战局详情首版因只有黑底描金框、缺少视觉层次被用户否定，2026-07-22 已重新设计为更完整的秦代黑金商业界面：青铜秦纹标题牌、四栏房间信息卡、土豪圆形垂旒章/MVP冠章/大鱼鱼纹章/劳模卷轴四种差异化荣誉造型，以及带黑曜石纹理、秦回纹角花、朱砂印和分层金属边框的战绩明细区域。主页面完整设计基准为`art_sources/record_info/qin_record_info_main_source.png`，运行预览为`art_sources/record_info/qin_record_info_runtime_preview.png`，后续不得再简化回普通描边框。
- 页面层级已进一步确认：`panelRecordInfo`主页面只显示房间概况、荣誉玩家和可点击的战绩明细列表；点击某条战绩后才激活Prefab内默认隐藏的全屏`牌局回顾`子层，子层内部再用Toggle切换“牌局回顾/文字牌谱”。这两个页签不得画在主页面效果图中；子层视觉参考单独保存为`art_sources/record_info/qin_record_info_child_page_reference.png`。
- 用户否定了`panelRecordInfo`整页密集秦纹和重新压缩布局的方案，最终约束为：Prefab原节点位置、尺寸、Widget和交互结构全部保持不变，只替换图片风格。背景使用大面积干净黑曜石/黑漆面、细暖金边和极少量关键秦印，禁止密集回纹、云纹、裂纹、细线底纹及重复图案；主页面仍保留现有独立`牌局回顾`按钮，隐藏子层内部再切换“牌局回顾/文字牌谱”。
- `tools/generate_qin_record_info_skin.py`现在按原Prefab布局确定性生成和覆盖实际运行资源：`战绩详情`目录20张PNG、4张牌谱页签、独占本页的`公用/皇冠框.png`、3张开牌/弃牌/休牌状态图、7张文字牌谱决策图、共享金色分隔线及去除`LUCK POKER`旧品牌的`pk2/bigbig.png`秦字牌背；均保持既有像素尺寸、`.meta`和UUID。`art_sources/record_info/qin_record_info_runtime_preview.png`改为由真实运行PNG按原节点坐标合成，不再直接缩放概念图；`panelRecordInfo`及3个动态条目Prefab本轮没有布局改动，Creator中的动态数据、滚动列表、页签和点击仍待用户在现有实例中验证。
- `assets/resources/Prefabs/钱包.prefab`及钱包内部动态条目`交易查询对象.prefab`、`银行对象.prefab`已完成黑金秦风换皮，覆盖充值、提现、记录、充值信息、实名认证、订单详情和选择银行等全部内嵌状态；原位重绘51张现有运行图片，并新增214×58的`钱包/支付宝提现.png`，补齐原Prefab缺失的支付宝提现背景/选中态。充值渠道中的银联、支付宝、微信、VIP及通用选择Tab按用户要求保留原图，不参与本轮重绘。
- 钱包新增支付宝提现SpriteFrame只绑定到原Toggle的Background和checkMark，节点名、Toggle target/checkMark引用、初始选中状态及脚本路径均保持不变；为使原零宽节点可显示和点击，仅把`支付宝提现`父节点宽度由0修正为201，并将其两层图片恢复为与银行卡/USDT相同的214×58布局。动态金额、输入值、提示、实名、订单和两个列表模板文字统一为暖金、象牙金、灰金与克制铜红，没有修改字符串、服务端字段或业务分支。
- 钱包换皮可由`tools/generate_qin_wallet_skin.py`从`art_sources/wallet/qin_wallet_emblem_source.png`确定性重建，六状态静态预览为`art_sources/wallet/qin_wallet_runtime_preview.png`。52张输出图片的尺寸和透明裁剪范围均与`.meta`一致，既有`.meta`/UUID未改，新增资源使用独立UUID，强蓝/青像素检查为0；共用`公用/btn_4.png`会按共享覆盖原则同步影响8个文件中的18处关闭按钮。外部`panelKefu`、`panelMsgView`和`panelLoading`未纳入，Creator中的服务端动态渠道、三种提现方式、EditBox、列表和点击交互仍待用户在现有实例中验证。
- `assets/Scenes/drh8.fire`牌桌已按当前用户手调布局完成整套黑金秦风美术替换；运行资源现由核心生成器130项与牌背/图集生成器12项共同构建，去重后共141张PNG。范围包含主操作、玩家框、动态状态、语音、设置、带入、实时战绩、牌型提示、奖池、举报、转盘、牌背/搓背、切牌图集、爆奖图集和新增动作状态`resources/other/drh/滚.png`。动态文字严格保留“大、跟、敲、休、丢、分、滚、搓牌中、地九王”等原业务含义。
- 三套可选牌背现为黑曜金、朱砂金和玄玉金秦纹款，中央使用已确认的准确“秦”徽标；`牌背0/1`共用黑曜金兼容旧配置，`搓背0～3`和DragonBones切牌图集已按运行时旧映射同步，旧`BATTLE`不再出现。爆奖DragonBones仍保持2048×4096及原切片坐标，但已完整改成“秦/大赢家”黑金焰火效果，旧`BIG WIN/JOKER`视觉已移除。五张既有桌面背景、54种牌面及三种尺寸、通用表情/互动道具属于已换皮或玩法语义内容，本轮保持现状，避免改变牌义和动画行为；玩家头像已在后续任务中统一切换为本地序号资源。
- drh8换皮由`tools/generate_qin_drh8_skin.py`、`tools/generate_qin_drh8_atlases.py`确定性重建；`tools/generate_qin_drh8_panel_fix.py`已作为核心生成器最后一道必跑修复，专门重绘74张易变形的弹层/按钮/选择框/滑条/动作资源，后续不得绕过该步骤单独保留宽泛生成器的旧结果。`tools/validate_qin_drh8_skin.py`已验证141张PNG尺寸、模式和透明裁剪与`.meta`一致，两次构建哈希一致，场景/Prefab前后哈希一致，预览成功解析69个活动Sprite和33个Label且未解析为0。
- 2026-07-23 Creator截图确认的变形根因是部分`cc.Sprite`使用RAW/TRIMMED尺寸模式：Creator预加载会按原图/裁剪尺寸重置节点大小，不能只依据场景序列化的`contentSize`判断运行效果。修复时在原尺寸透明画布内限定实际可见安全区，并保留极低透明度裁剪锚点；`tools/render_drh8_scene_preview.py`的`--simulate-creator-size-mode`模式用于复现这条运行路径。
- `tools/render_drh8_panel_previews.py`覆盖20个弹层状态，`tools/render_drh8_action_previews.py`覆盖12个动态动作状态；两套都必须同时跑普通尺寸和`--simulate-creator-size-mode`尺寸。当前模拟Creator预览中实时战绩、带入/余额不足、牌局回顾、文字牌谱、设置、举报、奖池及主操作/分牌/预操作/坐下/观战/语音均无解析或隔离错误。为避免房号、局内信息和分牌倒计时互相遮挡，场景与`panelGameView.prefab`仅同步调整了这些显示节点的位置/字号，并修正“解散房间”Sprite绑定及少量蓝青/纯红动态文字色；按钮逻辑、脚本、协议和用户手调的其他布局未改。Creator中的DragonBones播放、真实动态列表数据、点击热区和多桌布显示仍待用户在现有实例中验证。
- 2026-07-23 已对旧品牌标题做全项目审计：运行文本、场景、Prefab、脚本、配置和文件名中没有`Battle/BATTLE/LUCK POKER/POKER STAR`；macOS Vision OCR扫描`assets`下1316张图片后只确认两张残留旧图——`assets/ImagesLuck/登陆/背景.png`含`BATTLE`，`assets/imagesKK/游戏大厅/帽子.png`含`LUCKY POKER`。两张图的Texture/SpriteFrame UUID均没有场景或Prefab引用，脚本也没有动态路径加载，当前页面不会显示，但文件仍在`assets`，正式清理时应替换或删除，不能仅以“未引用”作为最终换皮完成标准。`art_sources`下109张图片没有识别到旧品牌标题。
- 同次审计发现根目录归档`runtime-src.zip`仍保留Native旧品牌：iOS `CFBundleDisplayName`和Android `app_name`均为`Battle`，Android/iOS图标目录共24张真实PNG，其主图明确使用完整`BATTLE`图标；此外归档中构建缓存路径仍含小写`battle`。该ZIP当前被Git忽略且不是活动Native源码，不影响Web/Creator预览，但若未来解压复用打包，必须先统一替换应用名、全套图标并清理旧构建缓存。`assets/ImagesLuck/动画/报奖-old/`另保留无引用的`BIG WIN`备用图集；它不是项目标题，但属于未清理旧风格资源。
- 当前实际生成的`build/jsb-link`原生工程没有`Battle`文本：Android `app_name`为`qing`，iOS显示名使用当前`PRODUCT_NAME`。2026-07-23 已把原Cocos默认图标替换为正式“秦”品牌D版图标：Android `mipmap-mdpi`至`mipmap-xxxhdpi`共5张，iOS AppIcon共21张并补齐已绑定的1024×1024商店图标；全部为不含透明通道的RGB PNG。由于`build/*`被Git忽略，正式母图和可重复生成脚本已单独保存在受版本控制的`art_sources/app_icon/`与`tools/generate_qin_app_icons.py`，Creator重新构建原生工程后需要复跑脚本。

- `assets/resources/UI/panelGivePad.prefab`赠送确认弹窗已完成黑金秦风换皮：原位重绘仅本页引用的`赠送金币.png`、`名字垫底.png`、`金额.png`、`交易密码.png`和`赠送按钮1.png`，形成鎏金标题、秦印玩家信息条、象牙金表单文字及强调型主按钮；共享的弹窗框、输入框、头像/头像框、透明EditBox底图和取消按钮均未覆盖。Prefab仅统一昵称、ID、输入值和占位文字的暖金/灰金配色，并把原本位于弹窗外的固定金额Label从`(-604.72,-170.626)`校正到输入值区域`(3.617,-1.454)`，同时调整到输入框之后绘制，避免被黑色输入底遮挡；脚本依赖的节点路径、按钮名、圆形Mask及赠送业务逻辑未改。`tools/generate_qin_give_pad_skin.py`可确定性重建5张运行图片，真实资源按Prefab坐标合成的预览为`art_sources/give_pad/qin_give_pad_runtime_preview.png`；尺寸、RGBA、`.meta`/UUID、强蓝像素、Prefab JSON、SpriteFrame解析及重复生成哈希检查通过，从玩家资料进入的手输金额模式和大厅预填金额模式仍待用户在现有Creator实例中实际验证。
- `assets/resources/UI/panelUserInfo.prefab`玩家资料弹窗已完成清爽黑金秦风换皮：新增623×880的专用`assets/ImagesLuck/互动/用户信息框.png`并只重绑本页，原位重绘玩家信息标题、开通VIP、语音回放、赠送、语音聊天、九宫统计框、六个道具卡底框及九张统计标题，共17张本页UI图片。上半区使用大面积暖黑漆留白和细金边组织头像/身份/操作，统计区改为克制三行三列信息卡；头像、头像框、充值按钮和已换皮开关继续复用现有资源。
- 用户明确要求`panelUserInfo`的道具图片不用改；本轮已对亲嘴、鸡、啤酒、拇指、炸弹、枪及5张隐藏道具图做SHA-256保护校验，11张均保持逐字节不变，只替换其外层`表情框.png`。Prefab除专用大框SpriteFrame绑定与动态Label暖金/象牙金/铜红色板外，没有修改任何节点名、层级、尺寸、坐标、Button、Toggle或`panelUserInfo.ts`业务逻辑。`tools/generate_qin_user_info_skin.py`可确定性重建17张运行PNG和`art_sources/user_info/qin_user_info_runtime_preview.png`，`tools/patch_qin_user_info_prefab.py`可重复应用绑定，`tools/validate_qin_user_info_skin.py`已验证尺寸、RGBA、透明裁剪、UUID、道具哈希、关键布局及交互契约；Creator实际头像数据、VIP/赠送/语音和道具点击仍待用户在现有实例中验证。
- `assets/resources/UI/panelHongli.prefab`及其运行时加载的`玩家对象`、`盟主对象`、`贡献对象`、`总业绩对象`、`红利提取记录对象`五个条目Prefab已完成清爽黑金秦风换皮：原位重绘代理目录57张既有专用PNG，并新增82×27的`ImagesLuck/代理/盟主徽标.png`，覆盖主页面余额/统计/六个入口、玩家/盟主/业绩/提取记录子页、比例输入与授权/设置按钮。整体使用暖黑漆、细金边、象牙字和克制铜红，不再使用旧蓝青霓虹或西式皇冠；“提升.png”继续显示实际业务文案“设置”，“总业绩”按钮文字也已按节点语义纠正。所有动态Label统一为暖金、象牙、灰金、铜红和沉稳成功绿；推广二维码全屏层从旧`BATTLE`登录背景重绑到现有黑金推广背景；原本SpriteFrame为空的`盟主对象/type`已绑定新增盟主徽标。节点名、尺寸、Widget、Toggle、分页、EditBox、二维码Graphics、按钮父子层级、脚本和服务端字段均未修改。
- `tools/generate_qin_hongli_skin.py`可确定性重建58张运行PNG和`art_sources/hongli/`两张静态总览，`tools/patch_qin_hongli_prefabs.py`可重复应用文字色板与两项SpriteFrame绑定，`tools/validate_qin_hongli_skin.py`执行只读全量检查；本机可用`PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/bin/python3.13 tools/generate_qin_hongli_skin.py`复跑。双遍生成哈希一致，58张PNG的尺寸、RGBA和透明裁剪与`.meta`一致，强蓝/青像素为0；`panelHongli`与5个条目Prefab JSON、关键路径、动态文字色板、推广背景/盟主徽标UUID及11张共享九宫格保护均验证通过。Creator中的26个页面/弹窗状态、动态列表、分页、二维码和代理授权/设置交互仍待用户在现有Creator实例中逐项验证。
- 2026-07-23 应用图标首轮四方向提案保存在`art_sources/app_icon/qin_app_icon_concepts_v1.png`，用户已选择D“咸阳宫门”。最终满画布无圆角源图为`qin_app_icon_d_source.png`，1024×1024 RGB母版为`qin_app_icon_d_master_1024.png`：前景为已确认的定制金属“秦”字圆形金印，背景为暖金暮光下的秦宫城门，并以两侧朱砂战旗和底部小朱印收口；不含`QIN/BATTLE/POKER`等额外文字。`tools/generate_qin_app_icons.py`可从固定源图确定性重建Android/iOS全套图标，双遍生成哈希一致；实际设备桌面遮罩和安装显示仍待Android/iOS真机验证。

## 修改项目时的约束

- 当前工作区在 2026-07-22 已存在大量用户未提交修改。每次只检查和修改目标文件，不做全仓格式化，不清理或覆盖无关变化。
- `library/`、`temp/`、`local/` 等为 Creator 生成内容，除非任务明确要求，不把它们当源代码修改。
- 保留 `.meta` 文件和 UUID；移动、替换资源时必须同步核对场景/Prefab 序列化引用。
- 大型核心文件是既有“上帝类”，改动时优先小范围修复并验证状态恢复、重连、切场景和异步回调，不要顺手进行大面积重构。
- 金币、VIP、支付、提现、短信、后台管理、付费看牌等客户端校验均不可信；相关修改必须要求服务端重复校验并保证原子性。
- 不在提交、日志、测试输出或对话中暴露密钥、密码、签名信息、Token、身份证、银行卡或手机号。
- 目前没有完整自动化测试和本仓库内服务端。静态检查通过不等于功能已验证；高风险改动至少需要 Creator 2.4.13 运行、真实协议联调和对应平台原生测试。

## GitHub 与 SSH

- 2026-07-22 已在本机创建 GitHub Ed25519 密钥，文件名为 `~/.ssh/id_ed25519_github_qing`，并配置为本机访问 `github.com` 所有仓库的默认密钥；私钥不得提交、复制到项目或对外发送。
- GitHub SSH 已验证成功，身份为 `teihin`；远程仓库地址为 `git@github.com:teihin/qing.git`，页面可访问且 `git ls-remote` 成功。当前远程没有引用，属于尚无提交的空仓库。
- 当前 `/Volumes/CB/qing` 已初始化为 Git 仓库，默认分支为 `main`，远程 `origin` 为 `git@github.com:teihin/qing.git`。
- 公开仓库提交前已将 `Tool.ts` 的短信平台账号字段和 `MobileManager.ts` 的微信、语音及统计平台配置字段置空；恢复这些功能时必须改用服务端或不入库的安全配置，不得再次硬编码真实凭据。
- `.gitignore` 已排除根目录签名文件、`runtime-src.zip`、macOS 元数据以及既有 Creator 缓存目录，避免敏感文件和生成内容进入仓库。
- 2026-07-22 已完成首次提交并成功推送到 `origin/main`；后续改动应继续先检查敏感信息和大文件，再提交并推送该分支。
- 后续所有 Git 提交说明必须使用中文，并详细写明修改内容；提交正文应按实际情况说明修改原因、涉及模块、关键行为变化、验证结果及未验证风险，不使用“更新”“修复问题”等无法追溯的笼统描述。
- 若本机代理导致 GitHub SSH 22 端口在握手阶段断开，可改走 GitHub 官方 `ssh.github.com:443`；2026-07-22 已按 GitHub 官方公布值核对 Ed25519 主机指纹、写入 `known_hosts` 并验证账号认证和推送成功。不得使用跳过主机校验的方式绕过错误。

## 审查范围说明

2026-07-22 已完成项目脚本、场景/Prefab 绑定、构建配置、热更新、KBE 网络及 `runtime-src.zip` 的静态通读；未完成真实后端联调、线上配置确认、Android/iOS 完整打包和真机回归。
