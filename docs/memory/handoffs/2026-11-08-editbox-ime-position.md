# 安卓原生输入条紧贴键盘上沿（EditBox 键盘错位）

- 日期：2026-11-08
- 目录/分支：`/Volumes/SSD/qing`，`codex/club-ui`
- 目标：安卓真机弹出软键盘时，Cocos 原生输入条（跨屏宽白条 + 绿色「完成」按钮）必须**底边压在键盘上沿，不留空隙**，不再飘在画面中间。

## 现象

弹出键盘后，原生输入条浮在游戏画面中部（约屏幕 40% 处），条与键盘之间露出一条游戏画面，且条下方的游戏内输入框被键盘压住。

历次修复均未解决：2026-07-23 把引擎里 `setTopMargin` 的 `- getHeight()` 改成 `- getHeight() * 3`，靠「多抬两个条高」硬顶，只在一台机器上碰巧接近。

## 根因（两层）

1. **输入条容器从来没有贴过底。** `addItems` 给 `myLayout` 设的是 `RelativeLayout.LayoutParams` + `addRule(ALIGN_PARENT_BOTTOM)`，但它是加进 `FrameLayout` 的。`ViewGroup.addView` 在 `checkLayoutParams` 失败后走 `generateLayoutParams`，`addRule` 被静默丢弃，容器实际钉在**窗口左上角**。于是历届代码写的 `topMargin` 根本不是「距底部多远」，而是「距屏幕顶部多远」，只能靠 `getHeight()` 乘倍数凑。
2. **位置依据本身不可靠。** 项目是 `IMMERSIVE_STICKY + LAYOUT_FULLSCREEN + LAYOUT_HIDE_NAVIGATION + cutout shortEdges`，窗口不随键盘缩放（`rootH=2340` 恒定）。旧代码把 `getWindowVisibleDisplayFrame().bottom`（键盘顶的**绝对 Y**）直接当 `topMargin` 用，几何上就是错的；又只在 `mTopMargin == 0` 首次布局算一次，动画中途的值被锁死。

## 改动文件

引擎源码在 Creator 安装目录（`settings.gradle` 的 `libcocos2dx` 直接引用），**不在本仓库**：

`/Applications/Cocos/Creator/2.4.13/CocosCreator.app/Contents/Resources/cocos2d-x/cocos/platform/android/java/src/org/cocos2dx/lib/Cocos2dxEditBox.java`

| 位置 | 改动 |
| --- | --- |
| `addItems` | 改用 `FrameLayout.LayoutParams` + `gravity = BOTTOM`，容器真正贴窗口底；删掉 `setFitsSystemWindows(true)`（会吃底部 inset，垫出空隙）。 |
| `registKeyboardVisible` | 注册 `setOnApplyWindowInsetsListener`（API20+ 守卫）+ `OnGlobalLayoutListener` 兜底，**每次变化都重算**，不再一次性锁存。 |
| `resolveImeHeight`（新增） | 键盘高度：`WindowInsets.Type.ime().bottom`（API30+）> `getSystemWindowInsetBottom()`（有键盘时）> `rootH - visibleFrame.bottom`。 |
| `applyImeHeight`（新增，替代 `setTopMargin`） | 自身 `topMargin` 归零，改用**容器 `bottomMargin = 键盘高度`**；无任何 `getHeight()` 倍数。附带一行 `Log.d` 打印三路来源。 |
| `hide` | 收起时 `applyImeHeight(0)` 复位。 |
| 清理 | 删 `mScreenHeight`（`getDefaultDisplay().getHeight()`，已废弃）、`mOrientation` 缓存。 |

新增工程内工具（**未提交**）：

| 文件 | 用途 |
| --- | --- |
| `tools/android-engine/Cocos2dxEditBox.java` | 修好的完整文件，作为补丁模板 |
| `tools/apply_editbox_ime_patch.py` | 一键重打补丁；按 `settings.gradle` 里 `libcocos2dx` 的真实路径定位，自动备份、幂等（认 `QING-IME-PATCH` 标记），`--check` 只读 |

## 验证

- 真机小米 9 SE（`grus`，Android 11 / SDK 30，1080×2340 / density 480），`com.fireball.qing` release 包，`adb install -r` 覆盖安装。
- 日志（`adb logcat -s Cocos2dxEditBox`）：

```
ime=928 insetIme=928 sysBottom=928 frameDiff=928 rootH=2340 visibleBottom=1412 stripH=128
```

  三路来源在这台机上一致（928），容器底 + 928 = 键盘顶，视觉上零间隙。用户在真机上确认「显示正确了」。
- `gradlew :qing:assembleRelease` 通过（Java 增量 14s；全量首次 1m40s）。

## 未验证 / 注意

- 只测了一台机器。**手势导航、刘海屏、悬浮/分屏键盘、折叠屏未测**。三路来源不一致的机型会走优先级回退，日志里 `insetIme` / `sysBottom` / `frameDiff` 能直接看出哪路偏了。
- iOS 侧未动，也未测。
- **Java 改动走原生层，热更新下发不了**，必须重新出 APK。
- **重装/升级 Creator 会覆盖引擎目录**，届时跑 `python3 tools/apply_editbox_ime_patch.py` 重打（`--check` 可先确认状态）。
- 本次 APK 包名是 `com.fireball.qing`（`settings/builder.json` 配置），与手机上旧的 `com.ttcx.game` 是两个独立 App，可共存，安装后是新图标、需重新登录。
- 构建时偶发 `rm: ... archiver.list.tmp: Operation not permitted`（NDK 归档临时文件冲突），删掉该目录下 `archiver.list*` 重跑即可，与本次改动无关。
