# 项目记忆（Codex 自动读取）

最后更新：2026-07-23

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
- iOS 配置包含旧 SDK 路径、任意网络加载和占位 Universal Link；发布前需重新核查。
- `runtime-src.zip` 内包含构建缓存和旧工程文件，不能直接当作干净、当前可发布的原生模板。

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
- Android `Cocos2dxWebView` 曾为客服网页增加图片文件选择、禁缓存、文件访问、混合内容和返回键处理。当前 `panelKefu` 在 `cc.sys.openURL()` 后直接返回，内嵌 WebView 不可达；`panelSJBWeb` 又缺少 Prefab。默认不迁移；若恢复内嵌客服，只重写最小文件选择能力，不照搬全局混合内容和文件访问放开。
- iOS `CCDevice-ios.mm` 曾在读取电量前启用电量监控；项目牌桌确实显示电量，但 2.4.13 已内置相同处理，无需迁移。
- 2.2.1 `config.hpp` 强制启用 V8 Inspector 属于历史调试修改；2.4.13 已等效启用，不迁移旧 `#if 1`，发布前应另行评估是否关闭远程调试。
- 旧 Xcode engine 工程有 arm64 和删项兼容修改，2.4.13 工程结构已变化，不能按旧工程覆盖或照搬删项；只在新生成项目中配置目标架构并实际编译验证。
- 旧 `CCImage的副本.cpp/.h` 与官方源码一致，只是修改前备份，不参与迁移。旧 Simulator 中的本项目资源属于预览缓存，不是引擎补丁。

## 已知未完成界面需求

根目录 `问题.txt` 记录了已有缺口，包括提取奖励按钮、经理页面分享文字/比例按钮、牌局实时统计、牌型提示、切牌动画、牌桌图片和奖池数字等。实施前应再次确认哪些仍是当前需求。

## 换皮美术方向

- 2026-07-22 开始进行整套游戏换皮，暂定新游戏名为“秦”，原游戏名为 `Battle`。
- 已确认主风格为黑金、高档、克制的东方帝王风；曾尝试“未来东方奢华”科技版，但用户否定该方向并确定回到第一版风格。
- 第一阶段从竖屏登录界面开始，采用秦代宫阙、黑曜石、暗金纹样与鎏金品牌字，保留账号、密码、登录按钮的原交互层级；品牌字已使用可控字体重绘为准确的“秦”。
- Creator 协作约束：如果项目已经在 Cocos Creator 中打开，不得再次启动新的 Creator 实例；后续换皮任务只修改美术文件及必要的序列化资源引用，Creator 的打开、预览、保存和运行操作全部交由用户完成。
- 效果图落地约束：用户确认后的效果图就是实际运行资源的视觉基准，后续切图和替换必须完整保留其构图、纹样、材质、层次与装饰细节，不得为了便于生成而自行简化；若现有节点尺寸或结构确实无法原样承载，必须先说明限制并确认处理方式，不能先做简化版。
- 登录换皮已生成并接入：新增 `秦_登录背景.png`（750×1334）、`秦_输入框.png`（573×86）和 `秦_清除.png`（45×45），原位替换登录专用的 `账号.png`、`密码.png`、`手机登陆.png`；`panelLogin.prefab` 保持节点结构和节点名不变，只更新对应 SpriteFrame 引用及输入/占位文字颜色。
- 登录背景、输入框和清除按钮原资源均被其他界面共用，因此本次采用新增登录专用资源并只重绑 `panelLogin`，没有覆盖 `背景.png`、`公用/输入框.png`、`CHACHA.png`。新 UUID 已被 Creator 资源库识别，静态尺寸和引用检查通过；实际运行显示与交互由用户在现有 Creator 实例中验证。
- 登录页顶部LOGO已从会被四边Widget非等比拉伸的`秦_登录背景.png`中完整分离：圆环、“秦”和`QIN`现合并为新增的400×400 RGBA资源`秦_登录LOGO.png`，`panelLogin`新增同级节点`登录LOGO`，Sprite使用SIMPLE/CUSTOM且trimmed=false，Widget只启用TOP+HORIZONTAL_CENTER（alignFlags=17、top=118），固定宽高与1:1比例；背景仍保持750×1334 RGB及原UUID，只在原LOGO区域补回宫阙暗纹。生成脚本`tools/generate_qin_login_skin.py`使用原始带环源图生成独立LOGO，并用`art_sources/login/qin_login_background_clean_source.png`局部修复无LOGO背景；输入框、按钮、业务节点与逻辑均未改。实际多设备显示仍由用户在现有Creator实例中验证。
- 2026-07-22 用户指出登录LOGO的宋体“秦”与最初确认效果图不一致；现已按用户提供的确认图改为横向展开、尖角收笔的定制金属“秦”字及独立`QIN`排版，继续使用原400×400透明资源、同一`.meta`/UUID、Prefab节点和Widget参数；自动裁剪边界已随新透明像素更新为`trimX=34、trimY=9、331×382`。最终源图保存为`art_sources/login/qin_login_logo_final_source.png`，生成脚本优先使用该源图，避免重建时退回系统字体；静态合成预览已更新，Creator实际显示仍待用户验证。
- 当前 `assets/resources/project.manifest` 仍是旧热更新清单；换皮资源进入 Native 热更新或发布包前必须重新构建生成清单。
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

- `assets/resources/UI/panelGivePad.prefab`赠送确认弹窗已完成黑金秦风换皮：原位重绘仅本页引用的`赠送金币.png`、`名字垫底.png`、`金额.png`、`交易密码.png`和`赠送按钮1.png`，形成鎏金标题、秦印玩家信息条、象牙金表单文字及强调型主按钮；共享的弹窗框、输入框、头像/头像框、透明EditBox底图和取消按钮均未覆盖。Prefab仅统一昵称、ID、输入值和占位文字的暖金/灰金配色，并把原本位于弹窗外的固定金额Label从`(-604.72,-170.626)`校正到输入值区域`(3.617,-1.454)`，同时调整到输入框之后绘制，避免被黑色输入底遮挡；脚本依赖的节点路径、按钮名、圆形Mask及赠送业务逻辑未改。`tools/generate_qin_give_pad_skin.py`可确定性重建5张运行图片，真实资源按Prefab坐标合成的预览为`art_sources/give_pad/qin_give_pad_runtime_preview.png`；尺寸、RGBA、`.meta`/UUID、强蓝像素、Prefab JSON、SpriteFrame解析及重复生成哈希检查通过，从玩家资料进入的手输金额模式和大厅预填金额模式仍待用户在现有Creator实例中实际验证。
- `assets/resources/UI/panelUserInfo.prefab`玩家资料弹窗已完成清爽黑金秦风换皮：新增623×880的专用`assets/ImagesLuck/互动/用户信息框.png`并只重绑本页，原位重绘玩家信息标题、开通VIP、语音回放、赠送、语音聊天、九宫统计框、六个道具卡底框及九张统计标题，共17张本页UI图片。上半区使用大面积暖黑漆留白和细金边组织头像/身份/操作，统计区改为克制三行三列信息卡；头像、头像框、充值按钮和已换皮开关继续复用现有资源。
- 用户明确要求`panelUserInfo`的道具图片不用改；本轮已对亲嘴、鸡、啤酒、拇指、炸弹、枪及5张隐藏道具图做SHA-256保护校验，11张均保持逐字节不变，只替换其外层`表情框.png`。Prefab除专用大框SpriteFrame绑定与动态Label暖金/象牙金/铜红色板外，没有修改任何节点名、层级、尺寸、坐标、Button、Toggle或`panelUserInfo.ts`业务逻辑。`tools/generate_qin_user_info_skin.py`可确定性重建17张运行PNG和`art_sources/user_info/qin_user_info_runtime_preview.png`，`tools/patch_qin_user_info_prefab.py`可重复应用绑定，`tools/validate_qin_user_info_skin.py`已验证尺寸、RGBA、透明裁剪、UUID、道具哈希、关键布局及交互契约；Creator实际头像数据、VIP/赠送/语音和道具点击仍待用户在现有实例中验证。
- `assets/resources/UI/panelHongli.prefab`及其运行时加载的`玩家对象`、`盟主对象`、`贡献对象`、`总业绩对象`、`红利提取记录对象`五个条目Prefab已完成清爽黑金秦风换皮：原位重绘代理目录57张既有专用PNG，并新增82×27的`ImagesLuck/代理/盟主徽标.png`，覆盖主页面余额/统计/六个入口、玩家/盟主/业绩/提取记录子页、比例输入与授权/设置按钮。整体使用暖黑漆、细金边、象牙字和克制铜红，不再使用旧蓝青霓虹或西式皇冠；“提升.png”继续显示实际业务文案“设置”，“总业绩”按钮文字也已按节点语义纠正。所有动态Label统一为暖金、象牙、灰金、铜红和沉稳成功绿；推广二维码全屏层从旧`BATTLE`登录背景重绑到现有黑金推广背景；原本SpriteFrame为空的`盟主对象/type`已绑定新增盟主徽标。节点名、尺寸、Widget、Toggle、分页、EditBox、二维码Graphics、按钮父子层级、脚本和服务端字段均未修改。
- `tools/generate_qin_hongli_skin.py`可确定性重建58张运行PNG和`art_sources/hongli/`两张静态总览，`tools/patch_qin_hongli_prefabs.py`可重复应用文字色板与两项SpriteFrame绑定，`tools/validate_qin_hongli_skin.py`执行只读全量检查；本机可用`PYTHONDONTWRITEBYTECODE=1 /opt/homebrew/bin/python3.13 tools/generate_qin_hongli_skin.py`复跑。双遍生成哈希一致，58张PNG的尺寸、RGBA和透明裁剪与`.meta`一致，强蓝/青像素为0；`panelHongli`与5个条目Prefab JSON、关键路径、动态文字色板、推广背景/盟主徽标UUID及11张共享九宫格保护均验证通过。Creator中的26个页面/弹窗状态、动态列表、分页、二维码和代理授权/设置交互仍待用户在现有Creator实例中逐项验证。

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
