# 项目记忆（Codex 自动读取）

最后更新：2026-07-22

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
- 当前 `assets/resources/project.manifest` 仍是旧热更新清单；换皮资源进入 Native 热更新或发布包前必须重新构建生成清单。
- 登录换皮已以提交 `c0859bc` 推送到 `origin/main`；提交正文使用中文详细记录了资源、结构、验证结果和待验证风险。
- 共享弹窗背景 `assets/imagesKK/公用/框.png` 已经用户确认并替换为黑曜石、暗金多层边框、秦纹标题栏和底部秦印收口风格。图片保持635×680 RGBA，`.meta`、纹理UUID、SpriteFrame UUID及九宫格边距左83/右81/上106/下42均未改变；12个场景或Prefab共34处原引用继续生效。PNG、尺寸、透明通道和引用数静态检查通过，Creator实际显示仍由用户验证。
- 同目录4张原蓝色主操作按钮已同步为黑曜石暗金风：`充值.png`（154×54，1处引用）、`确定.png`（295×85，47处引用）、`赠送按钮.png`（305×85，1处引用）、`赠送按钮1.png`（258×84，1处引用）。均保持原文件名、尺寸、RGBA、`.meta`和UUID；箭头/返回/开关图标及原本米金色的`取消.png`不在本轮范围。静态图片检查通过，缩放显示和点击区域仍待用户在Creator中验证。
- `panelMain` 游戏大厅“发现”页首版效果已获用户确认并完成原位换皮：保留顶部“游戏大厅/客服”、快速加入及1/2/5/10/20档位、底部五项导航的现有结构；顶部仍严格使用750×92窄标题带和128×39中央标题，没有扩大节点或装饰占用范围。
- 发现页基础美术已原位覆盖31张现有PNG，包含大厅背景、共用顶部、客服、快速加入、房间卡、档位、底部导航和房间状态；共用图片按用户要求直接覆盖，因此`顶部.png`等其他引用位置会同步换皮。所有基础图片保持原文件名、像素尺寸、RGBA/RGB模式、自动裁剪边界、`.meta`和UUID。
- 用户随后明确取消大厅LOGO和底部“发现”按钮的DragonBones动画。`panelMain`保留原`LOGO`与`Down/发现/New Node`节点，但动画组件已改为普通`cc.Sprite`：顶部绑定`秦_大厅主视觉.png`（672×349），保持用户已保存的y=400.27/Widget top=92.225；底部绑定`秦_发现按钮.png`（209×146），为补偿旧骨骼原点将节点y从-77.97改为-4.295。两张静态图均使用CUSTOM尺寸、trim=false；对应动画图集不再被`panelMain`运行时引用。
- `地九王`不是旧游戏品牌名，而是本游戏的一种特殊规则；任何换皮都必须保留“地九王”原文字义，不得改成“秦牌九”等品牌字样。发现页房间卡的`地九王.png`已恢复为黑金“地九王”，倒计时Label（示例“剩余:30:00”）颜色已由蓝色改为暖金RGB(232,193,111)，规则逻辑和动态时间内容未改。
- 大厅换皮可由`tools/generate_qin_hall_skin.py`从`art_sources/hall/`源图确定性重建，当前脚本输出31张基础图片和2张静态主视觉图片；静态合成预览为`art_sources/hall/qin_hall_runtime_preview.png`。两张静态图尺寸、RGBA、透明裁剪、UUID及Prefab引用检查通过，实际显示与点击仍由用户在现有Creator实例中验证。
- `assets/resources/Prefabs/排行榜.prefab`已按同一黑金秦风完成美术原位替换：排行榜目录16张专用PNG全部覆盖，准确保留“排行榜”“开始时间/结束时间”“玩家手数排行榜”“名次/玩家信息/手数/奖励”及`1皮/2皮/5皮/10皮/20皮`规则文字；节点、Toggle、动态Label、服务端字段和两个排行榜条目模板均未改动。
- 排行榜同时覆盖12张其引用的共用PNG，包括通用背景、垫底、表格标题头、金币、列表分割线、返回、四个分页箭头、栏目标题框和提示底框；这些图片会按用户确认的共用资源原则同步影响其他界面。`tools/generate_qin_ranking_skin.py`可从`art_sources/ranking/qin_ranking_trophy_source.png`确定性重建28张运行图片，静态合成预览为`art_sources/ranking/qin_ranking_runtime_preview.png`。28张图片的尺寸、RGBA/RGB模式和自动裁剪范围均与现有`.meta`一致，强蓝色像素检查为0，`.meta`/UUID未修改；Creator实际布局和交互仍由用户在现有实例中验证。
- `assets/resources/zuotype/1.jpg`至`5.jpg`五张竖屏牌桌背景已按用户确认的候选图原位替换，依次为克制黑金、皇家深蓝、经典翡翠绿、低饱和酒红和暖灰胡桃木风格。五图均保持原文件名、750×1334 JPEG规格及原`.meta`/UUID，中央牌面操作区无文字和品牌标记；静态格式和画面检查通过，Creator中的实际遮挡、缩放与牌局UI叠加效果仍待用户在现有实例中验证。
- `panelMain/Main/我的`主页面已完成黑金秦风换皮：原位覆盖18张“我的”专用PNG及2张共享头像PNG，包含页面标题、头像框、默认头像、上传按钮、金币框、VIP垫/三种VIP卡、五个隐藏统计标题和六个功能选择条；六个入口继续准确保留“战绩、代理、交易明细、赠送/受赠、个人数据、设置”文字及原业务节点名、顺序、SpriteFrame UUID和点击逻辑。
- 旧默认头像中的`BATTLE`品牌已移除，改为无文字的秦将头像。共享`resources/other/默认头像.png`会同步影响31处/10个文件，`ImagesLuck/公用/头像2.png`会同步影响26处/7个文件；这是按用户确认的共享图片直接覆盖原则处理。昵称、ID、金币、VIP到期时间及隐藏统计数据仍由原动态Label显示，只把相关文字颜色统一为暖金/象牙金，未修改数据字段、显隐逻辑或头像层级。
- “我的”换皮可由`tools/generate_qin_mine_skin.py`从`art_sources/mine/qin_default_avatar_source.png`确定性重建，静态合成预览为`art_sources/mine/qin_mine_runtime_preview.png`。20张运行图片的尺寸、`.meta`宽高/裁剪范围和UUID均保持不变，强蓝/青像素检查为0；独立点击子面板`panelRecordList`现已单独完成换皮，`panelHongli`、`panelVipInfo`及其专用图片仍未修改。Creator实际布局、动态数据和点击交互仍由用户在现有实例中验证。
- `panelRecordList`战绩界面已完成黑金秦风换皮：原位覆盖`assets/ImagesLuck/战绩`目录19张PNG及共享`assets/ImagesLuck/公用/我的战绩框.png`，包含标题、统计框、今天/昨天/前一天选中与未选中态、列表栏目文字及房间/底皮/时间/输赢条目图标；准确保留原业务文字、Toggle状态、分页按钮、节点名和查询逻辑。
- 战绩动态文字已同步匹配黑金风：`panelRecordList.prefab`的总局数、总手数和页码改为暖金；`战绩对象.prefab`的房间号为暖金、底皮/时间为象牙金、默认输赢为铜红；`panelRecordList.ts`仍按正负分支动态着色，但纯红/纯绿分别收敛为铜红RGB(196,86,66)和沉稳绿RGB(92,156,111)，没有修改字段、分页、Toggle或点击逻辑。生成脚本`tools/generate_qin_record_list_skin.py`使用已确认的完整战绩框源图`art_sources/record_list/qin_record_header_final_source.png`确定性重建20张运行图片，静态预览为`art_sources/record_list/qin_record_list_runtime_preview.png`；全部图片保持原尺寸、模式、自动裁剪边界、`.meta`和UUID，3张索引色图片也已固定透明裁剪边界，强蓝/青像素检查为0，Prefab JSON校验通过。共享背景、顶部、表格标题头、分割线、返回及分页箭头继续复用此前完成的黑金资源；Creator实际布局、Toggle切换、动态列表和点击进入详情仍待用户在现有实例中验证。
- 用户在Creator预览中反馈战绩统计框上半部留白过大、右上徽章过小且失衡，并明确要求实际资源不得简化效果图。`我的战绩框.png`现已直接按确认稿完整保留大型秦卷轴、圆形回纹、月桂、云纹、两侧精细装饰线、黑曜石纹理、分隔线和多层圆角金框，只去除预览棋盘格并适配为原612×279 RGBA；为避免独立统计条遮挡徽章底部，`局数手数`及两个动态数字节点整体下移20像素进入效果图预留的下方区域，节点名、引用和数据逻辑不变。
- `panelRecordInfo`战局详情界面已完成黑金秦风换皮：原位覆盖`assets/ImagesLuck/战绩详情`目录20张PNG及其使用的4张“牌局回顾/文字牌谱”选中与未选中图，旧`POKER STAR`标识已替换为无外部品牌的“秦”印；土豪、MVP、大鱼、劳模、奖池、总带入、总手数、名次、列表底框、筹码和双状态页签均统一为黑曜石暗金风，准确保留原文字语义。
- `panelRecordInfo.prefab`本身及运行时加载的`战绩玩家对象`、`回顾对象2`、`文字牌谱对象2`节点结构、业务脚本和SpriteFrame引用未改；主面板4处旧青色动态数据文字改为暖金RGB(232,193,111)。`tools/generate_qin_record_info_skin.py`可确定性重建24张运行图片，静态预览为`art_sources/record_info/qin_record_info_runtime_preview.png`。24张图片的像素尺寸、透明裁剪范围和`.meta`均检查一致，强蓝色像素为0，四份Prefab JSON解析通过；Creator中的实际动态数据、滚动列表、回顾切换和分页点击仍待用户在现有实例中验证。
- `assets/resources/Prefabs/钱包.prefab`及钱包内部动态条目`交易查询对象.prefab`、`银行对象.prefab`已完成黑金秦风换皮，覆盖充值、提现、记录、充值信息、实名认证、订单详情和选择银行等全部内嵌状态；原位重绘51张现有运行图片，并新增214×58的`钱包/支付宝提现.png`，补齐原Prefab缺失的支付宝提现背景/选中态。充值渠道中的银联、支付宝、微信、VIP及通用选择Tab按用户要求保留原图，不参与本轮重绘。
- 钱包新增支付宝提现SpriteFrame只绑定到原Toggle的Background和checkMark，节点名、Toggle target/checkMark引用、初始选中状态及脚本路径均保持不变；为使原零宽节点可显示和点击，仅把`支付宝提现`父节点宽度由0修正为201，并将其两层图片恢复为与银行卡/USDT相同的214×58布局。动态金额、输入值、提示、实名、订单和两个列表模板文字统一为暖金、象牙金、灰金与克制铜红，没有修改字符串、服务端字段或业务分支。
- 钱包换皮可由`tools/generate_qin_wallet_skin.py`从`art_sources/wallet/qin_wallet_emblem_source.png`确定性重建，六状态静态预览为`art_sources/wallet/qin_wallet_runtime_preview.png`。52张输出图片的尺寸和透明裁剪范围均与`.meta`一致，既有`.meta`/UUID未改，新增资源使用独立UUID，强蓝/青像素检查为0；共用`公用/btn_4.png`会按共享覆盖原则同步影响8个文件中的18处关闭按钮。外部`panelKefu`、`panelMsgView`和`panelLoading`未纳入，Creator中的服务端动态渠道、三种提现方式、EditBox、列表和点击交互仍待用户在现有实例中验证。

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
