# iOS 音效消失 + 屏幕不常亮（2026-11-19）

分支 `codex/club-ui`，改动目录 `native/ios/`，经同步脚本写入 `build/jsb-link/frameworks/runtime-src/proj.ios_mac/ios/`。

## 一、音效消失（进/出房间后无声，重启才恢复）

**根因**：语音功能（commit `48948a79 feat: add self-hosted cross-platform room voice`）引入 `QingVoiceBridge.mm`，四处把 `AVAudioSession` 切成 `PlayAndRecord + VoiceChat`，但没有任何地方还原。

| 位置 | 触发 |
|---|---|
| `prepareAudioEngine`（由 `prepare:` ← JS `MobileManager.PrepareVoice()` ← `panelGameView` 初始化） | 进牌桌（已授权麦克风时） |
| `beginRecord` | 录音 |
| `startPlayer` | 播放语音 |
| `leaveRoom` / `applicationWillResignActive` | 出房间 / 退后台，只 `setActive:NO` |

后果两层：
1. `PlayAndRecord + VoiceChat` 让播放走通话通道（音量受通话音量控制、AEC 压制非语音），音效变小/听不见。
2. `setActive:NO` 之后 Cocos 的 OpenAL 播放器不会自己重新激活会话，彻底静音，只有重启重新初始化才恢复。

Android 无此问题：走 AudioManager，不走 AVAudioSession。

**修复**（`native/ios/voice/QingVoiceBridge.mm`）：
- 新增 `captureGameAudioSession` / `restoreGameAudioSession`：切入前记录游戏原始 category/mode/options，用完写回并显式 `setActive:YES`。
- `prepareAudioEngine` 不再碰会话（只预创建 `AVAudioEngine`，不再访问 `inputNode`），进房间零副作用。
- restore 调用点：`finishRecord`（录音结束、且无语音在播）、`audioPlayerDidFinishPlaying`、`audioPlayerDecodeErrorDidOccur`、`startPlayer` 两个失败分支、`leaveRoom`、`applicationWillResignActive`。
- `tools/sync_ios_voice.py`：修正部署目标段落已应用时的误报（`expected exactly two anchors, found 0`），改为检测 12.0 + bundle id 已存在则跳过。

## 二、屏幕不常亮

**根因**：iOS 从来没有设置过 `idleTimerDisabled`，全仓也搜不到 `jsb.setIdleTimerDisabled`（该版本 jsb-adapter 未提供）。Android 之所以常亮，是因为 `proj.android-studio/app/src/org/cocos2dx/javascript/AppActivity.java:98` 有 `getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)`。

**修复**：
- `native/ios/app/QingAppServices.mm` 新增 `+ (void)QingAppStartup`，设 `[UIApplication sharedApplication].idleTimerDisabled = YES`（放在 AppController 分类里，符合"AppController 由 Creator 生成、重建会覆盖"的既有约定）。
- `tools/sync_ios_app_services.py` 新增启动钩子注入：在 `[QingVoiceBridge initializeBridge];` 后写 `[AppController QingAppStartup];`（幂等）。

## 三、第一版修复的漏洞（13:56 用户反馈"退出房间就没声音"）

`leaveRoom` 里 `setActive:NO` 是无条件执行的，而 `restoreGameAudioSession` 只在 category 是 `PlayAndRecord` 时才做事。只进出房间、没录音也没听语音时，category 一直是引擎设的 `Ambient`，restore 直接 return，会话却已被停用 → 照样无声。

第二版改法：

- `leaveRoom`：只有 `hasGameAudioSnapshot` 或当前 category 是 `PlayAndRecord`（即本类确实切换过）时才 `setActive:NO`；否则完全不碰会话。
- `restoreGameAudioSession`：分类没被改过也会补 `setActive:YES`（仅前台，`UIApplicationStateActive` 时），成功后打一行日志 `[QingVoiceBridge] 音频会话已交还游戏: category=… mode=…`。
- 新增 `+ (void)ApplicationDidBecomeActive` / `applicationDidBecomeActive`：回前台补一次恢复，由 `sync_ios_voice.py` 注入到 `AppController applicationDidBecomeActive`。
- `sync_ios_app_services.py` 增加 `#import "QingAppServices.h"` 注入（否则 `[AppController QingAppStartup]` 编译期找不到声明）。

**引擎侧事实**（`cocos/audio/apple/AudioEngine-inl.mm`）：引擎默认 category 是 `Ambient`；它只在收到 `UIApplicationDidBecomeActiveNotification` 且 `resumeOnBecomingActive` 为真时才会 `setCategory:Ambient + setActive:YES + alcMakeContextCurrent`。进出房间不触发这些通知，所以引擎永远不会自己恢复 —— 必须由 bridge 负责。若第二版真机仍无声，下一步要查 OpenAL 上下文（`alcMakeContextCurrent`）是否需要由引擎重设。

## 四、最终生效方案（14:03 真机验证通过）

前两版都停在"恢复会话分类 + setActive:YES"，真机出房间仍然静音。日志显示 `restore` 执行成功（`category=AVAudioSessionCategoryAmbient`、无报错）却仍无声，说明问题在更下层：

**引擎音频走 OpenAL，`setActive:NO` 会让 ALCcontext 断开**；引擎只在收到 `UIApplicationDidBecomeActiveNotification` 且内部 `resumeOnBecomingActive` 为真时才 `alcMakeContextCurrent(s_ALContext)`，进出房间不触发这些通知，因此重新激活会话也救不回来。

最终做法：**`leaveRoom` 里彻底移除 `setActive:NO`**，只把 category 交还游戏、保持会话一直激活；不 deactivate 就不会断 context。`applicationWillResignActive`（退后台）仍保留 deactivate，因为那条路径引擎自己会恢复。

副作用：录音打断其他 App 的音乐后，音乐不会自动续播（少了 `NotifyOthersOnDeactivation`）。棋牌场景可接受。

## 五、验证与兼容性

- `xcodebuild -target 8L-mobile -configuration Debug/Release -sdk iphoneos` → `** BUILD SUCCEEDED **`；编译中间产物（`proj.ios_mac/build`）每次用完即删。
- **真机（Xcode Run）**：进/出房间、录音后发送、播放语音，音效均正常恢复，控制台只在真正切回时打 `音频会话已交还游戏`。屏幕常亮同一版本一并生效。
- 兼容性：所用 API 全为 iOS 6 之前就有的老接口（`category`/`mode`/`categoryOptions`、`setCategory:mode:options:error:`、`setActive:`、`UIApplication.applicationState`、`idleTimerDisabled`），工程 `IPHONEOS_DEPLOYMENT_TARGET = 12.0`、`TARGETED_DEVICE_FAMILY = "1,2"`，覆盖 iOS 12+ 的全部 iPhone/iPad，机型差异不影响行为。
- 真正的变量是**音频路由**而非系统版本：侧边静音开关会静音（引擎用 `Ambient`，属既有行为，非本次引入）；蓝牙/有线耳机下录音会短暂切到 HFP、结束后回 A2DP。
- **仍需补测**：退后台再回前台、蓝牙耳机插拔、长时间不操作是否保持常亮。`build/` 下现存 `.xcarchive`/`.ipa` 仍是旧包，正式发版要重新 archive。
