# 2026-09-07 Android Studio 编译报错与 APK 体积排查

- 工作目录：`/Volumes/SSD/qing`，分支 `main`。
- 原生工程：`build/jsb-link/frameworks/runtime-src/proj.android-studio`（模块 `qing`，包名 `com.fireball.qing`）。
- 环境：Android Studio Meerkat **2024.3.1 (AI-243.22562.218)**，自带 JBR 21；AGP 8.7.3、Gradle 8.9、NDK 25.1.8937393、SDK 35 / Build Tools 35.0.1。
- 本轮只做只读排查与命令行验证，未修改任何构建脚本、资源或 Prefab，未执行发布。

## 一、Android Studio 报错根因

### 1. Gradle 同步失败（直接导致无法编译）

`.idea/gradle.xml` 第 9 行 `gradleJvm="#GRADLE_LOCAL_JAVA_HOME"`，Meerkat 2024.3 无法解析该值：

```
Gradle JVM (#GRADLE_LOCAL_JAVA_HOME) isn't resolved: SdkInfo$Undefined
onFailure(RESOLVE_PROJECT:0, ExternalSystemJdkException: Invalid Gradle JDK configuration found.)
Gradle sync failed in 358 ms
```

15:54 手动指定 `jbr-17.0.14` 后同步成功（24.8 s），但 `gradle.xml` 未被写回，重开仍会复现。
修复：Studio → Settings → Build Tools → Gradle → **Gradle JDK** 选择 `jbr-17.0.14`（与 `.idea/misc.xml` 的 JDK_17 一致，AGP 8.7.3 官方要求 17）或 Embedded JDK 21，Apply 让 IDE 写回配置。

### 2. 构建其实成功，但 Studio 报“找不到 APK”

根 `build.gradle` 第 20–24 行把所有模块 `buildDir` 重定向到 `java.io.tmpdir`：

```
buildDir = new File(System.getProperty('java.io.tmpdir'), "qing-android-gradle/${project.name}")
```

Studio 用 `-Pandroid.injected.apk.location=.../app` 拼接重定向路径，拼出十余层 `../`，抛
`FileNotFoundException: .../apk_ide_redirect_file/release/.../app/release/output-metadata.json`（`GoToApkLocationTask`）。
这是 IDE 定位 APK 的 UI 回调异常，APK 已实际生成。

该重定向的注释原因是“exFAT 卷产生 `._*` AppleDouble 文件”，但当前卷文件系统为 **Journaled HFS+**，工程内已检索不到任何 `._*` 文件，前提不成立。

### 3. 次要项

- `local.properties` 的 `ndk.dir` 已被 AGP 8 弃用（CXX5106 警告）；`app/build.gradle` 已有 `ndkVersion "25.1.8937393"`，可删。
- `PROP_MIN_SDK_VERSION=16` 低于 NDK 25 最低支持，每次构建刷 “Platform version 16 is unsupported by this NDK, using 19 instead”。改 19 可消除，但会缩小可安装设备范围。
- 工程根目录残留两个 Gradle OOM 堆转储：`java_pid26794.hprof`(553 MB)、`java_pid50462.hprof`(574 MB)，共约 1.1 GB。

### 命令行验证（均通过）

`assembleDebug --dry-run`、`compileDebugJavaWithJavac`（含 `libcocos2dx`）、`buildNdkBuildDebug[arm64-v8a]/[armeabi-v7a]`、`assembleDebug`（JDK 19 与 JBR 21 两种 JVM）全部 `BUILD SUCCESSFUL`。

## 二、APK 体积构成

对象：`app/release/0907-1.apk`（127,146,908 字节，2026-09-07 15:56 由 Studio `assembleRelease` 产出）。上一版 `8L-0813-2.apk` 为 77.4 MB（8 月 13 日）。

| 顶层 | 原始 | 占原始 | 说明 |
|---|---|---|---|
| assets | 106.26 MB | 66.3% | 压缩后约 100 MB，占 APK 约 83%（PNG 已压缩，zip 二次压缩率仅 94%） |
| lib | 52.18 MB | 32.6% | 压缩后 19.21 MB：arm64-v8a 29.26→9.94 MB、armeabi-v7a 22.92→9.27 MB |
| 其它 | ~1.7 MB | 1.1% | META-INF、dex(0.21 MB)、res、root |

assets 内按来源（用 `.meta` UUID 映射到 `build/jsb-link/assets/resources/native`）：

| 来源 | 包内 | 占比 |
|---|---|---|
| `resources/V7` | 50.12 MB | 49.0% |
| `resources/avatars` | 12.73 MB | 12.4% |
| `resources/pk2` | 8.81 MB | 8.6% |
| `ImagesLuck` | 6.03 MB | 5.9% |
| `resources/Audio` | 3.50 MB | 3.4% |
| `Images` | 2.72 MB | 2.7% |
| `ImagesXYPK` | 2.31 MB | 2.3% |
| `resources/zuotype` | 1.78 MB | 1.7% |
| `imagesKK` | 1.60 MB | 1.6% |
| `assets/font/PingFF.ttf` | 10.34 MB | 10.1% |
| 其它（main、jsb-adapter、other 等） | ~1.5 MB | — |

## 三、增量来源结论

- `assets/resources/V7` 于 **2026-09-04 首次进入 Git**，8 月 13 日版本不存在该目录（已用 `git log --until=2026-08-14` 核实）。
- V7 共 **674 个文件、源 52 MB**，其中 337 个 PNG 合计 50.12 MB 全部进包；压缩后约 47 MB，与 APK 增量 121.3 − 77.4 ≈ 44 MB 吻合。
- **APK 增量的 100% 来自 V7 换肤资源。**

V7 体积大的直接原因：

- 26 张单文件 >1 MB，均为全画布长背景母版（750×1800、750×1334、1223×1286），如 `shield_hd.png` 1.86 MB、`announcement_menu_long_exact.png` 1.83 MB、`followup_*_master_long.png` 一组各 1.3 MB 左右。
- 337 张 PNG 中 **316 张为 8bit RGBA32 真彩**，仅 21 张 RGB；未做量化或纹理压缩。
- Cocos 对 `assets/resources/` 是**全量打包**，不判断是否被引用。

## 四、优化候选（均需评估后再动）

1. **V7 长图量化压缩**（收益最大）：pngquant 质量 80–85 保留 alpha，预计 −55%~−70%，约省 25–35 MB。约束：只在源 `assets` 替换且“更小时才替换”、保留 `.meta`/UUID，之后需 Creator 重建、重做热更摘要、核对颜色/Alpha/图集切片与 Native 旧格式兼容；渐变处可能出现色带，需目视确认。
2. **删除 V7 中疑似废弃资源**：按 UUID/路径扫描，61 个文件（4.41 MB）未在任何 `.prefab`/`.fire`/`.ts`/`.js`/`.json` 中被引用，含 `followup_ranking_wins_master_long.png`、`followup_ranking_bonus_master_long.png`（合计 2.62 MB）、`input_user.png`、`input_password.png`、`login_button.png`、`mine_*` 六连图、`wallet_channel_*_selected` 四张等。删除前须按动态加载契约复核（可先用只读的 `tools/audit_cocos_unused_assets.py`）。
3. **PingFF.ttf 10.34 MB**：位于 `assets/font`，非新增。字库子集化可省 6–8 MB，但字体承载服务端公告、玩家名、聊天等任意动态文本，禁止只按源码汉字裁字库，风险高。
4. **lib 双 ABI**：armeabi-v7a 压缩后 9.27 MB。仅保留 arm64-v8a 可省约 9 MB，或改 AAB 由商店按 ABI 分发。
5. **旧目录（avatars 12.7 / pk2 8.8 / ImagesLuck 6.0 / Images 2.7 / ImagesXYPK 2.3 / imagesKK 1.6）**：若改走热更/远程加载可移出基础包，但涉及动态加载契约，需单独评估。

## 五、未验证

- 未执行任何压缩/删除/构建改动，本页数字为当前产物与源资产的实测统计。
- 未验证压缩后各页面实际观感、Creator 重建结果、热更摘要与真机安装。
- Studio 侧两项修复（Gradle JDK、buildDir 重定向）尚未实施，未重跑 IDE 内构建确认。
