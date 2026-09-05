# 构建、发布、环境与资源审计

整理日期：2026-09-05。历史提炼，本轮未执行 Creator/Gradle/Xcode 构建、资源生成、网络访问或发布。文中的工具和检查是按任务选用的导航，不是立即运行清单；先读源码确认副作用和现行参数。

## 恢复目录与真实资产

- 2026-09-03 故障 CCCC 盘恢复到 `/Volumes/SSD/qing`。原记忆中的 `/Volumes/CCCC/qing`、CB 及旧卷路径是历史地点，不作默认活跃目录；新任务仍须核对挂载、实际 cwd、Git 分支/HEAD 和未提交修改。
- 用户明确“和之前一样”包括真实 `build` 原生工程。恢复内容含 build/jsb-link、build/ios-unsigned、build/web-mobile、native、runtime-src.zip、跨平台生成历史参考、热更产物等。**不能把整个 build 当可随意删的缓存**；其中有生成后定制的原生桥、模板外补丁和交付包。
- 原恢复省略 library、temp、node_modules 和部分派生缓存，不是故障盘逐字节镜像。旧日期的文件数、容量、哈希只证明当次救援，不代表今日目录状态。
- 正式环境配置、签名文件、私钥只在受控位置读取，不复制到专题/日志。仓库 `.meta`/UUID 与场景/Prefab 绑定必须保留。

来源：[原记忆](../archive/2026-09-05/AGENTS.original.md)第 23–24、61、583–590 行。

## 构建顺序和不可混淆的状态

- Cocos 版本历史基线 2.4.13；构建前看当前实例、启动场景、目标平台、输出目录与用户本次要求。源码修改完成、快速脚本编译、Web 预览、Creator 构建、Gradle/Xcode 编译、签名安装、真机联调、上传发布是独立状态。
- **Gradle assemble 只包装现有 Creator 运行资源**，不会自动将最新 assets/scripts 编入。先 Creator 生成对应平台最新资源，再核查并同步项目级原生桥，再原生编译；对照 APK/IPA 内 assets/main/index 与最新 Creator 输出哈希。
- Creator 重生成可覆盖 build/jsb-link 的原生改动；重建前核对 Android/iOS 设备、语音、客服桥及全局引擎补丁实际位置。同步脚本有写入副作用，执行前读当前实现并确认适用工程。
- 历史 Android 工具链：AGP 8.7.3、Gradle 8.9、NDK 25.1.8937393、SDK 35、Build Tools 35.0.1，主模块 qing、包名 com.fireball.qing。这些不是要求无条件重配，需确认当前文件。不能签 instantapp；ZIP 有效也不证明启动或语音成功。
- 旧 Java min API 16 与 NDK Native API 19 不一致，不能把 API 16 当已验证支持。签名/ABI/Manifest/产物内资源及实际安装版本均需检查；Android Studio Apply Changes 不等同重新装最新 APK。
- 历史 iOS 包分检查包、完整未签名包、带语音包和可调试包。未签名归档不等于可安装/可发布；按实际 Info.plist、架构、资源、签名状态核验，不能仅按旧文件名选包。

来源：原记忆第 35、362–383、400–408、435–449 行。

## 原生与引擎踩坑

- 旧 2.2.1 引擎差异不能整体覆盖 2.4.13。历史仅确认移植 Native 旧格式 PNG 解码兼容到全局 CCImage.cpp；普通与旧格式图片兼容是混淆，不是安全加密。升级/重装 Creator 会覆盖该补丁，热更图片应先转换再生成 manifest/MD5。
- 键盘排错有多轮互相替代的尝试。2026-07-23 后段明确撤销自定义 Insets/平移等方案，最终历史临时方案是原布局按控件高度提高输入栏，保留 GLSurfaceView 原生编辑期间不自动 complete() 的修复。**不要拿早段“第五版 Insets”当最终状态重新恢复**；先核查全局实际文件、备份和最新真机证据。
- 曾制作允许 Release 开放 V8 Inspector 的内部测试包；正式对外包应核验调试条件保护，不沿用该测试设置。
- iOS libwebp.a 的旧胖包对齐问题曾用项目内 arm64 重封装解决；受限环境的 CoreSimulatorService 错误不证明平台组件损坏。查工具输出和实际 Xcode 环境后再决定，勿先重装。
- exFAT 曾产生 ._* AppleDouble，污染资源/Gradle 输出。历史已迁过 APFS，当前卷格式需实查；保留现有将中间产物放 APFS 临时盘的规避，除非独立验证后简化。不能“所有点文件”统删，.git/.gitignore 必须保留。

来源：原记忆第 366–378、420–451、581 行。

## 发布入口与持久性

- Native 热更实际入口为 `UI/panelUpdate.ts`，不是基本未使用的 logic/UpdateManager.ts。主/次版本提高触发强更、补丁位变化走热更的历史流程先核验；原记忆第 315 行旧 1.x 示例已被后续版本替代。
- 2026-08-15 本地 manifest 报告为 3.0.8，仅证明本地清单；任何历史本地/公网版本都不作今日事实。发布链：最新 Native 构建→生成产物→上传暂存→原子切换→远端版本/资源数/MD5→旧客户端真机升级。
- 热更重启生效依赖基础包 main.js 在 settings/引擎/bundle 前恢复 HotUpdateSearchPaths。`tools/generate_hot_update.py` 的引导补丁不在仅 src/assets 的热更 ZIP 内，旧基础包不能靠热更新获得它。
- Web 图保护入口 `tools/protect_web_images.js` 仅改最终 build/web-mobile 图片并注入加载器，不改源图、不处理 Native。`3上传网页版.command` 会在最终上传确认之前先改本地构建；取消上传也不回滚本地密文构建。所谓“只做本地保护检查”的不带 verify 参数命令也有写入，不能当只读运行。
- Web 上传前重新 Creator 构建，保护再校验再打包；源图变化后不复用旧产物。WebHome 独立目录和 `4上传推广网站.command` 属另一发布；描述文件/网页入口不是 IPA。对外历史用语不能用于技术判断包类型。
- Web 入口不缓存，带内容哈希资源才适用长期 immutable；未带哈希的热更 /up 资源不能照搬一年缓存。HTTP 缓存不等同 Service Worker/PWA。
- Caddy 管理 API 的路由可能重启丢失，历史有缓存/语音/客服等幂等恢复脚本与 cron；新迁移先读 `服务器完整安装与迁移手册.md`、`deploy/server/` 并取得必要系统导出，不能假设普通部署账号看得到全部旧服务。

来源：原记忆第 65–66、74、80–90、315、432–433、445 行。脚本名是定位入口，执行参数以当前工具帮助/源码为准。

## 资源审计与危险命名工具

- **`tools/validate_qin_drh8_skin.py` 会重建并改写 141 张运行美术，绝非只读检查。** 脏工作区禁止直接运行。优先 JSON、Meta、尺寸、UUID、哈希等只读验证；确需执行先保存限定文件清单/哈希，不能以全仓回滚收尾。
- `tools/audit_cocos_unused_assets.py` 历史为只读审计：跟踪场景、Prefab、脚本、压缩/标准 UUID、DragonBones 及动态加载约定。实际运行前仍检查当前实现。报告候选不是删除批准。
- 动态保护范围至少有表情2、pk2、zuotype、本地头像、道具/音效、other/<服务端状态值>、other/drh、other/牌谱、动态 UI/条目、KBE 实体及全局脚本。没有直接 UUID 引用不等于未使用。
- 字体承载服务端公告/玩家名/聊天等任意动态文本，不能只收集源码汉字生成极小字库；保留文件名/.meta 也需验证字符覆盖、布局和三端显示。
- 包体按产物逻辑/压缩字节看，不用 exFAT 的 du 分配占用推断。源码候选未进入构建不等于可节省 APK/IPA 体积；历史数量/测算均非今日保证。
- 图片优化应在源 assets，保留 .meta/UUID、仅更小时替换；后续需重建、重做热更摘要、核对颜色/Alpha/图集切片及 Native 旧格式兼容。不直接改 build 冒充源修改。

来源：原记忆第 73、574–581 行。历史审计产物定位：`reports/cocos-unused-assets-audit-2026-07-29.md`、对应 candidates CSV 与 dynamic-assets-retained CSV。

## 重启此类任务先核查

核对当前盘/分支/目标平台/用户未提交改动、运行中的 Creator、最新源码和构建时间、源资源与安装包哈希、原生补丁是否仍在、部署配置和授权范围。旧静态安全审查第 334–339 行只能作为再审入口，不直接当作当前未修复事实，也不复述其中凭据。不要为完成文档整理而运行生成器、清理资源、迁移服务器或发布。
